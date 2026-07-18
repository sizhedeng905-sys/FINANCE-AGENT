import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  PayloadTooLargeException,
  UnprocessableEntityException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BusinessRecordStatus,
  FieldDefinition,
  FieldSuggestionStatus,
  FieldType,
  ImportRowStatus,
  ImportTaskStatus,
  MappingDecisionType,
  OcrTaskStatus,
  Prisma,
  RawFileStatus,
  RecordSourceType,
  SemanticType,
  WorkOrderStatus
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { acquireProjectWriteLock } from '../common/database/project-write-lock';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { FilesService } from '../files/files.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecordPolicyService } from '../record-policy/record-policy.service';
import { ApproveFieldSuggestionDto, MapFieldSuggestionDto, QueryFieldSuggestionsDto } from './dto/field-suggestion.dto';
import { CreateImportTaskDto } from './dto/create-import-task.dto';
import { ParseImportTaskDto } from './dto/parse-import-task.dto';
import { QueryImportPreviewDto } from './dto/query-import-preview.dto';
import { QueryImportRowsDto } from './dto/query-import-rows.dto';
import { QueryImportTasksDto } from './dto/query-import-tasks.dto';
import { MappingInputDto, SaveMappingsDto } from './dto/save-mappings.dto';
import {
  ExcelParserService,
  ParsedImportColumn,
  ParsedImportRow,
  ParsedWorkbookMetadata,
  ParseWorkbookOptions,
  WorkbookInspection,
  WorkbookSelectionRequiredException
} from './excel-parser.service';
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
  actor: CurrentUser;
  context: RequestContext;
  attempt: number;
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
            status: row.status as ImportRowStatus,
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
      const columnById = new Map(columns.map((column) => [column.id, column]));
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

      if (dto.saveToProfile !== false) {
        const profile = await this.getOrCreateReviewedProfile(tx, task.templateId, actor);
        for (const mapping of dto.mappings) {
          const column = columnById.get(mapping.columnId)!;
          await tx.mappingProfileRule.upsert({
            where: {
              mappingProfileId_normalizedSourceName: {
                mappingProfileId: profile.id,
                normalizedSourceName: column.normalizedName
              }
            },
            create: {
              mappingProfileId: profile.id,
              sourceName: column.sourceName,
              normalizedSourceName: column.normalizedName,
              targetFieldId: mapping.ignore ? null : mapping.targetFieldId,
              ignored: mapping.ignore === true
            },
            update: {
              sourceName: column.sourceName,
              targetFieldId: mapping.ignore ? null : mapping.targetFieldId,
              ignored: mapping.ignore === true
            }
          });
        }
      }

      await this.refreshTaskMappingStatus(tx, id);
      await this.auditLogs.write(tx, actor, 'import_task.mappings_saved', 'import_task', id, {
        mappings: dto.mappings.map((mapping) => ({
          columnId: mapping.columnId,
          targetFieldId: mapping.targetFieldId ?? null,
          ignored: mapping.ignore === true,
          targetFieldName: mapping.targetFieldId ? fields.get(mapping.targetFieldId)?.fieldName : undefined
        })),
        savedToProfile: dto.saveToProfile !== false
      }, context);
      await this.ledgerEvents.write(tx, actor, 'mapping_rules_saved', 'import_task', id, {
        mappingCount: dto.mappings.length,
        savedToProfile: dto.saveToProfile !== false
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
      strategy: 'valid_rows_only'
    };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > IMPORT_PREVIEW_MAX_RESPONSE_BYTES) {
      throw new PayloadTooLargeException('预览响应超过安全预算，请缩小 pageSize');
    }
    return result;
  }

  async confirm(
    id: string,
    actor: CurrentUser,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    const scope = this.idempotency.prepare(
      actor.id,
      'POST',
      '/api/import-tasks/:id/confirm',
      idempotencyKey,
      { importTaskId: id },
      false
    );
    let claimedJob: BackgroundConfirmationJob | undefined;
    const result = await this.prisma.$transaction((tx) => this.idempotency.execute(tx, scope, 201, async () => {
      await this.lockTask(tx, id);
      const current = await tx.importTask.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('资源不存在');
      if (current.status === ImportTaskStatus.confirmed) {
        return this.confirmationResponse(await this.findDetailOrThrow(id, tx), true);
      }
      if (current.status === ImportTaskStatus.confirming) {
        return this.confirmationResponse(await this.findDetailOrThrow(id, tx), false);
      }
      const confirmableStatuses: ImportTaskStatus[] = [
        ImportTaskStatus.pending_confirm,
        ImportTaskStatus.confirmation_failed
      ];
      if (!confirmableStatuses.includes(current.status)) {
        throw new ConflictException('仅待确认或确认失败的任务可以确认');
      }

      await acquireProjectWriteLock(tx, current.projectId);
      const template = await this.recordPolicy.getWritableTemplate(
        tx,
        current.projectId,
        current.templateId,
        current.importType
      );
      if (template.version !== current.templateVersion) {
        throw new ConflictException('导入任务引用的模板版本已变化，请重新创建任务');
      }
      const [columnCount, decisionCount, totalRows, processedRows, successRows, errorRows] = await Promise.all([
        tx.importColumn.count({ where: { importTaskId: id } }),
        tx.mappingDecision.count({ where: { importTaskId: id } }),
        tx.importRow.count({ where: { importTaskId: id } }),
        tx.importRow.count({ where: { importTaskId: id, confirmationProcessedAt: { not: null } } }),
        tx.businessRecord.count({ where: { importTaskId: id } }),
        tx.importRow.count({
          where: { importTaskId: id, confirmationProcessedAt: { not: null }, status: ImportRowStatus.error }
        })
      ]);
      if (columnCount === 0 || decisionCount !== columnCount) {
        throw new ConflictException('所有未知列必须先映射或明确忽略');
      }
      if (totalRows === 0) throw new UnprocessableEntityException('没有可导入的数据行');

      const attempt = current.confirmationAttempts + 1;
      const leaseToken = randomUUID();
      const now = new Date();
      await tx.importTask.update({
        where: { id },
        data: {
          status: ImportTaskStatus.confirming,
          leaseToken,
          leaseUntil: new Date(now.getTime() + this.confirmationLeaseMs),
          confirmRequestedBy: actor.id,
          confirmationTotalRows: totalRows,
          confirmationProcessedRows: processedRows,
          confirmationSuccessRows: successRows,
          confirmationErrorRows: errorRows,
          confirmationAttempts: attempt,
          confirmationStartedAt: current.confirmationStartedAt ?? now,
          importedRows: successRows,
          errorMessage: null,
          version: { increment: 1 }
        }
      });
      await this.auditLogs.write(tx, actor, 'import_task.confirm_scheduled', 'import_task', id, {
        attempt,
        totalRows,
        processedRows,
        batchSize: this.confirmationBatchSize
      }, context);
      await this.ledgerEvents.write(
        tx,
        actor,
        'import_task_confirmation_scheduled',
        'import_task',
        id,
        { attempt, totalRows, processedRows, batchSize: this.confirmationBatchSize },
        `import_task:${id}:confirm_attempt:${attempt}:scheduled`
      );
      claimedJob = { taskId: id, leaseToken, actor, context, attempt };
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
      const actor = this.toCurrentUser(requestedUser ?? task.uploader);
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
          importedRows: successRows,
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
      return { taskId: id, leaseToken, actor, context, attempt };
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
        await this.completeBackgroundConfirmation(job);
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
      const now = new Date();
      const snapshotTime = task.confirmationStartedAt ?? now;
      const recordData: Prisma.BusinessRecordCreateManyInput[] = [];
      const valueData: Prisma.RecordValueCreateManyInput[] = [];
      const ledgerData: Prisma.LedgerEventCreateManyInput[] = [];
      const recordIdByRow = new Map<string, string>();

      for (const row of preview.rows) {
        if (row.status !== ImportRowStatus.mapped || row.errors.length > 0 || !row.recordDate || row.amount === undefined) {
          continue;
        }
        const policyValues = row.values.map((value) => ({ fieldId: value.fieldId, value: value.value }));
        const canonical = this.recordPolicy.resolveCanonicalValues(task.template, policyValues, { requireValues: true });
        this.recordPolicy.assertTopLevelMatches(canonical, {
          amount: row.amount,
          recordDate: row.recordDate,
          category: row.category
        });
        const recordId = this.deterministicImportRecordId(row.id);
        recordIdByRow.set(row.id, recordId);
        recordData.push({
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
            rawFileSha256: task.rawFile.sha256
          }),
          confirmationSnapshot: this.recordPolicy.toConfirmationSnapshot(task.template, canonical, policyValues, {
            projectId: task.projectId,
            sourceType: RecordSourceType.excel,
            sourceId: row.id,
            confirmedAt: snapshotTime,
            confirmedBy: job.actor.username,
            attachments: [task.rawFileId]
          }),
          recordType: task.template.recordType,
          accountingDirection: canonical.accountingDirection,
          dataLayer: task.template.dataLayer,
          recordDate: canonical.recordDate,
          amount: canonical.amount,
          category: canonical.category,
          subCategory: row.subCategory,
          description: `${task.fileName} 第${row.rowNumber}行导入记录`,
          sourceType: RecordSourceType.excel,
          sourceId: row.id,
          importTaskId: job.taskId,
          status: BusinessRecordStatus.pending_confirm,
          attachments: [task.rawFileId],
          createdBy: job.actor.username
        });
        valueData.push(...row.values.map((value) => this.buildRecordValueData(
          recordId,
          value,
          task.template.templateFields
        )));
        ledgerData.push({
          eventType: 'business_record_created',
          aggregateType: 'business_record',
          aggregateId: recordId,
          actorUserId: job.actor.id,
          actorUsername: job.actor.username,
          idempotencyKey: `import_row:${row.id}:business_record_created`,
          payload: {
            sourceType: RecordSourceType.excel,
            importTaskId: job.taskId,
            importRowId: row.id,
            rawFileId: task.rawFileId,
            accountingDirection: task.template.accountingDirection,
            amount: row.amount
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
      await this.persistConfirmationRows(tx, job.taskId, preview.rows, recordIdByRow, now);

      const [processedRows, successRows, errorRows] = await Promise.all([
        tx.importRow.count({ where: { importTaskId: job.taskId, confirmationProcessedAt: { not: null } } }),
        tx.businessRecord.count({ where: { importTaskId: job.taskId } }),
        tx.importRow.count({
          where: {
            importTaskId: job.taskId,
            confirmationProcessedAt: { not: null },
            status: ImportRowStatus.error
          }
        })
      ]);
      await tx.importTask.update({
        where: { id: job.taskId },
        data: {
          confirmationProcessedRows: processedRows,
          confirmationSuccessRows: successRows,
          confirmationErrorRows: errorRows,
          importedRows: successRows,
          leaseUntil: new Date(Date.now() + this.confirmationLeaseMs)
        }
      });
      return true;
    });
  }

  private async completeBackgroundConfirmation(job: BackgroundConfirmationJob) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, job.taskId);
      await this.assertOwnedConfirmation(tx, job.taskId, job.leaseToken);
      const [totalRows, processedRows, successRows, errorRows, duplicateRows, ignoredRows] = await Promise.all([
        tx.importRow.count({ where: { importTaskId: job.taskId } }),
        tx.importRow.count({ where: { importTaskId: job.taskId, confirmationProcessedAt: { not: null } } }),
        tx.businessRecord.count({ where: { importTaskId: job.taskId } }),
        tx.importRow.count({ where: { importTaskId: job.taskId, status: ImportRowStatus.error } }),
        tx.importRow.count({ where: { importTaskId: job.taskId, status: ImportRowStatus.duplicate } }),
        tx.importRow.count({ where: { importTaskId: job.taskId, status: ImportRowStatus.ignored } })
      ]);
      if (processedRows !== totalRows) throw new Error('确认进度与数据库事实不一致');
      if (successRows === 0) {
        const reason = '没有可导入的合法行';
        await tx.importTask.update({
          where: { id: job.taskId },
          data: {
            status: ImportTaskStatus.confirmation_failed,
            leaseToken: null,
            leaseUntil: null,
            confirmationTotalRows: totalRows,
            confirmationProcessedRows: processedRows,
            confirmationSuccessRows: 0,
            confirmationErrorRows: errorRows,
            importedRows: 0,
            validRows: 0,
            errorRows,
            duplicateRows,
            ignoredRows,
            errorMessage: reason,
            version: { increment: 1 }
          }
        });
        await this.auditLogs.write(tx, job.actor, 'import_task.confirm_failed', 'import_task', job.taskId, {
          attempt: job.attempt,
          reason,
          totalRows,
          errorRows,
          duplicateRows,
          ignoredRows
        }, job.context);
        await this.ledgerEvents.write(
          tx,
          job.actor,
          'import_task_confirmation_failed',
          'import_task',
          job.taskId,
          { attempt: job.attempt, reason, totalRows, errorRows, duplicateRows, ignoredRows },
          `import_task:${job.taskId}:confirm_attempt:${job.attempt}:failed`
        );
        return;
      }

      const now = new Date();
      await tx.$executeRaw`
        UPDATE business_records
        SET status = ${BusinessRecordStatus.confirmed}::"BusinessRecordStatus",
            confirmed_at = ${now},
            confirmed_by = ${job.actor.username},
            confirmation_snapshot = COALESCE(confirmation_snapshot, '{}'::jsonb)
              || jsonb_build_object('confirmedAt', ${now.toISOString()}, 'confirmedBy', ${job.actor.username}),
            updated_at = ${now}
        WHERE import_task_id = ${job.taskId}
          AND status = ${BusinessRecordStatus.pending_confirm}::"BusinessRecordStatus"
      `;
      await tx.importRow.updateMany({
        where: { importTaskId: job.taskId, generatedRecordId: { not: null } },
        data: { status: ImportRowStatus.confirmed, confirmedAt: now }
      });
      const summary = { importedRows: successRows, errorRows, duplicateRows, ignoredRows };
      await tx.importTask.update({
        where: { id: job.taskId },
        data: {
          status: ImportTaskStatus.confirmed,
          leaseToken: null,
          leaseUntil: null,
          confirmedAt: now,
          confirmedBy: job.actor.id,
          confirmationTotalRows: totalRows,
          confirmationProcessedRows: processedRows,
          confirmationSuccessRows: successRows,
          confirmationErrorRows: errorRows,
          importedRows: successRows,
          validRows: successRows,
          errorRows,
          duplicateRows,
          ignoredRows,
          errorMessage: errorRows > 0 ? `${errorRows} 行校验失败，已保留未入库` : null,
          version: { increment: 1 }
        }
      });
      await this.auditLogs.write(tx, job.actor, 'import_task.confirm', 'import_task', job.taskId, summary, job.context);
      await this.auditLogs.write(
        tx,
        job.actor,
        'import_task.confirm_completed',
        'import_task',
        job.taskId,
        { attempt: job.attempt, totalRows, ...summary },
        job.context
      );
      await this.ledgerEvents.write(
        tx,
        job.actor,
        'import_task_confirmed',
        'import_task',
        job.taskId,
        { attempt: job.attempt, totalRows, ...summary },
        `import_task:${job.taskId}:confirmed`
      );
    }, { maxWait: 10_000, timeout: 60_000 });
  }

  private async persistConfirmationRows(
    tx: Prisma.TransactionClient,
    taskId: string,
    rows: PreviewRow[],
    recordIdByRow: Map<string, string>,
    processedAt: Date
  ) {
    const updates = rows.map((row) => Prisma.sql`(
      ${row.id}::text,
      ${JSON.stringify(row.normalizedData)}::jsonb,
      ${row.status}::"ImportRowStatus",
      ${JSON.stringify(row.errors)}::jsonb,
      ${JSON.stringify(row.warnings)}::jsonb,
      ${recordIdByRow.get(row.id) ?? row.generatedRecordId ?? null}::text
    )`);
    await tx.$executeRaw(Prisma.sql`
      UPDATE import_rows AS target
      SET normalized_data_json = source.normalized_data,
          status = source.status,
          errors = source.errors,
          warnings = source.warnings,
          generated_record_id = source.generated_record_id,
          confirmation_processed_at = ${processedAt}
      FROM (VALUES ${Prisma.join(updates)})
        AS source(id, normalized_data, status, errors, warnings, generated_record_id)
      WHERE target.id = source.id
        AND target.import_task_id = ${taskId}
        AND target.confirmation_processed_at IS NULL
    `);
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
      await this.resolveSuggestion(tx, suggestion, field, FieldSuggestionStatus.approved, actor, templateId);
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
      await this.resolveSuggestion(tx, suggestion, field, FieldSuggestionStatus.mapped_to_existing, actor, templateId);
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
      await this.saveProfileRule(tx, suggestion.templateId, suggestion.importColumn.normalizedName, suggestion.sourceName, null, true, actor);
      await this.refreshTaskMappingStatus(tx, suggestion.importTaskId);
      await this.auditLogs.write(tx, actor, 'field_suggestion.reject', 'field_suggestion', id, {}, context);
      await this.ledgerEvents.write(tx, actor, 'field_suggestion_rejected', 'field_suggestion', id, {});
    });
    return toFieldSuggestion(await this.findSuggestionOrThrow(this.prisma, id));
  }

  private async applyAutomaticMappings(
    tx: Prisma.TransactionClient,
    task: { id: string; templateId: string; projectId: string },
    columns: Array<{
      id: string;
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
    const profiles = await tx.mappingProfile.findMany({
      where: { templateId: task.templateId, isActive: true },
      include: { rules: true },
      orderBy: { updatedAt: 'desc' }
    });
    const profileRules = new Map<string, (typeof profiles)[number]['rules'][number]>();
    for (const profile of profiles) {
      for (const rule of profile.rules) if (!profileRules.has(rule.normalizedSourceName)) profileRules.set(rule.normalizedSourceName, rule);
    }
    const existing = await tx.mappingDecision.findMany({ where: { importTaskId: task.id } });
    const existingByColumn = new Map(existing.map((decision) => [decision.importColumnId, decision]));
    const usedFieldIds = new Set(existing.flatMap((decision) => decision.targetFieldId ? [decision.targetFieldId] : []));
    const validFieldIds = new Set(fields.map((field) => field.id));

    for (const column of columns) {
      if (existingByColumn.has(column.id)) continue;
      let match: { field?: FieldDefinition; type: MappingDecisionType; confidence: number; ignored?: boolean } | undefined;
      const profileRule = profileRules.get(column.normalizedName);
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
            confirmedBy: match.type === MappingDecisionType.profile ? actor.id : undefined
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
      const parserErrors = this.stringArray(row.errors);
      const warnings = this.stringArray(row.warnings);
      const rawData = this.jsonObject(row.rawData);
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

      let status = row.status;
      const fixedStatuses: ImportRowStatus[] = [
        ImportRowStatus.ignored,
        ImportRowStatus.duplicate,
        ImportRowStatus.confirmed
      ];
      if (!fixedStatuses.includes(status)) {
        status = errors.length > 0 ? ImportRowStatus.error : ImportRowStatus.mapped;
      }
      if (row.status === ImportRowStatus.ignored || row.status === ImportRowStatus.duplicate) {
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
        warnings,
        generatedRecordId: row.generatedRecordId ?? undefined
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
    actor: CurrentUser,
    templateId = suggestion.templateId
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
    await this.saveProfileRule(
      tx,
      templateId,
      suggestion.importColumn.normalizedName,
      suggestion.sourceName,
      field.id,
      false,
      actor
    );
    await this.refreshTaskMappingStatus(tx, suggestion.importTaskId);
  }

  private async saveProfileRule(
    tx: Prisma.TransactionClient,
    templateId: string,
    normalizedSourceName: string,
    sourceName: string,
    targetFieldId: string | null,
    ignored: boolean,
    actor: CurrentUser
  ) {
    const profile = await this.getOrCreateReviewedProfile(tx, templateId, actor);
    await tx.mappingProfileRule.upsert({
      where: {
        mappingProfileId_normalizedSourceName: {
          mappingProfileId: profile.id,
          normalizedSourceName
        }
      },
      create: { mappingProfileId: profile.id, normalizedSourceName, sourceName, targetFieldId, ignored },
      update: { sourceName, targetFieldId, ignored }
    });
  }

  private async getOrCreateReviewedProfile(tx: Prisma.TransactionClient, templateId: string, actor: CurrentUser) {
    return tx.mappingProfile.upsert({
      where: { templateId_name: { templateId, name: '财务人工确认' } },
      create: { templateId, name: '财务人工确认', reviewedBy: actor.id },
      update: { isActive: true, reviewedBy: actor.id }
    });
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

  private async refreshTaskMappingStatus(tx: Prisma.TransactionClient, id: string) {
    const [columns, decisions] = await Promise.all([
      tx.importColumn.count({ where: { importTaskId: id } }),
      tx.mappingDecision.count({ where: { importTaskId: id } })
    ]);
    await tx.importTask.update({
      where: { id },
      data: {
        status: columns > 0 && columns === decisions ? ImportTaskStatus.pending_confirm : ImportTaskStatus.mapping,
        version: { increment: 1 }
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
      select: { id: true, templateId: true, projectId: true, status: true, leaseToken: true }
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
      status: row.status as ImportRowStatus,
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
    return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code);
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
      generatedRecordId: row.generatedRecordId
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

}
