import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  PayloadTooLargeException,
  UnauthorizedException,
  UnprocessableEntityException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BusinessRecordPublicationStatus,
  BusinessRecordStatus,
  FileScanStatus,
  FieldDefinition,
  FieldSuggestionStatus,
  FieldType,
  ImportRowStatus,
  ImportTaskStatus,
  MappingDecisionType,
  MappingProfileStatus,
  OcrTaskStatus,
  Prisma,
  RawFileStatus,
  RecordSourceType,
  SemanticType,
  UserRole,
  UserStatus,
  WorkOrderStatus
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { acquireProjectWriteLock } from '../common/database/project-write-lock';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { canonicalJson, canonicalJsonSha256 } from '../common/utils/canonical-json';
import { FilesService } from '../files/files.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { financialPolicySnapshot } from '../record-policy/financial-policy-baseline';
import { RecordPolicyService } from '../record-policy/record-policy.service';
import { ApproveFieldSuggestionDto, MapFieldSuggestionDto, QueryFieldSuggestionsDto } from './dto/field-suggestion.dto';
import { ConfirmImportTaskDto } from './dto/confirm-import-task.dto';
import { CreateImportTaskDto } from './dto/create-import-task.dto';
import { ParseImportTaskDto } from './dto/parse-import-task.dto';
import { QueryImportPreviewDto } from './dto/query-import-preview.dto';
import { QueryImportRowsDto } from './dto/query-import-rows.dto';
import { QueryImportTasksDto } from './dto/query-import-tasks.dto';
import { QueryMappingProfilesDto } from './dto/query-mapping-profiles.dto';
import { RevalidateImportTaskDto } from './dto/revalidate-import-task.dto';
import { ReviewImportRowDto } from './dto/review-import-row.dto';
import { MappingInputDto, SaveMappingsDto } from './dto/save-mappings.dto';
import {
  EXCEL_PARSER_VERSION,
  ExcelParserService,
  ParsedImportColumn,
  ParsedImportRow,
  ParsedWorkbookMetadata,
  ParseWorkbookOptions,
  WorkbookInspection,
  WorkbookSelectionRequiredException
} from './excel-parser.service';
import {
  buildExcelStructureFingerprint,
  buildMappingProfileScopeKey,
  buildMappingProfileSnapshotHash,
  MAPPING_PROFILE_POLICY_VERSION,
  MappingProfileRuleSnapshot
} from './mapping-profile-fingerprint';
import {
  IMPORT_TRANSFORM_REGISTRY_VERSION,
  isRegisteredImportTransformKey,
  transformKeyForFieldType
} from './import-transform-registry';
import {
  importTaskDetailInclude,
  ImportTaskDetail,
  toFieldSuggestion,
  toImportRow,
  toImportTask
} from './import.presenter';
import { XlsConverterService } from './xls-converter.service';
import { XlsConversionMetadata } from './xls-sanitizer';

type PrismaWriter = Prisma.TransactionClient | PrismaService;

const previewTaskInclude = {
  project: true,
  template: {
    include: {
      templateFields: {
        include: { field: true },
        orderBy: { displayOrder: 'asc' as const }
      }
    }
  },
  rawFile: true,
  columns: {
    include: { decision: { include: { targetField: true } } },
    orderBy: { columnIndex: 'asc' as const }
  }
} satisfies Prisma.ImportTaskInclude;

const stagedRecordIntegrityInclude = {
  values: { orderBy: [{ fieldId: 'asc' as const }, { id: 'asc' as const }] },
  sourceImportRow: {
    select: {
      id: true,
      importTaskId: true,
      status: true,
      confirmationProcessedAt: true,
      generatedRecordHash: true,
      generatedRecordValueCount: true
    }
  }
} satisfies Prisma.BusinessRecordInclude;

type PreviewTask = Prisma.ImportTaskGetPayload<{ include: typeof previewTaskInclude }>;
type PreviewImportRow = Prisma.ImportRowGetPayload<Record<string, never>>;
type PreviewField = FieldDefinition;

interface PreviewValue {
  field: PreviewField;
  value: string | string[];
}

interface PreviewRow {
  id: string;
  rowNumber: number;
  rowHash: string;
  status: ImportRowStatus;
  recordDate?: string;
  amount?: string;
  category: string;
  subCategory: string;
  values: Array<{ fieldId: string; fieldName: string; fieldType: FieldType; value: string | string[] }>;
  normalizedData: Record<string, string | string[]>;
  errors: string[];
  warnings: string[];
  generatedRecordId?: string;
  summaryCandidate: boolean;
  review: {
    decision?: 'include' | 'exclude';
    reason?: string;
    reviewedBy?: string;
    reviewedAt?: string;
  };
}

interface PreviewResult {
  task: PreviewTask;
  unresolvedColumns: Array<{ id: string; sourceName: string; sourceKey: string }>;
  rows: PreviewRow[];
  summary: { total: number; valid: number; errors: number; duplicates: number; ignored: number };
}

export interface PreviewSummary {
  total: number;
  valid: number;
  errors: number;
  duplicates: number;
  ignored: number;
}

interface ImportValidationIssue {
  code: string;
  message: string;
  count: number;
  rowDigest: string;
  sampleRowNumbers: number[];
}

interface ImportValidationIssueAccumulator {
  code: string;
  message: string;
  count: number;
  sampleRowNumbers: number[];
  digest: ReturnType<typeof createHash>;
}

const AUTOMATIC_MAPPING_TYPES: MappingDecisionType[] = [
  MappingDecisionType.profile,
  MappingDecisionType.field_key,
  MappingDecisionType.exact_name,
  MappingDecisionType.alias,
  MappingDecisionType.normalized,
  MappingDecisionType.fuzzy
];
const IMPORT_PARSE_LEASE_MS = 10 * 60 * 1000;
const IMPORT_PARSE_REAPER_MS = 60 * 1000;
const IMPORT_BACKGROUND_THRESHOLD_ROWS = 5_000;
const IMPORT_BACKGROUND_MAX_ROWS = 50_000;
const IMPORT_PREVIEW_SUMMARY_BATCH_SIZE = 500;
const IMPORT_PREVIEW_MAX_RESPONSE_BYTES = 1024 * 1024;
const IMPORT_ROW_BATCH_SIZE = 500;
const IMPORT_MAX_PARSE_ATTEMPTS = 3;
const WORKER_HANDOFF_LEASE_PREFIX = 'worker-handoff:';
export const EXCEL_VALIDATION_SCHEMA_VERSION = 'excel-validation/1.0';
export const EXCEL_DETERMINISTIC_VALIDATION_RULE_VERSION = 'excel-deterministic-validation/1.0';
export const EXCEL_APPROVAL_SNAPSHOT_SCHEMA_VERSION = 'excel-approval/1.0';
export const EXCEL_APPROVAL_POLICY_VERSION = 'finance-excel-approval/1.0-pending-h10';
export const EXCEL_APPROVAL_AUTHORIZATION_POLICY_VERSION = 'finance-excel-approval-authz/1.0';
export const EXCEL_ROW_REVIEW_POLICY_VERSION = 'excel-row-review-h01/1.0';
export const EXCEL_STAGING_CONTENT_SCHEMA_VERSION = 'excel-staging-record/1.0';
const IMPORT_VALIDATION_MAX_ISSUES = 100;
const SUMMARY_ROW_LABELS = new Set(['小计', '合计', '总计', '本页合计', '累计']);

class ImportParseLeaseLostError extends Error {}
class ImportParseWorkerStoppingError extends Error {}
class ImportConfirmationLeaseLostError extends Error {}
class ImportConfirmationWorkerStoppingError extends Error {}

interface BackgroundParseJob {
  taskId: string;
  leaseToken: string;
  actor: CurrentUser;
  context: RequestContext;
  options: ParseWorkbookOptions;
  attempt: number;
  workbook?: PreparedWorkbook;
}

interface BackgroundConfirmationJob {
  taskId: string;
  leaseToken: string;
  approvalSnapshotHash: string;
  actor: CurrentUser;
  context: RequestContext;
  attempt: number;
}

interface PreparedConfirmationIntegrity {
  taskVersion: number;
  rowSetHash: string;
  normalizedOutputHash: string;
  recordCount: number;
  stagingManifestHash: string;
  stagingValueCount: number;
}

interface StagingRecordIntegrity {
  recordId: string;
  contentHash: string;
  valueCount: number;
}

interface StagingRecordHashInput {
  id: string;
  projectId: string;
  templateId: string;
  templateVersion: number;
  templateSnapshot: unknown;
  sourceSnapshot: unknown;
  confirmationSnapshot: unknown;
  recordType: string;
  accountingDirection: string;
  dataLayer: string;
  recordDate: Date;
  amount: Prisma.Decimal;
  currency: string;
  category: string | null;
  subCategory: string | null;
  description: string | null;
  sourceType: string;
  sourceId: string;
  importTaskId: string;
  status: BusinessRecordStatus;
  publicationStatus: BusinessRecordPublicationStatus;
  attachments: unknown;
  createdBy: string | null;
  stagingApprovalHash: string;
}

interface StagingRecordValueHashInput {
  fieldId: string;
  fieldName: string;
  valueText?: string | null;
  valueNumber?: Prisma.Decimal | Prisma.DecimalJsLike | string | number | null;
  valueDate?: Date | string | null;
  valueJson?: unknown;
}

interface PreparedWorkbook {
  buffer: Buffer;
  sourceFormat: 'xls' | 'xlsx';
  sourceSha256: string;
  parserInputSha256: string;
  conversion?: XlsConversionMetadata;
}

