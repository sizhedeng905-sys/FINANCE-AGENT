import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ImportTaskStatus,
  OcrTaskStatus,
  Prisma,
  RetentionDataClass,
  RetentionRun,
  RetentionRunStatus
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRetentionLegalHoldDto } from './dto/create-retention-legal-hold.dto';
import { CreateRetentionRunDto } from './dto/create-retention-run.dto';
import { QueryRetentionLegalHoldsDto } from './dto/query-retention-legal-holds.dto';
import { QueryRetentionRunsDto } from './dto/query-retention-runs.dto';
import {
  RETENTION_EVIDENCE_SCHEMA_VERSION,
  RETENTION_MODE_DISABLED_REASON,
  RETENTION_POLICY_VERSION,
  RetentionResourceType
} from './retention.constants';

interface RetentionCandidate {
  resourceType: RetentionResourceType;
  id: string;
  protected: boolean;
  protectionReason?: string;
}

interface RetentionAnalysis {
  beforeCount: number;
  afterCount: number;
  scannedCount: number;
  eligibleCount: number;
  heldCount: number;
  protectedCount: number;
  deletedCount: 0;
  evidence: Prisma.InputJsonValue;
}

@Injectable()
export class RetentionService {
  private readonly mode: string;
  private readonly defaultBatchSize: number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    config: ConfigService
  ) {
    this.mode = config.get<string>('dataRetention.mode') ?? 'disabled';
    this.defaultBatchSize = config.get<number>('dataRetention.batchSize') ?? 100;
    this.leaseMs = config.get<number>('dataRetention.leaseMs') ?? 60_000;
    this.maxAttempts = config.get<number>('dataRetention.maxAttempts') ?? 3;
  }

  classes() {
    return {
      mode: this.mode,
      destructiveExecutionEnabled: false,
      policyVersion: RETENTION_POLICY_VERSION,
      pendingDecisionRefs: ['H12', 'H14'],
      classes: Object.values(RetentionDataClass).map((dataClass) => ({ dataClass }))
    };
  }

  async createRun(dto: CreateRetentionRunDto, actor: CurrentUser, context?: RequestContext) {
    this.assertDryRunEnabled();
    const cutoffAt = new Date(dto.cutoffAt);
    if (cutoffAt.getTime() >= Date.now()) {
      throw new BadRequestException('RETENTION_CUTOFF_MUST_BE_IN_THE_PAST');
    }

    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.retentionRun.create({
        data: {
          dataClass: dto.dataClass,
          dryRun: true,
          cutoffAt,
          batchSize: dto.batchSize ?? this.defaultBatchSize,
          policyVersion: RETENTION_POLICY_VERSION,
          requestedBy: actor.id,
          requestedByUsername: actor.username,
          maxAttempts: this.maxAttempts,
          evidence: {
            schemaVersion: RETENTION_EVIDENCE_SCHEMA_VERSION,
            destructiveAction: false,
            contentIncluded: false,
            pendingDecisionRefs: ['H12', 'H14']
          }
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'retention.dry_run.queued',
        'retention_run',
        created.id,
        {
          dataClass: created.dataClass,
          cutoffAt: created.cutoffAt.toISOString(),
          batchSize: created.batchSize,
          policyVersion: created.policyVersion,
          destructiveAction: false
        },
        context
      );
      return created;
    });

    return this.toPublicRun(run);
  }

  async listRuns(query: QueryRetentionRunsDto) {
    const where: Prisma.RetentionRunWhereInput = {
      ...(query.dataClass ? { dataClass: query.dataClass } : {}),
      ...(query.status ? { status: query.status } : {})
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.retentionRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.retentionRun.count({ where })
    ]);
    return {
      items: items.map((item) => this.toPublicRun(item)),
      pagination: { page: query.page, pageSize: query.pageSize, total }
    };
  }

  async findRun(id: string) {
    const run = await this.prisma.retentionRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('RETENTION_RUN_NOT_FOUND');
    return this.toPublicRun(run);
  }

  async createLegalHold(dto: CreateRetentionLegalHoldDto, actor: CurrentUser, context?: RequestContext) {
    await this.assertResourceExists(dto.resourceType, dto.resourceId);
    const hold = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.retentionLegalHold.upsert({
        where: { resourceType_resourceId: { resourceType: dto.resourceType, resourceId: dto.resourceId } },
        create: {
          resourceType: dto.resourceType,
          resourceId: dto.resourceId,
          reason: dto.reason,
          createdBy: actor.id,
          createdByUsername: actor.username
        },
        update: {
          active: true,
          reason: dto.reason,
          createdBy: actor.id,
          createdByUsername: actor.username
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'retention.legal_hold.upserted',
        dto.resourceType,
        dto.resourceId,
        {
          legalHoldId: saved.id,
          active: true,
          policyVersion: RETENTION_POLICY_VERSION,
          releaseEnabled: false,
          pendingDecisionRefs: ['H14']
        },
        context
      );
      return saved;
    });
    return hold;
  }

  async listLegalHolds(query: QueryRetentionLegalHoldsDto) {
    const where: Prisma.RetentionLegalHoldWhereInput = {
      active: true,
      ...(query.resourceType ? { resourceType: query.resourceType } : {})
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.retentionLegalHold.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      this.prisma.retentionLegalHold.count({ where })
    ]);
    return { items, pagination: { page: query.page, pageSize: query.pageSize, total } };
  }

  async processNext(instanceId: string): Promise<ReturnType<RetentionService['toPublicRun']> | null> {
    if (this.mode !== 'dry-run') return null;
    await this.recoverExhaustedLeases();
    const run = await this.claimNext(instanceId);
    if (!run) return null;

    try {
      const analysis = await this.analyze(run);
      const completed = await this.prisma.$transaction(async (tx) => {
        const result = await tx.retentionRun.updateMany({
          where: { id: run.id, status: RetentionRunStatus.running, leaseToken: run.leaseToken },
          data: {
            status: RetentionRunStatus.completed,
            leaseToken: null,
            leaseUntil: null,
            beforeCount: analysis.beforeCount,
            afterCount: analysis.afterCount,
            scannedCount: analysis.scannedCount,
            eligibleCount: analysis.eligibleCount,
            heldCount: analysis.heldCount,
            protectedCount: analysis.protectedCount,
            deletedCount: 0,
            evidence: analysis.evidence,
            errorCode: null,
            errorMessage: null,
            completedAt: new Date()
          }
        });
        if (result.count !== 1) throw new Error('RETENTION_LEASE_LOST');
        await tx.auditLog.create({
          data: {
            actorUserId: run.requestedBy,
            actorUsername: run.requestedByUsername,
            action: 'retention.dry_run.completed',
            resourceType: 'retention_run',
            resourceId: run.id,
            metadata: {
              dataClass: run.dataClass,
              beforeCount: analysis.beforeCount,
              afterCount: analysis.afterCount,
              scannedCount: analysis.scannedCount,
              eligibleCount: analysis.eligibleCount,
              heldCount: analysis.heldCount,
              protectedCount: analysis.protectedCount,
              deletedCount: 0,
              policyVersion: run.policyVersion
            }
          }
        });
        return tx.retentionRun.findUniqueOrThrow({ where: { id: run.id } });
      });
      return this.toPublicRun(completed);
    } catch {
      const exhausted = run.attemptCount >= run.maxAttempts;
      await this.prisma.$transaction(async (tx) => {
        const result = await tx.retentionRun.updateMany({
          where: { id: run.id, status: RetentionRunStatus.running, leaseToken: run.leaseToken },
          data: {
            status: exhausted ? RetentionRunStatus.failed : RetentionRunStatus.queued,
            leaseToken: null,
            leaseUntil: null,
            errorCode: exhausted ? 'RETENTION_MAX_ATTEMPTS_EXHAUSTED' : 'RETENTION_DRY_RUN_RETRY_QUEUED',
            errorMessage: 'Retention dry-run failed without applying destructive changes.',
            ...(exhausted ? { completedAt: new Date() } : {})
          }
        });
        if (result.count === 1) {
          await tx.auditLog.create({
            data: {
              actorUserId: run.requestedBy,
              actorUsername: run.requestedByUsername,
              action: exhausted ? 'retention.dry_run.failed' : 'retention.dry_run.retry_queued',
              resourceType: 'retention_run',
              resourceId: run.id,
              metadata: {
                dataClass: run.dataClass,
                attemptCount: run.attemptCount,
                maxAttempts: run.maxAttempts,
                deletedCount: 0,
                policyVersion: run.policyVersion
              },
              failureReason: exhausted ? 'RETENTION_MAX_ATTEMPTS_EXHAUSTED' : 'RETENTION_DRY_RUN_RETRY_QUEUED'
            }
          });
        }
      });
      const current = await this.prisma.retentionRun.findUnique({ where: { id: run.id } });
      return current ? this.toPublicRun(current) : null;
    }
  }

  private assertDryRunEnabled() {
    if (this.mode !== 'dry-run') {
      throw new ServiceUnavailableException(RETENTION_MODE_DISABLED_REASON);
    }
  }

  private async claimNext(instanceId: string) {
    const now = new Date();
    const leaseToken = `${instanceId}:${randomUUID()}`;
    const leaseUntil = new Date(now.getTime() + this.leaseMs);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH next_run AS (
        SELECT "id"
        FROM "retention_runs"
        WHERE (
          "status" = 'queued'::"RetentionRunStatus"
          OR ("status" = 'running'::"RetentionRunStatus" AND "lease_until" < ${now})
        )
          AND "attempt_count" < "max_attempts"
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "retention_runs" AS run
      SET "status" = 'running'::"RetentionRunStatus",
          "lease_token" = ${leaseToken},
          "lease_until" = ${leaseUntil},
          "attempt_count" = run."attempt_count" + 1,
          "started_at" = COALESCE(run."started_at", ${now}),
          "updated_at" = ${now}
      FROM next_run
      WHERE run."id" = next_run."id"
      RETURNING run."id"
    `;
    if (!rows[0]) return null;
    return this.prisma.retentionRun.findFirst({
      where: { id: rows[0].id, status: RetentionRunStatus.running, leaseToken }
    });
  }

  private async recoverExhaustedLeases() {
    const recoveredIds = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "retention_runs"
      SET "status" = 'failed'::"RetentionRunStatus",
          "lease_token" = NULL,
          "lease_until" = NULL,
          "error_code" = 'RETENTION_MAX_ATTEMPTS_EXHAUSTED',
          "error_message" = 'Expired retention lease exhausted the configured attempts without destructive changes.',
          "completed_at" = NOW(),
          "updated_at" = NOW()
      WHERE "status" = 'running'::"RetentionRunStatus"
        AND "lease_until" < NOW()
        AND "attempt_count" >= "max_attempts"
      RETURNING "id"
    `;
    if (recoveredIds.length === 0) return;
    const recovered = await this.prisma.retentionRun.findMany({
      where: { id: { in: recoveredIds.map((item) => item.id) } }
    });
    await this.prisma.auditLog.createMany({
      data: recovered.map((run) => ({
        actorUserId: run.requestedBy,
        actorUsername: run.requestedByUsername,
        action: 'retention.dry_run.lease_recovery_failed',
        resourceType: 'retention_run',
        resourceId: run.id,
        metadata: {
          dataClass: run.dataClass,
          attemptCount: run.attemptCount,
          maxAttempts: run.maxAttempts,
          deletedCount: 0,
          policyVersion: run.policyVersion
        },
        failureReason: 'RETENTION_MAX_ATTEMPTS_EXHAUSTED'
      }))
    });
  }

  private async analyze(run: RetentionRun): Promise<RetentionAnalysis> {
    if (!run.dryRun) throw new Error('RETENTION_DESTRUCTIVE_RUN_REJECTED');
    const beforeCount = await this.countCandidates(run.dataClass, run.cutoffAt);
    const candidates = await this.loadCandidates(run.dataClass, run.cutoffAt, run.batchSize);
    const holds = candidates.length === 0
      ? []
      : await this.prisma.retentionLegalHold.findMany({
        where: {
          active: true,
          OR: candidates.map((item) => ({ resourceType: item.resourceType, resourceId: item.id }))
        },
        select: { resourceType: true, resourceId: true }
      });
    const heldKeys = new Set(holds.map((hold) => `${hold.resourceType}:${hold.resourceId}`));
    const heldCount = candidates.filter((item) => heldKeys.has(`${item.resourceType}:${item.id}`)).length;
    const protectedCount = candidates.filter((item) => item.protected).length;
    const eligibleCount = candidates.filter(
      (item) => !item.protected && !heldKeys.has(`${item.resourceType}:${item.id}`)
    ).length;
    const resourceTypeCounts = candidates.reduce<Record<string, number>>((counts, item) => {
      counts[item.resourceType] = (counts[item.resourceType] ?? 0) + 1;
      return counts;
    }, {});
    const protectionReasonCounts = candidates.reduce<Record<string, number>>((counts, item) => {
      if (!item.protectionReason) return counts;
      counts[item.protectionReason] = (counts[item.protectionReason] ?? 0) + 1;
      return counts;
    }, {});
    const afterCount = await this.countCandidates(run.dataClass, run.cutoffAt);

    return {
      beforeCount,
      afterCount,
      scannedCount: candidates.length,
      eligibleCount,
      heldCount,
      protectedCount,
      deletedCount: 0,
      evidence: {
        schemaVersion: RETENTION_EVIDENCE_SCHEMA_VERSION,
        policyVersion: run.policyVersion,
        pendingDecisionRefs: ['H12', 'H14'],
        destructiveAction: false,
        contentIncluded: false,
        cutoffAt: run.cutoffAt.toISOString(),
        resourceTypeCounts,
        protectionReasonCounts,
        candidateSampleHashes: candidates.slice(0, 20).map((item) => this.hashResource(item)),
        sampleTruncated: candidates.length > 20
      }
    };
  }

  private async countCandidates(dataClass: RetentionDataClass, cutoffAt: Date) {
    const where = { createdAt: { lt: cutoffAt } };
    switch (dataClass) {
      case RetentionDataClass.ai_conversation_content:
        return this.prisma.aiMessage.count({ where });
      case RetentionDataClass.ai_provider_payload: {
        const [logs, attempts] = await Promise.all([
          this.prisma.aiCallLog.count({ where }),
          this.prisma.aiCallAttempt.count({ where })
        ]);
        return logs + attempts;
      }
      case RetentionDataClass.ai_task_payload:
        return this.prisma.aiTask.count({ where });
      case RetentionDataClass.ocr_intermediate:
        return this.prisma.ocrTask.count({ where });
      case RetentionDataClass.import_intermediate:
        return this.prisma.importTask.count({ where });
      case RetentionDataClass.notification:
        return this.prisma.notification.count({ where });
      case RetentionDataClass.idempotency_response:
        return this.prisma.idempotencyKey.count({ where });
      case RetentionDataClass.audit_event:
        return this.prisma.auditLog.count({ where });
      case RetentionDataClass.ledger_event:
        return this.prisma.ledgerEvent.count({ where });
    }
  }

  private async loadCandidates(dataClass: RetentionDataClass, cutoffAt: Date, take: number) {
    const where = { createdAt: { lt: cutoffAt } };
    switch (dataClass) {
      case RetentionDataClass.ai_conversation_content:
        return (await this.prisma.aiMessage.findMany({ where, orderBy: { createdAt: 'asc' }, take, select: { id: true } }))
          .map((item) => this.candidate('ai_message', item.id));
      case RetentionDataClass.ai_provider_payload: {
        const logs = await this.prisma.aiCallLog.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take,
          select: { id: true }
        });
        const attempts = logs.length >= take
          ? []
          : await this.prisma.aiCallAttempt.findMany({
            where,
            orderBy: { createdAt: 'asc' },
            take: take - logs.length,
            select: { id: true }
          });
        return [
          ...logs.map((item) => this.candidate('ai_call_log', item.id)),
          ...attempts.map((item) => this.candidate('ai_call_attempt', item.id))
        ];
      }
      case RetentionDataClass.ai_task_payload:
        return (await this.prisma.aiTask.findMany({ where, orderBy: { createdAt: 'asc' }, take, select: { id: true } }))
          .map((item) => this.candidate('ai_task', item.id));
      case RetentionDataClass.ocr_intermediate:
        return (await this.prisma.ocrTask.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take,
          select: { id: true, status: true }
        })).map((item) => {
          const protectedResource = item.status !== OcrTaskStatus.failed && item.status !== OcrTaskStatus.cancelled;
          return this.candidate(
            'ocr_task',
            item.id,
            protectedResource,
            protectedResource ? 'OCR_EVIDENCE_OR_ACTIVE_TASK' : undefined
          );
        });
      case RetentionDataClass.import_intermediate:
        return (await this.prisma.importTask.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take,
          select: { id: true, status: true }
        })).map((item) => {
          const protectedResource = item.status !== ImportTaskStatus.failed && item.status !== ImportTaskStatus.cancelled;
          return this.candidate(
            'import_task',
            item.id,
            protectedResource,
            protectedResource ? 'IMPORT_EVIDENCE_OR_ACTIVE_TASK' : undefined
          );
        });
      case RetentionDataClass.notification:
        return (await this.prisma.notification.findMany({ where, orderBy: { createdAt: 'asc' }, take, select: { id: true } }))
          .map((item) => this.candidate('notification', item.id));
      case RetentionDataClass.idempotency_response:
        return (await this.prisma.idempotencyKey.findMany({ where, orderBy: { createdAt: 'asc' }, take, select: { id: true } }))
          .map((item) => this.candidate('idempotency_key', item.id));
      case RetentionDataClass.audit_event:
        return (await this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' }, take, select: { id: true } }))
          .map((item) => this.candidate('audit_log', item.id, true, 'IMMUTABLE_AUDIT_EVENT'));
      case RetentionDataClass.ledger_event:
        return (await this.prisma.ledgerEvent.findMany({ where, orderBy: { createdAt: 'asc' }, take, select: { id: true } }))
          .map((item) => this.candidate('ledger_event', item.id, true, 'IMMUTABLE_LEDGER_EVENT'));
    }
  }

  private candidate(
    resourceType: RetentionResourceType,
    id: string,
    protectedResource = false,
    protectionReason?: string
  ): RetentionCandidate {
    return { resourceType, id, protected: protectedResource, protectionReason };
  }

  private hashResource(candidate: RetentionCandidate) {
    return createHash('sha256')
      .update(`retention-evidence-v1:${candidate.resourceType}:${candidate.id}`)
      .digest('hex');
  }

  private async assertResourceExists(resourceType: RetentionResourceType, id: string) {
    const exists = await this.resourceExists(resourceType, id);
    if (!exists) throw new NotFoundException('RETENTION_RESOURCE_NOT_FOUND');
  }

  private async resourceExists(resourceType: RetentionResourceType, id: string) {
    switch (resourceType) {
      case 'ai_message': return Boolean(await this.prisma.aiMessage.findUnique({ where: { id }, select: { id: true } }));
      case 'ai_call_log': return Boolean(await this.prisma.aiCallLog.findUnique({ where: { id }, select: { id: true } }));
      case 'ai_call_attempt': return Boolean(await this.prisma.aiCallAttempt.findUnique({ where: { id }, select: { id: true } }));
      case 'ai_task': return Boolean(await this.prisma.aiTask.findUnique({ where: { id }, select: { id: true } }));
      case 'ocr_task': return Boolean(await this.prisma.ocrTask.findUnique({ where: { id }, select: { id: true } }));
      case 'import_task': return Boolean(await this.prisma.importTask.findUnique({ where: { id }, select: { id: true } }));
      case 'notification': return Boolean(await this.prisma.notification.findUnique({ where: { id }, select: { id: true } }));
      case 'idempotency_key': return Boolean(await this.prisma.idempotencyKey.findUnique({ where: { id }, select: { id: true } }));
      case 'audit_log': return Boolean(await this.prisma.auditLog.findUnique({ where: { id }, select: { id: true } }));
      case 'ledger_event': return Boolean(await this.prisma.ledgerEvent.findUnique({ where: { id }, select: { id: true } }));
    }
  }

  private toPublicRun(run: RetentionRun) {
    const { leaseToken: _leaseToken, ...safe } = run;
    return safe;
  }
}
