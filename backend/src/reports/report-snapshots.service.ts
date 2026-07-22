import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountingDirection,
  BusinessRecordPublicationStatus,
  BusinessRecordStatus,
  Prisma,
  RecordDataLayer,
  ReportSnapshotType
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportSnapshotDto } from './dto/create-report-snapshot.dto';
import { QueryReportSnapshotSourcesDto } from './dto/query-report-snapshot-sources.dto';
import {
  CanonicalReportSnapshot,
  REPORT_CANONICALIZATION_VERSION,
  REPORT_QUERY_VERSION,
  REPORT_RETENTION_CLASS,
  REPORT_SNAPSHOT_SCHEMA_VERSION,
  ReportCurrencyMetrics,
  ReportSnapshotBreakdown,
  ReportSnapshotMetrics,
  ReportSnapshotWarning,
  reportSnapshotHashInput
} from './report-snapshot.contract';
import { formatChinaDate, reportRange } from './report-period';

const REPORT_TRANSACTION_TIMEOUT_MS = 60_000;
const REPORT_TRANSACTION_MAX_ATTEMPTS = 3;

const reportRecordSelect = {
  id: true,
  projectId: true,
  version: true,
  recordDate: true,
  amount: true,
  currency: true,
  accountingDirection: true,
  category: true,
  subCategory: true,
  sourceType: true,
  sourceId: true,
  confirmedAt: true,
  updatedAt: true,
  project: { select: { name: true } }
} satisfies Prisma.BusinessRecordSelect;

type ReportRecord = Prisma.BusinessRecordGetPayload<{ select: typeof reportRecordSelect }>;
type StoredSnapshot = Prisma.ReportSnapshotGetPayload<Record<string, never>>;

interface SnapshotSourceRow {
  recordId: string;
  recordVersion: number;
  recordHash: string;
  projectId: string;
  recordDate: Date;
  currency: string;
  accountingDirection: AccountingDirection;
  amount: string;
}

