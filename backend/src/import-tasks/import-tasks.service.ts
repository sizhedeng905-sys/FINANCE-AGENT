import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from '@nestjs/common';
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
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { FilesService } from '../files/files.service';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecordPolicyService } from '../record-policy/record-policy.service';
import { ApproveFieldSuggestionDto, MapFieldSuggestionDto, QueryFieldSuggestionsDto } from './dto/field-suggestion.dto';
import { CreateImportTaskDto } from './dto/create-import-task.dto';
import { QueryImportRowsDto } from './dto/query-import-rows.dto';
import { QueryImportTasksDto } from './dto/query-import-tasks.dto';
import { MappingInputDto, SaveMappingsDto } from './dto/save-mappings.dto';
import { ExcelParserService } from './excel-parser.service';
import {
  importTaskDetailInclude,
  ImportTaskDetail,
  toFieldSuggestion,
  toImportRow,
  toImportTask
} from './import.presenter';

type PrismaWriter = Prisma.TransactionClient | PrismaService;

const previewInclude = {
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
  },
  rows: { orderBy: { rowNumber: 'asc' as const } }
} satisfies Prisma.ImportTaskInclude;

type PreviewTask = Prisma.ImportTaskGetPayload<{ include: typeof previewInclude }>;
type PreviewField = FieldDefinition;

interface PreviewValue {
  field: PreviewField;
  value: string | string[];
}

