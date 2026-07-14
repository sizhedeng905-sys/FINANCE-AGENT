import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessRecordStatus,
  DataRecordType,
  FieldDefinition,
  FieldType,
  Prisma,
  ProjectStatus,
  RecordSourceType
} from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { toBusinessRecord } from '../data-center/data-center.presenter';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRecordDto } from './dto/create-record.dto';
import { QueryRecordsDto } from './dto/query-records.dto';
import { RecordValueInputDto } from './dto/record-value-input.dto';
import { UpdateRecordDto } from './dto/update-record.dto';

type PrismaWriter = Prisma.TransactionClient | PrismaService;
type TemplateFieldRule = {
  field: FieldDefinition;
  isRequired: boolean;
  isVisible: boolean;
  defaultValue: string | null;
};

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly ledgerEvents: LedgerEventsService
  ) {}

  async findMany(query: QueryRecordsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(query);

    const [items, total] = await Promise.all([
      this.prisma.businessRecord.findMany({
        where,
        include: this.recordInclude(),
        orderBy: {
          createdAt: 'desc'
        },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.businessRecord.count({ where })
    ]);

    return {
      items: items.map(toBusinessRecord),
      page,
      pageSize,
      total
    };
  }

  async findProjectRecords(projectId: string, query: QueryRecordsDto) {
    return this.findMany({
      ...query,
      projectId
    });
  }

  async findOne(id: string) {
    return toBusinessRecord(await this.findRecordOrThrow(id));
  }

  async create(dto: CreateRecordDto, actor: CurrentUser, context: RequestContext) {
    if (dto.sourceType && dto.sourceType !== RecordSourceType.manual) {
      throw new BadRequestException('手工补录只允许 manual 来源');
    }

    if (dto.sourceId && dto.sourceId !== 'manual') {
      throw new BadRequestException('手工补录的 sourceId 只能是 manual');
    }

    if (dto.status === BusinessRecordStatus.confirmed || dto.status === BusinessRecordStatus.rejected) {
      throw new BadRequestException('新建记录不能直接进入已确认或已作废状态');
    }

    return this.prisma.$transaction(async (tx) => {
      const status = dto.status ?? BusinessRecordStatus.pending_confirm;
      const templateFields = await this.validateProjectTemplateAndValues(
        tx,
        dto.projectId,
        dto.templateId,
        dto.recordType,
        dto.values,
        status !== BusinessRecordStatus.draft
      );
      const values = this.applyTemplateDefaults(dto.values, templateFields);
      const attachmentIds = this.resolveAttachmentIds(dto.attachments, values, templateFields);
      await this.validateRecordAttachments(tx, attachmentIds, dto.projectId);

      const record = await tx.businessRecord.create({
        data: {
          projectId: dto.projectId,
          templateId: dto.templateId,
          recordType: dto.recordType,
          recordDate: this.parseDateOnly(dto.recordDate, 'recordDate'),
          amount: this.toAmountDecimal(dto.amount),
          category: dto.category,
          subCategory: dto.subCategory,
          description: dto.description,
          sourceType: RecordSourceType.manual,
          sourceId: 'manual',
          status,
          attachments: attachmentIds,
          createdBy: actor.username,
          values: {
            create: values.map((value) => this.buildRecordValueCreate(value, templateFields.get(value.fieldId)!.field))
          }
        },
        include: this.recordInclude()
      });

      const presented = toBusinessRecord(record);
      await this.auditLogs.write(
        tx,
        actor,
        'business_record.create',
        'business_record',
        record.id,
        { after: presented },
        context
      );
      await this.ledgerEvents.write(
        tx,
        actor,
        'business_record_created',
        'business_record',
        record.id,
        {
          record: presented,
          sourceType: RecordSourceType.manual
        }
      );

      return presented;
    });
  }

  async update(id: string, dto: UpdateRecordDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findRecordOrThrow(id, tx);
      if (before.status === BusinessRecordStatus.confirmed || before.status === BusinessRecordStatus.rejected) {
        throw new ConflictException('已确认或已作废记录不能直接修改');
      }
      await this.ensureProjectWritable(before.projectId, tx);
      if (Object.keys(dto).length === 0) throw new BadRequestException('至少提供一个可修改字段');

      const templateFields = dto.values
        ? await this.validateProjectTemplateAndValues(
            tx,
            before.projectId,
            before.templateId,
            before.recordType,
            dto.values,
            before.status === BusinessRecordStatus.pending_confirm
          )
        : undefined;
      const values = dto.values && templateFields ? this.applyTemplateDefaults(dto.values, templateFields) : undefined;
      const attachmentIds = dto.attachments !== undefined || (values && templateFields)
        ? this.resolveAttachmentIds(
            dto.attachments ?? this.toStringArray(before.attachments),
            values ?? [],
            templateFields ?? new Map()
          )
        : undefined;
      if (attachmentIds) await this.validateRecordAttachments(tx, attachmentIds, before.projectId);

      await tx.businessRecord.update({
        where: {
          id
        },
        data: {
          recordDate: dto.recordDate ? this.parseDateOnly(dto.recordDate, 'recordDate') : undefined,
          amount: dto.amount !== undefined ? this.toAmountDecimal(dto.amount) : undefined,
          category: dto.category,
          subCategory: dto.subCategory,
          description: dto.description,
          attachments: attachmentIds
        }
      });

      if (values && templateFields) {
        await tx.recordValue.deleteMany({
          where: {
            recordId: id
          }
        });

        for (const value of values) {
          await tx.recordValue.create({
            data: {
              recordId: id,
              ...this.buildRecordValueCreate(value, templateFields.get(value.fieldId)!.field)
            }
          });
        }
      }

      const after = await this.findRecordOrThrow(id, tx);
      await this.auditLogs.write(
        tx,
        actor,
        'business_record.update',
        'business_record',
        id,
        { before: toBusinessRecord(before), after: toBusinessRecord(after) },
        context
      );

      return toBusinessRecord(after);
    });
  }

  async void(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findRecordOrThrow(id, tx);
      if (before.status === BusinessRecordStatus.rejected) {
        return { id, status: before.status };
      }
      await this.ensureProjectWritable(before.projectId, tx);
      const record = await tx.businessRecord.update({
        where: {
          id
        },
        data: {
          status: BusinessRecordStatus.rejected,
          voidedAt: new Date(),
          voidedBy: actor.username
        },
        include: this.recordInclude()
      });

      await this.auditLogs.write(
        tx,
        actor,
        'business_record.void',
        'business_record',
        id,
        { before: toBusinessRecord(before), after: toBusinessRecord(record) },
        context
      );
      await this.ledgerEvents.write(tx, actor, 'business_record_voided', 'business_record', id, {
        status: record.status
      });

      return {
        id,
        status: record.status
      };
    });
  }

  async confirm(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findRecordOrThrow(id, tx);
      if (before.status === BusinessRecordStatus.confirmed) {
        return toBusinessRecord(before);
      }
      if (before.status === BusinessRecordStatus.rejected) {
        throw new ConflictException('已作废记录不能确认');
      }
      const templateFields = await this.validateProjectTemplateAndValues(
        tx,
        before.projectId,
        before.templateId,
        before.recordType,
        this.toRecordValueInputs(before.values),
        true
      );
      const attachmentIds = this.resolveAttachmentIds(
        this.toStringArray(before.attachments),
        this.toRecordValueInputs(before.values),
        templateFields
      );
      await this.validateRecordAttachments(tx, attachmentIds, before.projectId);

      const record = await tx.businessRecord.update({
        where: {
          id
        },
        data: {
          status: BusinessRecordStatus.confirmed,
          confirmedAt: new Date(),
          confirmedBy: actor.username
        },
        include: this.recordInclude()
      });

      await this.auditLogs.write(
        tx,
        actor,
        'business_record.confirm',
        'business_record',
        id,
        { before: toBusinessRecord(before), after: toBusinessRecord(record) },
        context
      );
      await this.ledgerEvents.write(tx, actor, 'business_record_confirmed', 'business_record', id, {
        status: record.status
      });

      return toBusinessRecord(record);
    });
  }

  private buildWhere(query: QueryRecordsDto): Prisma.BusinessRecordWhereInput {
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
    const dateTo = query.dateTo ? this.toInclusiveDateTo(query.dateTo) : undefined;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new BadRequestException('开始日期不能晚于结束日期');
    }
    return {
      projectId: query.projectId,
      templateId: query.templateId,
      importTaskId: query.importTaskId,
      recordType: query.recordType,
      sourceType: query.sourceType,
      status: query.status,
      recordDate: dateFrom || dateTo ? { gte: dateFrom, lte: dateTo } : undefined
    };
  }

  private async validateProjectTemplateAndValues(
    prisma: PrismaWriter,
    projectId: string,
    templateId: string,
    recordType: DataRecordType,
    values: RecordValueInputDto[],
    enforceRequired = false
  ) {
    const [project, projectTemplate, template] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.projectTemplate.findUnique({
        where: {
          projectId_templateId: {
            projectId,
            templateId
          }
        }
      }),
      prisma.template.findUnique({
        where: {
          id: templateId
        },
        include: {
          templateFields: {
            include: {
              field: true
            }
          }
        }
      })
    ]);

    if (!project) {
      throw new NotFoundException('项目不存在');
    }

    if (project.status !== ProjectStatus.active) {
      throw new ConflictException('归档项目不能写入业务记录');
    }

    if (!template || !projectTemplate || !projectTemplate.isActive) {
      throw new BadRequestException('模板未被该项目启用');
    }

    if (template.recordType !== recordType) {
      throw new BadRequestException('记录类型与模板类型不一致');
    }

    const templateFieldMap = new Map<string, TemplateFieldRule>(
      template.templateFields.map((templateField) => [
        templateField.fieldId,
        {
          field: templateField.field,
          isRequired: templateField.isRequired,
          isVisible: templateField.isVisible,
          defaultValue: templateField.defaultValue
        }
      ])
    );
    const seen = new Set<string>();

    for (const value of values) {
      if (seen.has(value.fieldId)) {
        throw new BadRequestException('字段值不能重复提交');
      }

      seen.add(value.fieldId);
      if (!templateFieldMap.has(value.fieldId)) {
        throw new BadRequestException('字段不属于该模板');
      }
    }

    if (enforceRequired) {
      const valuesByField = new Map(values.map((value) => [value.fieldId, value.value]));
      for (const [fieldId, rule] of templateFieldMap) {
        if (!rule.isRequired) continue;
        const submittedValue = valuesByField.get(fieldId);
        if (!this.hasValue(submittedValue) && !this.hasValue(rule.defaultValue)) {
          throw new BadRequestException(`${rule.field.fieldName} 为必填字段`);
        }
      }
    }

    return templateFieldMap;
  }

  private buildRecordValueCreate(value: RecordValueInputDto, field: FieldDefinition) {
    const base = {
      fieldId: value.fieldId,
      fieldName: field.fieldName
    };

    if (value.value === null || value.value === undefined || value.value === '') {
      return base;
    }

    if (field.fieldType === FieldType.number || field.fieldType === FieldType.money) {
      if (typeof value.value !== 'number' && typeof value.value !== 'string') {
        throw new BadRequestException(`${field.fieldName} 必须是数字`);
      }

      const numericText = String(value.value).trim();
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(numericText)) {
        throw new BadRequestException(`${field.fieldName} 必须是数字`);
      }

      let numericValue: Prisma.Decimal;
      try {
        numericValue = new Prisma.Decimal(numericText);
      } catch {
        throw new BadRequestException(`${field.fieldName} 必须是数字`);
      }
      if (numericValue.decimalPlaces() > 4 || numericValue.abs().greaterThan('99999999999999.9999')) {
        throw new BadRequestException(`${field.fieldName} 超出允许的数值范围或精度`);
      }

      return {
        ...base,
        valueNumber: numericValue
      };
    }

    if (field.fieldType === FieldType.date) {
      return {
        ...base,
        valueDate: this.parseDateOnly(String(value.value), field.fieldName)
      };
    }

    if (field.fieldType === FieldType.file) {
      if (!Array.isArray(value.value) && typeof value.value !== 'string') {
        throw new BadRequestException(`${field.fieldName} 的文件值格式不正确`);
      }
      const jsonValue = (Array.isArray(value.value) ? value.value : [value.value]).map((item) =>
        typeof item === 'string' ? item.trim() : item
      );
      if (
        jsonValue.length > 20 ||
        jsonValue.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 64) ||
        new Set(jsonValue).size !== jsonValue.length
      ) {
        throw new BadRequestException(`${field.fieldName} 的文件值格式不正确`);
      }
      return {
        ...base,
        valueJson: jsonValue
      };
    }

    if (typeof value.value !== 'string') {
      throw new BadRequestException(`${field.fieldName} 必须是文本`);
    }
    const maxLength = field.fieldType === FieldType.textarea ? 5000 : 500;
    if (value.value.length > maxLength) {
      throw new BadRequestException(`${field.fieldName} 不能超过 ${maxLength} 个字符`);
    }

    return {
      ...base,
      valueText: String(value.value)
    };
  }

  private applyTemplateDefaults(values: RecordValueInputDto[], templateFields: Map<string, TemplateFieldRule>) {
    const result = values.map((value) => {
      const defaultValue = templateFields.get(value.fieldId)?.defaultValue;
      return !this.hasValue(value.value) && this.hasValue(defaultValue)
        ? { fieldId: value.fieldId, value: defaultValue }
        : value;
    });
    const seen = new Set(result.map((value) => value.fieldId));
    for (const [fieldId, rule] of templateFields) {
      if (!seen.has(fieldId) && this.hasValue(rule.defaultValue)) {
        result.push({ fieldId, value: rule.defaultValue });
      }
    }
    return result;
  }

  private toRecordValueInputs(values: Array<{
    fieldId: string;
    valueText: string | null;
    valueNumber: Prisma.Decimal | null;
    valueDate: Date | null;
    valueJson: Prisma.JsonValue | null;
  }>): RecordValueInputDto[] {
    return values.map((value) => ({
      fieldId: value.fieldId,
      value: value.valueText
        ?? value.valueNumber?.toString()
        ?? value.valueDate?.toISOString().slice(0, 10)
        ?? value.valueJson
        ?? null
    }));
  }

  private resolveAttachmentIds(
    submittedAttachments: string[] | undefined,
    values: RecordValueInputDto[],
    templateFields: Map<string, TemplateFieldRule>
  ) {
    const attachmentIds = [...(submittedAttachments ?? [])];
    for (const value of values) {
      if (templateFields.get(value.fieldId)?.field.fieldType !== FieldType.file || !this.hasValue(value.value)) continue;
      if (!Array.isArray(value.value) && typeof value.value !== 'string') {
        throw new BadRequestException('文件字段格式不正确');
      }
      attachmentIds.push(...((Array.isArray(value.value) ? value.value : [value.value]) as string[]));
    }
    const normalized = attachmentIds.map((id) => id.trim());
    const unique = [...new Set(normalized)];
    if (unique.length > 20 || unique.some((id) => !id || id.length > 64)) {
      throw new BadRequestException('业务记录最多关联 20 个有效附件');
    }
    return unique;
  }

  private async validateRecordAttachments(prisma: PrismaWriter, attachmentIds: string[], projectId: string) {
    if (!attachmentIds.length) return;
    const files = await prisma.rawFile.findMany({
      where: { id: { in: attachmentIds }, isVoided: false }
    });
    if (files.length !== attachmentIds.length) {
      throw new BadRequestException('附件不存在或已作废');
    }
    if (files.some((file) => file.relatedProjectId !== projectId || file.relatedWorkOrderId !== null)) {
      throw new BadRequestException('附件不属于当前项目或已关联工单');
    }
  }

  private toStringArray(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private hasValue(value: unknown) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  private parseDateOnly(value: string, fieldName: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${fieldName} 必须是 YYYY-MM-DD 格式`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${fieldName} 必须是有效日期`);
    }
    return date;
  }

  private toAmountDecimal(value: number) {
    const amount = new Prisma.Decimal(String(value));
    if (amount.decimalPlaces() > 2 || amount.abs().greaterThan('9999999999999999.99')) {
      throw new BadRequestException('amount 超出允许的数值范围或精度');
    }
    return amount;
  }

  private async findRecordOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const record = await prisma.businessRecord.findUnique({
      where: {
        id
      },
      include: this.recordInclude()
    });

    if (!record) {
      throw new NotFoundException('资源不存在');
    }

    return record;
  }

  private async ensureProjectWritable(projectId: string, prisma: PrismaWriter) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.status !== ProjectStatus.active) {
      throw new ConflictException('归档项目不能写入业务记录');
    }
  }

  private toInclusiveDateTo(input: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      return new Date(`${input}T23:59:59.999Z`);
    }
    return new Date(input);
  }

  private recordInclude() {
    return {
      project: true,
      template: true,
      values: {
        include: {
          field: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      }
    } as const;
  }
}