@Injectable()
export class ReportSnapshotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async create(
    dto: CreateReportSnapshotDto,
    actor: CurrentUser,
    context: RequestContext
  ) {
    const projectIds = this.normalizeProjectIds(dto.projectIds);
    const range = reportRange(this.reportPeriod(dto.reportType), dto.date);

    const createSnapshot = async (tx: Prisma.TransactionClient) => {
      await this.assertProjectsExist(tx, projectIds);
      const records = await tx.businessRecord.findMany({
        where: {
          projectId: projectIds.length > 0 ? { in: projectIds } : undefined,
          publicationStatus: BusinessRecordPublicationStatus.published,
          dataLayer: RecordDataLayer.actual,
          status: BusinessRecordStatus.confirmed,
          recordDate: { gte: range.start, lt: range.end }
        },
        select: reportRecordSelect,
        orderBy: { id: 'asc' }
      });
      const sourceRows = records.map((record) => this.sourceRow(record));
      const sourceDigest = canonicalJsonSha256(sourceRows.map((source) => ({
        recordId: source.recordId,
        recordVersion: source.recordVersion,
        recordHash: source.recordHash
      })));
      const watermark = await this.databaseWatermark(tx, sourceDigest);
      const scopeProjectIds = projectIds.length > 0
        ? projectIds
        : [...new Set(records.map((record) => record.projectId))].sort();
      const metrics = this.metrics(records);
      const warnings = this.warnings(metrics);
      const snapshotId = randomUUID();
      const snapshotWithoutHash: Omit<CanonicalReportSnapshot, 'snapshotHash'> = {
        schemaVersion: REPORT_SNAPSHOT_SCHEMA_VERSION,
        snapshotId,
        reportType: dto.reportType,
        period: {
          start: formatChinaDate(range.start),
          endExclusive: formatChinaDate(range.end),
          timezone: 'Asia/Shanghai'
        },
        scope: {
          organizationId: 'default',
          scopeType: scopeProjectIds.length === 1
            ? 'PROJECT'
            : projectIds.length > 0 ? 'PROJECT_SET' : 'COMPANY',
          projectIds: scopeProjectIds
        },
        dataPolicy: {
          recordStatus: 'CONFIRMED',
          dataLayer: 'ACTUAL',
          currencies: metrics.byCurrency.map((item) => item.currency),
          currencyAggregation: 'SEPARATE_BY_CURRENCY'
        },
        metrics,
        breakdowns: this.breakdowns(records),
        warnings,
        queryVersion: REPORT_QUERY_VERSION,
        dataWatermark: watermark.value,
        sourceDigest,
        canonicalizationVersion: REPORT_CANONICALIZATION_VERSION,
        generatedAt: watermark.generatedAt.toISOString(),
        retentionClass: REPORT_RETENTION_CLASS
      };
      const snapshotHash = canonicalJsonSha256(reportSnapshotHashInput(snapshotWithoutHash));
      const snapshot: CanonicalReportSnapshot = { ...snapshotWithoutHash, snapshotHash };

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${snapshotHash}, 0))`;
      const existing = await tx.reportSnapshot.findUnique({ where: { snapshotHash } });
      if (existing) {
        await this.auditLogs.write(
          tx,
          actor,
          'report.snapshot.reused',
          'report_snapshot',
          existing.id,
          { reportType: dto.reportType, snapshotHash, sourceCount: existing.sourceCount },
          context
        );
        return this.present(existing, true);
      }

      const created = await tx.reportSnapshot.create({
        data: {
          id: snapshotId,
          schemaVersion: REPORT_SNAPSHOT_SCHEMA_VERSION,
          reportType: dto.reportType,
          scopeType: snapshot.scope.scopeType,
          projectIds: this.json(snapshot.scope.projectIds),
          periodStart: range.start,
          periodEndExclusive: range.end,
          timezone: snapshot.period.timezone,
          dataPolicy: this.json(snapshot.dataPolicy),
          metrics: this.json(snapshot.metrics),
          breakdowns: this.json(snapshot.breakdowns),
          warnings: this.json(snapshot.warnings),
          queryVersion: REPORT_QUERY_VERSION,
          dataWatermark: snapshot.dataWatermark,
          sourceDigest,
          sourceCount: sourceRows.length,
          canonicalizationVersion: REPORT_CANONICALIZATION_VERSION,
          snapshotHash,
          snapshotJson: this.json(snapshot),
          retentionClass: REPORT_RETENTION_CLASS,
          createdBy: actor.id,
          ...(sourceRows.length > 0 ? {
            sources: {
              createMany: {
                data: sourceRows.map((source) => ({
                  recordId: source.recordId,
                  recordVersion: source.recordVersion,
                  recordHash: source.recordHash,
                  projectId: source.projectId,
                  recordDate: source.recordDate,
                  currency: source.currency,
                  accountingDirection: source.accountingDirection,
                  amount: source.amount
                }))
              }
            }
          } : {})
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'report.snapshot.created',
        'report_snapshot',
        created.id,
        {
          reportType: dto.reportType,
          snapshotHash,
          sourceDigest,
          sourceCount: sourceRows.length,
          projectIds: scopeProjectIds
        },
        context
      );
      return this.present(created, false);
    };

    // Concurrent identical requests can abort repeatable-read or race on snapshotHash.
    for (let attempt = 1; attempt <= REPORT_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(createSnapshot, {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 5_000,
          timeout: REPORT_TRANSACTION_TIMEOUT_MS
        });
      } catch (error) {
        if (attempt === REPORT_TRANSACTION_MAX_ATTEMPTS || !this.isSnapshotWriteConflict(error)) throw error;
      }
    }
    throw new Error('Report snapshot transaction retry state is inconsistent');
  }

  async findOne(id: string) {
    const snapshot = await this.getStored(id);
    return this.present(snapshot, false);
  }

  async sources(id: string, query: QueryReportSnapshotSourcesDto) {
    const storedSnapshot = await this.getStored(id);
    const canonicalSnapshot = storedSnapshot.snapshotJson as unknown as CanonicalReportSnapshot;
    if (
      canonicalSnapshot.snapshotId !== storedSnapshot.id
      || canonicalSnapshot.snapshotHash !== storedSnapshot.snapshotHash
    ) {
      throw new Error('报告快照完整性校验失败');
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ReportSnapshotSourceWhereInput = {
      snapshotId: id,
      projectId: query.projectId,
      currency: query.currency,
      accountingDirection: query.accountingDirection
    };
    const projectNames = new Map(
      canonicalSnapshot.breakdowns.map((breakdown) => [breakdown.projectId, breakdown.projectName])
    );
    const [items, total] = await Promise.all([
      this.prisma.reportSnapshotSource.findMany({
        where,
        orderBy: [{ recordDate: 'asc' }, { recordId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.reportSnapshotSource.count({ where })
    ]);
    return {
      items: items.map((item) => ({
        recordId: item.recordId,
        recordVersion: item.recordVersion,
        recordHash: item.recordHash,
        projectId: item.projectId,
        projectName: projectNames.get(item.projectId) ?? item.projectId,
        recordDate: item.recordDate.toISOString(),
        currency: item.currency,
        accountingDirection: item.accountingDirection,
        amount: item.amount.toFixed(2)
      })),
      page,
      pageSize,
      total,
      snapshot: {
        snapshotId: storedSnapshot.id,
        snapshotHash: storedSnapshot.snapshotHash,
        sourceDigest: storedSnapshot.sourceDigest,
        dataWatermark: storedSnapshot.dataWatermark,
        sourceCount: storedSnapshot.sourceCount
      }
    };
  }

  async getStored(id: string): Promise<StoredSnapshot> {
    const snapshot = await this.prisma.reportSnapshot.findUnique({ where: { id } });
    if (!snapshot) throw new NotFoundException('报告快照不存在');
    return snapshot;
  }

  private normalizeProjectIds(values?: string[]) {
    const projectIds = [...new Set((values ?? []).map((value) => value.trim()))].sort();
    if (projectIds.some((value) => value.length === 0 || value.length > 256)) {
      throw new BadRequestException('项目 ID 不合法');
    }
    return projectIds;
  }

  private async assertProjectsExist(tx: Prisma.TransactionClient, projectIds: string[]) {
    if (projectIds.length === 0) return;
    const projects = await tx.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true }
    });
    if (projects.length !== projectIds.length) throw new NotFoundException('项目不存在');
  }

  private reportPeriod(type: ReportSnapshotType) {
    if (type === ReportSnapshotType.WEEKLY) return 'week' as const;
    if (type === ReportSnapshotType.MONTHLY) return 'month' as const;
    return 'today' as const;
  }

  private sourceRow(record: ReportRecord): SnapshotSourceRow {
    const content = {
      recordId: record.id,
      recordVersion: record.version,
      projectId: record.projectId,
      recordDate: record.recordDate.toISOString(),
      amount: record.amount.toFixed(2),
      currency: record.currency,
      accountingDirection: record.accountingDirection,
      category: record.category ?? null,
      subCategory: record.subCategory ?? null,
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      confirmedAt: record.confirmedAt?.toISOString() ?? null,
      updatedAt: record.updatedAt.toISOString()
    };
    return {
      recordId: record.id,
      recordVersion: record.version,
      recordHash: canonicalJsonSha256(content),
      projectId: record.projectId,
      recordDate: record.recordDate,
      currency: record.currency,
      accountingDirection: record.accountingDirection,
      amount: record.amount.toFixed(2)
    };
  }

  private metrics(records: ReportRecord[]): ReportSnapshotMetrics {
    const groups = new Map<string, { income: Prisma.Decimal; cost: Prisma.Decimal; recordCount: number }>();
    for (const record of records) {
      const current = groups.get(record.currency) ?? {
        income: new Prisma.Decimal(0),
        cost: new Prisma.Decimal(0),
        recordCount: 0
      };
      if (record.accountingDirection === AccountingDirection.income) {
        current.income = current.income.plus(record.amount);
      } else {
        current.cost = current.cost.plus(record.amount);
      }
      current.recordCount += 1;
      groups.set(record.currency, current);
    }
    const byCurrency = [...groups.entries()]
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([currency, values]) => this.currencyMetrics(currency, values));
    const only = byCurrency.length === 1 ? byCurrency[0] : undefined;
    return {
      currency: only?.currency ?? null,
      income: only?.income ?? null,
      cost: only?.cost ?? null,
      profit: only?.profit ?? null,
      recordCount: records.length,
      byCurrency
    };
  }

  private breakdowns(records: ReportRecord[]): ReportSnapshotBreakdown[] {
    const groups = new Map<string, {
      projectId: string;
      projectName: string;
      currency: string;
      income: Prisma.Decimal;
      cost: Prisma.Decimal;
      recordCount: number;
    }>();
    for (const record of records) {
      const key = `${record.projectId}\u0000${record.currency}`;
      const current = groups.get(key) ?? {
        projectId: record.projectId,
        projectName: record.project.name,
        currency: record.currency,
        income: new Prisma.Decimal(0),
        cost: new Prisma.Decimal(0),
        recordCount: 0
      };
      if (record.accountingDirection === AccountingDirection.income) {
        current.income = current.income.plus(record.amount);
      } else {
        current.cost = current.cost.plus(record.amount);
      }
      current.recordCount += 1;
      groups.set(key, current);
    }
    return [...groups.values()]
      .sort((first, second) => first.projectId.localeCompare(second.projectId)
        || first.currency.localeCompare(second.currency))
      .map((item) => ({
        projectId: item.projectId,
        projectName: item.projectName,
        ...this.currencyMetrics(item.currency, item)
      }));
  }

  private currencyMetrics(
    currency: string,
    values: { income: Prisma.Decimal; cost: Prisma.Decimal; recordCount: number }
  ): ReportCurrencyMetrics {
    return {
      currency,
      income: values.income.toFixed(2),
      cost: values.cost.toFixed(2),
      profit: values.income.minus(values.cost).toFixed(2),
      recordCount: values.recordCount
    };
  }

  private warnings(metrics: ReportSnapshotMetrics): ReportSnapshotWarning[] {
    const warnings: ReportSnapshotWarning[] = [];
    if (metrics.recordCount === 0) {
      warnings.push({
        code: 'NO_CONFIRMED_ACTUAL_DATA',
        message: '当前范围没有已确认的实际经营记录。'
      });
    }
    if (metrics.byCurrency.length > 1) {
      warnings.push({
        code: 'MIXED_CURRENCY_TOTAL_DISABLED',
        message: '当前范围包含多种币种，系统已分币种展示且未计算跨币种总额。'
      });
    }
    warnings.push({
      code: 'FORMAL_METRIC_POLICY_PENDING',
      message: '正式经营指标口径和真实逐分对账仍待人工签字，当前快照仅用于工程与合成验收。'
    });
    return warnings;
  }

  private async databaseWatermark(tx: Prisma.TransactionClient, sourceDigest: string) {
    const rows = await tx.$queryRaw<Array<{ generatedAt: Date; databaseSnapshot: string }>>`
      SELECT transaction_timestamp() AS "generatedAt", pg_current_snapshot()::text AS "databaseSnapshot"
    `;
    const row = rows[0];
    if (!row) throw new Error('无法获取报告一致性水位');
    return {
      generatedAt: new Date(row.generatedAt),
      value: `postgres:${row.databaseSnapshot};source:${sourceDigest}`
    };
  }

  private present(snapshot: StoredSnapshot, reused: boolean) {
    return {
      snapshot: snapshot.snapshotJson as unknown as CanonicalReportSnapshot,
      reused,
      sourceCount: snapshot.sourceCount
    };
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private isSnapshotWriteConflict(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === 'P2002' || error.code === 'P2034';
    }
    if (typeof error !== 'object' || error === null || !('code' in error)) return false;
    return ['P2002', 'P2034'].includes(String((error as { code?: unknown }).code));
  }
}