@Injectable()
export class ImportTasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportTasksService.name);
  private readonly backgroundJobs = new Map<string, Promise<void>>();
  private readonly confirmationBatchSize: number;
  private readonly confirmationLeaseMs: number;
  private readonly confirmationMaxAttempts: number;
  private readonly processRole: string;
  private readonly workerPollIntervalMs: number;
  private leaseReaper?: NodeJS.Timeout;
  private recoveryJob?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly excelParser: ExcelParserService,
    private readonly xlsConverter: XlsConverterService,
    private readonly auditLogs: AuditLogsService,
    private readonly ledgerEvents: LedgerEventsService,
    private readonly recordPolicy: RecordPolicyService,
    private readonly idempotency: IdempotencyService,
    config: ConfigService
  ) {
    this.confirmationBatchSize = config.get<number>('importConfirmation.batchSize') ?? 500;
    this.confirmationLeaseMs = config.get<number>('importConfirmation.leaseMs') ?? 60_000;
    this.confirmationMaxAttempts = config.get<number>('importConfirmation.maxAttempts') ?? 3;
    this.processRole = config.get<string>('processRole') ?? 'all';
    this.workerPollIntervalMs = config.get<number>('worker.pollIntervalMs') ?? IMPORT_PARSE_REAPER_MS;
  }

  onModuleInit() {
    if (!this.canRunBackgroundJobs()) return;
    this.scheduleRecovery();
    this.leaseReaper = setInterval(() => this.scheduleRecovery(), this.workerPollIntervalMs);
    this.leaseReaper.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.leaseReaper) clearInterval(this.leaseReaper);
    if (this.recoveryJob) await this.recoveryJob;
    await Promise.allSettled(this.backgroundJobs.values());
  }

  private scheduleRecovery() {
    if (this.stopping || this.recoveryJob) return;
    const active = Promise.all([
      this.recoverExpiredParses(),
      this.recoverExpiredConfirmations()
    ]).then(() => undefined).finally(() => {
      if (this.recoveryJob === active) this.recoveryJob = undefined;
    });
    this.recoveryJob = active;
  }

  async create(
    file: Express.Multer.File | undefined,
    dto: CreateImportTaskDto,
    actor: CurrentUser,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    if (!file) throw new BadRequestException('请选择 Excel 文件');
    const sourceExtension = extname(file.originalname).toLowerCase();
    if (!['.xls', '.xlsx'].includes(sourceExtension)) {
      throw new BadRequestException('仅支持 .xls 和 .xlsx 文件');
    }
    const template = await this.recordPolicy.getWritableTemplate(
      this.prisma,
      dto.projectId,
      dto.templateId,
      dto.importType
    );
    const rawFile = await this.files.upload(file, { relatedProjectId: dto.projectId }, actor, context);
    const scope = this.idempotency.prepare(
      actor.id,
      'POST',
      '/api/import-tasks',
      idempotencyKey,
      {
        ...dto,
        file: {
          name: rawFile.originalFileName,
          size: rawFile.fileSize,
          sha256: rawFile.sha256
        }
      },
      false
    );
    try {
      const result = await this.prisma.$transaction((tx) => this.idempotency.execute(tx, scope, 201, async () => {
        const validatedWorkbook = sourceExtension === '.xls'
          ? await this.prepareWorkbook(await this.files.readForProcessing(rawFile.id, actor))
          : undefined;
        await acquireProjectWriteLock(tx, dto.projectId);
        await this.recordPolicy.getWritableTemplate(tx, dto.projectId, dto.templateId, dto.importType);
        const task = await tx.importTask.create({
          data: {
            projectId: dto.projectId,
            templateId: dto.templateId,
            templateVersion: template.version,
            templateSnapshot: this.recordPolicy.toSnapshot(template),
            rawFileId: rawFile.id,
            fileName: rawFile.originalFileName,
            importType: dto.importType,
            uploadedBy: actor.id,
            idempotencyKey: this.idempotency.persistenceKey(scope)
          }
        });
        await this.auditLogs.write(
          tx,
          actor,
          'import_task.create',
          'import_task',
          task.id,
          {
            projectId: dto.projectId,
            templateId: dto.templateId,
            rawFileId: rawFile.id,
            sourceFormat: sourceExtension.slice(1),
            conversion: validatedWorkbook?.conversion
          },
          context
        );
        await this.ledgerEvents.write(tx, actor, 'import_task_created', 'import_task', task.id, {
          projectId: dto.projectId,
          templateId: dto.templateId,
          rawFileId: rawFile.id,
          sha256: rawFile.sha256,
          sourceFormat: sourceExtension.slice(1),
          conversion: validatedWorkbook?.conversion
        });
        const detail = await tx.importTask.findUnique({
          where: { id: task.id },
          include: importTaskDetailInclude
        });
        if (!detail) throw new NotFoundException('资源不存在');
        return toImportTask(detail);
      }));
      if (result.rawFileId !== rawFile.id) {
        await this.files.discardFailedUpload(
          rawFile.id,
          actor,
          context,
          '导入幂等请求已绑定既有任务，重复上传文件已清理'
        );
      }
      return result;
    } catch (error) {
      await this.files.discardFailedUpload(
        rawFile.id,
        actor,
        context,
        '导入任务创建失败，原文件已作废'
      ).catch(() => undefined);
      throw error;
    }
  }

  async findMany(query: QueryImportTasksDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ImportTaskWhereInput = {
      projectId: query.projectId,
      status: query.status
    };
    const [items, total] = await Promise.all([
      this.prisma.importTask.findMany({
        where,
        include: importTaskDetailInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.importTask.count({ where })
    ]);
    return { items: items.map(toImportTask), page, pageSize, total };
  }

  async findOne(id: string) {
    return toImportTask(await this.findDetailOrThrow(id));
  }

  async inspect(id: string, actor: CurrentUser, context: RequestContext) {
    const task = await this.findDetailOrThrow(id);
    if (task.status === ImportTaskStatus.cancelled) throw new ConflictException('已取消任务不能检查工作簿');
    const file = await this.files.readForProcessing(task.rawFileId, actor);
    const workbook = await this.prepareWorkbook(file);
    const inspection = await this.excelParser.inspect(workbook.buffer);
    await this.prisma.$transaction(async (tx) => {
      await this.auditLogs.write(tx, actor, 'import_task.inspect', 'import_task', id, {
        rawFileId: task.rawFileId,
        sheetCount: inspection.sheets.length,
        requiresSheetSelection: inspection.requiresSheetSelection,
        processingMode: inspection.processingMode,
        mediaCount: inspection.mediaCount,
        mediaExpandedBytes: inspection.mediaExpandedBytes,
        ...this.workbookProvenance(workbook)
      }, context);
      await this.ledgerEvents.write(tx, actor, 'import_task_inspected', 'import_task', id, {
        rawFileId: task.rawFileId,
        sheetCount: inspection.sheets.length,
        processingMode: inspection.processingMode,
        mediaCount: inspection.mediaCount,
        ...this.workbookProvenance(workbook)
      });
    });
    return inspection;
  }

  async parse(id: string, dto: ParseImportTaskDto, actor: CurrentUser, context: RequestContext) {
    const prepared = await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.importTask.findUnique({ where: { id }, include: importTaskDetailInclude });
      if (!task) throw new NotFoundException('资源不存在');
      const completedStatuses: ImportTaskStatus[] = [
        ImportTaskStatus.parsed,
        ImportTaskStatus.mapping,
        ImportTaskStatus.pending_confirm,
        ImportTaskStatus.confirmed
      ];
      if (completedStatuses.includes(task.status)) return { skipped: true as const, task };
      if (task.status === ImportTaskStatus.cancelled) throw new ConflictException('已取消任务不能解析');
      if (
        task.status === ImportTaskStatus.parsing &&
        task.leaseToken &&
        task.leaseUntil &&
        task.leaseUntil.getTime() > Date.now()
      ) {
        throw new ConflictException('Excel 任务正在解析中');
      }

      const leaseToken = randomUUID();
      const attempt = task.parseAttempts + 1;
      await tx.importTask.update({
        where: { id },
        data: {
          status: ImportTaskStatus.parsing,
          leaseToken,
          leaseUntil: new Date(Date.now() + IMPORT_PARSE_LEASE_MS),
          parseConfig: this.parseConfig(dto),
          parseRequestedBy: actor.id,
          executionMode: null,
          processingMode: null,
          processedRows: 0,
          totalRows: 0,
          validRows: 0,
          errorRows: 0,
          duplicateRows: 0,
          ignoredRows: 0,
          importedRows: 0,
          parseAttempts: attempt,
          errorMessage: null,
          version: { increment: 1 }
        }
      });
      if (task.status === ImportTaskStatus.parsing || task.status === ImportTaskStatus.failed) {
        await tx.importSheet.deleteMany({ where: { importTaskId: id } });
      }
      await this.auditLogs.write(
        tx,
        actor,
        'import_task.parse_started',
        'import_task',
        id,
        {
          attempt,
          previousStatus: task.status,
          sheetIndex: dto.sheetIndex,
          headerStartRowIndex: dto.headerStartRowIndex,
          headerRowIndex: dto.headerRowIndex,
          allowHiddenSheet: dto.allowHiddenSheet ?? false,
          allowCachedFormulaResults: dto.allowCachedFormulaResults ?? false
        },
        context
      );
      return { skipped: false as const, task, leaseToken, attempt };
    });
    if (prepared.skipped) return toImportTask(prepared.task);

    let workbook: PreparedWorkbook;
    try {
      const file = await this.files.readForProcessing(prepared.task.rawFileId, actor);
      workbook = await this.prepareWorkbook(file);
    } catch (error) {
      await this.failOwnedParse(id, prepared.task.rawFileId, prepared.leaseToken, prepared.attempt, actor, context, error);
      throw error;
    }

    const inspection = await this.excelParser.inspect(workbook.buffer).catch(() => undefined);
    const estimatedRows = inspection ? this.estimateDataRows(inspection, dto) : undefined;
    if (estimatedRows !== undefined && estimatedRows > IMPORT_BACKGROUND_MAX_ROWS) {
      const error = new BadRequestException(`Excel 数据行不能超过 ${IMPORT_BACKGROUND_MAX_ROWS}`);
      await this.failOwnedParse(id, prepared.task.rawFileId, prepared.leaseToken, prepared.attempt, actor, context, error, dto);
      throw error;
    }
    if (estimatedRows !== undefined && estimatedRows > IMPORT_BACKGROUND_THRESHOLD_ROWS) {
      const scheduled = await this.prisma.$transaction(async (tx) => {
        await this.lockTask(tx, id);
        const changed = await tx.importTask.updateMany({
          where: { id, status: ImportTaskStatus.parsing, leaseToken: prepared.leaseToken },
          data: {
            executionMode: 'background',
            processingMode: 'streaming',
            totalRows: estimatedRows,
            leaseUntil: new Date(Date.now() + IMPORT_PARSE_LEASE_MS),
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1) return false;
        await this.auditLogs.write(tx, actor, 'import_task.parse_scheduled', 'import_task', id, {
          attempt: prepared.attempt,
          estimatedRows,
          batchSize: IMPORT_ROW_BATCH_SIZE,
          ...this.workbookProvenance(workbook)
        }, context);
        await this.ledgerEvents.write(
          tx,
          actor,
          'import_task_parse_scheduled',
          'import_task',
          id,
          {
            attempt: prepared.attempt,
            estimatedRows,
            batchSize: IMPORT_ROW_BATCH_SIZE,
            ...this.workbookProvenance(workbook)
          },
          `import_task:${id}:parse_attempt:${prepared.attempt}:scheduled`
        );
        return true;
      });
      if (!scheduled) throw new ConflictException('Excel 解析租约已失效');
      await this.scheduleBackgroundParse({
        taskId: id,
        leaseToken: prepared.leaseToken,
        actor,
        context,
        options: dto,
        attempt: prepared.attempt,
        workbook
      });
      return toImportTask(await this.findDetailOrThrow(id));
    }

    await this.prisma.importTask.updateMany({
      where: { id, status: ImportTaskStatus.parsing, leaseToken: prepared.leaseToken },
      data: { executionMode: 'synchronous', processingMode: inspection?.processingMode }
    });
    let parsed;
    try {
      parsed = await this.excelParser.parse(workbook.buffer, dto, workbook.sourceSha256);
    } catch (error) {
      await this.failOwnedParse(id, prepared.task.rawFileId, prepared.leaseToken, prepared.attempt, actor, context, error, dto);
      throw error;
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const current = await tx.importTask.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('资源不存在');
      if (current.status !== ImportTaskStatus.parsing || current.leaseToken !== prepared.leaseToken) {
        throw new ConflictException('Excel 解析租约已失效，结果未写入');
      }

      await tx.importSheet.deleteMany({ where: { importTaskId: id } });
      const sheet = await tx.importSheet.create({
        data: this.importSheetData(id, parsed.sheet)
      });
      const columns = [];
      for (const column of parsed.columns) {
        columns.push(await tx.importColumn.create({
          data: {
            importTaskId: id,
            sheetId: sheet.id,
            columnIndex: column.columnIndex,
            sourceColumnId: column.sourceColumnId,
            columnLetter: column.columnLetter,
            sourceKey: column.sourceKey,
            sourceName: column.sourceName,
            headerParts: column.headerParts,
            normalizedName: column.normalizedName,
            sampleValues: column.sampleValues,
            inferredType: column.inferredType,
            duplicateName: column.duplicateName,
            statistics: column.statistics as unknown as Prisma.InputJsonObject
          }
        }));
      }
      for (const row of parsed.rows) {
        await tx.importRow.create({
          data: {
            importTaskId: id,
            sheetId: sheet.id,
            rowNumber: row.rowNumber,
            rawData: row.rawData as Prisma.InputJsonObject,
            rowHash: row.rowHash,
            parserStatus: row.status as ImportRowStatus,
            status: row.status as ImportRowStatus,
            parserErrors: row.errors,
            parserWarnings: row.warnings,
            errors: row.errors,
            warnings: row.warnings,
            cellEvidence: row.cellEvidence as unknown as Prisma.InputJsonArray,
            evidenceHash: row.evidenceHash
          }
        });
      }

      await this.applyAutomaticMappings(tx, current, columns, actor);
      const counts = this.parsedCounts(parsed.rows);
      const decided = await tx.mappingDecision.count({ where: { importTaskId: id } });
      await tx.importTask.update({
        where: { id },
        data: {
          status: decided === columns.length ? ImportTaskStatus.pending_confirm : ImportTaskStatus.mapping,
          leaseToken: null,
          leaseUntil: null,
          executionMode: 'synchronous',
          processingMode: parsed.processingMode,
          sourceSha256: parsed.ir.sourceSha256,
          parserInputSha256: parsed.ir.parserInputSha256,
          irSchemaVersion: parsed.ir.schemaVersion,
          parserVersion: parsed.ir.parserVersion,
          irHash: parsed.ir.hash,
          rowEvidenceDigest: parsed.ir.rowEvidenceDigest,
          processedRows: parsed.rows.length,
          version: { increment: 1 },
          parsedAt: new Date(),
          errorMessage: null,
          totalRows: parsed.rows.length,
          validRows: counts.valid,
          errorRows: counts.errors,
          duplicateRows: counts.duplicates,
          ignoredRows: counts.ignored,
          importedRows: 0
        }
      });
      await tx.rawFile.update({ where: { id: current.rawFileId }, data: { status: RawFileStatus.parsed } });
      await this.auditLogs.write(tx, actor, 'import_task.parse', 'import_task', id, {
        attempt: prepared.attempt,
        executionMode: 'synchronous',
        sheetIndex: parsed.sheet.sheetIndex,
        headerRowIndex: parsed.sheet.headerRowIndex,
        processingMode: parsed.processingMode,
        allowCachedFormulaResults: dto.allowCachedFormulaResults ?? false,
        columns: columns.length,
        rows: parsed.rows.length,
        ...this.workbookProvenance(workbook),
        irSchemaVersion: parsed.ir.schemaVersion,
        parserVersion: parsed.ir.parserVersion,
        irHash: parsed.ir.hash,
        ...counts
      }, context);
      await this.ledgerEvents.write(tx, actor, 'import_task_parsed', 'import_task', id, {
        attempt: prepared.attempt,
        executionMode: 'synchronous',
        rawFileId: current.rawFileId,
        processingMode: parsed.processingMode,
        allowCachedFormulaResults: dto.allowCachedFormulaResults ?? false,
        rowCount: parsed.rows.length,
        columnCount: columns.length,
        ...this.workbookProvenance(workbook),
        irSchemaVersion: parsed.ir.schemaVersion,
        parserVersion: parsed.ir.parserVersion,
        irHash: parsed.ir.hash
      }, `import_task:${id}:parse_attempt:${prepared.attempt}:parsed`);
    });

    return toImportTask(await this.findDetailOrThrow(id));
  }

  async recoverExpiredParses() {
    if (this.stopping) return 0;
    try {
      const expired = await this.prisma.importTask.findMany({
        where: {
          status: ImportTaskStatus.parsing,
          executionMode: 'background',
          leaseUntil: { lt: new Date() }
        },
        select: { id: true },
        orderBy: { leaseUntil: 'asc' },
        take: 20
      });
      let recovered = 0;
      for (const { id } of expired) {
        if (this.stopping) continue;
        try {
          const job = await this.claimExpiredBackgroundParse(id);
          if (!job) continue;
          recovered += 1;
          await this.scheduleBackgroundParse(job);
        } catch (error) {
          this.logger.warn(`Import parse ${id} recovery failed: ${this.errorMessage(error)}`);
        }
      }
      return recovered;
    } catch (error) {
      this.logger.warn(`Import parse lease recovery failed: ${this.errorMessage(error)}`);
      return 0;
    }
  }

  private async claimExpiredBackgroundParse(id: string): Promise<BackgroundParseJob | undefined> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.importTask.findUnique({
        where: { id },
        include: { uploader: true }
      });
      if (
        !task ||
        task.status !== ImportTaskStatus.parsing ||
        task.executionMode !== 'background' ||
        !task.leaseUntil ||
        task.leaseUntil.getTime() >= Date.now()
      ) {
        return undefined;
      }

      const requestedUser = task.parseRequestedBy
        ? await tx.user.findUnique({ where: { id: task.parseRequestedBy } })
        : undefined;
      const actor = this.toCurrentUser(requestedUser ?? task.uploader);
      const options = this.readParseConfig(task.parseConfig);
      const workerHandoff = this.isWorkerHandoffLease(task.leaseToken);
      if (!options || (!workerHandoff && task.parseAttempts >= IMPORT_MAX_PARSE_ATTEMPTS)) {
        const reason = options
          ? `后台解析连续中断 ${task.parseAttempts} 次，已停止自动恢复`
          : '后台解析配置无效，已停止自动恢复';
        await tx.importSheet.deleteMany({ where: { importTaskId: id } });
        await tx.importTask.update({
          where: { id },
          data: {
            status: ImportTaskStatus.failed,
            processedRows: 0,
            validRows: 0,
            errorRows: 0,
            duplicateRows: 0,
            ignoredRows: 0,
            errorMessage: reason,
            leaseToken: null,
            leaseUntil: null,
            version: { increment: 1 }
          }
        });
        await tx.rawFile.update({ where: { id: task.rawFileId }, data: { status: RawFileStatus.failed } });
        const context = { requestId: `import-recovery-exhausted-${id}` };
        await this.auditLogs.write(tx, actor, 'import_task.parse_recovery_exhausted', 'import_task', id, {
          attempts: task.parseAttempts,
          reason
        }, context);
        await this.ledgerEvents.write(
          tx,
          actor,
          'import_task_parse_recovery_exhausted',
          'import_task',
          id,
          { attempts: task.parseAttempts, reason },
          `import_task:${id}:parse_recovery_exhausted`
        );
        return undefined;
      }

      const attempt = workerHandoff ? task.parseAttempts : task.parseAttempts + 1;
      const leaseToken = randomUUID();
      const context = {
        requestId: workerHandoff
          ? `import-worker-claim-${id}-${attempt}`
          : `import-recovery-${id}-${attempt}`
      };
      await tx.importSheet.deleteMany({ where: { importTaskId: id } });
      await tx.importTask.update({
        where: { id },
        data: {
          leaseToken,
          leaseUntil: new Date(Date.now() + IMPORT_PARSE_LEASE_MS),
          processedRows: 0,
          validRows: 0,
          errorRows: 0,
          duplicateRows: 0,
          ignoredRows: 0,
          parseAttempts: attempt,
          errorMessage: null,
          version: { increment: 1 }
        }
      });
      await tx.rawFile.update({ where: { id: task.rawFileId }, data: { status: RawFileStatus.uploaded } });
      const auditAction = workerHandoff ? 'import_task.parse_claimed' : 'import_task.parse_recovered';
      const eventType = workerHandoff ? 'import_task_parse_claimed' : 'import_task_parse_recovered';
      const eventSuffix = workerHandoff ? 'worker_claimed' : 'recovered';
      await this.auditLogs.write(tx, actor, auditAction, 'import_task', id, {
        attempt,
        previousLeaseUntil: task.leaseUntil.toISOString(),
        restartFromRow: 0,
        workerHandoff
      }, context);
      await this.ledgerEvents.write(
        tx,
        actor,
        eventType,
        'import_task',
        id,
        { attempt, restartFromRow: 0, workerHandoff },
        `import_task:${id}:parse_attempt:${attempt}:${eventSuffix}`
      );
      return { taskId: id, leaseToken, actor, context, options, attempt };
    });
  }

  private async scheduleBackgroundParse(job: BackgroundParseJob) {
    if (!this.canRunBackgroundJobs()) {
      await this.handoffParseToWorker(job.taskId, job.leaseToken);
      return;
    }
    const jobKey = `${job.taskId}:${job.leaseToken}`;
    if (this.backgroundJobs.has(jobKey) || this.stopping) return;
    const running = this.executeBackgroundParse(job)
      .catch((error) => this.logger.error(`Background import ${job.taskId} failed: ${this.errorMessage(error)}`))
      .finally(() => this.backgroundJobs.delete(jobKey));
    this.backgroundJobs.set(jobKey, running);
  }

  private async executeBackgroundParse(job: BackgroundParseJob) {
    let rawFileId: string | undefined;
    try {
      if (this.stopping) throw new ImportParseWorkerStoppingError();
      const task = await this.prisma.importTask.findUnique({
        where: { id: job.taskId },
        select: { status: true, leaseToken: true, rawFileId: true }
      });
      if (!task || task.status !== ImportTaskStatus.parsing || task.leaseToken !== job.leaseToken) {
        throw new ImportParseLeaseLostError();
      }
      rawFileId = task.rawFileId;
      const workbook = job.workbook ?? await this.prepareWorkbook(
        await this.files.readForProcessing(task.rawFileId, job.actor)
      );
      let sheetId: string | undefined;
      let processedRows = 0;
      let counts = { valid: 0, errors: 0, duplicates: 0, ignored: 0 };

      const parsed = await this.excelParser.parseInBatches(
        workbook.buffer,
        async (rows, progress) => {
          if (this.stopping) throw new ImportParseWorkerStoppingError();
          if (!sheetId || progress.processedRows !== processedRows + rows.length) {
            throw new Error('Excel 后台批次进度不连续');
          }
          const delta = this.parsedCounts(rows);
          const nextCounts = {
            valid: counts.valid + delta.valid,
            errors: counts.errors + delta.errors,
            duplicates: counts.duplicates + delta.duplicates,
            ignored: counts.ignored + delta.ignored
          };
          await this.prisma.$transaction(async (tx) => {
            await this.lockTask(tx, job.taskId);
            await this.assertOwnedParse(tx, job.taskId, job.leaseToken);
            await tx.importRow.createMany({
              data: rows.map((row) => this.importRowData(job.taskId, sheetId!, row))
            });
            await tx.importTask.update({
              where: { id: job.taskId },
              data: {
                processedRows: progress.processedRows,
                totalRows: progress.totalRows,
                validRows: nextCounts.valid,
                errorRows: nextCounts.errors,
                duplicateRows: nextCounts.duplicates,
                ignoredRows: nextCounts.ignored,
                leaseUntil: new Date(Date.now() + IMPORT_PARSE_LEASE_MS)
              }
            });
          });
          processedRows = progress.processedRows;
          counts = nextCounts;
        },
        job.options,
        {
          maxRows: IMPORT_BACKGROUND_MAX_ROWS,
          batchSize: IMPORT_ROW_BATCH_SIZE,
          sourceSha256: workbook.sourceSha256,
          onStart: async (metadata) => {
            if (this.stopping) throw new ImportParseWorkerStoppingError();
            sheetId = await this.prisma.$transaction(async (tx) => {
              await this.lockTask(tx, job.taskId);
              await this.assertOwnedParse(tx, job.taskId, job.leaseToken);
              await tx.importSheet.deleteMany({ where: { importTaskId: job.taskId } });
              const sheet = await tx.importSheet.create({
                data: this.importSheetData(job.taskId, metadata.sheet)
              });
              if (metadata.columns.length > 0) {
                await tx.importColumn.createMany({
                  data: metadata.columns.map((column) => this.importColumnData(job.taskId, sheet.id, column))
                });
              }
              await tx.importTask.update({
                where: { id: job.taskId },
                data: {
                  processingMode: metadata.processingMode,
                  sourceSha256: workbook.sourceSha256,
                  parserInputSha256: workbook.parserInputSha256,
                  totalRows: metadata.sheet.rowCount,
                  processedRows: 0,
                  leaseUntil: new Date(Date.now() + IMPORT_PARSE_LEASE_MS)
                }
              });
              return sheet.id;
            });
          }
        }
      );

      if (!sheetId || processedRows !== parsed.sheet.rowCount) {
        throw new Error('Excel 后台解析行数与持久化进度不一致');
      }
      await this.completeBackgroundParse(job, rawFileId, sheetId, parsed, counts, workbook);
    } catch (error) {
      if (error instanceof ImportParseLeaseLostError) return;
      if (error instanceof ImportParseWorkerStoppingError) {
        await this.releaseParseForRecovery(job.taskId, job.leaseToken);
        return;
      }
      if (rawFileId) {
        this.logger.warn(`Background import ${job.taskId} attempt ${job.attempt} failed: ${this.errorMessage(error)}`);
        await this.failOwnedParse(
          job.taskId,
          rawFileId,
          job.leaseToken,
          job.attempt,
          job.actor,
          job.context,
          error,
          job.options
        );
      }
    }
  }

  private async completeBackgroundParse(
    job: BackgroundParseJob,
    rawFileId: string,
    sheetId: string,
    parsed: ParsedWorkbookMetadata,
    counts: { valid: number; errors: number; duplicates: number; ignored: number },
    workbook: PreparedWorkbook
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, job.taskId);
      const current = await this.assertOwnedParse(tx, job.taskId, job.leaseToken);
      await tx.importSheet.update({
        where: { id: sheetId },
        data: this.importSheetUpdateData(parsed.sheet)
      });
      const columns = await tx.importColumn.findMany({
        where: { importTaskId: job.taskId },
        orderBy: { columnIndex: 'asc' }
      });
      if (columns.length !== parsed.columns.length) throw new Error('Excel 后台解析列数不一致');
      for (const parsedColumn of parsed.columns) {
        const column = columns.find((item) => item.columnIndex === parsedColumn.columnIndex);
        if (!column) throw new Error('Excel 后台解析列索引不一致');
        await tx.importColumn.update({
          where: { id: column.id },
          data: {
            sampleValues: parsedColumn.sampleValues,
            inferredType: parsedColumn.inferredType,
            duplicateName: parsedColumn.duplicateName,
            statistics: parsedColumn.statistics as unknown as Prisma.InputJsonObject
          }
        });
      }
      const refreshedColumns = await tx.importColumn.findMany({
        where: { importTaskId: job.taskId },
        orderBy: { columnIndex: 'asc' }
      });
      await this.applyAutomaticMappings(tx, current, refreshedColumns, job.actor);
      const decided = await tx.mappingDecision.count({ where: { importTaskId: job.taskId } });
      await tx.importTask.update({
        where: { id: job.taskId },
        data: {
          status: decided === refreshedColumns.length ? ImportTaskStatus.pending_confirm : ImportTaskStatus.mapping,
          leaseToken: null,
          leaseUntil: null,
          executionMode: 'background',
          processingMode: parsed.processingMode,
          sourceSha256: parsed.ir.sourceSha256,
          parserInputSha256: parsed.ir.parserInputSha256,
          irSchemaVersion: parsed.ir.schemaVersion,
          parserVersion: parsed.ir.parserVersion,
          irHash: parsed.ir.hash,
          rowEvidenceDigest: parsed.ir.rowEvidenceDigest,
          processedRows: parsed.sheet.rowCount,
          totalRows: parsed.sheet.rowCount,
          validRows: counts.valid,
          errorRows: counts.errors,
          duplicateRows: counts.duplicates,
          ignoredRows: counts.ignored,
          importedRows: 0,
          parsedAt: new Date(),
          errorMessage: null,
          version: { increment: 1 }
        }
      });
      await tx.rawFile.update({ where: { id: rawFileId }, data: { status: RawFileStatus.parsed } });
      await this.auditLogs.write(tx, job.actor, 'import_task.parse', 'import_task', job.taskId, {
        attempt: job.attempt,
        executionMode: 'background',
        processingMode: parsed.processingMode,
        sheetIndex: parsed.sheet.sheetIndex,
        headerRowIndex: parsed.sheet.headerRowIndex,
        allowCachedFormulaResults: job.options.allowCachedFormulaResults ?? false,
        columns: refreshedColumns.length,
        rows: parsed.sheet.rowCount,
        batchSize: IMPORT_ROW_BATCH_SIZE,
        ...this.workbookProvenance(workbook),
        irSchemaVersion: parsed.ir.schemaVersion,
        parserVersion: parsed.ir.parserVersion,
        irHash: parsed.ir.hash,
        ...counts
      }, job.context);
      await this.ledgerEvents.write(
        tx,
        job.actor,
        'import_task_parsed',
        'import_task',
        job.taskId,
        {
          attempt: job.attempt,
          executionMode: 'background',
          rawFileId,
          processingMode: parsed.processingMode,
          allowCachedFormulaResults: job.options.allowCachedFormulaResults ?? false,
          rowCount: parsed.sheet.rowCount,
          columnCount: refreshedColumns.length,
          ...this.workbookProvenance(workbook),
          irSchemaVersion: parsed.ir.schemaVersion,
          parserVersion: parsed.ir.parserVersion,
          irHash: parsed.ir.hash
        },
        `import_task:${job.taskId}:parse_attempt:${job.attempt}:parsed`
      );
    });
  }

  async getColumns(id: string) {
    const task = toImportTask(await this.findDetailOrThrow(id));
    return task.columns;
  }

  async getRows(id: string, query: QueryImportRowsDto, errorsOnly = false) {
    await this.ensureTaskExists(id);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ImportRowWhereInput = {
      importTaskId: id,
      status: errorsOnly ? { in: [ImportRowStatus.error, ImportRowStatus.duplicate] } : query.status
    };
    const [items, total] = await Promise.all([
      this.prisma.importRow.findMany({
        where,
        orderBy: { rowNumber: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.importRow.count({ where })
    ]);
    return { items: items.map(toImportRow), page, pageSize, total };
  }

  async findMappingProfiles(query: QueryMappingProfilesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.MappingProfileWhereInput = {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.templateId ? { templateId: query.templateId } : {}),
      ...(query.status ? { status: query.status } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.mappingProfile.findMany({
        where,
        include: { rules: { orderBy: { columnIndex: 'asc' } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.mappingProfile.count({ where })
    ]);
    return { items: items.map((profile) => this.presentMappingProfile(profile)), page, pageSize, total };
  }

  async revokeMappingProfile(id: string, actor: CurrentUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const profile = await tx.mappingProfile.findUnique({ where: { id } });
      if (!profile) throw new NotFoundException('映射配置不存在');
      if (profile.status === MappingProfileStatus.revoked) return;
      if (profile.projectId) await acquireProjectWriteLock(tx, profile.projectId);

      const affectedTasks = await tx.importTask.findMany({
        where: {
          mappingProfileId: id,
          status: { notIn: [ImportTaskStatus.confirming, ImportTaskStatus.confirmed, ImportTaskStatus.cancelled] }
        },
        select: { id: true }
      });
      const taskIds = affectedTasks.map((task) => task.id);
      if (taskIds.length > 0) {
        await tx.mappingDecision.deleteMany({
          where: { importTaskId: { in: taskIds }, mappingType: MappingDecisionType.profile }
        });
        await tx.importTask.updateMany({
          where: { id: { in: taskIds } },
          data: {
            mappingProfileId: null,
            mappingProfileVersion: null,
            mappingProfileSnapshotHash: null,
            previewSummaryVersion: null,
            version: { increment: 1 }
          }
        });
        for (const taskId of taskIds) await this.refreshTaskMappingStatus(tx, taskId);
      }
      await tx.mappingProfile.update({
        where: { id },
        data: { status: MappingProfileStatus.revoked, isActive: false }
      });
      await this.auditLogs.write(tx, actor, 'mapping_profile.revoke', 'mapping_profile', id, {
        projectId: profile.projectId,
        templateId: profile.templateId,
        profileVersion: profile.profileVersion,
        affectedTaskIds: taskIds
      }, context);
      await this.ledgerEvents.write(tx, actor, 'mapping_profile_revoked', 'mapping_profile', id, {
        projectId: profile.projectId,
        templateId: profile.templateId,
        profileVersion: profile.profileVersion,
        affectedTaskCount: taskIds.length
      });
    });
    const profile = await this.prisma.mappingProfile.findUniqueOrThrow({
      where: { id },
      include: { rules: { orderBy: { columnIndex: 'asc' } } }
    });
    return this.presentMappingProfile(profile);
  }

  async autoMatch(id: string, actor: CurrentUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.importTask.findUnique({ where: { id }, include: { columns: { include: { decision: true } } } });
      if (!task) throw new NotFoundException('资源不存在');
      this.assertTaskMutable(task.status);
      await tx.mappingDecision.deleteMany({
        where: { importTaskId: id, mappingType: { in: AUTOMATIC_MAPPING_TYPES } }
      });
      const columns = await tx.importColumn.findMany({ where: { importTaskId: id }, orderBy: { columnIndex: 'asc' } });
      await this.applyAutomaticMappings(tx, task, columns, actor);
      await this.refreshTaskMappingStatus(tx, id);
      await this.auditLogs.write(tx, actor, 'import_task.auto_match', 'import_task', id, { columns: columns.length }, context);
    });
    return toImportTask(await this.findDetailOrThrow(id));
  }

  async saveMappings(id: string, dto: SaveMappingsDto, actor: CurrentUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.importTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('资源不存在');
      this.assertTaskMutable(task.status);
      await acquireProjectWriteLock(tx, task.projectId);

      const columnIds = dto.mappings.map((item) => item.columnId);
      const columns = await tx.importColumn.findMany({ where: { importTaskId: id, id: { in: columnIds } } });
      if (columns.length !== columnIds.length) throw new BadRequestException('包含不属于当前任务的导入列');

      this.validateMappingInputs(dto.mappings);
      const targetFieldIds = dto.mappings.flatMap((item) => item.targetFieldId ? [item.targetFieldId] : []);
      if (new Set(targetFieldIds).size !== targetFieldIds.length) {
        throw new BadRequestException('同一系统字段不能映射多个 Excel 列');
      }
      const templateFields = await tx.templateField.findMany({
        where: {
          templateId: task.templateId,
          fieldId: { in: targetFieldIds },
          isVisible: true,
          field: { isActive: true }
        },
        include: { field: true }
      });
      if (templateFields.length !== targetFieldIds.length) {
        throw new BadRequestException('目标字段必须属于当前模板且处于启用状态');
      }

      const replacingColumns = new Set(columnIds);
      const otherDecisions = await tx.mappingDecision.findMany({
        where: { importTaskId: id, importColumnId: { notIn: [...replacingColumns] }, targetFieldId: { not: null } }
      });
      if (otherDecisions.some((decision) => decision.targetFieldId && targetFieldIds.includes(decision.targetFieldId))) {
        throw new BadRequestException('目标字段已被当前任务的其他列使用');
      }

      const fields = new Map(templateFields.map((item) => [item.fieldId, item.field]));
      for (const mapping of dto.mappings) {
        const ignored = mapping.ignore === true;
        await tx.mappingDecision.upsert({
          where: { importColumnId: mapping.columnId },
          create: {
            importTaskId: id,
            importColumnId: mapping.columnId,
            targetFieldId: ignored ? null : mapping.targetFieldId,
            mappingType: ignored ? MappingDecisionType.ignored : MappingDecisionType.manual,
            confidence: new Prisma.Decimal(1),
            ignored,
            confirmedBy: actor.id
          },
          update: {
            targetFieldId: ignored ? null : mapping.targetFieldId,
            mappingType: ignored ? MappingDecisionType.ignored : MappingDecisionType.manual,
            confidence: new Prisma.Decimal(1),
            ignored,
            confirmedBy: actor.id
          }
        });
        await tx.fieldSuggestion.updateMany({
          where: { importColumnId: mapping.columnId, status: FieldSuggestionStatus.pending },
          data: ignored
            ? { status: FieldSuggestionStatus.rejected, approvedBy: actor.id, approvedAt: new Date() }
            : {
                status: FieldSuggestionStatus.mapped_to_existing,
                mappedFieldId: mapping.targetFieldId,
                approvedBy: actor.id,
                approvedAt: new Date()
              }
        });
      }

      await this.refreshTaskMappingStatus(tx, id);
      const profile = dto.saveToProfile === false
        ? undefined
        : await this.saveReviewedProfileForTask(tx, id, actor);
      await this.auditLogs.write(tx, actor, 'import_task.mappings_saved', 'import_task', id, {
        mappings: dto.mappings.map((mapping) => ({
          columnId: mapping.columnId,
          targetFieldId: mapping.targetFieldId ?? null,
          ignored: mapping.ignore === true,
          targetFieldName: mapping.targetFieldId ? fields.get(mapping.targetFieldId)?.fieldName : undefined
        })),
        savedToProfile: Boolean(profile),
        profileId: profile?.id,
        profileVersion: profile?.profileVersion,
        structureFingerprint: profile?.sourceStructureFingerprint
      }, context);
      await this.ledgerEvents.write(tx, actor, 'mapping_rules_saved', 'import_task', id, {
        mappingCount: dto.mappings.length,
        savedToProfile: Boolean(profile),
        profileId: profile?.id,
        profileVersion: profile?.profileVersion
      });
    });
    return toImportTask(await this.findDetailOrThrow(id));
  }

  async generateSuggestions(id: string, actor: CurrentUser, context: RequestContext) {
    const count = await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.importTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('资源不存在');
      this.assertTaskMutable(task.status);
      const columns = await tx.importColumn.findMany({
        where: { importTaskId: id, decision: null }
      });
      for (const column of columns) await this.upsertSuggestion(tx, task, column);
      await this.auditLogs.write(tx, actor, 'import_task.suggestions_generated', 'import_task', id, { count: columns.length }, context);
      return columns.length;
    });
    const task = await this.findDetailOrThrow(id);
    return { count, suggestions: task.columns.flatMap((column) => column.suggestion ? [toFieldSuggestion(column.suggestion)] : []) };
  }

  async preview(id: string, query: QueryImportPreviewDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const task = await this.prisma.importTask.findUnique({ where: { id }, include: previewTaskInclude });
    if (!task) throw new NotFoundException('资源不存在');
    this.assertPreviewAvailable(task.status);

    const importRows = await this.prisma.importRow.findMany({
      where: { importTaskId: id },
      orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize
    });
    const preview = this.buildPreviewRows(task, importRows);
    const summary = await this.getPreviewSummary(task);
    const currentTask = await this.findDetailOrThrow(id);
    if (currentTask.version !== task.version) {
      throw new ConflictException('导入任务已发生变化，请刷新后重试');
    }

    const result = {
      task: toImportTask(currentTask),
      unresolvedColumns: preview.unresolvedColumns,
      rows: preview.rows.map((row) => this.presentPreviewRow(row)),
      summary,
      pagination: {
        page,
        pageSize,
        total: summary.total,
        totalPages: Math.ceil(summary.total / pageSize),
        hasNext: page * pageSize < summary.total
      },
      strategy: 'whole_batch_fail_closed'
    };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > IMPORT_PREVIEW_MAX_RESPONSE_BYTES) {
      throw new PayloadTooLargeException('预览响应超过安全预算，请缩小 pageSize');
    }
    return result;
  }

  async reviewRow(
    id: string,
    rowId: string,
    dto: ReviewImportRowDto,
    actor: CurrentUser,
    context: RequestContext
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.importTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('资源不存在');
      this.assertTaskMutable(task.status);
      if (task.version !== dto.expectedVersion || task.reviewRevision !== dto.expectedReviewRevision) {
        throw new ConflictException('导入审核内容已变化，请刷新后重试');
      }
      const row = await tx.importRow.findFirst({ where: { id: rowId, importTaskId: id } });
      if (!row) throw new NotFoundException('导入行不存在');
      const summaryCandidate = this.isPotentialSummaryRow(this.jsonObject(row.rawData));
      if (!summaryCandidate) {
        throw new ConflictException({
          message: '逐行审核仅用于处置疑似汇总行，普通明细错误必须修正后重新导入',
          data: { reason: 'IMPORT_ROW_REVIEW_NOT_SUMMARY', decisionId: 'H01' }
        });
      }
      if (
        dto.decision === 'include'
        && ([ImportRowStatus.ignored, ImportRowStatus.duplicate] as ImportRowStatus[]).includes(row.parserStatus)
      ) {
        throw new ConflictException({
          message: '解析器已将该行标记为空行或重复行，H03 未批准前不能强制纳入',
          data: { reason: 'IMPORT_ROW_INCLUDE_POLICY_PENDING', decisionRefs: ['H01', 'H03'] }
        });
      }

      await tx.importRow.update({
        where: { id: rowId },
        data: {
          reviewDecision: dto.decision,
          reviewReason: dto.reason,
          reviewedBy: actor.id,
          reviewedAt: new Date()
        }
      });
      await this.invalidateImportReview(tx, id);
      await this.auditLogs.write(tx, actor, 'import_row.review', 'import_row', rowId, {
        importTaskId: id,
        rowNumber: row.rowNumber,
        summaryCandidate,
        decision: dto.decision,
        reason: dto.reason,
        policyVersion: EXCEL_ROW_REVIEW_POLICY_VERSION,
        invalidatedValidationSnapshotHash: task.validationSnapshotHash
      }, context);
      await this.ledgerEvents.write(tx, actor, 'import_row_reviewed', 'import_row', rowId, {
        importTaskId: id,
        rowNumber: row.rowNumber,
        summaryCandidate,
        decision: dto.decision,
        policyVersion: EXCEL_ROW_REVIEW_POLICY_VERSION
      });
    });
    return toImportTask(await this.findDetailOrThrow(id));
  }

  async revalidate(id: string, dto: RevalidateImportTaskDto, actor: CurrentUser, context: RequestContext) {
    const task = await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const current = await tx.importTask.findUnique({ where: { id }, include: previewTaskInclude });
      if (!current) throw new NotFoundException('资源不存在');
      if (current.status !== ImportTaskStatus.pending_confirm) {
        throw new ConflictException('只有待财务确认的 Excel 任务可以重新校验');
      }
      if (current.version !== dto.expectedVersion || current.reviewRevision !== dto.expectedReviewRevision) {
        throw new ConflictException('导入审核内容已变化，请刷新后重新校验');
      }
      await acquireProjectWriteLock(tx, current.projectId);
      this.assertImportSourceEligible(current);
      const template = await this.recordPolicy.getWritableTemplate(
        tx,
        current.projectId,
        current.templateId,
        current.importType
      );
      if (template.version !== current.templateVersion) {
        throw new ConflictException('导入任务引用的模板版本已变化，请重新创建任务');
      }
      if (!current.sourceSha256 || !current.irSchemaVersion || !current.parserVersion || !current.irHash) {
        throw new ConflictException('Excel 任务缺少可重放的来源或 IR 证据');
      }
      return current;
    });

    const unresolvedColumns = task.columns.filter((column) => !column.decision);
    if (unresolvedColumns.length > 0) throw new ConflictException('所有 Excel 列必须先映射或明确忽略');

    const rowSetDigest = createHash('sha256');
    const outputDigest = createHash('sha256');
    const blocking = new Map<string, ImportValidationIssueAccumulator>();
    const warnings = new Map<string, ImportValidationIssueAccumulator>();
    const summary: PreviewSummary = { total: 0, valid: 0, errors: 0, duplicates: 0, ignored: 0 };
    let blockingErrorCount = 0;
    let warningOccurrenceCount = 0;
    let lastRowNumber: number | undefined;
    let lastId: string | undefined;

    while (true) {
      const current = await this.prisma.importTask.findUnique({
        where: { id },
        select: { version: true, reviewRevision: true, status: true }
      });
      if (
        !current
        || current.version !== dto.expectedVersion
        || current.reviewRevision !== dto.expectedReviewRevision
        || current.status !== ImportTaskStatus.pending_confirm
      ) {
        throw new ConflictException('导入审核内容在校验期间发生变化，请重新开始');
      }
      const rows = await this.prisma.importRow.findMany({
        where: {
          importTaskId: id,
          ...(lastRowNumber === undefined || lastId === undefined
            ? {}
            : {
                OR: [
                  { rowNumber: { gt: lastRowNumber } },
                  { rowNumber: lastRowNumber, id: { gt: lastId } }
                ]
              })
        },
        orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
        take: IMPORT_PREVIEW_SUMMARY_BATCH_SIZE
      });
      if (rows.length === 0) break;
      const preview = this.buildPreviewRows(task, rows);
      await this.persistValidationRows(id, preview.rows);

      for (const row of preview.rows) {
        summary.total += 1;
        if (row.status === ImportRowStatus.mapped) summary.valid += 1;
        else if (row.status === ImportRowStatus.error) summary.errors += 1;
        else if (row.status === ImportRowStatus.duplicate) summary.duplicates += 1;
        else if (row.status === ImportRowStatus.ignored) summary.ignored += 1;

        this.updateCanonicalDigest(rowSetDigest, {
          rowId: row.id,
          rowNumber: row.rowNumber,
          rowHash: row.rowHash,
          status: row.status,
          reviewDecision: row.review.decision ?? null,
          summaryCandidate: row.summaryCandidate
        });
        if (row.status === ImportRowStatus.mapped) {
          this.updateCanonicalDigest(outputDigest, this.normalizedPreviewOutput(row));
        }
        for (const message of row.errors) {
          blockingErrorCount += 1;
          this.addValidationIssue(blocking, 'ROW_VALIDATION_ERROR', message, row);
        }
        for (const message of row.warnings) {
          warningOccurrenceCount += 1;
          this.addValidationIssue(warnings, 'ROW_REVIEW_WARNING', message, row);
        }
        if (row.status === ImportRowStatus.duplicate) {
          warningOccurrenceCount += 1;
          this.addValidationIssue(
            warnings,
            'DUPLICATE_ROW_EXCLUDED',
            '解析器标记的重复行未生成正式记录；H03 正式重复策略仍待人工门禁',
            row
          );
        }
        if (row.status === ImportRowStatus.ignored && row.review.decision !== 'exclude') {
          warningOccurrenceCount += 1;
          this.addValidationIssue(
            warnings,
            'PARSER_IGNORED_ROW',
            '解析器标记的空白行未生成正式记录',
            row
          );
        }
      }

      const last = rows[rows.length - 1];
      lastRowNumber = last.rowNumber;
      lastId = last.id;
    }

    if (summary.total === 0) {
      blockingErrorCount += 1;
      this.addValidationIssueWithoutRow(blocking, 'NO_IMPORT_ROWS', '没有可供财务审核的 Excel 数据行');
    }
    if (summary.valid === 0) {
      blockingErrorCount += 1;
      this.addValidationIssueWithoutRow(blocking, 'NO_DETAIL_ROWS', '没有可生成正式记录的有效业务明细行');
    }

    const blockingErrors = this.finalizeValidationIssues('error', blocking);
    const validationWarnings = this.finalizeValidationIssues('warning', warnings);
    const normalizedOutputHash = outputDigest.digest('hex');
    const rowSetHash = rowSetDigest.digest('hex');
    const mappingPayloadHash = this.importMappingHash(task);
    const templateContentHash = this.importTemplateContentHash(task);
    const core = {
      schemaVersion: EXCEL_VALIDATION_SCHEMA_VERSION,
      taskId: task.id,
      projectId: task.projectId,
      sourceSha256: task.sourceSha256,
      irSchemaVersion: task.irSchemaVersion,
      parserVersion: task.parserVersion,
      irHash: task.irHash,
      templateId: task.templateId,
      templateVersion: task.templateVersion,
      templateContentHash,
      reviewRevision: task.reviewRevision,
      mappingPayloadHash,
      transformRegistryVersion: task.transformRegistryVersion ?? IMPORT_TRANSFORM_REGISTRY_VERSION,
      validationRuleVersion: EXCEL_DETERMINISTIC_VALIDATION_RULE_VERSION,
      rowSetHash,
      normalizedOutputHash,
      counts: {
        ...summary,
        recordCount: summary.valid,
        blockingErrorCount,
        warningOccurrenceCount
      },
      blockingErrors,
      warnings: validationWarnings,
      valid: blockingErrorCount === 0,
      validatedBy: actor.id
    };
    const snapshot = { ...core, snapshotHash: canonicalJsonSha256(core) };
    const validatedAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const result = await tx.importTask.updateMany({
        where: {
          id,
          status: ImportTaskStatus.pending_confirm,
          version: dto.expectedVersion,
          reviewRevision: dto.expectedReviewRevision
        },
        data: {
          validationRevision: task.reviewRevision,
          validationSnapshot: this.json(snapshot),
          validationSnapshotHash: snapshot.snapshotHash,
          validationRuleVersion: EXCEL_DETERMINISTIC_VALIDATION_RULE_VERSION,
          validatedAt,
          totalRows: summary.total,
          validRows: summary.valid,
          errorRows: summary.errors,
          duplicateRows: summary.duplicates,
          ignoredRows: summary.ignored,
          previewSummaryVersion: task.version + 1,
          version: { increment: 1 }
        }
      });
      if (result.count !== 1) throw new ConflictException('导入审核内容在校验期间发生变化，请重新开始');
      await this.auditLogs.write(tx, actor, 'import_task.revalidate', 'import_task', id, {
        reviewRevision: task.reviewRevision,
        snapshotHash: snapshot.snapshotHash,
        normalizedOutputHash,
        rowSetHash,
        valid: snapshot.valid,
        counts: snapshot.counts
      }, context);
      await this.ledgerEvents.write(tx, actor, 'import_task_revalidated', 'import_task', id, {
        reviewRevision: task.reviewRevision,
        snapshotHash: snapshot.snapshotHash,
        normalizedOutputHash,
        valid: snapshot.valid
      });
      return result;
    });
    void updated;
    return toImportTask(await this.findDetailOrThrow(id));
  }

  async confirm(
    id: string,
    dto: ConfirmImportTaskDto,
    actor: CurrentUser,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    const scope = this.idempotency.prepare(
      actor.id,
      'POST',
      '/api/import-tasks/:id/confirm',
      idempotencyKey,
      { importTaskId: id, ...dto }
    );
    const persistenceKey = this.idempotency.persistenceKey(scope);
    if (!persistenceKey) throw new BadRequestException('Excel 财务批准必须提供 Idempotency-Key');
    const approvalRequestKeyHash = canonicalJsonSha256({ persistenceKey });
    let claimedJob: BackgroundConfirmationJob | undefined;
    const result = await this.prisma.$transaction((tx) => this.idempotency.execute(tx, scope, 201, async () => {
      await this.lockTask(tx, id);
      const current = await tx.importTask.findUnique({ where: { id }, include: previewTaskInclude });
      if (!current) throw new NotFoundException('资源不存在');
      if (current.status === ImportTaskStatus.confirmed) {
        throw new ConflictException({
          message: 'Excel 导入任务已完成正式发布',
          data: { reason: 'IMPORT_TASK_ALREADY_COMMITTED' }
        });
      }
      if (current.status === ImportTaskStatus.confirming) {
        throw new ConflictException({
          message: 'Excel 导入任务已由另一批准命令占用',
          data: { reason: 'IMPORT_APPROVAL_CONCURRENT_CONFLICT' }
        });
      }
      const confirmableStatuses: ImportTaskStatus[] = [
        ImportTaskStatus.pending_confirm,
        ImportTaskStatus.confirmation_failed
      ];
      if (!confirmableStatuses.includes(current.status)) {
        throw new ConflictException('仅待确认或确认失败的任务可以确认');
      }
      if (current.version !== dto.expectedVersion || current.reviewRevision !== dto.expectedReviewRevision) {
        throw new ConflictException({
          message: 'Excel 审核内容已变化，请刷新后批准',
          data: {
            reason: 'IMPORT_APPROVAL_VERSION_CONFLICT',
            version: current.version,
            reviewRevision: current.reviewRevision
          }
        });
      }

      await acquireProjectWriteLock(tx, current.projectId);
      this.assertImportSourceEligible(current);
      const template = await this.recordPolicy.getWritableTemplate(
        tx,
        current.projectId,
        current.templateId,
        current.importType
      );
      if (template.version !== current.templateVersion) {
        throw new ConflictException('导入任务引用的模板版本已变化，请重新创建任务');
      }
      const approver = await this.assertCurrentFinanceApprover(tx, current, actor);
      const approvedValidation = this.assertImportApprovalValidation(current, dto);
      const [columnCount, decisionCount, totalRows] = await Promise.all([
        tx.importColumn.count({ where: { importTaskId: id } }),
        tx.mappingDecision.count({ where: { importTaskId: id } }),
        tx.importRow.count({ where: { importTaskId: id } })
      ]);
      if (columnCount === 0 || decisionCount !== columnCount) {
        throw new ConflictException('所有未知列必须先映射或明确忽略');
      }
      if (totalRows === 0) throw new UnprocessableEntityException('没有可导入的数据行');
      if (totalRows !== approvedValidation.counts.total) {
        throw new ConflictException({
          message: 'Excel 行集合在重新校验后发生变化',
          data: { reason: 'IMPORT_ROW_SET_CHANGED' }
        });
      }
      if (current.status === ImportTaskStatus.confirmation_failed) {
        await this.resetFailedConfirmationStaging(tx, id);
      }

      const attempt = current.confirmationAttempts + 1;
      const leaseToken = randomUUID();
      const now = new Date();
      const approvalCore = {
        schemaVersion: EXCEL_APPROVAL_SNAPSHOT_SCHEMA_VERSION,
        taskId: current.id,
        taskVersion: current.version,
        projectId: current.projectId,
        source: {
          rawFileId: current.rawFileId,
          rawFileSha256: current.rawFile.sha256,
          sourceSha256: current.sourceSha256,
          parserInputSha256: current.parserInputSha256,
          irSchemaVersion: current.irSchemaVersion,
          parserVersion: current.parserVersion,
          irHash: current.irHash,
          rowEvidenceDigest: current.rowEvidenceDigest
        },
        template: {
          templateId: current.templateId,
          templateVersion: current.templateVersion,
          templateContentHash: approvedValidation.templateContentHash,
          templateSnapshotHash: canonicalJsonSha256(current.templateSnapshot ?? null)
        },
        mapping: {
          mappingPayloadHash: approvedValidation.mappingPayloadHash,
          structureFingerprint: current.structureFingerprint,
          fingerprintVersion: current.fingerprintVersion,
          profileId: current.mappingProfileId,
          profileVersion: current.mappingProfileVersion,
          profileSnapshotHash: current.mappingProfileSnapshotHash
        },
        aiSuggestion: {
          appliedToFormalData: false
        },
        review: {
          reviewRevision: current.reviewRevision,
          validationSnapshotHash: current.validationSnapshotHash,
          validationRuleVersion: current.validationRuleVersion,
          rowSetHash: approvedValidation.rowSetHash,
          normalizedOutputHash: approvedValidation.normalizedOutputHash,
          acknowledgedWarningIds: approvedValidation.acknowledgedWarningIds
        },
        versions: {
          transformRegistryVersion: current.transformRegistryVersion ?? IMPORT_TRANSFORM_REGISTRY_VERSION,
          approvalPolicyVersion: EXCEL_APPROVAL_POLICY_VERSION,
          authorizationPolicyVersion: EXCEL_APPROVAL_AUTHORIZATION_POLICY_VERSION,
          rowReviewPolicyVersion: EXCEL_ROW_REVIEW_POLICY_VERSION,
          financialPolicy: financialPolicySnapshot()
        },
        approval: {
          approvedByUserId: approver.id,
          approvedByUsername: approver.username,
          approvedAt: now.toISOString(),
          selfApproval: false,
          requestKeyHash: approvalRequestKeyHash
        },
        output: {
          normalizedOutputHash: approvedValidation.normalizedOutputHash,
          recordCount: approvedValidation.counts.recordCount
        }
      };
      const approvalSnapshot = {
        ...approvalCore,
        snapshotHash: canonicalJsonSha256(approvalCore)
      };
      const scheduled = await tx.importTask.updateMany({
        where: {
          id,
          status: current.status,
          version: dto.expectedVersion,
          reviewRevision: dto.expectedReviewRevision,
          validationSnapshotHash: dto.expectedValidationSnapshotHash
        },
        data: {
          status: ImportTaskStatus.confirming,
          leaseToken,
          leaseUntil: new Date(now.getTime() + this.confirmationLeaseMs),
          confirmRequestedBy: approver.id,
          confirmationTotalRows: totalRows,
          confirmationProcessedRows: 0,
          confirmationSuccessRows: 0,
          confirmationErrorRows: 0,
          confirmationAttempts: attempt,
          confirmationStartedAt: now,
          importedRows: 0,
          approvalSnapshot: this.json(approvalSnapshot),
          approvalSnapshotHash: approvalSnapshot.snapshotHash,
          approvalReviewRevision: current.reviewRevision,
          approvalValidationHash: current.validationSnapshotHash,
          approvalPolicyVersion: EXCEL_APPROVAL_POLICY_VERSION,
          approvalRequestKeyHash,
          errorMessage: null,
          version: { increment: 1 }
        }
      });
      if (scheduled.count !== 1) {
        throw new ConflictException({
          message: 'Excel 批准命令未赢得并发竞争',
          data: { reason: 'IMPORT_APPROVAL_CONCURRENT_CONFLICT' }
        });
      }
      await this.auditLogs.write(tx, approver, 'import_task.confirm_scheduled', 'import_task', id, {
        attempt,
        totalRows,
        recordCount: approvedValidation.counts.recordCount,
        batchSize: this.confirmationBatchSize,
        reviewRevision: current.reviewRevision,
        validationSnapshotHash: current.validationSnapshotHash,
        approvalSnapshotHash: approvalSnapshot.snapshotHash,
        normalizedOutputHash: approvedValidation.normalizedOutputHash,
        acknowledgedWarningIds: approvedValidation.acknowledgedWarningIds,
        selfApproval: false
      }, context);
      await this.ledgerEvents.write(
        tx,
        approver,
        'import_task_confirmation_scheduled',
        'import_task',
        id,
        {
          attempt,
          totalRows,
          recordCount: approvedValidation.counts.recordCount,
          approvalSnapshotHash: approvalSnapshot.snapshotHash
        },
        `import_task:${id}:confirm_attempt:${attempt}:scheduled`
      );
      claimedJob = {
        taskId: id,
        leaseToken,
        approvalSnapshotHash: approvalSnapshot.snapshotHash,
        actor: approver,
        context,
        attempt
      };
      return this.confirmationResponse(await this.findDetailOrThrow(id, tx), false);
    }));
    if (claimedJob) await this.scheduleBackgroundConfirmation(claimedJob);
    return result;
  }

  async recoverExpiredConfirmations() {
    if (this.stopping) return 0;
    try {
      const expired = await this.prisma.importTask.findMany({
        where: { status: ImportTaskStatus.confirming, leaseUntil: { lt: new Date() } },
        select: { id: true },
        orderBy: { leaseUntil: 'asc' },
        take: 20
      });
      let recovered = 0;
      for (const { id } of expired) {
        if (this.stopping) continue;
        try {
          const job = await this.claimExpiredBackgroundConfirmation(id);
          if (!job) continue;
          recovered += 1;
          await this.scheduleBackgroundConfirmation(job);
        } catch (error) {
          this.logger.warn(`Import confirmation ${id} recovery failed: ${this.errorMessage(error)}`);
        }
      }
      return recovered;
    } catch (error) {
      this.logger.warn(`Import confirmation lease recovery failed: ${this.errorMessage(error)}`);
      return 0;
    }
  }

  private async claimExpiredBackgroundConfirmation(
    id: string
  ): Promise<BackgroundConfirmationJob | undefined> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.importTask.findUnique({ where: { id }, include: { uploader: true } });
      if (
        !task ||
        task.status !== ImportTaskStatus.confirming ||
        !task.leaseUntil ||
        task.leaseUntil.getTime() >= Date.now()
      ) {
        return undefined;
      }
      const requestedUser = task.confirmRequestedBy
        ? await tx.user.findUnique({ where: { id: task.confirmRequestedBy } })
        : undefined;
      if (!requestedUser || !task.approvalSnapshotHash) {
        throw new ConflictException('Excel 确认任务缺少不可变批准快照或批准人');
      }
      const actor = this.toCurrentUser(requestedUser);
      const workerHandoff = this.isWorkerHandoffLease(task.leaseToken);
      const attempt = workerHandoff ? task.confirmationAttempts : task.confirmationAttempts + 1;
      const context = {
        requestId: workerHandoff
          ? `import-confirm-worker-claim-${id}-${attempt}`
          : `import-confirm-recovery-${id}-${attempt}`
      };
      if (!workerHandoff && task.confirmationAttempts >= this.confirmationMaxAttempts) {
        const reason = `后台确认连续中断 ${task.confirmationAttempts} 次，已停止自动恢复`;
        await tx.importTask.update({
          where: { id },
          data: {
            status: ImportTaskStatus.confirmation_failed,
            leaseToken: null,
            leaseUntil: null,
            errorMessage: reason,
            version: { increment: 1 }
          }
        });
        await this.auditLogs.write(tx, actor, 'import_task.confirm_recovery_exhausted', 'import_task', id, {
          attempts: task.confirmationAttempts,
          reason
        }, context);
        await this.ledgerEvents.write(
          tx,
          actor,
          'import_task_confirmation_recovery_exhausted',
          'import_task',
          id,
          { attempts: task.confirmationAttempts, reason },
          `import_task:${id}:confirmation_recovery_exhausted`
        );
        return undefined;
      }

      const [totalRows, processedRows, successRows, errorRows] = await Promise.all([
        tx.importRow.count({ where: { importTaskId: id } }),
        tx.importRow.count({ where: { importTaskId: id, confirmationProcessedAt: { not: null } } }),
        tx.businessRecord.count({ where: { importTaskId: id } }),
        tx.importRow.count({
          where: { importTaskId: id, confirmationProcessedAt: { not: null }, status: ImportRowStatus.error }
        })
      ]);
      const leaseToken = randomUUID();
      await tx.importTask.update({
        where: { id },
        data: {
          leaseToken,
          leaseUntil: new Date(Date.now() + this.confirmationLeaseMs),
          confirmationTotalRows: totalRows,
          confirmationProcessedRows: processedRows,
          confirmationSuccessRows: successRows,
          confirmationErrorRows: errorRows,
          confirmationAttempts: attempt,
          importedRows: 0,
          errorMessage: null,
          version: { increment: 1 }
        }
      });
      const auditAction = workerHandoff ? 'import_task.confirm_claimed' : 'import_task.confirm_recovered';
      const eventType = workerHandoff
        ? 'import_task_confirmation_claimed'
        : 'import_task_confirmation_recovered';
      const eventSuffix = workerHandoff ? 'worker_claimed' : 'recovered';
      await this.auditLogs.write(tx, actor, auditAction, 'import_task', id, {
        attempt,
        previousLeaseUntil: task.leaseUntil.toISOString(),
        processedRows,
        totalRows,
        workerHandoff
      }, context);
      await this.ledgerEvents.write(
        tx,
        actor,
        eventType,
        'import_task',
        id,
        { attempt, processedRows, totalRows, workerHandoff },
        `import_task:${id}:confirm_attempt:${attempt}:${eventSuffix}`
      );
      return {
        taskId: id,
        leaseToken,
        approvalSnapshotHash: task.approvalSnapshotHash,
        actor,
        context,
        attempt
      };
    });
  }

  private async scheduleBackgroundConfirmation(job: BackgroundConfirmationJob) {
    if (!this.canRunBackgroundJobs()) {
      await this.handoffConfirmationToWorker(job.taskId, job.leaseToken);
      return;
    }
    const jobKey = `confirm:${job.taskId}:${job.leaseToken}`;
    if (this.backgroundJobs.has(jobKey) || this.stopping) return;
    const running = this.executeBackgroundConfirmation(job)
      .catch((error) => this.logger.error(
        `Background confirmation ${job.taskId} failed: ${this.errorMessage(error)}`
      ))
      .finally(() => this.backgroundJobs.delete(jobKey));
    this.backgroundJobs.set(jobKey, running);
  }

  private async executeBackgroundConfirmation(job: BackgroundConfirmationJob) {
    try {
      while (true) {
        if (this.stopping) throw new ImportConfirmationWorkerStoppingError();
        const processedBatch = await this.processConfirmationBatch(job);
        if (processedBatch) continue;
        const integrity = await this.prepareBackgroundConfirmationCompletion(job);
        await this.completeBackgroundConfirmation(job, integrity);
        return;
      }
    } catch (error) {
      if (error instanceof ImportConfirmationLeaseLostError) return;
      if (error instanceof ImportConfirmationWorkerStoppingError || this.isTransientDatabaseError(error)) {
        await this.releaseConfirmationForRecovery(job.taskId, job.leaseToken, this.errorMessage(error));
        return;
      }
      this.logger.warn(
        `Background confirmation ${job.taskId} attempt ${job.attempt} failed: ${this.errorMessage(error)}`
      );
      await this.failOwnedConfirmation(job, error);
    }
  }

  private async processConfirmationBatch(job: BackgroundConfirmationJob) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, job.taskId);
      await this.assertOwnedConfirmation(tx, job.taskId, job.leaseToken);
      const identity = await tx.importTask.findUnique({
        where: { id: job.taskId },
        select: { projectId: true }
      });
      if (!identity) throw new NotFoundException('资源不存在');
      await acquireProjectWriteLock(tx, identity.projectId);
      const task = await tx.importTask.findUnique({
        where: { id: job.taskId },
        include: previewTaskInclude
      });
      if (!task) throw new NotFoundException('资源不存在');
      this.assertImportApprovalSnapshotCurrent(task, job.approvalSnapshotHash);
      this.assertImportSourceEligible(task);
      const activeTemplate = await this.recordPolicy.getWritableTemplate(
        tx,
        task.projectId,
        task.templateId,
        task.importType
      );
      if (activeTemplate.version !== task.templateVersion) {
        throw new ConflictException('导入任务引用的模板版本已变化，请重新创建任务');
      }
      const rows = await tx.importRow.findMany({
        where: { importTaskId: job.taskId, confirmationProcessedAt: null },
        orderBy: { rowNumber: 'asc' },
        take: this.confirmationBatchSize
      });
      if (rows.length === 0) return false;

      const preview = this.buildPreviewRows(task, rows);
      if (preview.unresolvedColumns.length > 0) {
        throw new ConflictException('确认期间检测到未处理的映射列');
      }
      const invalid = preview.rows.find((row) => row.status === ImportRowStatus.error || row.errors.length > 0);
      if (invalid) {
        throw new ConflictException({
          message: `批准后第 ${invalid.rowNumber} 行重新校验失败，整批不会发布`,
          data: { reason: 'IMPORT_POST_APPROVAL_ROW_INVALID', rowNumber: invalid.rowNumber }
        });
      }
      const now = new Date();
      const snapshotTime = task.confirmationStartedAt ?? now;
      const recordData: Prisma.BusinessRecordCreateManyInput[] = [];
      const valueData: Prisma.RecordValueCreateManyInput[] = [];
      const ledgerData: Prisma.LedgerEventCreateManyInput[] = [];
      const recordIntegrityByRow = new Map<string, StagingRecordIntegrity>();

      for (const row of preview.rows) {
        if (([ImportRowStatus.ignored, ImportRowStatus.duplicate] as ImportRowStatus[]).includes(row.status)) {
          continue;
        }
        if (row.status !== ImportRowStatus.mapped || !row.recordDate || row.amount === undefined) {
          throw new ConflictException({
            message: `批准后的第 ${row.rowNumber} 行不再是可入账明细，整批不会发布`,
            data: { reason: 'IMPORT_POST_APPROVAL_ROW_STATE_CHANGED', rowNumber: row.rowNumber }
          });
        }
        const policyValues = row.values.map((value) => ({ fieldId: value.fieldId, value: value.value }));
        const canonical = this.recordPolicy.resolveCanonicalValues(task.template, policyValues, { requireValues: true });
        this.recordPolicy.assertTopLevelMatches(canonical, {
          amount: row.amount,
          recordDate: row.recordDate,
          category: row.category
        });
        const recordId = this.deterministicImportRecordId(row.id);
        const recordValues = row.values.map((value) => this.buildRecordValueData(
          recordId,
          value,
          task.template.templateFields
        ));
        const recordInput = {
          id: recordId,
          projectId: task.projectId,
          templateId: task.templateId,
          templateVersion: task.templateVersion,
          templateSnapshot: this.recordPolicy.toSnapshot(task.template),
          sourceSnapshot: this.recordPolicy.toSourceSnapshot(RecordSourceType.excel, row.id, {
            importTaskId: job.taskId,
            importRowId: row.id,
            rowNumber: row.rowNumber,
            rowHash: row.rowHash,
            rawFileId: task.rawFileId,
            rawFileSha256: task.rawFile.sha256,
            approvalSnapshotHash: task.approvalSnapshotHash
          }),
          confirmationSnapshot: this.json({
            ...this.recordPolicy.toConfirmationSnapshot(task.template, canonical, policyValues, {
              projectId: task.projectId,
              sourceType: RecordSourceType.excel,
              sourceId: row.id,
              confirmedAt: snapshotTime,
              confirmedBy: job.actor.username,
              attachments: [task.rawFileId]
            }),
            ingestionApproval: {
              schemaVersion: EXCEL_APPROVAL_SNAPSHOT_SCHEMA_VERSION,
              snapshotHash: task.approvalSnapshotHash,
              validationSnapshotHash: task.validationSnapshotHash,
              reviewRevision: task.reviewRevision,
              normalizedOutputHash: this.approvalOutputHash(task)
            }
          }),
          recordType: task.template.recordType,
          accountingDirection: canonical.accountingDirection,
          dataLayer: task.template.dataLayer,
          recordDate: canonical.recordDate,
          amount: canonical.amount,
          currency: 'CNY',
          category: canonical.category,
          subCategory: row.subCategory,
          description: `${task.fileName} 第${row.rowNumber}行导入记录`,
          sourceType: RecordSourceType.excel,
          sourceId: row.id,
          importTaskId: job.taskId,
          status: BusinessRecordStatus.pending_confirm,
          publicationStatus: BusinessRecordPublicationStatus.unpublished,
          stagingApprovalHash: job.approvalSnapshotHash,
          attachments: [task.rawFileId],
          createdBy: job.actor.username
        } satisfies Prisma.BusinessRecordCreateManyInput;
        const contentHash = this.stagingRecordContentHash(recordInput, recordValues);
        recordData.push(recordInput);
        valueData.push(...recordValues);
        recordIntegrityByRow.set(row.id, {
          recordId,
          contentHash,
          valueCount: recordValues.length
        });
        ledgerData.push({
          eventType: 'business_record_staged',
          aggregateType: 'business_record',
          aggregateId: recordId,
          actorUserId: job.actor.id,
          actorUsername: job.actor.username,
          idempotencyKey: `import_row:${row.id}:business_record_staged`,
          payload: {
            sourceType: RecordSourceType.excel,
            importTaskId: job.taskId,
            importRowId: row.id,
            rawFileId: task.rawFileId,
            accountingDirection: task.template.accountingDirection,
            amount: row.amount,
            approvalSnapshotHash: task.approvalSnapshotHash
          }
        });
      }

      if (recordData.length > 0) {
        await tx.businessRecord.createMany({ data: recordData, skipDuplicates: true });
      }
      if (valueData.length > 0) {
        await tx.recordValue.createMany({ data: valueData, skipDuplicates: true });
      }
      if (ledgerData.length > 0) {
        await tx.ledgerEvent.createMany({ data: ledgerData, skipDuplicates: true });
      }
      const sealedRecords = await this.persistStagingRecordIntegrity(
        tx,
        job.taskId,
        job.approvalSnapshotHash,
        recordIntegrityByRow
      );
      if (sealedRecords !== recordIntegrityByRow.size) {
        throw new ConflictException({
          message: 'Excel 暂存记录封存数量不一致，整批不会发布',
          data: { reason: 'IMPORT_STAGING_SEAL_COUNT_MISMATCH' }
        });
      }
      const persistedRows = await this.persistConfirmationRows(
        tx,
        job.taskId,
        preview.rows,
        recordIntegrityByRow,
        now
      );
      if (persistedRows !== preview.rows.length) {
        throw new ConflictException({
          message: 'Excel 确认行持久化数量不一致，整批不会发布',
          data: { reason: 'IMPORT_STAGING_ROW_COUNT_MISMATCH' }
        });
      }

      const progress = await tx.importTask.updateMany({
        where: {
          id: job.taskId,
          status: ImportTaskStatus.confirming,
          leaseToken: job.leaseToken,
          approvalSnapshotHash: job.approvalSnapshotHash
        },
        data: {
          confirmationProcessedRows: { increment: preview.rows.length },
          confirmationSuccessRows: { increment: recordIntegrityByRow.size },
          importedRows: 0,
          leaseUntil: new Date(Date.now() + this.confirmationLeaseMs)
        }
      });
      if (progress.count !== 1) throw new ImportConfirmationLeaseLostError();
      return true;
    });
  }

  private async prepareBackgroundConfirmationCompletion(
    job: BackgroundConfirmationJob
  ): Promise<PreparedConfirmationIntegrity> {
    const task = await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, job.taskId);
      await this.assertOwnedConfirmation(tx, job.taskId, job.leaseToken);
      const current = await tx.importTask.findUnique({ where: { id: job.taskId }, include: previewTaskInclude });
      if (!current) throw new NotFoundException('Import task not found');
      this.assertImportApprovalSnapshotCurrent(current, job.approvalSnapshotHash);
      const renewed = await tx.importTask.updateMany({
        where: {
          id: job.taskId,
          status: ImportTaskStatus.confirming,
          leaseToken: job.leaseToken,
          approvalSnapshotHash: job.approvalSnapshotHash
        },
        data: { leaseUntil: new Date(Date.now() + this.confirmationLeaseMs) }
      });
      if (renewed.count !== 1) throw new ImportConfirmationLeaseLostError();
      return current;
    }, { maxWait: 10_000, timeout: 30_000 });

    let nextHeartbeatAt = Date.now() + Math.max(100, Math.floor(this.confirmationLeaseMs / 3));
    const heartbeat = async (force = false) => {
      if (!force && Date.now() < nextHeartbeatAt) return;
      await this.renewOwnedConfirmationLease(job);
      nextHeartbeatAt = Date.now() + Math.max(100, Math.floor(this.confirmationLeaseMs / 3));
    };
    const approvalIntegrity = await this.recomputeApprovalIntegrity(
      this.prisma,
      task,
      () => heartbeat(false)
    );
    const stagingIntegrity = await this.recomputeStagingIntegrity(
      this.prisma,
      task,
      () => heartbeat(false)
    );
    await heartbeat(true);
    return { taskVersion: task.version, ...approvalIntegrity, ...stagingIntegrity };
  }

  private async completeBackgroundConfirmation(
    job: BackgroundConfirmationJob,
    integrity: PreparedConfirmationIntegrity
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, job.taskId);
      await this.assertOwnedConfirmation(tx, job.taskId, job.leaseToken);
      const task = await tx.importTask.findUnique({ where: { id: job.taskId }, include: previewTaskInclude });
      if (!task) throw new NotFoundException('资源不存在');
      this.assertImportApprovalSnapshotCurrent(task, job.approvalSnapshotHash);
      if (task.version !== integrity.taskVersion) throw new ImportConfirmationLeaseLostError();
      await acquireProjectWriteLock(tx, task.projectId);
      this.assertImportSourceEligible(task);
      const activeTemplate = await this.recordPolicy.getWritableTemplate(
        tx,
        task.projectId,
        task.templateId,
        task.importType
      );
      if (activeTemplate.version !== task.templateVersion) {
        throw new ConflictException('Excel 批准后模板版本发生变化，整批不会发布');
      }
      const approver = await this.assertCurrentFinanceApprover(tx, task, job.actor);
      const [totalRows, processedRows, successRows, errorRows, duplicateRows, ignoredRows] = await Promise.all([
        tx.importRow.count({ where: { importTaskId: job.taskId } }),
        tx.importRow.count({ where: { importTaskId: job.taskId, confirmationProcessedAt: { not: null } } }),
        tx.businessRecord.count({ where: { importTaskId: job.taskId } }),
        tx.importRow.count({ where: { importTaskId: job.taskId, status: ImportRowStatus.error } }),
        tx.importRow.count({ where: { importTaskId: job.taskId, status: ImportRowStatus.duplicate } }),
        tx.importRow.count({ where: { importTaskId: job.taskId, status: ImportRowStatus.ignored } })
      ]);
      if (processedRows !== totalRows) throw new Error('确认进度与数据库事实不一致');
      if (errorRows !== 0 || successRows === 0) {
        throw new ConflictException({
          message: 'Excel 整批存在阻断错误或没有有效明细，正式记录不会发布',
          data: { reason: 'IMPORT_WHOLE_BATCH_VALIDATION_FAILED', errorRows, successRows }
        });
      }
      const expectedRecordCount = this.approvalRecordCount(task);
      if (
        integrity.rowSetHash !== this.approvalRowSetHash(task)
        || integrity.normalizedOutputHash !== this.approvalOutputHash(task)
        || integrity.recordCount !== expectedRecordCount
        || successRows !== expectedRecordCount
      ) {
        throw new ConflictException({
          message: 'Excel staging 与批准快照不一致，整批不会发布',
          data: { reason: 'IMPORT_APPROVAL_INTEGRITY_MISMATCH' }
        });
      }

      const [publicationFacts] = await tx.$queryRaw<Array<{
        readyRecordCount: bigint;
        actualValueCount: bigint;
        stagedLedgerCount: bigint;
      }>>`
        SELECT
          (
            SELECT COUNT(*)::bigint
            FROM business_records AS record
            JOIN import_rows AS import_row
              ON import_row.generated_record_id = record.id
             AND import_row.import_task_id = record.import_task_id
            WHERE record.import_task_id = ${job.taskId}
              AND record.publication_status = ${BusinessRecordPublicationStatus.unpublished}::"BusinessRecordPublicationStatus"
              AND record.status = ${BusinessRecordStatus.pending_confirm}::"BusinessRecordStatus"
              AND record.version = 1
              AND record.staging_approval_hash = ${job.approvalSnapshotHash}
              AND record.staging_content_hash IS NOT NULL
              AND record.staging_content_hash = import_row.generated_record_hash
              AND record.source_id = import_row.id
              AND import_row.status = ${ImportRowStatus.mapped}::"ImportRowStatus"
              AND import_row.confirmed_at IS NULL
              AND record.confirmed_at IS NULL
              AND record.confirmed_by IS NULL
              AND record.voided_at IS NULL
              AND record.voided_by IS NULL
              AND import_row.confirmation_processed_at IS NOT NULL
              AND import_row.generated_record_value_count IS NOT NULL
              AND (
                SELECT COUNT(*)::integer
                FROM record_values AS value
                WHERE value.record_id = record.id
              ) = import_row.generated_record_value_count
          ) AS "readyRecordCount",
          (
            SELECT COUNT(*)::bigint
            FROM record_values AS value
            JOIN business_records AS record ON record.id = value.record_id
            WHERE record.import_task_id = ${job.taskId}
          ) AS "actualValueCount",
          (
            SELECT COUNT(*)::bigint
            FROM ledger_events AS event
            JOIN business_records AS record ON record.id = event.aggregate_id
            WHERE record.import_task_id = ${job.taskId}
              AND event.aggregate_type = 'business_record'
              AND event.event_type = 'business_record_staged'
          ) AS "stagedLedgerCount"
      `;
      const readyRecordCount = Number(publicationFacts.readyRecordCount);
      const actualValueCount = Number(publicationFacts.actualValueCount);
      const stagedLedgerCount = Number(publicationFacts.stagedLedgerCount);
      if (
        !/^[0-9a-f]{64}$/.test(integrity.stagingManifestHash)
        || readyRecordCount !== expectedRecordCount
        || actualValueCount !== integrity.stagingValueCount
        || stagedLedgerCount !== expectedRecordCount
      ) {
        throw new ConflictException({
          message: 'Excel 暂存记录未通过最终发布栅栏，整批不会发布',
          data: {
            reason: 'IMPORT_STAGING_PUBLICATION_FENCE_FAILED',
            expectedRecordCount,
            readyRecordCount,
            expectedValueCount: integrity.stagingValueCount,
            actualValueCount,
            stagedLedgerCount
          }
        });
      }

      const now = new Date();
      const publishedRecordCount = Number(await tx.$executeRaw`
        UPDATE business_records AS record
        SET status = ${BusinessRecordStatus.confirmed}::"BusinessRecordStatus",
            publication_status = ${BusinessRecordPublicationStatus.published}::"BusinessRecordPublicationStatus",
            confirmed_at = ${now},
            confirmed_by = ${approver.username},
            confirmation_snapshot = COALESCE(confirmation_snapshot, '{}'::jsonb)
              || jsonb_build_object('confirmedAt', ${now.toISOString()}, 'confirmedBy', ${approver.username}),
            updated_at = ${now}
        WHERE record.import_task_id = ${job.taskId}
          AND record.publication_status = ${BusinessRecordPublicationStatus.unpublished}::"BusinessRecordPublicationStatus"
          AND record.status = ${BusinessRecordStatus.pending_confirm}::"BusinessRecordStatus"
          AND record.version = 1
          AND record.source_type = ${RecordSourceType.excel}::"RecordSourceType"
          AND record.staging_approval_hash = ${job.approvalSnapshotHash}
          AND record.staging_content_hash IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM import_rows AS source_row
            WHERE source_row.generated_record_id = record.id
              AND source_row.import_task_id = record.import_task_id
              AND source_row.id = record.source_id
              AND source_row.status = ${ImportRowStatus.mapped}::"ImportRowStatus"
              AND source_row.confirmed_at IS NULL
              AND source_row.confirmation_processed_at IS NOT NULL
              AND source_row.generated_record_hash = record.staging_content_hash
              AND source_row.generated_record_value_count = (
                SELECT COUNT(*)::integer
                FROM record_values AS value
                WHERE value.record_id = record.id
              )
          )
      `);
      if (publishedRecordCount !== expectedRecordCount) {
        throw new ConflictException({
          message: 'Excel 正式记录发布行数不一致，事务已回滚',
          data: {
            reason: 'IMPORT_PUBLICATION_RECORD_ROWCOUNT_MISMATCH',
            expectedRecordCount,
            publishedRecordCount
          }
        });
      }
      const confirmedImportRowCount = Number(await tx.$executeRaw`
        UPDATE import_rows AS source_row
        SET status = ${ImportRowStatus.confirmed}::"ImportRowStatus",
            confirmed_at = ${now}
        FROM business_records AS record
        WHERE source_row.import_task_id = ${job.taskId}
          AND source_row.status = ${ImportRowStatus.mapped}::"ImportRowStatus"
          AND source_row.confirmed_at IS NULL
          AND source_row.confirmation_processed_at IS NOT NULL
          AND source_row.generated_record_id = record.id
          AND source_row.generated_record_hash IS NOT NULL
          AND source_row.generated_record_hash = record.staging_content_hash
          AND source_row.generated_record_value_count = (
            SELECT COUNT(*)::integer
            FROM record_values AS value
            WHERE value.record_id = record.id
          )
          AND record.import_task_id = source_row.import_task_id
          AND record.source_id = source_row.id
          AND record.publication_status = ${BusinessRecordPublicationStatus.published}::"BusinessRecordPublicationStatus"
          AND record.status = ${BusinessRecordStatus.confirmed}::"BusinessRecordStatus"
          AND record.staging_approval_hash = ${job.approvalSnapshotHash}
      `);
      if (confirmedImportRowCount !== expectedRecordCount) {
        throw new ConflictException({
          message: 'Excel 来源行发布行数不一致，事务已回滚',
          data: {
            reason: 'IMPORT_PUBLICATION_SOURCE_ROWCOUNT_MISMATCH',
            expectedRecordCount,
            confirmedImportRows: confirmedImportRowCount
          }
        });
      }
      const committedLedgerCount = Number(await tx.$executeRaw`
        UPDATE ledger_events AS event
        SET event_type = 'business_record_created',
            payload = COALESCE(event.payload, '{}'::jsonb)
              || jsonb_build_object(
                'committedAt', ${now.toISOString()},
                'approvalSnapshotHash', ${task.approvalSnapshotHash}
              )
        FROM business_records AS record
        WHERE event.aggregate_id = record.id
          AND event.event_type = 'business_record_staged'
          AND record.import_task_id = ${job.taskId}
      `);
      if (committedLedgerCount !== expectedRecordCount) {
        throw new ConflictException({
          message: 'Excel ledger 发布行数不一致，事务已回滚',
          data: {
            reason: 'IMPORT_PUBLICATION_LEDGER_ROWCOUNT_MISMATCH',
            expectedRecordCount,
            committedLedgerCount
          }
        });
      }
      const summary = { importedRows: successRows, errorRows, duplicateRows, ignoredRows };
      const published = await tx.importTask.updateMany({
        where: {
          id: job.taskId,
          status: ImportTaskStatus.confirming,
          leaseToken: job.leaseToken,
          approvalSnapshotHash: job.approvalSnapshotHash
        },
        data: {
          status: ImportTaskStatus.confirmed,
          leaseToken: null,
          leaseUntil: null,
          confirmedAt: now,
          confirmedBy: approver.id,
          confirmationTotalRows: totalRows,
          confirmationProcessedRows: processedRows,
          confirmationSuccessRows: successRows,
          confirmationErrorRows: errorRows,
          importedRows: successRows,
          validRows: successRows,
          errorRows,
          duplicateRows,
          ignoredRows,
          errorMessage: null,
          version: { increment: 1 }
        }
      });
      if (published.count !== 1) throw new ImportConfirmationLeaseLostError();
      await this.auditLogs.write(tx, approver, 'import_task.confirm', 'import_task', job.taskId, {
        ...summary,
        approvalSnapshotHash: task.approvalSnapshotHash,
        validationSnapshotHash: task.validationSnapshotHash,
        normalizedOutputHash: integrity.normalizedOutputHash,
        stagingManifestHash: integrity.stagingManifestHash,
        stagingValueCount: integrity.stagingValueCount,
        selfApproval: false
      }, job.context);
      await this.auditLogs.write(
        tx,
        approver,
        'import_task.confirm_completed',
        'import_task',
        job.taskId,
        { attempt: job.attempt, totalRows, ...summary, approvalSnapshotHash: task.approvalSnapshotHash },
        job.context
      );
      await this.ledgerEvents.write(
        tx,
        approver,
        'import_task_confirmed',
        'import_task',
        job.taskId,
        { attempt: job.attempt, totalRows, ...summary, approvalSnapshotHash: task.approvalSnapshotHash },
        `import_task:${job.taskId}:confirmed`
      );
      await this.ledgerEvents.write(
        tx,
        approver,
        'business_records_batch_committed',
        'import_task',
        job.taskId,
        {
          recordCount: successRows,
          approvalSnapshotHash: task.approvalSnapshotHash,
          normalizedOutputHash: integrity.normalizedOutputHash,
          stagingManifestHash: integrity.stagingManifestHash,
          stagingValueCount: integrity.stagingValueCount
        },
        `import_task:${job.taskId}:business_records_batch_committed`
      );
    }, { maxWait: 10_000, timeout: 120_000 });
  }

  private async persistValidationRows(taskId: string, rows: PreviewRow[]) {
    if (rows.length === 0) return;
    const updates = rows.map((row) => Prisma.sql`(
      ${row.id}::text,
      ${JSON.stringify(row.normalizedData)}::jsonb,
      ${row.status}::"ImportRowStatus",
      ${JSON.stringify(row.errors)}::jsonb,
      ${JSON.stringify(row.warnings)}::jsonb
    )`);
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE import_rows AS target
      SET normalized_data_json = source.normalized_data,
          status = source.status,
          errors = source.errors,
          warnings = source.warnings
      FROM (VALUES ${Prisma.join(updates)})
        AS source(id, normalized_data, status, errors, warnings)
      WHERE target.id = source.id
        AND target.import_task_id = ${taskId}
        AND target.confirmation_processed_at IS NULL
    `);
  }

  private normalizedPreviewOutput(row: PreviewRow) {
    return {
      rowId: row.id,
      rowNumber: row.rowNumber,
      rowHash: row.rowHash,
      recordDate: row.recordDate,
      amount: row.amount,
      category: row.category,
      subCategory: row.subCategory,
      values: [...row.values]
        .map((value) => ({ fieldId: value.fieldId, fieldType: value.fieldType, value: value.value }))
        .sort((left, right) => left.fieldId.localeCompare(right.fieldId))
    };
  }

  private stagingRecordContentHash(
    record: StagingRecordHashInput,
    values: StagingRecordValueHashInput[]
  ) {
    return canonicalJsonSha256({
      schemaVersion: EXCEL_STAGING_CONTENT_SCHEMA_VERSION,
      approvalSnapshotHash: record.stagingApprovalHash,
      record: {
        id: record.id,
        projectId: record.projectId,
        templateId: record.templateId,
        templateVersion: record.templateVersion,
        templateSnapshot: record.templateSnapshot ?? null,
        sourceSnapshot: record.sourceSnapshot ?? null,
        confirmationSnapshot: record.confirmationSnapshot ?? null,
        recordType: record.recordType,
        accountingDirection: record.accountingDirection,
        dataLayer: record.dataLayer,
        recordDate: record.recordDate.toISOString(),
        amount: record.amount.toFixed(2),
        currency: record.currency,
        category: record.category ?? null,
        subCategory: record.subCategory ?? null,
        description: record.description ?? null,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        importTaskId: record.importTaskId,
        status: record.status,
        publicationStatus: record.publicationStatus,
        attachments: record.attachments ?? null,
        createdBy: record.createdBy ?? null
      },
      values: values
        .map((value) => ({
          fieldId: value.fieldId,
          fieldName: value.fieldName,
          valueText: value.valueText ?? null,
          valueNumber: value.valueNumber === null || value.valueNumber === undefined
            ? null
            : new Prisma.Decimal(String(value.valueNumber)).toString(),
          valueDate: value.valueDate === null || value.valueDate === undefined
            ? null
            : new Date(value.valueDate).toISOString(),
          valueJson: value.valueJson ?? null
        }))
        .sort((left, right) => left.fieldId.localeCompare(right.fieldId))
    });
  }

  private updateCanonicalDigest(digest: ReturnType<typeof createHash>, value: unknown) {
    const encoded = canonicalJson(value);
    digest.update(`${Buffer.byteLength(encoded, 'utf8')}:`, 'utf8');
    digest.update(encoded, 'utf8');
  }

  private addValidationIssue(
    target: Map<string, ImportValidationIssueAccumulator>,
    code: string,
    message: string,
    row: PreviewRow
  ) {
    let key = `${code}:${message}`;
    let normalizedCode = code;
    let normalizedMessage = message;
    if (!target.has(key) && target.size >= IMPORT_VALIDATION_MAX_ISSUES - 1) {
      key = 'ADDITIONAL_ISSUE_CATEGORIES';
      normalizedCode = 'ADDITIONAL_ISSUE_CATEGORIES';
      normalizedMessage = '其余校验问题类别已聚合，请通过分页错误行查看完整明细';
    }
    let issue = target.get(key);
    if (!issue) {
      issue = {
        code: normalizedCode,
        message: normalizedMessage,
        count: 0,
        sampleRowNumbers: [],
        digest: createHash('sha256')
      };
      target.set(key, issue);
    }
    issue.count += 1;
    if (issue.sampleRowNumbers.length < 20) issue.sampleRowNumbers.push(row.rowNumber);
    this.updateCanonicalDigest(issue.digest, { rowId: row.id, rowNumber: row.rowNumber, rowHash: row.rowHash, message });
  }

  private addValidationIssueWithoutRow(
    target: Map<string, ImportValidationIssueAccumulator>,
    code: string,
    message: string
  ) {
    const issue: ImportValidationIssueAccumulator = {
      code,
      message,
      count: 1,
      sampleRowNumbers: [],
      digest: createHash('sha256')
    };
    this.updateCanonicalDigest(issue.digest, { code, message });
    target.set(`${code}:${message}`, issue);
  }

  private finalizeValidationIssues(
    kind: 'error' | 'warning',
    source: Map<string, ImportValidationIssueAccumulator>
  ) {
    return [...source.values()]
      .map((issue): ImportValidationIssue & { issueId: string } => {
        const value: ImportValidationIssue = {
          code: issue.code,
          message: issue.message,
          count: issue.count,
          rowDigest: issue.digest.digest('hex'),
          sampleRowNumbers: issue.sampleRowNumbers
        };
        return { ...value, issueId: this.importValidationIssueId(kind, value) };
      })
      .sort((left, right) => left.issueId.localeCompare(right.issueId));
  }

  private importValidationIssueId(kind: 'error' | 'warning', issue: ImportValidationIssue) {
    return `${kind}:${canonicalJsonSha256({
      code: issue.code,
      count: issue.count,
      rowDigest: issue.rowDigest,
      sampleRowNumbers: issue.sampleRowNumbers
    })}`;
  }

  private importMappingHash(task: PreviewTask) {
    return canonicalJsonSha256(task.columns.map((column) => ({
      columnId: column.id,
      sourceColumnId: column.sourceColumnId,
      sourceKey: column.sourceKey,
      sourceName: column.sourceName,
      targetFieldId: column.decision?.targetFieldId ?? null,
      mappingType: column.decision?.mappingType ?? null,
      ignored: column.decision?.ignored ?? false
    })));
  }

  private importTemplateContentHash(task: PreviewTask) {
    return canonicalJsonSha256({
      templateId: task.templateId,
      version: task.templateVersion,
      recordType: task.template.recordType,
      accountingDirection: task.template.accountingDirection,
      dataLayer: task.template.dataLayer,
      primaryAmountFieldId: task.template.primaryAmountFieldId,
      primaryDateFieldId: task.template.primaryDateFieldId,
      fields: task.template.templateFields.map((item) => ({
        fieldId: item.fieldId,
        fieldKey: item.field.fieldKey,
        fieldType: item.field.fieldType,
        required: item.isRequired,
        visible: item.isVisible,
        active: item.field.isActive,
        defaultValue: item.defaultValue
      }))
    });
  }

  private assertImportSourceEligible(task: PreviewTask) {
    if (
      task.rawFile.isVoided
      || task.rawFile.scanStatus !== FileScanStatus.clean
      || task.rawFile.status === RawFileStatus.failed
      || task.rawFile.status === RawFileStatus.voided
      || task.rawFile.relatedProjectId !== task.projectId
      || task.rawFile.sha256 !== task.sourceSha256
    ) {
      throw new ConflictException({
        message: 'Excel 来源文件不再满足财务审核条件',
        data: { reason: 'IMPORT_SOURCE_SECURITY_STATE_CHANGED' }
      });
    }
  }

  private async assertCurrentFinanceApprover(
    tx: Prisma.TransactionClient,
    task: Pick<PreviewTask, 'uploadedBy'>,
    actor: CurrentUser
  ): Promise<CurrentUser> {
    const current = await tx.user.findUnique({ where: { id: actor.id } });
    if (
      !current
      || current.status !== UserStatus.active
      || current.tokenVersion !== actor.tokenVersion
      || current.username !== actor.username
    ) {
      throw new UnauthorizedException({
        message: 'Excel 批准前当前身份已变化',
        data: { reason: 'IMPORT_APPROVER_IDENTITY_CHANGED' }
      });
    }
    if (current.role !== UserRole.finance || actor.role !== UserRole.finance) {
      throw new ForbiddenException({
        message: '当前用户已不具备 Excel 财务批准权限',
        data: { reason: 'IMPORT_APPROVER_ROLE_REVOKED' }
      });
    }
    if (task.uploadedBy === current.id) {
      throw new ForbiddenException({
        message: '上传者不能审批同一 Excel 导入任务',
        data: {
          reason: 'IMPORT_SELF_APPROVAL_FORBIDDEN',
          decisionId: 'H10',
          policyVersion: EXCEL_APPROVAL_POLICY_VERSION
        }
      });
    }
    return {
      ...actor,
      username: current.username,
      name: current.name,
      role: current.role,
      department: current.department ?? '',
      phone: current.phone ?? '',
      status: current.status,
      tokenVersion: current.tokenVersion
    };
  }

  private assertImportApprovalValidation(task: PreviewTask, dto: ConfirmImportTaskDto) {
    if (
      task.validationRevision !== task.reviewRevision
      || task.validationSnapshotHash !== dto.expectedValidationSnapshotHash
      || task.validationRuleVersion !== EXCEL_DETERMINISTIC_VALIDATION_RULE_VERSION
      || !task.validatedAt
      || !task.validationSnapshot
      || typeof task.validationSnapshot !== 'object'
      || Array.isArray(task.validationSnapshot)
    ) {
      throw new ConflictException({
        message: '当前 Excel 审核修订没有有效的确定性校验快照',
        data: { reason: 'IMPORT_VALIDATION_SNAPSHOT_STALE' }
      });
    }

    const snapshot = task.validationSnapshot as Record<string, Prisma.JsonValue>;
    const { snapshotHash: embeddedHash, ...snapshotCore } = snapshot;
    const counts = snapshot.counts;
    const currentMappingHash = this.importMappingHash(task);
    const currentTemplateHash = this.importTemplateContentHash(task);
    const snapshotCounts = counts && typeof counts === 'object' && !Array.isArray(counts)
      ? counts as Record<string, Prisma.JsonValue>
      : undefined;
    const total = snapshotCounts?.total;
    const recordCount = snapshotCounts?.recordCount;
    const blockingErrorCount = snapshotCounts?.blockingErrorCount;
    const rowSetHash = snapshot.rowSetHash;
    const normalizedOutputHash = snapshot.normalizedOutputHash;
    const snapshotIsCurrent = (
      typeof embeddedHash === 'string'
      && embeddedHash === task.validationSnapshotHash
      && canonicalJsonSha256(snapshotCore) === task.validationSnapshotHash
      && snapshot.schemaVersion === EXCEL_VALIDATION_SCHEMA_VERSION
      && snapshot.taskId === task.id
      && snapshot.projectId === task.projectId
      && snapshot.sourceSha256 === task.sourceSha256
      && snapshot.irSchemaVersion === task.irSchemaVersion
      && snapshot.parserVersion === task.parserVersion
      && snapshot.irHash === task.irHash
      && snapshot.templateId === task.templateId
      && snapshot.templateVersion === task.templateVersion
      && snapshot.templateContentHash === currentTemplateHash
      && snapshot.reviewRevision === task.reviewRevision
      && snapshot.mappingPayloadHash === currentMappingHash
      && snapshot.validationRuleVersion === EXCEL_DETERMINISTIC_VALIDATION_RULE_VERSION
      && typeof rowSetHash === 'string'
      && /^[0-9a-f]{64}$/.test(rowSetHash)
      && typeof normalizedOutputHash === 'string'
      && normalizedOutputHash === dto.expectedPayloadHash
      && /^[0-9a-f]{64}$/.test(normalizedOutputHash)
      && Number.isInteger(total)
      && Number.isInteger(recordCount)
      && Number.isInteger(blockingErrorCount)
      && Number(total) > 0
      && Number(recordCount) >= 0
      && typeof snapshot.valid === 'boolean'
      && Array.isArray(snapshot.blockingErrors)
      && Array.isArray(snapshot.warnings)
    );
    if (!snapshotIsCurrent) {
      throw new ConflictException({
        message: 'Excel 来源、模板、映射、行审核或规范输出在重新校验后发生变化',
        data: { reason: 'IMPORT_APPROVAL_PAYLOAD_STALE' }
      });
    }
    if (
      blockingErrorCount !== 0
      || snapshot.valid !== true
      || (snapshot.blockingErrors as Prisma.JsonArray).length !== 0
      || Number(recordCount) === 0
    ) {
      throw new ConflictException({
        message: 'Excel 整批存在阻断错误或没有可入账明细，修正并重新校验后才能批准',
        data: {
          reason: 'IMPORT_VALIDATION_BLOCKING_ERRORS',
          blockingErrorCount: Number(blockingErrorCount),
          recordCount: Number(recordCount)
        }
      });
    }

    const warningIds = (snapshot.warnings as Prisma.JsonArray).map((warning) => {
      if (!warning || typeof warning !== 'object' || Array.isArray(warning)) return null;
      const value = warning as Prisma.JsonObject;
      const issueId = value.issueId;
      const code = value.code;
      const message = value.message;
      const count = value.count;
      const rowDigest = value.rowDigest;
      const sampleRowNumbers = value.sampleRowNumbers;
      if (
        typeof issueId !== 'string'
        || typeof code !== 'string'
        || typeof message !== 'string'
        || !Number.isInteger(count)
        || typeof rowDigest !== 'string'
        || !Array.isArray(sampleRowNumbers)
        || !sampleRowNumbers.every((item) => Number.isInteger(item))
      ) return null;
      const issue: ImportValidationIssue = {
        code,
        message,
        count: Number(count),
        rowDigest,
        sampleRowNumbers: sampleRowNumbers.map(Number)
      };
      return issueId === this.importValidationIssueId('warning', issue) ? issueId : null;
    });
    if (warningIds.some((issueId) => issueId === null)) {
      throw new ConflictException({
        message: 'Excel 校验警告缺少稳定确认 ID',
        data: { reason: 'IMPORT_WARNING_ID_INVALID' }
      });
    }
    const requiredWarningIds = [...warningIds as string[]].sort();
    const acknowledgedWarningIds = [...dto.acknowledgedWarningIds].sort();
    if (
      requiredWarningIds.length !== acknowledgedWarningIds.length
      || requiredWarningIds.some((issueId, index) => issueId !== acknowledgedWarningIds[index])
    ) {
      throw new ConflictException({
        message: '必须逐项确认当前 Excel 校验快照的全部警告',
        data: { reason: 'IMPORT_WARNING_ACKNOWLEDGEMENT_MISMATCH', requiredWarningIds }
      });
    }

    return {
      mappingPayloadHash: currentMappingHash,
      templateContentHash: currentTemplateHash,
      rowSetHash: rowSetHash as string,
      normalizedOutputHash: normalizedOutputHash as string,
      acknowledgedWarningIds,
      counts: { total: Number(total), recordCount: Number(recordCount) }
    };
  }

  private assertImportApprovalSnapshotCurrent(task: PreviewTask, expectedSnapshotHash: string) {
    if (
      task.approvalSnapshotHash !== expectedSnapshotHash
      || task.approvalReviewRevision !== task.reviewRevision
      || task.approvalValidationHash !== task.validationSnapshotHash
      || task.approvalPolicyVersion !== EXCEL_APPROVAL_POLICY_VERSION
      || !task.approvalSnapshot
      || typeof task.approvalSnapshot !== 'object'
      || Array.isArray(task.approvalSnapshot)
    ) {
      throw new ConflictException({
        message: 'Excel Worker 缺少当前不可变批准快照',
        data: { reason: 'IMPORT_APPROVAL_SNAPSHOT_STALE' }
      });
    }
    const snapshot = task.approvalSnapshot as Record<string, Prisma.JsonValue>;
    const { snapshotHash: embeddedHash, ...core } = snapshot;
    if (
      embeddedHash !== expectedSnapshotHash
      || canonicalJsonSha256(core) !== expectedSnapshotHash
      || snapshot.schemaVersion !== EXCEL_APPROVAL_SNAPSHOT_SCHEMA_VERSION
      || snapshot.taskId !== task.id
      || snapshot.projectId !== task.projectId
      || this.approvalOutputHash(task) !== this.validationOutputHash(task)
      || this.approvalRowSetHash(task) !== this.validationRowSetHash(task)
    ) {
      throw new ConflictException({
        message: 'Excel 批准快照内容或关联校验快照已变化',
        data: { reason: 'IMPORT_APPROVAL_SNAPSHOT_TAMPERED' }
      });
    }
  }

  private approvalOutputHash(task: PreviewTask) {
    const output = this.approvalSection(task, 'output');
    const value = output.normalizedOutputHash;
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
      throw new ConflictException('Excel 批准快照缺少规范输出哈希');
    }
    return value;
  }

  private approvalRowSetHash(task: PreviewTask) {
    const review = this.approvalSection(task, 'review');
    const value = review.rowSetHash;
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
      throw new ConflictException('Excel 批准快照缺少行集合哈希');
    }
    return value;
  }

  private approvalRecordCount(task: PreviewTask) {
    const output = this.approvalSection(task, 'output');
    const value = output.recordCount;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new ConflictException('Excel 批准快照缺少有效记录数');
    }
    return value;
  }

  private approvalSection(task: PreviewTask, key: 'review' | 'output') {
    if (!task.approvalSnapshot || typeof task.approvalSnapshot !== 'object' || Array.isArray(task.approvalSnapshot)) {
      throw new ConflictException('Excel 批准快照不存在');
    }
    const section = (task.approvalSnapshot as Prisma.JsonObject)[key];
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      throw new ConflictException(`Excel 批准快照缺少 ${key} 区段`);
    }
    return section as Prisma.JsonObject;
  }

  private validationOutputHash(task: PreviewTask) {
    const snapshot = this.validationSnapshotObject(task);
    const value = snapshot.normalizedOutputHash;
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
      throw new ConflictException('Excel 校验快照缺少规范输出哈希');
    }
    return value;
  }

  private validationRowSetHash(task: PreviewTask) {
    const snapshot = this.validationSnapshotObject(task);
    const value = snapshot.rowSetHash;
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
      throw new ConflictException('Excel 校验快照缺少行集合哈希');
    }
    return value;
  }

  private validationSnapshotObject(task: PreviewTask) {
    if (!task.validationSnapshot || typeof task.validationSnapshot !== 'object' || Array.isArray(task.validationSnapshot)) {
      throw new ConflictException('Excel 校验快照不存在');
    }
    return task.validationSnapshot as Prisma.JsonObject;
  }

  private async recomputeApprovalIntegrity(
    prisma: PrismaWriter,
    task: PreviewTask,
    heartbeat?: () => Promise<void>
  ) {
    const rowSetDigest = createHash('sha256');
    const outputDigest = createHash('sha256');
    let recordCount = 0;
    let lastRowNumber: number | undefined;
    let lastId: string | undefined;
    while (true) {
      await heartbeat?.();
      const rows = await prisma.importRow.findMany({
        where: {
          importTaskId: task.id,
          ...(lastRowNumber === undefined || lastId === undefined
            ? {}
            : {
                OR: [
                  { rowNumber: { gt: lastRowNumber } },
                  { rowNumber: lastRowNumber, id: { gt: lastId } }
                ]
              })
        },
        orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
        take: IMPORT_PREVIEW_SUMMARY_BATCH_SIZE
      });
      if (rows.length === 0) break;
      const preview = this.buildPreviewRows(task, rows);
      for (const row of preview.rows) {
        if (row.status === ImportRowStatus.error || row.errors.length > 0) {
          throw new ConflictException({
            message: `最终发布前第 ${row.rowNumber} 行校验失败`,
            data: { reason: 'IMPORT_FINAL_ROW_VALIDATION_FAILED', rowNumber: row.rowNumber }
          });
        }
        this.updateCanonicalDigest(rowSetDigest, {
          rowId: row.id,
          rowNumber: row.rowNumber,
          rowHash: row.rowHash,
          status: row.status === ImportRowStatus.confirmed ? ImportRowStatus.mapped : row.status,
          reviewDecision: row.review.decision ?? null,
          summaryCandidate: row.summaryCandidate
        });
        if (row.status === ImportRowStatus.mapped || row.status === ImportRowStatus.confirmed) {
          recordCount += 1;
          this.updateCanonicalDigest(outputDigest, this.normalizedPreviewOutput({ ...row, status: ImportRowStatus.mapped }));
        }
      }
      const last = rows[rows.length - 1];
      lastRowNumber = last.rowNumber;
      lastId = last.id;
    }
    return {
      rowSetHash: rowSetDigest.digest('hex'),
      normalizedOutputHash: outputDigest.digest('hex'),
      recordCount
    };
  }

  private async recomputeStagingIntegrity(
    prisma: PrismaWriter,
    task: PreviewTask,
    heartbeat?: () => Promise<void>
  ) {
    const manifestDigest = createHash('sha256');
    const expectedRecordCount = this.approvalRecordCount(task);
    let recordCount = 0;
    let valueCount = 0;
    let lastId: string | undefined;
    while (true) {
      await heartbeat?.();
      const records = await prisma.businessRecord.findMany({
        where: {
          importTaskId: task.id,
          id: lastId ? { gt: lastId } : undefined
        },
        include: stagedRecordIntegrityInclude,
        orderBy: { id: 'asc' },
        take: IMPORT_PREVIEW_SUMMARY_BATCH_SIZE
      });
      if (records.length === 0) break;
      for (const record of records) {
        const sourceRow = record.sourceImportRow;
        const structurallyValid =
          record.publicationStatus === BusinessRecordPublicationStatus.unpublished
          && record.status === BusinessRecordStatus.pending_confirm
          && record.version === 1
          && record.sourceType === RecordSourceType.excel
          && record.stagingApprovalHash === task.approvalSnapshotHash
          && typeof record.stagingContentHash === 'string'
          && /^[0-9a-f]{64}$/.test(record.stagingContentHash)
          && record.confirmedAt === null
          && record.confirmedBy === null
          && record.voidedAt === null
          && record.voidedBy === null
          && sourceRow !== null
          && sourceRow.importTaskId === task.id
          && sourceRow.id === record.sourceId
          && sourceRow.confirmationProcessedAt !== null
          && sourceRow.generatedRecordHash === record.stagingContentHash
          && sourceRow.generatedRecordValueCount === record.values.length;
        if (!structurallyValid) {
          throw new ConflictException({
            message: 'Excel 暂存记录状态、版本或批准快照不一致，整批不会发布',
            data: { reason: 'IMPORT_STAGING_INTEGRITY_MISMATCH', recordId: record.id }
          });
        }
        const contentHash = this.stagingRecordContentHash(
          record as StagingRecordHashInput,
          record.values
        );
        if (contentHash !== record.stagingContentHash) {
          throw new ConflictException({
            message: 'Excel 暂存记录内容哈希不一致，整批不会发布',
            data: { reason: 'IMPORT_STAGING_CONTENT_HASH_MISMATCH', recordId: record.id }
          });
        }
        recordCount += 1;
        valueCount += record.values.length;
        this.updateCanonicalDigest(manifestDigest, {
          recordId: record.id,
          contentHash,
          valueCount: record.values.length
        });
      }
      lastId = records[records.length - 1].id;
    }
    if (recordCount !== expectedRecordCount) {
      throw new ConflictException({
        message: 'Excel 暂存记录数量与批准快照不一致，整批不会发布',
        data: {
          reason: 'IMPORT_STAGING_RECORD_COUNT_MISMATCH',
          expectedRecordCount,
          actualRecordCount: recordCount
        }
      });
    }
    return {
      stagingManifestHash: manifestDigest.digest('hex'),
      stagingValueCount: valueCount
    };
  }

  private async resetFailedConfirmationStaging(tx: Prisma.TransactionClient, taskId: string) {
    const recordIds = (await tx.businessRecord.findMany({
      where: {
        importTaskId: taskId,
        publicationStatus: BusinessRecordPublicationStatus.unpublished
      },
      select: { id: true }
    })).map((record) => record.id);
    if (recordIds.length > 0) {
      await tx.ledgerEvent.deleteMany({ where: { aggregateId: { in: recordIds }, eventType: 'business_record_staged' } });
      await tx.businessRecord.deleteMany({
        where: {
          id: { in: recordIds },
          importTaskId: taskId,
          publicationStatus: BusinessRecordPublicationStatus.unpublished
        }
      });
    }
    await tx.importRow.updateMany({
      where: { importTaskId: taskId },
      data: {
        confirmationProcessedAt: null,
        generatedRecordId: null,
        generatedRecordHash: null,
        generatedRecordValueCount: null,
        confirmedAt: null
      }
    });
  }

  private async persistStagingRecordIntegrity(
    tx: Prisma.TransactionClient,
    taskId: string,
    approvalSnapshotHash: string,
    integrityByRow: Map<string, StagingRecordIntegrity>
  ) {
    if (integrityByRow.size === 0) return 0;
    const updates = [...integrityByRow.values()].map((integrity) => Prisma.sql`(
      ${integrity.recordId}::text,
      ${integrity.contentHash}::text
    )`);
    return Number(await tx.$executeRaw(Prisma.sql`
      UPDATE business_records AS target
      SET staging_content_hash = source.content_hash,
          updated_at = NOW()
      FROM (VALUES ${Prisma.join(updates)}) AS source(id, content_hash)
      WHERE target.id = source.id
        AND target.import_task_id = ${taskId}
        AND target.publication_status = ${BusinessRecordPublicationStatus.unpublished}::"BusinessRecordPublicationStatus"
        AND target.status = ${BusinessRecordStatus.pending_confirm}::"BusinessRecordStatus"
        AND target.version = 1
        AND target.staging_approval_hash = ${approvalSnapshotHash}
        AND (target.staging_content_hash IS NULL OR target.staging_content_hash = source.content_hash)
    `));
  }

  private async persistConfirmationRows(
    tx: Prisma.TransactionClient,
    taskId: string,
    rows: PreviewRow[],
    integrityByRow: Map<string, StagingRecordIntegrity>,
    processedAt: Date
  ) {
    if (rows.length === 0) return 0;
    const updates = rows.map((row) => {
      const integrity = integrityByRow.get(row.id);
      return Prisma.sql`(
        ${row.id}::text,
        ${JSON.stringify(row.normalizedData)}::jsonb,
        ${row.status}::"ImportRowStatus",
        ${JSON.stringify(row.errors)}::jsonb,
        ${JSON.stringify(row.warnings)}::jsonb,
        ${integrity?.recordId ?? row.generatedRecordId ?? null}::text,
        ${integrity?.contentHash ?? null}::text,
        ${integrity?.valueCount ?? null}::integer
      )`;
    });
    return Number(await tx.$executeRaw(Prisma.sql`
      UPDATE import_rows AS target
      SET normalized_data_json = source.normalized_data,
          status = source.status,
          errors = source.errors,
          warnings = source.warnings,
          generated_record_id = source.generated_record_id,
          generated_record_hash = source.generated_record_hash,
          generated_record_value_count = source.generated_record_value_count,
          confirmation_processed_at = ${processedAt}
      FROM (VALUES ${Prisma.join(updates)})
        AS source(
          id,
          normalized_data,
          status,
          errors,
          warnings,
          generated_record_id,
          generated_record_hash,
          generated_record_value_count
        )
      WHERE target.id = source.id
        AND target.import_task_id = ${taskId}
        AND target.confirmation_processed_at IS NULL
    `));
  }

  private async failOwnedConfirmation(job: BackgroundConfirmationJob, error: unknown) {
    const message = this.safeConfirmationErrorMessage(error).slice(0, 1000);
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, job.taskId);
      const current = await tx.importTask.findUnique({
        where: { id: job.taskId },
        select: { status: true, leaseToken: true }
      });
      if (
        !current ||
        current.status !== ImportTaskStatus.confirming ||
        current.leaseToken !== job.leaseToken
      ) {
        return;
      }
      await tx.importTask.update({
        where: { id: job.taskId },
        data: {
          status: ImportTaskStatus.confirmation_failed,
          leaseToken: null,
          leaseUntil: null,
          importedRows: 0,
          errorMessage: message,
          version: { increment: 1 }
        }
      });
      await this.auditLogs.write(tx, job.actor, 'import_task.confirm_failed', 'import_task', job.taskId, {
        attempt: job.attempt,
        error: message
      }, job.context);
      await this.ledgerEvents.write(
        tx,
        job.actor,
        'import_task_confirmation_failed',
        'import_task',
        job.taskId,
        { attempt: job.attempt, error: message },
        `import_task:${job.taskId}:confirm_attempt:${job.attempt}:failed`
      );
    }).catch((failure) => this.logger.warn(
      `Failed to persist confirmation failure ${job.taskId}: ${this.errorMessage(failure)}`
    ));
  }

  private async releaseConfirmationForRecovery(id: string, leaseToken: string, reason?: string) {
    await this.prisma.importTask.updateMany({
      where: { id, status: ImportTaskStatus.confirming, leaseToken },
      data: {
        leaseUntil: new Date(Date.now() - 1),
        errorMessage: reason ? `后台确认中断，等待租约恢复：${reason}`.slice(0, 1000) : null
      }
    }).catch(() => undefined);
  }

  private async renewOwnedConfirmationLease(job: BackgroundConfirmationJob) {
    const renewed = await this.prisma.importTask.updateMany({
      where: {
        id: job.taskId,
        status: ImportTaskStatus.confirming,
        leaseToken: job.leaseToken,
        approvalSnapshotHash: job.approvalSnapshotHash
      },
      data: { leaseUntil: new Date(Date.now() + this.confirmationLeaseMs) }
    });
    if (renewed.count !== 1) throw new ImportConfirmationLeaseLostError();
  }

  private async handoffConfirmationToWorker(id: string, leaseToken: string) {
    const updated = await this.prisma.importTask.updateMany({
      where: { id, status: ImportTaskStatus.confirming, leaseToken },
      data: {
        leaseToken: `${WORKER_HANDOFF_LEASE_PREFIX}${leaseToken}`,
        leaseUntil: new Date(Date.now() - 1),
        errorMessage: null
      }
    });
    if (updated.count !== 1) throw new ConflictException('Excel 确认任务交接 Worker 失败');
  }

  private async assertOwnedConfirmation(tx: Prisma.TransactionClient, id: string, leaseToken: string) {
    const task = await tx.importTask.findUnique({
      where: { id },
      select: { status: true, leaseToken: true }
    });
    if (!task || task.status !== ImportTaskStatus.confirming || task.leaseToken !== leaseToken) {
      throw new ImportConfirmationLeaseLostError();
    }
  }

  private confirmationResponse(task: ImportTaskDetail, alreadyConfirmed: boolean) {
    return {
      task: toImportTask(task),
      recordIds: [] as string[],
      recordsPath: `/api/records?importTaskId=${task.id}`,
      importedRows: task.importedRows,
      errorRows: task.errorRows,
      duplicateRows: task.duplicateRows,
      ignoredRows: task.ignoredRows,
      alreadyConfirmed
    };
  }

  async cancel(id: string, actor: CurrentUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.importTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('资源不存在');
      if (task.status === ImportTaskStatus.confirmed) throw new ConflictException('已确认任务不能取消');
      const confirmationStartedStatuses: ImportTaskStatus[] = [
        ImportTaskStatus.confirming,
        ImportTaskStatus.confirmation_failed
      ];
      if (confirmationStartedStatuses.includes(task.status)) {
        throw new ConflictException('确认开始后不能取消；失败任务只能从已保存进度重试');
      }
      if (task.status === ImportTaskStatus.cancelled) return;
      if (task.status === ImportTaskStatus.parsing) {
        await tx.importSheet.deleteMany({ where: { importTaskId: id } });
      }
      await tx.importTask.update({
        where: { id },
        data: {
          status: ImportTaskStatus.cancelled,
          errorMessage: '用户取消',
          processedRows: task.status === ImportTaskStatus.parsing ? 0 : task.processedRows,
          validRows: task.status === ImportTaskStatus.parsing ? 0 : task.validRows,
          errorRows: task.status === ImportTaskStatus.parsing ? 0 : task.errorRows,
          duplicateRows: task.status === ImportTaskStatus.parsing ? 0 : task.duplicateRows,
          ignoredRows: task.status === ImportTaskStatus.parsing ? 0 : task.ignoredRows,
          leaseToken: null,
          leaseUntil: null,
          version: { increment: 1 }
        }
      });
      await this.auditLogs.write(tx, actor, 'import_task.cancel', 'import_task', id, {}, context);
      await this.ledgerEvents.write(tx, actor, 'import_task_cancelled', 'import_task', id, {});
    });
    return toImportTask(await this.findDetailOrThrow(id));
  }

  async findSuggestions(query: QueryFieldSuggestionsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.FieldSuggestionWhereInput = {
      status: query.status,
      projectId: query.projectId,
      importTaskId: query.importTaskId
    };
    const include = { mappedField: true } as const;
    const [items, total] = await Promise.all([
      this.prisma.fieldSuggestion.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.fieldSuggestion.count({ where })
    ]);
    return { items: items.map(toFieldSuggestion), page, pageSize, total };
  }

  async approveSuggestion(id: string, dto: ApproveFieldSuggestionDto, actor: CurrentUser, context: RequestContext) {
    const result = await this.prisma.$transaction(async (tx) => {
      const suggestion = await this.findSuggestionOrThrow(tx, id);
      if (suggestion.status !== FieldSuggestionStatus.pending) {
        if (suggestion.mappedFieldId) {
          return { fieldId: suggestion.mappedFieldId, templateId: suggestion.templateId };
        }
        throw new ConflictException('字段建议已经处理');
      }
      await this.lockMutableTask(tx, suggestion.importTaskId);
      const fieldName = dto.fieldName ?? suggestion.suggestedFieldName;
      const fieldType = dto.fieldType ?? suggestion.suggestedFieldType;
      const fieldKey = await this.uniqueFieldKey(tx, suggestion.sourceName);
      const field = await tx.fieldDefinition.create({
        data: {
          fieldKey,
          fieldName,
          fieldType,
          semanticType: this.semanticTypeFor(fieldType),
          aliases: [suggestion.sourceName],
          description: `由 Excel 导入任务 ${suggestion.importTaskId} 人工批准创建`
        }
      });
      const templateId = await this.ensureTemplateField(tx, suggestion, field.id, actor, context);
      await this.resolveSuggestion(tx, suggestion, field, FieldSuggestionStatus.approved, actor);
      await this.auditLogs.write(
        tx,
        actor,
        'field_suggestion.approve',
        'field_suggestion',
        id,
        { fieldId: field.id, templateId },
        context
      );
      await this.auditLogs.write(tx, actor, 'field.create_from_suggestion', 'field_definition', field.id, { suggestionId: id }, context);
      await this.ledgerEvents.write(tx, actor, 'field_suggestion_approved', 'field_suggestion', id, { fieldId: field.id, templateId });
      await this.ledgerEvents.write(tx, actor, 'field_created', 'field_definition', field.id, { suggestionId: id });
      return { fieldId: field.id, templateId };
    });
    return { ...result, suggestion: toFieldSuggestion(await this.findSuggestionOrThrow(this.prisma, id)) };
  }

  async mapSuggestion(id: string, dto: MapFieldSuggestionDto, actor: CurrentUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const suggestion = await this.findSuggestionOrThrow(tx, id);
      if (suggestion.status !== FieldSuggestionStatus.pending) {
        if (suggestion.mappedFieldId === dto.fieldId) return;
        throw new ConflictException('字段建议已经处理');
      }
      await this.lockMutableTask(tx, suggestion.importTaskId);
      const field = await tx.fieldDefinition.findUnique({ where: { id: dto.fieldId } });
      if (!field || !field.isActive) throw new BadRequestException('目标字段不存在或已停用');
      const templateId = await this.ensureTemplateField(tx, suggestion, field.id, actor, context);
      await this.resolveSuggestion(tx, suggestion, field, FieldSuggestionStatus.mapped_to_existing, actor);
      await this.auditLogs.write(
        tx,
        actor,
        'field_suggestion.map',
        'field_suggestion',
        id,
        { fieldId: field.id, templateId },
        context
      );
      await this.ledgerEvents.write(tx, actor, 'field_suggestion_mapped', 'field_suggestion', id, { fieldId: field.id, templateId });
    });
    return toFieldSuggestion(await this.findSuggestionOrThrow(this.prisma, id));
  }

  async rejectSuggestion(id: string, actor: CurrentUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const suggestion = await this.findSuggestionOrThrow(tx, id);
      if (suggestion.status === FieldSuggestionStatus.rejected) return;
      if (suggestion.status !== FieldSuggestionStatus.pending) throw new ConflictException('字段建议已经处理');
      await this.lockMutableTask(tx, suggestion.importTaskId);
      await tx.fieldSuggestion.update({
        where: { id },
        data: { status: FieldSuggestionStatus.rejected, approvedBy: actor.id, approvedAt: new Date() }
      });
      await tx.mappingDecision.upsert({
        where: { importColumnId: suggestion.importColumnId },
        create: {
          importTaskId: suggestion.importTaskId,
          importColumnId: suggestion.importColumnId,
          mappingType: MappingDecisionType.ignored,
          ignored: true,
          confidence: new Prisma.Decimal(1),
          confirmedBy: actor.id
        },
        update: {
          targetFieldId: null,
          mappingType: MappingDecisionType.ignored,
          ignored: true,
          confidence: new Prisma.Decimal(1),
          confirmedBy: actor.id
        }
      });
      await this.refreshTaskMappingStatus(tx, suggestion.importTaskId);
      await this.saveReviewedProfileForTask(tx, suggestion.importTaskId, actor);
      await this.auditLogs.write(tx, actor, 'field_suggestion.reject', 'field_suggestion', id, {}, context);
      await this.ledgerEvents.write(tx, actor, 'field_suggestion_rejected', 'field_suggestion', id, {});
    });
    return toFieldSuggestion(await this.findSuggestionOrThrow(this.prisma, id));
  }

  private async applyAutomaticMappings(
    tx: Prisma.TransactionClient,
    task: { id: string; templateId: string; projectId: string; templateVersion: number },
    columns: Array<{
      id: string;
      sourceColumnId?: string | null;
      columnIndex?: number;
      sourceName: string;
      normalizedName: string;
      inferredType: string;
      sampleValues: Prisma.JsonValue;
      duplicateName: boolean;
    }>,
    actor: CurrentUser
  ) {
    const templateFields = await tx.templateField.findMany({
      where: { templateId: task.templateId, isVisible: true, field: { isActive: true } },
      include: { field: true },
      orderBy: { displayOrder: 'asc' }
    });
    const fields = templateFields.map((item) => item.field);
    const validFieldIds = new Set(fields.map((field) => field.id));
    const structure = await this.getTaskStructureFingerprint(tx, task.id);
    const scopeKey = buildMappingProfileScopeKey({
      projectId: task.projectId,
      templateId: task.templateId,
      templateVersion: task.templateVersion,
      structureFingerprint: structure.fingerprint,
      transformRegistryVersion: structure.transformRegistryVersion
    });
    let profile = await tx.mappingProfile.findUnique({
      where: { scopeKey },
      include: { rules: true }
    });
    const profileTargetFieldIds = profile?.rules.flatMap((rule) => rule.targetFieldId ? [rule.targetFieldId] : []) ?? [];
    const expectedProfileSnapshotHash = profile
      ? buildMappingProfileSnapshotHash({
          scopeKey,
          profileVersion: profile.profileVersion,
          rules: profile.rules
        })
      : null;
    if (
      profile &&
      (
        profile.status !== MappingProfileStatus.active ||
        !profile.isActive ||
        profile.projectId !== task.projectId ||
        profile.templateId !== task.templateId ||
        profile.templateVersion !== task.templateVersion ||
        profile.sourceStructureFingerprint !== structure.fingerprint ||
        profile.fingerprintVersion !== structure.fingerprintVersion ||
        profile.transformRegistryVersion !== structure.transformRegistryVersion ||
        profile.policyVersion !== MAPPING_PROFILE_POLICY_VERSION ||
        profile.approvalSnapshotHash !== expectedProfileSnapshotHash ||
        profile.rules.length !== columns.length ||
        new Set(profileTargetFieldIds).size !== profileTargetFieldIds.length ||
        profile.rules.some((rule) =>
          !isRegisteredImportTransformKey(rule.transformKey)
          || (!rule.ignored && (!rule.targetFieldId || !validFieldIds.has(rule.targetFieldId)))
          || (rule.ignored && rule.targetFieldId !== null)
        ) ||
        columns.some((column) => !profile!.rules.some((rule) => this.profileRuleMatchesColumn(rule, column)))
      )
    ) {
      if (profile.status === MappingProfileStatus.active || profile.isActive) {
        await tx.mappingProfile.update({
          where: { id: profile.id },
          data: { status: MappingProfileStatus.stale, isActive: false }
        });
      }
      profile = null;
    }
    const profileRules = new Map(
      (profile?.rules ?? []).map((rule) => [rule.sourceColumnId, rule])
    );
    await tx.importTask.update({
      where: { id: task.id },
      data: {
        structureFingerprint: structure.fingerprint,
        fingerprintVersion: structure.fingerprintVersion,
        transformRegistryVersion: structure.transformRegistryVersion,
        mappingProfileId: profile?.id ?? null,
        mappingProfileVersion: profile?.profileVersion ?? null,
        mappingProfileSnapshotHash: profile?.approvalSnapshotHash ?? null
      }
    });
    const existing = await tx.mappingDecision.findMany({ where: { importTaskId: task.id } });
    const existingByColumn = new Map(existing.map((decision) => [decision.importColumnId, decision]));
    const usedFieldIds = new Set(existing.flatMap((decision) => decision.targetFieldId ? [decision.targetFieldId] : []));

    for (const column of columns) {
      if (existingByColumn.has(column.id)) continue;
      let match: { field?: FieldDefinition; type: MappingDecisionType; confidence: number; ignored?: boolean } | undefined;
      const profileRule = profileRules.get(this.sourceColumnId(column));
      if (profileRule && (profileRule.ignored || (profileRule.targetFieldId && validFieldIds.has(profileRule.targetFieldId)))) {
        match = {
          field: fields.find((field) => field.id === profileRule.targetFieldId),
          type: MappingDecisionType.profile,
          confidence: 1,
          ignored: profileRule.ignored
        };
      } else if (!column.duplicateName) {
        match = this.matchField(column, fields);
      }

      if (match && (!match.field || !usedFieldIds.has(match.field.id))) {
        await tx.mappingDecision.create({
          data: {
            importTaskId: task.id,
            importColumnId: column.id,
            targetFieldId: match.field?.id,
            mappingType: match.ignored ? MappingDecisionType.ignored : match.type,
            confidence: new Prisma.Decimal(match.confidence),
            ignored: match.ignored === true,
            confirmedBy: undefined
          }
        });
        if (match.field) usedFieldIds.add(match.field.id);
        await tx.fieldSuggestion.updateMany({
          where: { importColumnId: column.id, status: FieldSuggestionStatus.pending },
          data: match.ignored
            ? { status: FieldSuggestionStatus.rejected }
            : { status: FieldSuggestionStatus.mapped_to_existing, mappedFieldId: match.field?.id }
        });
      } else {
        await this.upsertSuggestion(tx, task, column);
      }
    }
    if (profile) {
      await tx.mappingProfile.update({
        where: { id: profile.id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() }
      });
    }
  }

  private matchField(
    column: { sourceName: string; normalizedName: string },
    fields: FieldDefinition[]
  ): { field: FieldDefinition; type: MappingDecisionType; confidence: number } | undefined {
    const source = column.sourceName.normalize('NFKC').trim();
    const sourceLower = source.toLowerCase();
    const fieldKey = fields.find((field) => field.fieldKey.toLowerCase() === sourceLower);
    if (fieldKey) return { field: fieldKey, type: MappingDecisionType.field_key, confidence: 1 };
    const exactName = fields.find((field) => field.fieldName.normalize('NFKC').trim() === source);
    if (exactName) return { field: exactName, type: MappingDecisionType.exact_name, confidence: 0.99 };
    const alias = fields.find((field) => this.aliases(field).some((item) => item.normalize('NFKC').trim() === source));
    if (alias) return { field: alias, type: MappingDecisionType.alias, confidence: 0.96 };
    const normalized = fields.find((field) => this.fieldNames(field).some((name) => this.excelParser.normalizeHeader(name) === column.normalizedName));
    if (normalized) return { field: normalized, type: MappingDecisionType.normalized, confidence: 0.93 };

    if (column.normalizedName.length < 3) return undefined;
    const ranked = fields
      .map((field) => ({
        field,
        score: Math.max(...this.fieldNames(field).map((name) => this.similarity(column.normalizedName, this.excelParser.normalizeHeader(name))))
      }))
      .sort((left, right) => right.score - left.score);
    if (ranked[0] && ranked[0].score >= 0.82 && ranked[0].score - (ranked[1]?.score ?? 0) >= 0.08) {
      return { field: ranked[0].field, type: MappingDecisionType.fuzzy, confidence: Number(ranked[0].score.toFixed(4)) };
    }
    return undefined;
  }

  private async upsertSuggestion(
    tx: Prisma.TransactionClient,
    task: { id: string; projectId: string; templateId: string },
    column: { id: string; sourceName: string; inferredType: string; sampleValues: Prisma.JsonValue }
  ) {
    await tx.fieldSuggestion.upsert({
      where: { importColumnId: column.id },
      create: {
        projectId: task.projectId,
        templateId: task.templateId,
        importTaskId: task.id,
        importColumnId: column.id,
        sourceName: column.sourceName,
        suggestedFieldName: column.sourceName,
        suggestedFieldType: this.suggestFieldType(column.sourceName, column.inferredType),
        sampleValues: column.sampleValues === null ? [] : column.sampleValues as Prisma.InputJsonValue,
        reason: '表头未匹配当前模板字段，必须人工映射、创建字段或明确忽略'
      },
      update: {
        suggestedFieldType: this.suggestFieldType(column.sourceName, column.inferredType),
        sampleValues: column.sampleValues === null ? [] : column.sampleValues as Prisma.InputJsonValue,
        reason: '表头未匹配当前模板字段，必须人工映射、创建字段或明确忽略'
      }
    });
  }

  private assertPreviewAvailable(status: ImportTaskStatus) {
    const unavailableStatuses: ImportTaskStatus[] = [ImportTaskStatus.uploaded, ImportTaskStatus.failed];
    if (unavailableStatuses.includes(status)) {
      throw new ConflictException('导入任务尚未成功解析');
    }
  }

  private async getPreviewSummary(task: PreviewTask): Promise<PreviewSummary> {
    if (task.status === ImportTaskStatus.confirmed || task.previewSummaryVersion === task.version) {
      return {
        total: task.totalRows,
        valid: task.validRows,
        errors: task.errorRows,
        duplicates: task.duplicateRows,
        ignored: task.ignoredRows
      };
    }

    const summary: PreviewSummary = { total: 0, valid: 0, errors: 0, duplicates: 0, ignored: 0 };
    let lastRowNumber: number | undefined;
    let lastId: string | undefined;
    while (true) {
      const rows = await this.prisma.importRow.findMany({
        where: {
          importTaskId: task.id,
          ...(lastRowNumber === undefined || lastId === undefined
            ? {}
            : {
                OR: [
                  { rowNumber: { gt: lastRowNumber } },
                  { rowNumber: lastRowNumber, id: { gt: lastId } }
                ]
              })
        },
        orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }],
        take: IMPORT_PREVIEW_SUMMARY_BATCH_SIZE
      });
      if (rows.length === 0) break;
      const batch = this.buildPreviewRows(task, rows).summary;
      summary.total += batch.total;
      summary.valid += batch.valid;
      summary.errors += batch.errors;
      summary.duplicates += batch.duplicates;
      summary.ignored += batch.ignored;
      const last = rows[rows.length - 1];
      lastRowNumber = last.rowNumber;
      lastId = last.id;
    }

    const updated = await this.prisma.importTask.updateMany({
      where: { id: task.id, version: task.version },
      data: {
        totalRows: summary.total,
        validRows: summary.valid,
        errorRows: summary.errors,
        duplicateRows: summary.duplicates,
        ignoredRows: summary.ignored,
        previewSummaryVersion: task.version
      }
    });
    if (updated.count !== 1) {
      throw new ConflictException('导入任务已发生变化，请刷新后重试');
    }
    return summary;
  }

  private buildPreviewRows(task: PreviewTask, importRows: PreviewImportRow[]): PreviewResult {
    this.assertPreviewAvailable(task.status);
    const unresolvedColumns = task.columns
      .filter((column) => !column.decision)
      .map((column) => ({ id: column.id, sourceName: column.sourceName, sourceKey: column.sourceKey }));
    const templateFields = task.template.templateFields;
    const templateFieldById = new Map(templateFields.map((item) => [item.fieldId, item]));
    const requiredFields = templateFields.filter((item) => item.isRequired);
    const category = task.template.accountingDirection === 'income' ? '收入' : '成本';
    const rows: PreviewRow[] = importRows.map((row) => {
      const parserErrors = this.stringArray(row.parserErrors);
      const warnings = this.stringArray(row.parserWarnings);
      const rawData = this.jsonObject(row.rawData);
      const summaryCandidate = this.isPotentialSummaryRow(rawData);
      const normalizedData: Record<string, string | string[]> = {};
      const values: PreviewValue[] = [];
      const errors = [...parserErrors];

      for (const column of task.columns) {
        const decision = column.decision;
        if (!decision || decision.ignored || !decision.targetField) continue;
        const templateField = templateFieldById.get(decision.targetField.id);
        if (!templateField) {
          errors.push(`${column.sourceName}：映射字段不属于当前模板`);
          continue;
        }
        if (!templateField.isVisible || !decision.targetField.isActive) {
          errors.push(`${column.sourceName}：停用或隐藏字段不能写入`);
          continue;
        }
        const result = this.normalizeFieldValue(decision.targetField, rawData[column.sourceKey]);
        if (result.error) errors.push(`${column.sourceName}：${result.error}`);
        if (result.value !== undefined) {
          normalizedData[decision.targetField.id] = result.value;
          values.push({ field: decision.targetField, value: result.value });
        }
      }

      for (const templateField of templateFields) {
        if (templateField.fieldId in normalizedData || !this.hasPreviewValue(templateField.defaultValue)) continue;
        if (!templateField.field.isActive) {
          errors.push(`${templateField.field.fieldName}：停用字段不能应用默认值`);
          continue;
        }
        const result = this.normalizeFieldValue(templateField.field, templateField.defaultValue);
        if (result.error) {
          errors.push(`${templateField.field.fieldName}默认值：${result.error}`);
          continue;
        }
        if (result.value !== undefined) {
          normalizedData[templateField.fieldId] = result.value;
          values.push({ field: templateField.field, value: result.value });
        }
      }

      for (const required of requiredFields) {
        if (!(required.fieldId in normalizedData)) {
          errors.push(`缺少必填字段：${required.field.fieldName}`);
        }
      }

      let amount = task.template.primaryAmountFieldId
        ? normalizedData[task.template.primaryAmountFieldId]
        : undefined;
      let recordDate = task.template.primaryDateFieldId
        ? normalizedData[task.template.primaryDateFieldId]
        : undefined;
      try {
        const canonical = this.recordPolicy.resolveCanonicalValues(
          task.template,
          values.map((value) => ({ fieldId: value.field.id, value: value.value })),
          { requireValues: true }
        );
        amount = canonical.amount.toFixed(2);
        recordDate = canonical.recordDate.toISOString().slice(0, 10);
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() >= 500) throw error;
        errors.push(this.errorMessage(error));
      }

      if (summaryCandidate && !row.reviewDecision) {
        errors.push('疑似汇总行，必须由财务明确按明细纳入或排除');
      }
      if (row.reviewDecision === 'include') {
        warnings.push(summaryCandidate ? '财务已将疑似汇总行确认为业务明细' : '财务已明确将该行纳入业务明细');
      }

      let status = row.status === ImportRowStatus.confirmed ? ImportRowStatus.confirmed : row.parserStatus;
      const parserFixedStatuses: ImportRowStatus[] = [ImportRowStatus.ignored, ImportRowStatus.duplicate];
      if (row.reviewDecision === 'exclude') {
        status = ImportRowStatus.ignored;
        errors.length = 0;
        warnings.push('财务已明确排除该行，不生成正式记录');
      } else if (!parserFixedStatuses.includes(status) && status !== ImportRowStatus.confirmed) {
        status = errors.length > 0 ? ImportRowStatus.error : ImportRowStatus.mapped;
      } else if (parserFixedStatuses.includes(status)) {
        errors.length = 0;
      }

      return {
        id: row.id,
        rowNumber: row.rowNumber,
        rowHash: row.rowHash,
        status,
        recordDate: typeof recordDate === 'string' ? recordDate : undefined,
        amount: typeof amount === 'string' ? amount : undefined,
        category,
        subCategory: task.template.name,
        values: values.map((item) => ({
          fieldId: item.field.id,
          fieldName: item.field.fieldName,
          fieldType: item.field.fieldType,
          value: item.value
        })),
        normalizedData,
        errors: [...new Set(errors)],
        warnings: [...new Set(warnings)],
        generatedRecordId: row.generatedRecordId ?? undefined,
        summaryCandidate,
        review: {
          decision: row.reviewDecision === 'include' || row.reviewDecision === 'exclude'
            ? row.reviewDecision
            : undefined,
          reason: row.reviewReason ?? undefined,
          reviewedBy: row.reviewedBy ?? undefined,
          reviewedAt: row.reviewedAt?.toISOString()
        }
      };
    });

    return {
      task,
      unresolvedColumns,
      rows,
      summary: {
        total: rows.length,
        valid: rows.filter((row) => row.status === ImportRowStatus.mapped || row.status === ImportRowStatus.confirmed).length,
        errors: rows.filter((row) => row.status === ImportRowStatus.error).length,
        duplicates: rows.filter((row) => row.status === ImportRowStatus.duplicate).length,
        ignored: rows.filter((row) => row.status === ImportRowStatus.ignored).length
      }
    };
  }

  private normalizeFieldValue(field: FieldDefinition, raw: unknown): { value?: string | string[]; error?: string } {
    if (raw === null || raw === undefined || raw === '') return {};
    if (this.isFormulaValue(raw)) {
      const result = raw.result;
      if (result === null || result === undefined || typeof result === 'object') {
        return { error: '公式单元格缺少可用缓存结果' };
      }
      return this.normalizeFieldValue(field, result);
    }
    if (field.fieldType === FieldType.money || field.fieldType === FieldType.number) {
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: '必须是数字' };
      const normalized = typeof raw === 'number'
        ? String(raw)
        : raw.trim().replace(/[￥¥,$，\s]/g, '');
      if (!/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) return { error: '数字格式错误' };
      const maxDecimals = field.fieldType === FieldType.money ? 2 : 4;
      try {
        if (typeof raw === 'number' && !Number.isSafeInteger(raw * 10 ** maxDecimals)) {
          return { error: '高精度数字必须在 Excel 中保存为文本' };
        }
        const decimal = field.fieldType === FieldType.money
          ? this.recordPolicy.parseMoney(normalized, field.fieldName)
          : this.recordPolicy.parseNumericValue(normalized, field.fieldName, maxDecimals);
        return { value: field.fieldType === FieldType.money ? decimal.toFixed(2) : decimal.toString() };
      } catch (error) {
        return { error: this.errorMessage(error) };
      }
    }
    if (field.fieldType === FieldType.date) {
      if (typeof raw !== 'string') return { error: '日期格式错误' };
      const match = raw.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
      if (!match) return { error: '日期必须是 YYYY-MM-DD 或 YYYY/MM/DD' };
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return { error: '日期无效' };
      }
      return { value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
    }
    if (field.fieldType === FieldType.file) return { error: 'Excel 单元格不能直接作为文件字段' };
    if (!['string', 'number', 'boolean'].includes(typeof raw)) return { error: '文本值格式错误' };
    const value = String(raw).trim();
    const maxLength = field.fieldType === FieldType.textarea ? 5000 : 1000;
    if (value.length > maxLength) return { error: `文本不能超过 ${maxLength} 个字符` };
    return { value };
  }

  private buildRecordValueData(
    recordId: string,
    value: { fieldId: string; fieldName: string; fieldType: FieldType; value: string | string[] },
    templateFields: PreviewTask['template']['templateFields']
  ): Prisma.RecordValueCreateManyInput {
    const field = templateFields.find((item) => item.fieldId === value.fieldId)?.field;
    if (!field) throw new BadRequestException('导入字段不属于当前模板');
    const base = { recordId, fieldId: field.id, fieldName: field.fieldName };
    if (field.fieldType === FieldType.money || field.fieldType === FieldType.number) {
      return { ...base, valueNumber: new Prisma.Decimal(value.value as string) };
    }
    if (field.fieldType === FieldType.date) {
      return { ...base, valueDate: new Date(`${String(value.value)}T00:00:00.000Z`) };
    }
    if (field.fieldType === FieldType.file) return { ...base, valueJson: value.value as string[] };
    return { ...base, valueText: String(value.value) };
  }

  private async resolveSuggestion(
    tx: Prisma.TransactionClient,
    suggestion: Awaited<ReturnType<ImportTasksService['findSuggestionOrThrow']>>,
    field: FieldDefinition,
    status: FieldSuggestionStatus,
    actor: CurrentUser
  ) {
    await tx.fieldSuggestion.update({
      where: { id: suggestion.id },
      data: { status, mappedFieldId: field.id, approvedBy: actor.id, approvedAt: new Date() }
    });
    await tx.mappingDecision.upsert({
      where: { importColumnId: suggestion.importColumnId },
      create: {
        importTaskId: suggestion.importTaskId,
        importColumnId: suggestion.importColumnId,
        targetFieldId: field.id,
        mappingType: MappingDecisionType.manual,
        confidence: new Prisma.Decimal(1),
        confirmedBy: actor.id
      },
      update: {
        targetFieldId: field.id,
        mappingType: MappingDecisionType.manual,
        confidence: new Prisma.Decimal(1),
        ignored: false,
        confirmedBy: actor.id
      }
    });
    await this.refreshTaskMappingStatus(tx, suggestion.importTaskId);
    await this.saveReviewedProfileForTask(tx, suggestion.importTaskId, actor);
  }

  private async saveReviewedProfileForTask(
    tx: Prisma.TransactionClient,
    taskId: string,
    actor: CurrentUser
  ) {
    const task = await tx.importTask.findUnique({
      where: { id: taskId },
      include: {
        columns: {
          include: { decision: { include: { targetField: true } } },
          orderBy: { columnIndex: 'asc' }
        }
      }
    });
    if (!task) throw new NotFoundException('导入任务不存在');
    if (task.columns.length === 0 || task.columns.some((column) => !column.decision)) return undefined;
    await acquireProjectWriteLock(tx, task.projectId);

    const structure = await this.getTaskStructureFingerprint(tx, task.id);
    const scopeKey = buildMappingProfileScopeKey({
      projectId: task.projectId,
      templateId: task.templateId,
      templateVersion: task.templateVersion,
      structureFingerprint: structure.fingerprint,
      transformRegistryVersion: structure.transformRegistryVersion
    });
    const existing = await tx.mappingProfile.findUnique({ where: { scopeKey } });
    const profileVersion = (existing?.profileVersion ?? 0) + 1;
    const rules: MappingProfileRuleSnapshot[] = task.columns.map((column) => ({
      sourceColumnId: this.sourceColumnId(column),
      columnIndex: column.columnIndex,
      normalizedSourceName: column.normalizedName,
      sourceInferredType: column.inferredType,
      targetFieldId: column.decision!.ignored ? null : column.decision!.targetFieldId,
      transformKey: this.mappingTransformKey(column.decision!.targetField?.fieldType),
      ignored: column.decision!.ignored
    }));
    const approvalSnapshotHash = buildMappingProfileSnapshotHash({ scopeKey, profileVersion, rules });
    const now = new Date();

    await tx.mappingProfile.updateMany({
      where: {
        projectId: task.projectId,
        templateId: task.templateId,
        status: MappingProfileStatus.active,
        scopeKey: { not: scopeKey }
      },
      data: { status: MappingProfileStatus.stale, isActive: false }
    });

    const profile = existing
      ? await tx.mappingProfile.update({
          where: { id: existing.id },
          data: {
            templateVersion: task.templateVersion,
            profileVersion,
            sourceStructureFingerprint: structure.fingerprint,
            fingerprintVersion: structure.fingerprintVersion,
            transformRegistryVersion: structure.transformRegistryVersion,
            policyVersion: MAPPING_PROFILE_POLICY_VERSION,
            approvalSnapshotHash,
            status: MappingProfileStatus.active,
            isActive: true,
            reviewedBy: actor.id,
            approvedAt: now,
            createdFromTaskId: task.id
          }
        })
      : await tx.mappingProfile.create({
          data: {
            projectId: task.projectId,
            templateId: task.templateId,
            templateVersion: task.templateVersion,
            name: `财务确认-${structure.fingerprint.slice(0, 12)}`,
            profileVersion,
            sourceStructureFingerprint: structure.fingerprint,
            fingerprintVersion: structure.fingerprintVersion,
            transformRegistryVersion: structure.transformRegistryVersion,
            policyVersion: MAPPING_PROFILE_POLICY_VERSION,
            scopeKey,
            approvalSnapshotHash,
            status: MappingProfileStatus.active,
            isActive: true,
            reviewedBy: actor.id,
            approvedAt: now,
            createdFromTaskId: task.id
          }
        });

    await tx.mappingProfileRule.deleteMany({ where: { mappingProfileId: profile.id } });
    await tx.mappingProfileRule.createMany({
      data: task.columns.map((column, index) => ({
        mappingProfileId: profile.id,
        sourceColumnId: rules[index].sourceColumnId,
        columnIndex: column.columnIndex,
        sourceName: column.sourceName,
        normalizedSourceName: column.normalizedName,
        sourceInferredType: column.inferredType,
        targetFieldId: rules[index].targetFieldId,
        transformKey: rules[index].transformKey,
        ignored: rules[index].ignored
      }))
    });
    await tx.importTask.update({
      where: { id: task.id },
      data: {
        structureFingerprint: structure.fingerprint,
        fingerprintVersion: structure.fingerprintVersion,
        transformRegistryVersion: structure.transformRegistryVersion,
        mappingProfileId: profile.id,
        mappingProfileVersion: profile.profileVersion,
        mappingProfileSnapshotHash: profile.approvalSnapshotHash
      }
    });
    return profile;
  }

  private async getTaskStructureFingerprint(tx: PrismaWriter, taskId: string) {
    const task = await tx.importTask.findUnique({
      where: { id: taskId },
      select: {
        fileName: true,
        templateId: true,
        templateVersion: true,
        parserVersion: true,
        sheets: {
          orderBy: { sheetIndex: 'asc' },
          select: {
            sheetIndex: true,
            sheetName: true,
            selectedHeaderRows: true,
            mergedRanges: true
          }
        },
        columns: {
          orderBy: { columnIndex: 'asc' },
          select: {
            sourceColumnId: true,
            columnIndex: true,
            columnLetter: true,
            headerParts: true,
            normalizedName: true,
            inferredType: true
          }
        }
      }
    });
    if (!task || task.sheets.length === 0 || task.columns.length === 0) {
      throw new ConflictException('导入结构尚未解析完成');
    }
    const extension = extname(task.fileName).toLowerCase();
    if (extension !== '.xls' && extension !== '.xlsx') {
      throw new ConflictException('导入结构来源格式不受支持');
    }
    return buildExcelStructureFingerprint({
      workbookType: extension.slice(1) as 'xls' | 'xlsx',
      parserVersion: task.parserVersion ?? EXCEL_PARSER_VERSION,
      templateId: task.templateId,
      templateVersion: task.templateVersion,
      transformRegistryVersion: IMPORT_TRANSFORM_REGISTRY_VERSION,
      sheets: task.sheets,
      columns: task.columns
    });
  }

  private sourceColumnId(column: { sourceColumnId?: string | null; columnIndex?: number }) {
    return column.sourceColumnId ?? `column:${column.columnIndex ?? 0}`;
  }

  private profileRuleMatchesColumn(
    rule: {
      sourceColumnId: string;
      columnIndex: number;
      normalizedSourceName: string;
      sourceInferredType: string;
    },
    column: {
      sourceColumnId?: string | null;
      columnIndex?: number;
      normalizedName: string;
      inferredType: string;
    }
  ) {
    return rule.sourceColumnId === this.sourceColumnId(column)
      && rule.columnIndex === (column.columnIndex ?? 0)
      && rule.normalizedSourceName === column.normalizedName
      && rule.sourceInferredType === column.inferredType;
  }

  private mappingTransformKey(fieldType?: FieldType) {
    return fieldType ? transformKeyForFieldType(fieldType) : 'IDENTITY_V1';
  }

  private presentMappingProfile(profile: {
    id: string;
    projectId: string | null;
    templateId: string;
    templateVersion: number;
    name: string;
    profileVersion: number;
    sourceStructureFingerprint: string | null;
    fingerprintVersion: string | null;
    transformRegistryVersion: string | null;
    policyVersion: string | null;
    approvalSnapshotHash: string | null;
    status: MappingProfileStatus;
    usageCount: number;
    lastUsedAt: Date | null;
    approvedAt: Date | null;
    reviewedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    rules: Array<{
      id: string;
      sourceColumnId: string;
      columnIndex: number;
      sourceName: string;
      normalizedSourceName: string;
      sourceInferredType: string;
      targetFieldId: string | null;
      transformKey: string;
      ignored: boolean;
    }>;
  }) {
    return {
      id: profile.id,
      projectId: profile.projectId,
      templateId: profile.templateId,
      templateVersion: profile.templateVersion,
      name: profile.name,
      profileVersion: profile.profileVersion,
      sourceStructureFingerprint: profile.sourceStructureFingerprint,
      fingerprintVersion: profile.fingerprintVersion,
      transformRegistryVersion: profile.transformRegistryVersion,
      policyVersion: profile.policyVersion,
      approvalSnapshotHash: profile.approvalSnapshotHash,
      status: profile.status,
      usageCount: profile.usageCount,
      lastUsedAt: profile.lastUsedAt?.toISOString(),
      approvedAt: profile.approvedAt?.toISOString(),
      reviewedBy: profile.reviewedBy,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      rules: profile.rules.map((rule) => ({
        id: rule.id,
        sourceColumnId: rule.sourceColumnId,
        columnIndex: rule.columnIndex,
        sourceName: rule.sourceName,
        normalizedSourceName: rule.normalizedSourceName,
        sourceInferredType: rule.sourceInferredType,
        targetFieldId: rule.targetFieldId,
        transformKey: rule.transformKey,
        ignored: rule.ignored
      }))
    };
  }

  private async ensureTemplateField(
    tx: Prisma.TransactionClient,
    suggestion: Awaited<ReturnType<ImportTasksService['findSuggestionOrThrow']>>,
    fieldId: string,
    actor: CurrentUser,
    context: RequestContext
  ) {
    const templateId = suggestion.templateId;
    const existing = await tx.templateField.findUnique({ where: { templateId_fieldId: { templateId, fieldId } } });
    if (existing) {
      if (!existing.isVisible) throw new BadRequestException('隐藏字段不能用于导入映射');
      return templateId;
    }

    await this.lockTask(tx, suggestion.importTaskId);
    await acquireProjectWriteLock(tx, suggestion.projectId);
    const task = await tx.importTask.findUnique({ where: { id: suggestion.importTaskId } });
    if (!task) throw new NotFoundException('导入任务不存在');
    this.assertTaskMutable(task.status);
    if (task.templateId !== templateId) {
      throw new ConflictException('导入任务模板版本已经变化，请刷新后重试');
    }

    const published = await tx.projectTemplate.findUnique({
      where: { projectId_templateId: { projectId: suggestion.projectId, templateId } }
    });
    if (!published?.isActive) {
      throw new ConflictException('当前模板已不再是项目活动版本，请刷新后重试');
    }

    const [otherImports, activeOcrTasks, activeWorkOrders, mutableRecords] = await Promise.all([
      tx.importTask.count({
        where: {
          id: { not: suggestion.importTaskId },
          projectId: suggestion.projectId,
          templateId,
          status: { notIn: [ImportTaskStatus.confirmed, ImportTaskStatus.cancelled] }
        }
      }),
      tx.ocrTask.count({
        where: {
          projectId: suggestion.projectId,
          templateId,
          status: { notIn: [OcrTaskStatus.confirmed, OcrTaskStatus.cancelled] }
        }
      }),
      tx.workOrder.count({
        where: {
          projectId: suggestion.projectId,
          templateId,
          status: { notIn: [WorkOrderStatus.completed, WorkOrderStatus.boss_rejected] }
        }
      }),
      tx.businessRecord.count({
        where: {
          projectId: suggestion.projectId,
          templateId,
          status: { in: [BusinessRecordStatus.draft, BusinessRecordStatus.pending_confirm] }
        }
      })
    ]);
    if (otherImports + activeOcrTasks + activeWorkOrders + mutableRecords > 0) {
      throw new ConflictException('该模板仍有其他在途任务或待确认记录，处理完成后再创建新模板版本');
    }

    const source = await tx.template.findUnique({
      where: { id: templateId },
      include: { templateFields: { include: { field: true }, orderBy: { displayOrder: 'asc' } } }
    });
    if (!source) throw new NotFoundException('模板不存在');
    const nextOrder = Math.max(0, ...source.templateFields.map((item) => item.displayOrder)) + 1;
    const nextTemplate = await tx.template.create({
      data: {
        name: `${source.name} 导入字段版`,
        recordType: source.recordType,
        accountingDirection: source.accountingDirection,
        dataLayer: source.dataLayer,
        primaryAmountFieldId: source.primaryAmountFieldId,
        primaryDateFieldId: source.primaryDateFieldId,
        version: source.version + 1,
        description: source.description,
        isSystem: false,
        createdBy: actor.username,
        templateFields: {
          create: [
            ...source.templateFields.map((item) => ({
              fieldId: item.fieldId,
              isRequired: item.isRequired,
              isVisible: item.isVisible,
              displayOrder: item.displayOrder,
              defaultValue: item.defaultValue
            })),
            { fieldId, isRequired: false, isVisible: true, displayOrder: nextOrder }
          ]
        }
      },
      include: { templateFields: { include: { field: true }, orderBy: { displayOrder: 'asc' } } }
    });
    await tx.projectTemplate.update({ where: { id: published.id }, data: { isActive: false } });
    const nextProjectTemplate = await tx.projectTemplate.create({
      data: {
        projectId: suggestion.projectId,
        templateId: nextTemplate.id,
        recordType: nextTemplate.recordType,
        customName: published.customName,
        isActive: true
      }
    });
    await tx.importTask.update({
      where: { id: suggestion.importTaskId },
      data: {
        templateId: nextTemplate.id,
        templateVersion: nextTemplate.version,
        templateSnapshot: this.recordPolicy.toSnapshot(nextTemplate),
        version: { increment: 1 }
      }
    });
    await tx.fieldSuggestion.updateMany({
      where: { importTaskId: suggestion.importTaskId },
      data: { templateId: nextTemplate.id }
    });
    await this.auditLogs.write(
      tx,
      actor,
      'template.clone_for_import',
      'template',
      nextTemplate.id,
      { sourceTemplateId: source.id, importTaskId: suggestion.importTaskId },
      context
    );
    await this.auditLogs.write(
      tx,
      actor,
      'project_template.switch_for_import',
      'project_template',
      nextProjectTemplate.id,
      {
        projectId: suggestion.projectId,
        beforeTemplateId: source.id,
        afterTemplateId: nextTemplate.id,
        importTaskId: suggestion.importTaskId
      },
      context
    );
    await this.ledgerEvents.write(tx, actor, 'template_version_created', 'template', nextTemplate.id, {
      sourceTemplateId: source.id,
      importTaskId: suggestion.importTaskId
    });
    await this.ledgerEvents.write(tx, actor, 'project_template_version_switched', 'project_template', nextProjectTemplate.id, {
      projectId: suggestion.projectId,
      beforeTemplateId: source.id,
      afterTemplateId: nextTemplate.id,
      importTaskId: suggestion.importTaskId
    });
    return nextTemplate.id;
  }

  private async uniqueFieldKey(tx: Prisma.TransactionClient, sourceName: string) {
    const ascii = sourceName
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    const digest = createHash('sha256').update(sourceName).digest('hex').slice(0, 10);
    const base = ascii ? `import_${ascii}` : `import_field_${digest}`;
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}_${suffix + 1}`;
      if (!await tx.fieldDefinition.findUnique({ where: { fieldKey: candidate } })) return candidate;
    }
    throw new ConflictException('无法生成唯一字段识别名');
  }

  private reviewInvalidationData(): Prisma.ImportTaskUpdateInput {
    return {
      reviewRevision: { increment: 1 },
      validationRevision: null,
      validationSnapshot: Prisma.DbNull,
      validationSnapshotHash: null,
      validationRuleVersion: null,
      validatedAt: null,
      approvalSnapshot: Prisma.DbNull,
      approvalSnapshotHash: null,
      approvalReviewRevision: null,
      approvalValidationHash: null,
      approvalPolicyVersion: null,
      approvalRequestKeyHash: null,
      previewSummaryVersion: null,
      version: { increment: 1 }
    };
  }

  private async invalidateImportReview(tx: Prisma.TransactionClient, id: string) {
    await tx.importTask.update({ where: { id }, data: this.reviewInvalidationData() });
  }

  private async refreshTaskMappingStatus(tx: Prisma.TransactionClient, id: string) {
    const [columns, decisions] = await Promise.all([
      tx.importColumn.count({ where: { importTaskId: id } }),
      tx.mappingDecision.count({ where: { importTaskId: id } })
    ]);
    await tx.importTask.update({
      where: { id },
      data: {
        status: columns > 0 && columns === decisions ? ImportTaskStatus.pending_confirm : ImportTaskStatus.mapping,
        ...this.reviewInvalidationData()
      }
    });
  }

  private validateMappingInputs(mappings: MappingInputDto[]) {
    for (const mapping of mappings) {
      const hasField = Boolean(mapping.targetFieldId);
      const ignored = mapping.ignore === true;
      if (hasField === ignored) throw new BadRequestException('每一列必须二选一：映射字段或明确忽略');
    }
  }

  private async failOwnedParse(
    id: string,
    rawFileId: string,
    leaseToken: string,
    attempt: number,
    actor: CurrentUser,
    context: RequestContext,
    error: unknown,
    options: ParseWorkbookOptions = {}
  ) {
    const message = this.safeParseErrorMessage(error).slice(0, 1000);
    const selectionRequired = error instanceof WorkbookSelectionRequiredException;
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const current = await tx.importTask.findUnique({
        where: { id },
        select: { status: true, leaseToken: true }
      });
      if (!current || current.status !== ImportTaskStatus.parsing || current.leaseToken !== leaseToken) return;
      await tx.importSheet.deleteMany({ where: { importTaskId: id } });
      await tx.importTask.update({
        where: { id },
        data: {
          status: selectionRequired ? ImportTaskStatus.uploaded : ImportTaskStatus.failed,
          processedRows: 0,
          validRows: 0,
          errorRows: 0,
          duplicateRows: 0,
          ignoredRows: 0,
          errorMessage: selectionRequired ? null : message,
          leaseToken: null,
          leaseUntil: null,
          version: { increment: 1 }
        }
      });
      await tx.rawFile.update({
        where: { id: rawFileId },
        data: { status: selectionRequired ? RawFileStatus.uploaded : RawFileStatus.failed }
      });
      await this.auditLogs.write(
        tx,
        actor,
        selectionRequired ? 'import_task.parse_selection_required' : 'import_task.parse_failed',
        'import_task',
        id,
        selectionRequired ? {
          attempt,
          sheetIndex: options.sheetIndex,
          headerStartRowIndex: options.headerStartRowIndex,
          headerRowIndex: options.headerRowIndex
        } : { attempt, error: message },
        context
      );
      if (!selectionRequired) {
        await this.ledgerEvents.write(
          tx,
          actor,
          'import_task_parse_failed',
          'import_task',
          id,
          { attempt, error: message },
          `import_task:${id}:parse_attempt:${attempt}:failed`
        );
      }
    });
  }

  private async releaseParseForRecovery(id: string, leaseToken: string, reason: string | null = '后台解析进程已停止，等待租约恢复') {
    await this.prisma.importTask.updateMany({
      where: { id, status: ImportTaskStatus.parsing, leaseToken },
      data: {
        leaseUntil: new Date(Date.now() - 1),
        errorMessage: reason
      }
    }).catch(() => undefined);
  }

  private async handoffParseToWorker(id: string, leaseToken: string) {
    const updated = await this.prisma.importTask.updateMany({
      where: { id, status: ImportTaskStatus.parsing, leaseToken },
      data: {
        leaseToken: `${WORKER_HANDOFF_LEASE_PREFIX}${leaseToken}`,
        leaseUntil: new Date(Date.now() - 1),
        errorMessage: null
      }
    });
    if (updated.count !== 1) throw new ConflictException('Excel 解析任务交接 Worker 失败');
  }

  private isWorkerHandoffLease(leaseToken: string | null) {
    return leaseToken?.startsWith(WORKER_HANDOFF_LEASE_PREFIX) ?? false;
  }

  private canRunBackgroundJobs() {
    return this.processRole === 'worker' || this.processRole === 'all';
  }

  private async assertOwnedParse(tx: Prisma.TransactionClient, id: string, leaseToken: string) {
    const task = await tx.importTask.findUnique({
      where: { id },
      select: {
        id: true,
        templateId: true,
        templateVersion: true,
        projectId: true,
        status: true,
        leaseToken: true
      }
    });
    if (!task || task.status !== ImportTaskStatus.parsing || task.leaseToken !== leaseToken) {
      throw new ImportParseLeaseLostError();
    }
    return task;
  }

  private importColumnData(importTaskId: string, sheetId: string, column: ParsedImportColumn): Prisma.ImportColumnCreateManyInput {
    return {
      importTaskId,
      sheetId,
      columnIndex: column.columnIndex,
      sourceColumnId: column.sourceColumnId,
      columnLetter: column.columnLetter,
      sourceKey: column.sourceKey,
      sourceName: column.sourceName,
      headerParts: column.headerParts,
      normalizedName: column.normalizedName,
      sampleValues: column.sampleValues,
      inferredType: column.inferredType,
      duplicateName: column.duplicateName,
      statistics: column.statistics as unknown as Prisma.InputJsonObject
    };
  }

  private importSheetData(
    importTaskId: string,
    sheet: ParsedWorkbookMetadata['sheet']
  ): Prisma.ImportSheetUncheckedCreateInput {
    return {
      importTaskId,
      stableId: sheet.stableId,
      sheetName: sheet.sheetName,
      sheetIndex: sheet.sheetIndex,
      visibility: sheet.visibility,
      headerStartRowIndex: sheet.headerStartRowIndex,
      headerRowIndex: sheet.headerRowIndex,
      selectedHeaderRows: sheet.selectedHeaderRows,
      mergedRanges: sheet.mergedRanges,
      dateSystem: sheet.dateSystem,
      timezone: sheet.timezone,
      rowCount: sheet.rowCount
    };
  }

  private importSheetUpdateData(sheet: ParsedWorkbookMetadata['sheet']): Prisma.ImportSheetUpdateInput {
    return {
      stableId: sheet.stableId,
      sheetName: sheet.sheetName,
      sheetIndex: sheet.sheetIndex,
      visibility: sheet.visibility,
      headerStartRowIndex: sheet.headerStartRowIndex,
      headerRowIndex: sheet.headerRowIndex,
      selectedHeaderRows: sheet.selectedHeaderRows,
      mergedRanges: sheet.mergedRanges,
      dateSystem: sheet.dateSystem,
      timezone: sheet.timezone,
      rowCount: sheet.rowCount
    };
  }

  private importRowData(
    importTaskId: string,
    sheetId: string,
    row: ParsedImportRow
  ): Prisma.ImportRowCreateManyInput {
    return {
      importTaskId,
      sheetId,
      rowNumber: row.rowNumber,
      rawData: row.rawData as Prisma.InputJsonObject,
      rowHash: row.rowHash,
      parserStatus: row.status as ImportRowStatus,
      status: row.status as ImportRowStatus,
      parserErrors: row.errors,
      parserWarnings: row.warnings,
      errors: row.errors,
      warnings: row.warnings,
      cellEvidence: row.cellEvidence as unknown as Prisma.InputJsonArray,
      evidenceHash: row.evidenceHash
    };
  }

  private parseConfig(options: ParseWorkbookOptions): Prisma.InputJsonObject {
    const config: Record<string, Prisma.InputJsonValue> = {};
    if (options.sheetIndex !== undefined) config.sheetIndex = options.sheetIndex;
    if (options.headerStartRowIndex !== undefined) config.headerStartRowIndex = options.headerStartRowIndex;
    if (options.headerRowIndex !== undefined) config.headerRowIndex = options.headerRowIndex;
    if (options.allowHiddenSheet !== undefined) config.allowHiddenSheet = options.allowHiddenSheet;
    if (options.allowCachedFormulaResults !== undefined) {
      config.allowCachedFormulaResults = options.allowCachedFormulaResults;
    }
    return config as Prisma.InputJsonObject;
  }

  private readParseConfig(value: Prisma.JsonValue | null): ParseWorkbookOptions | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const config = value as Record<string, Prisma.JsonValue>;
    const sheetIndex = this.optionalInteger(config.sheetIndex, 0, 999);
    const headerStartRowIndex = this.optionalInteger(config.headerStartRowIndex, 1, 1000);
    const headerRowIndex = this.optionalInteger(config.headerRowIndex, 1, 1000);
    const allowHiddenSheet = this.optionalBoolean(config.allowHiddenSheet);
    const allowCachedFormulaResults = this.optionalBoolean(config.allowCachedFormulaResults);
    if (
      sheetIndex === null ||
      headerStartRowIndex === null ||
      headerRowIndex === null ||
      allowHiddenSheet === null ||
      allowCachedFormulaResults === null
    ) {
      return undefined;
    }
    return {
      ...(sheetIndex === undefined ? {} : { sheetIndex }),
      ...(headerStartRowIndex === undefined ? {} : { headerStartRowIndex }),
      ...(headerRowIndex === undefined ? {} : { headerRowIndex }),
      ...(allowHiddenSheet === undefined ? {} : { allowHiddenSheet }),
      ...(allowCachedFormulaResults === undefined ? {} : { allowCachedFormulaResults })
    };
  }

  private optionalInteger(value: Prisma.JsonValue | undefined, min: number, max: number): number | undefined | null {
    if (value === undefined) return undefined;
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
  }

  private optionalBoolean(value: Prisma.JsonValue | undefined): boolean | undefined | null {
    if (value === undefined) return undefined;
    return typeof value === 'boolean' ? value : null;
  }

  private async prepareWorkbook(
    file: Awaited<ReturnType<FilesService['readForProcessing']>>
  ): Promise<PreparedWorkbook> {
    const extension = extname(file.fileName).toLowerCase();
    if (extension === '.xlsx') {
      return {
        buffer: file.buffer,
        sourceFormat: 'xlsx',
        sourceSha256: file.sha256,
        parserInputSha256: file.sha256
      };
    }
    if (extension === '.xls') {
      const converted = await this.xlsConverter.convert(file.buffer);
      return {
        buffer: converted.buffer,
        sourceFormat: 'xls',
        sourceSha256: file.sha256,
        parserInputSha256: createHash('sha256').update(converted.buffer).digest('hex'),
        conversion: converted.metadata
      };
    }
    throw new BadRequestException('导入源文件必须是 .xls 或 .xlsx');
  }

  private workbookProvenance(workbook: PreparedWorkbook) {
    return {
      sourceFormat: workbook.sourceFormat,
      sourceSha256: workbook.sourceSha256,
      parserInputSha256: workbook.parserInputSha256,
      ...(workbook.conversion ? { conversion: workbook.conversion } : {})
    };
  }

  private estimateDataRows(inspection: WorkbookInspection, options: ParseWorkbookOptions) {
    if (options.sheetIndex === undefined && inspection.requiresSheetSelection) return undefined;
    const selectedSheetIndex = options.sheetIndex ?? inspection.recommendedSelection?.sheetIndex;
    const sheet = inspection.sheets.find((item) => item.sheetIndex === selectedSheetIndex);
    if (!sheet || !sheet.nonEmpty || (sheet.state !== 'visible' && !options.allowHiddenSheet)) return undefined;
    const recommended = inspection.recommendedSelection?.sheetIndex === sheet.sheetIndex
      ? inspection.recommendedSelection
      : undefined;
    const headerRowIndex = options.headerRowIndex
      ?? recommended?.headerRowIndex
      ?? sheet.headerCandidates[0]?.endRowIndex;
    const candidate = sheet.headerCandidates.find((item) => item.endRowIndex === headerRowIndex);
    const headerStartRowIndex = options.headerStartRowIndex
      ?? recommended?.headerStartRowIndex
      ?? candidate?.startRowIndex
      ?? headerRowIndex;
    if (
      !headerRowIndex ||
      !headerStartRowIndex ||
      headerStartRowIndex < 1 ||
      headerRowIndex < headerStartRowIndex ||
      headerRowIndex - headerStartRowIndex > 2 ||
      headerRowIndex >= sheet.rowCount
    ) {
      return undefined;
    }
    return sheet.rowCount - headerRowIndex;
  }

  private toCurrentUser(user: {
    id: string;
    username: string;
    name: string;
    role: CurrentUser['role'];
    department: string | null;
    phone: string | null;
    status: CurrentUser['status'];
    tokenVersion: number;
  }): CurrentUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      department: user.department ?? '',
      phone: user.phone ?? '',
      status: user.status,
      tokenVersion: user.tokenVersion
    };
  }

  private errorMessage(error: unknown) {
    return error instanceof Error && error.message ? error.message : 'Excel 解析失败';
  }

  private deterministicImportRecordId(importRowId: string) {
    const hex = createHash('sha256').update(`excel-import-record:${importRowId}`).digest('hex').slice(0, 32);
    const versioned = `${hex.slice(0, 12)}5${hex.slice(13, 16)}`;
    const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const normalized = `${versioned}${variant}${hex.slice(17)}`;
    return [
      normalized.slice(0, 8),
      normalized.slice(8, 12),
      normalized.slice(12, 16),
      normalized.slice(16, 20),
      normalized.slice(20)
    ].join('-');
  }

  private isTransientDatabaseError(error: unknown) {
    if (error instanceof Prisma.PrismaClientInitializationError) return true;
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034'].includes(error.code);
  }

  private safeConfirmationErrorMessage(error: unknown) {
    if (error instanceof HttpException && error.getStatus() < 500) return this.errorMessage(error);
    return 'Excel 后台确认失败，已保留进度，可安全重试';
  }

  private hasPreviewValue(value: unknown) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  private isPotentialSummaryRow(rawData: Record<string, unknown>) {
    return Object.values(rawData).some((raw) => {
      const value = this.isFormulaValue(raw) ? raw.result : raw;
      if (typeof value !== 'string') return false;
      const label = value.normalize('NFKC').trim().replace(/[\s:：]+/g, '');
      return SUMMARY_ROW_LABELS.has(label);
    });
  }

  private safeParseErrorMessage(error: unknown) {
    if (error instanceof HttpException && error.getStatus() < 500) return this.errorMessage(error);
    return 'Excel 后台解析失败，请重试或联系管理员';
  }

  private parsedCounts(rows: Array<{ status: string }>) {
    return {
      valid: rows.filter((row) => row.status === 'pending').length,
      errors: rows.filter((row) => row.status === 'error').length,
      duplicates: rows.filter((row) => row.status === 'duplicate').length,
      ignored: rows.filter((row) => row.status === 'ignored').length
    };
  }

  private presentPreviewRow(row: PreviewRow) {
    return {
      id: row.id,
      rowNumber: row.rowNumber,
      status: row.status,
      recordDate: row.recordDate,
      amount: row.amount,
      category: row.category,
      subCategory: row.subCategory,
      values: row.values,
      mappedData: row.normalizedData,
      errors: row.errors,
      warnings: row.warnings,
      generatedRecordId: row.generatedRecordId,
      summaryCandidate: row.summaryCandidate,
      review: row.review
    };
  }

  private aliases(field: FieldDefinition): string[] {
    return Array.isArray(field.aliases)
      ? field.aliases.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private fieldNames(field: FieldDefinition) {
    return [field.fieldKey, field.fieldName, ...this.aliases(field)];
  }

  private similarity(left: string, right: string) {
    if (!left || !right) return 0;
    const distance = this.levenshtein(left, right);
    return 1 - distance / Math.max(left.length, right.length);
  }

  private levenshtein(left: string, right: string) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const current = [leftIndex];
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        current[rightIndex] = Math.min(
          current[rightIndex - 1] + 1,
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
        );
      }
      previous.splice(0, previous.length, ...current);
    }
    return previous[right.length];
  }

  private suggestFieldType(sourceName: string, inferredType: string): FieldType {
    if (inferredType === 'date') return FieldType.date;
    if (inferredType === 'number') {
      return /金额|费用|收入|成本|单价|补贴|扣款|费$/.test(sourceName) ? FieldType.money : FieldType.number;
    }
    return FieldType.text;
  }

  private semanticTypeFor(fieldType: FieldType): SemanticType {
    if (fieldType === FieldType.money || fieldType === FieldType.number) return SemanticType.amount;
    if (fieldType === FieldType.date) return SemanticType.date;
    if (fieldType === FieldType.file) return SemanticType.file;
    if (fieldType === FieldType.select) return SemanticType.category;
    return SemanticType.remark;
  }

  private jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private stringArray(value: Prisma.JsonValue): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private isFormulaValue(value: unknown): value is { formula: string; result?: unknown } {
    return Boolean(
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && 'formula' in value
      && typeof (value as { formula?: unknown }).formula === 'string'
    );
  }

  private async findDetailOrThrow(
    id: string,
    prisma: PrismaWriter = this.prisma
  ): Promise<ImportTaskDetail> {
    const task = await prisma.importTask.findUnique({ where: { id }, include: importTaskDetailInclude });
    if (!task) throw new NotFoundException('资源不存在');
    return task;
  }

  private async ensureTaskExists(id: string) {
    if (!await this.prisma.importTask.findUnique({ where: { id }, select: { id: true } })) {
      throw new NotFoundException('资源不存在');
    }
  }

  private async findSuggestionOrThrow(prisma: PrismaWriter, id: string) {
    const suggestion = await prisma.fieldSuggestion.findUnique({
      where: { id },
      include: { mappedField: true, importColumn: true }
    });
    if (!suggestion) throw new NotFoundException('资源不存在');
    return suggestion;
  }

  private assertTaskMutable(status: ImportTaskStatus) {
    if (status === ImportTaskStatus.confirmed) throw new ConflictException('已确认任务不能修改');
    const confirmationStartedStatuses: ImportTaskStatus[] = [
      ImportTaskStatus.confirming,
      ImportTaskStatus.confirmation_failed
    ];
    if (confirmationStartedStatuses.includes(status)) {
      throw new ConflictException('确认开始后不能修改导入任务');
    }
    if (status === ImportTaskStatus.uploaded) throw new ConflictException('请先解析 Excel 文件');
    if (status === ImportTaskStatus.parsing) throw new ConflictException('Excel 任务正在解析中');
    if (status === ImportTaskStatus.failed || status === ImportTaskStatus.cancelled) {
      throw new ConflictException('失败或已取消任务不能修改');
    }
  }

  private async lockMutableTask(tx: Prisma.TransactionClient, id: string) {
    await this.lockTask(tx, id);
    const task = await tx.importTask.findUnique({ where: { id }, select: { status: true } });
    if (!task) throw new NotFoundException('资源不存在');
    this.assertTaskMutable(task.status);
  }

  private async lockTask(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 9))`;
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

}