interface PreviewRow {
  id: string;
  rowNumber: number;
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

const AUTOMATIC_MAPPING_TYPES: MappingDecisionType[] = [
  MappingDecisionType.profile,
  MappingDecisionType.field_key,
  MappingDecisionType.exact_name,
  MappingDecisionType.alias,
  MappingDecisionType.normalized,
  MappingDecisionType.fuzzy
];
const IMPORT_PARSE_LEASE_MS = 10 * 60 * 1000;

@Injectable()
export class ImportTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly excelParser: ExcelParserService,
    private readonly auditLogs: AuditLogsService,
    private readonly ledgerEvents: LedgerEventsService,
    private readonly recordPolicy: RecordPolicyService
  ) {}

  async create(
    file: Express.Multer.File | undefined,
    dto: CreateImportTaskDto,
    actor: CurrentUser,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    this.validateIdempotencyKey(idempotencyKey);
    if (idempotencyKey) {
      const existing = await this.prisma.importTask.findUnique({ where: { idempotencyKey }, include: importTaskDetailInclude });
      if (existing) return toImportTask(existing);
    }
    if (!file) throw new BadRequestException('请选择 Excel 文件');
    if (extname(file.originalname).toLowerCase() !== '.xlsx') {
      throw new BadRequestException('第一版仅支持 .xlsx 文件');
    }

    const template = await this.recordPolicy.getWritableTemplate(
      this.prisma,
      dto.projectId,
      dto.templateId,
      dto.importType
    );

    const rawFile = await this.files.upload(file, { relatedProjectId: dto.projectId }, actor, context);
    try {
      const taskId = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.projectId}, 22))`;
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
            idempotencyKey
          }
        });
        await this.auditLogs.write(
          tx,
          actor,
          'import_task.create',
          'import_task',
          task.id,
          { projectId: dto.projectId, templateId: dto.templateId, rawFileId: rawFile.id },
          context
        );
        await this.ledgerEvents.write(tx, actor, 'import_task_created', 'import_task', task.id, {
          projectId: dto.projectId,
          templateId: dto.templateId,
          rawFileId: rawFile.id,
          sha256: rawFile.sha256
        });
        return task.id;
      });
      return toImportTask(await this.findDetailOrThrow(taskId));
    } catch (error) {
      await this.files.void(rawFile.id, { reason: '导入任务创建失败，原文件已作废' }, actor, context).catch(() => undefined);
      if (idempotencyKey && this.isUniqueConflict(error)) {
        const existing = await this.prisma.importTask.findUnique({ where: { idempotencyKey }, include: importTaskDetailInclude });
        if (existing) return toImportTask(existing);
      }
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

  async parse(id: string, actor: CurrentUser, context: RequestContext) {
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
      await tx.importTask.update({
        where: { id },
        data: {
          status: ImportTaskStatus.parsing,
          leaseToken,
          leaseUntil: new Date(Date.now() + IMPORT_PARSE_LEASE_MS),
          errorMessage: null,
          version: { increment: 1 }
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'import_task.parse_started',
        'import_task',
        id,
        { leaseToken, previousStatus: task.status },
        context
      );
      return { skipped: false as const, task, leaseToken };
    });
    if (prepared.skipped) return toImportTask(prepared.task);

    let parsed;
    try {
      const file = await this.files.readForProcessing(prepared.task.rawFileId, actor);
      parsed = await this.excelParser.parse(file.buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Excel 解析失败';
      await this.prisma.$transaction(async (tx) => {
        await this.lockTask(tx, id);
        const updated = await tx.importTask.updateMany({
          where: { id, status: ImportTaskStatus.parsing, leaseToken: prepared.leaseToken },
          data: {
            status: ImportTaskStatus.failed,
            errorMessage: message,
            leaseToken: null,
            leaseUntil: null,
            version: { increment: 1 }
          }
        });
        if (updated.count === 1) {
          await tx.rawFile.update({ where: { id: prepared.task.rawFileId }, data: { status: RawFileStatus.failed } });
          await this.auditLogs.write(
            tx,
            actor,
            'import_task.parse_failed',
            'import_task',
            id,
            { error: message },
            context
          );
        }
      });
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
        data: { importTaskId: id, ...parsed.sheet }
      });
      const columns = [];
      for (const column of parsed.columns) {
        columns.push(await tx.importColumn.create({
          data: {
            importTaskId: id,
            sheetId: sheet.id,
            columnIndex: column.columnIndex,
            sourceKey: column.sourceKey,
            sourceName: column.sourceName,
            normalizedName: column.normalizedName,
            sampleValues: column.sampleValues,
            inferredType: column.inferredType,
            duplicateName: column.duplicateName
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
            warnings: row.warnings
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
        sheet: parsed.sheet.sheetName,
        columns: columns.length,
        rows: parsed.rows.length,
        ...counts
      }, context);
      await this.ledgerEvents.write(tx, actor, 'import_task_parsed', 'import_task', id, {
        rawFileId: current.rawFileId,
        rowCount: parsed.rows.length,
        columnCount: columns.length
      });
    });

    return toImportTask(await this.findDetailOrThrow(id));
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
        where: { templateId: task.templateId, fieldId: { in: targetFieldIds }, field: { isActive: true } },
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

  async preview(id: string) {
    const preview = await this.buildPreview(this.prisma, id);
    return {
      task: toImportTask(await this.findDetailOrThrow(id)),
      unresolvedColumns: preview.unresolvedColumns,
      rows: preview.rows.map((row) => this.presentPreviewRow(row)),
      summary: preview.summary,
      strategy: 'valid_rows_only'
    };
  }

  async confirm(id: string, actor: CurrentUser, context: RequestContext) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const current = await tx.importTask.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('资源不存在');
      if (current.status === ImportTaskStatus.confirmed) {
        const records = await tx.businessRecord.findMany({ where: { importTaskId: id }, select: { id: true } });
        return { alreadyConfirmed: true, recordIds: records.map((record) => record.id) };
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${current.projectId}, 22))`;

      const template = await this.recordPolicy.getWritableTemplate(
        tx,
        current.projectId,
        current.templateId,
        current.importType
      );
      if (template.version !== current.templateVersion) {
        throw new ConflictException('导入任务引用的模板版本已变化，请重新创建任务');
      }

      const preview = await this.buildPreview(tx, id);
      if (preview.unresolvedColumns.length > 0) {
        throw new ConflictException('所有未知列必须先映射或明确忽略');
      }
      const validRows = preview.rows.filter((row) => row.status === ImportRowStatus.mapped && row.errors.length === 0);
      if (validRows.length === 0) throw new UnprocessableEntityException('没有可导入的合法行');

      const recordIds: string[] = [];
      const now = new Date();
      for (const row of preview.rows) {
        if (row.generatedRecordId) {
          recordIds.push(row.generatedRecordId);
          continue;
        }
        if (row.status !== ImportRowStatus.mapped || row.errors.length > 0 || !row.recordDate || row.amount === undefined) {
          await tx.importRow.update({
            where: { id: row.id },
            data: {
              normalizedData: row.normalizedData as Prisma.InputJsonObject,
              status: row.status,
              errors: row.errors,
              warnings: row.warnings
            }
          });
          continue;
        }

        const record = await tx.businessRecord.create({
          data: {
            projectId: preview.task.projectId,
            templateId: preview.task.templateId,
            templateVersion: current.templateVersion,
            recordType: preview.task.template.recordType,
            accountingDirection: template.accountingDirection,
            recordDate: new Date(`${row.recordDate}T00:00:00.000Z`),
            amount: new Prisma.Decimal(row.amount),
            category: template.accountingDirection === 'income' ? '收入' : '成本',
            subCategory: row.subCategory,
            description: `${preview.task.fileName} 第${row.rowNumber}行导入记录`,
            sourceType: RecordSourceType.excel,
            sourceId: row.id,
            importTaskId: id,
            status: BusinessRecordStatus.confirmed,
            attachments: [preview.task.rawFileId],
            createdBy: actor.username,
            confirmedBy: actor.username,
            confirmedAt: now,
            values: {
              create: row.values.map((value) => this.buildRecordValue(value, preview.task.template.templateFields))
            }
          }
        });
        recordIds.push(record.id);
        await tx.importRow.update({
          where: { id: row.id },
          data: {
            normalizedData: row.normalizedData as Prisma.InputJsonObject,
            status: ImportRowStatus.confirmed,
            errors: [],
            warnings: row.warnings,
            generatedRecordId: record.id,
            confirmedAt: now
          }
        });
        await this.ledgerEvents.write(tx, actor, 'business_record_created', 'business_record', record.id, {
          sourceType: RecordSourceType.excel,
          importTaskId: id,
          importRowId: row.id,
          rawFileId: preview.task.rawFileId,
          accountingDirection: template.accountingDirection,
          amount: row.amount
        }, `import_row:${row.id}:business_record_created`);
      }

      const errorRows = preview.rows.filter((row) => row.status === ImportRowStatus.error).length;
      const duplicateRows = preview.rows.filter((row) => row.status === ImportRowStatus.duplicate).length;
      const ignoredRows = preview.rows.filter((row) => row.status === ImportRowStatus.ignored).length;
      await tx.importTask.update({
        where: { id },
        data: {
          status: ImportTaskStatus.confirmed,
          confirmedAt: now,
          confirmedBy: actor.id,
          importedRows: recordIds.length,
          validRows: recordIds.length,
          errorRows,
          duplicateRows,
          ignoredRows,
          errorMessage: errorRows > 0 ? `${errorRows} 行校验失败，已保留未入库` : null
        }
      });
      await this.auditLogs.write(tx, actor, 'import_task.confirm', 'import_task', id, {
        recordIds,
        importedRows: recordIds.length,
        errorRows,
        duplicateRows,
        ignoredRows
      }, context);
      await this.ledgerEvents.write(tx, actor, 'import_task_confirmed', 'import_task', id, {
        recordIds,
        importedRows: recordIds.length,
        errorRows,
        duplicateRows,
        ignoredRows
      });
      return { alreadyConfirmed: false, recordIds };
    });

    const task = await this.findDetailOrThrow(id);
    return {
      task: toImportTask(task),
      recordIds: result.recordIds,
      importedRows: task.importedRows,
      errorRows: task.errorRows,
      duplicateRows: task.duplicateRows,
      ignoredRows: task.ignoredRows,
      alreadyConfirmed: result.alreadyConfirmed
    };
  }

  async cancel(id: string, actor: CurrentUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.importTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('资源不存在');
      if (task.status === ImportTaskStatus.confirmed) throw new ConflictException('已确认任务不能取消');
      if (task.status === ImportTaskStatus.cancelled) return;
      await tx.importTask.update({
        where: { id },
        data: {
          status: ImportTaskStatus.cancelled,
          errorMessage: '用户取消',
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
      where: { templateId: task.templateId, field: { isActive: true } },
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

  private async buildPreview(prisma: PrismaWriter, id: string): Promise<PreviewResult> {
    const task = await prisma.importTask.findUnique({ where: { id }, include: previewInclude });
    if (!task) throw new NotFoundException('资源不存在');
    const unavailableStatuses: ImportTaskStatus[] = [ImportTaskStatus.uploaded, ImportTaskStatus.failed];
    if (unavailableStatuses.includes(task.status)) {
      throw new ConflictException('导入任务尚未成功解析');
    }
    const unresolvedColumns = task.columns
      .filter((column) => !column.decision)
      .map((column) => ({ id: column.id, sourceName: column.sourceName, sourceKey: column.sourceKey }));
    const requiredFields = task.template.templateFields.filter((item) => item.isRequired);
    const mappedFields = task.columns.flatMap((column) => column.decision?.targetField ? [column.decision.targetField] : []);
    const amountField = mappedFields.find((field) => field.id === task.template.primaryAmountFieldId);
    const dateField = mappedFields.find((field) => field.id === task.template.primaryDateFieldId);
    const category = task.template.accountingDirection === 'income' ? '收入' : '成本';
    const rows: PreviewRow[] = task.rows.map((row) => {
      const parserErrors = this.stringArray(row.errors);
      const warnings = this.stringArray(row.warnings);
      const rawData = this.jsonObject(row.rawData);
      const normalizedData: Record<string, string | string[]> = {};
      const values: PreviewValue[] = [];
      const errors = [...parserErrors];

      for (const column of task.columns) {
        const decision = column.decision;
        if (!decision || decision.ignored || !decision.targetField) continue;
        const result = this.normalizeFieldValue(decision.targetField, rawData[column.sourceKey]);
        if (result.error) errors.push(`${column.sourceName}：${result.error}`);
        if (result.value !== undefined) {
          normalizedData[decision.targetField.id] = result.value;
          values.push({ field: decision.targetField, value: result.value });
        }
      }

      for (const required of requiredFields) {
        if (!(required.fieldId in normalizedData) && !required.defaultValue) {
          errors.push(`缺少必填字段：${required.field.fieldName}`);
        }
      }
      if (!task.template.primaryAmountFieldId) errors.push('模板未配置主金额字段');
      else if (!amountField) errors.push('未映射模板主金额字段');
      if (!task.template.primaryDateFieldId) errors.push('模板未配置主日期字段');
      else if (!dateField) errors.push('未映射模板主日期字段');
      const amount = amountField ? normalizedData[amountField.id] : undefined;
      const recordDate = dateField ? normalizedData[dateField.id] : undefined;
      if (amountField && typeof amount !== 'string') errors.push('金额字段为空或格式错误');
      if (dateField && typeof recordDate !== 'string') errors.push('日期字段为空或格式错误');

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
    if (this.isFormulaValue(raw)) return { error: '公式单元格不能直接入库' };
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
        const decimal = new Prisma.Decimal(normalized);
        if (decimal.abs().greaterThan('99999999999999.99')) return { error: '数字超出允许范围' };
        if (decimal.decimalPlaces() > maxDecimals) return { error: `最多允许 ${maxDecimals} 位小数` };
        return { value: decimal.toString() };
      } catch {
        return { error: '数字格式错误' };
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

  private buildRecordValue(
    value: { fieldId: string; fieldName: string; fieldType: FieldType; value: string | string[] },
    templateFields: PreviewTask['template']['templateFields']
  ): Prisma.RecordValueCreateWithoutRecordInput {
    const field = templateFields.find((item) => item.fieldId === value.fieldId)?.field;
    if (!field) throw new BadRequestException('导入字段不属于当前模板');
    const base = { field: { connect: { id: field.id } }, fieldName: field.fieldName };
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
    if (existing) return templateId;

    await this.lockTask(tx, suggestion.importTaskId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${suggestion.projectId}, 22))`;
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
      data: { status: columns > 0 && columns === decisions ? ImportTaskStatus.pending_confirm : ImportTaskStatus.mapping }
    });
  }

  private validateMappingInputs(mappings: MappingInputDto[]) {
    for (const mapping of mappings) {
      const hasField = Boolean(mapping.targetFieldId);
      const ignored = mapping.ignore === true;
      if (hasField === ignored) throw new BadRequestException('每一列必须二选一：映射字段或明确忽略');
    }
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

  private isFormulaValue(value: unknown): value is { formula: string } {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'formula' in value);
  }

  private async findDetailOrThrow(id: string): Promise<ImportTaskDetail> {
    const task = await this.prisma.importTask.findUnique({ where: { id }, include: importTaskDetailInclude });
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
    if (status === ImportTaskStatus.uploaded) throw new ConflictException('请先解析 Excel 文件');
    if (status === ImportTaskStatus.parsing) throw new ConflictException('Excel 任务正在解析中');
    if (status === ImportTaskStatus.failed || status === ImportTaskStatus.cancelled) {
      throw new ConflictException('失败或已取消任务不能修改');
    }
  }

  private async lockTask(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 9))`;
  }

  private validateIdempotencyKey(value?: string) {
    if (value === undefined) return;
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new BadRequestException('Idempotency-Key 格式不合法');
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
