import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessRecordStatus,
  DataRecordType,
  FieldDefinition,
  FieldType,
  FileScanStatus,
  Prisma,
  ProjectStatus,
  RecordSourceType,
  Template,
  TemplateField
} from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { toBusinessRecord } from '../data-center/data-center.presenter';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyValueInput, RecordPolicyService } from '../record-policy/record-policy.service';
import { CreateRecordDto } from './dto/create-record.dto';
import { QueryRecordsDto } from './dto/query-records.dto';
import { RecordValueInputDto } from './dto/record-value-input.dto';
import { UpdateRecordDto } from './dto/update-record.dto';

type PrismaWriter = Prisma.TransactionClient | PrismaService;
type PolicyTemplate = Template & {
  templateFields: Array<TemplateField & { field: FieldDefinition }>;
};
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
    private readonly ledgerEvents: LedgerEventsService,
    private readonly recordPolicy: RecordPolicyService,
    private readonly idempotency: IdempotencyService
  ) {}

  async findMany(query: QueryRecordsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildWhere(query);
    const [items, total] = await Promise.all([
      this.prisma.businessRecord.findMany({
        where,
        include: this.recordInclude(),
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.businessRecord.count({ where })
    ]);
    return { items: items.map(toBusinessRecord), page, pageSize, total };
  }

  async findProjectRecords(projectId: string, query: QueryRecordsDto) {
    return this.findMany({ ...query, projectId });
  }

  async findOne(id: string) {
    return toBusinessRecord(await this.findRecordOrThrow(id));
  }

  async create(
    dto: CreateRecordDto,
    actor: CurrentUser,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    if (dto.sourceType && dto.sourceType !== RecordSourceType.manual) {
      throw new BadRequestException('手工补录只允许 manual 来源');
    }
    if (dto.sourceId && dto.sourceId !== 'manual') {
      throw new BadRequestException('手工补录的 sourceId 只能是 manual');
    }
    if (dto.status === BusinessRecordStatus.confirmed || dto.status === BusinessRecordStatus.rejected) {
      throw new BadRequestException('新建记录不能直接进入已确认或已作废状态');
    }

    const scope = this.idempotency.prepare(
      actor.id,
      'POST',
      '/api/records',
      idempotencyKey,
      this.canonicalCreateRequest(dto),
      false
    );
    return this.prisma.$transaction((tx) => this.idempotency.execute(tx, scope, 201, async () => {
      const status = dto.status ?? BusinessRecordStatus.pending_confirm;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dto.projectId}, 22))`;
      const template = await this.recordPolicy.getWritableTemplate(
        tx,
        dto.projectId,
        dto.templateId,
        dto.recordType
      );
      const templateFields = this.validateValues(template, dto.values, status !== BusinessRecordStatus.draft);
      const values = this.applyTemplateDefaults(dto.values, templateFields);
      const topLevelAmount = this.recordPolicy.parseMoney(dto.amount, 'amount');
      if (topLevelAmount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('金额必须大于 0；冲销请使用显式作废流程');
      }
      let amount = topLevelAmount;
      let recordDate = this.recordPolicy.parseDateOnly(dto.recordDate, 'recordDate');
      let category = template.accountingDirection === 'income' ? '收入' : '成本';
      if (status !== BusinessRecordStatus.draft || this.hasCanonicalValues(template, values)) {
        const canonical = this.recordPolicy.resolveCanonicalValues(template, values, { requireValues: true });
        this.recordPolicy.assertTopLevelMatches(canonical, dto);
        amount = canonical.amount;
        recordDate = canonical.recordDate;
        category = canonical.category;
      } else if (dto.category?.trim() && dto.category.trim() !== category) {
        throw new BadRequestException('收支方向由模板决定，不能通过 category 覆盖');
      }

      const attachmentIds = this.resolveAttachmentIds(dto.attachments, values, templateFields);
      await this.validateRecordAttachments(tx, attachmentIds, dto.projectId, status !== BusinessRecordStatus.draft);
      const record = await tx.businessRecord.create({
        data: {
          projectId: dto.projectId,
          templateId: dto.templateId,
          templateVersion: template.version,
          templateSnapshot: this.recordPolicy.toSnapshot(template),
          sourceSnapshot: this.recordPolicy.toSourceSnapshot(RecordSourceType.manual, 'manual', {
            createdByUserId: actor.id
          }),
          recordType: template.recordType,
          accountingDirection: template.accountingDirection,
          dataLayer: template.dataLayer,
          recordDate,
          amount,
          category,
          subCategory: dto.subCategory,
          description: dto.description,
          sourceType: RecordSourceType.manual,
          sourceId: 'manual',
          status,
          attachments: attachmentIds,
          createdBy: actor.username,
          values: {
            create: values.map((value) =>
              this.buildRecordValueCreate(value, templateFields.get(value.fieldId)!.field)
            )
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
        { record: presented, sourceType: RecordSourceType.manual },
        `business_record:${record.id}:created`
      );
      return presented;
    }));
  }

  async update(id: string, dto: UpdateRecordDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findRecordOrThrow(id, tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${before.projectId}, 22))`;
      if (this.isTerminal(before.status)) throw new ConflictException('终态记录不能直接修改');
      if (Object.keys(dto).length === 0) throw new BadRequestException('至少提供一个可修改字段');
      const template = await this.recordPolicy.getWritableTemplate(
        tx,
        before.projectId,
        before.templateId,
        before.recordType
      );
      let values = dto.values ? [...dto.values] : this.toRecordValueInputs(before.values);
      let rewriteValues = dto.values !== undefined;
      if (!dto.values && dto.amount !== undefined) {
        values = this.replaceCanonicalValue(template, values, 'amount', dto.amount);
        rewriteValues = true;
      }
      if (!dto.values && dto.recordDate !== undefined) {
        values = this.replaceCanonicalValue(template, values, 'date', dto.recordDate);
        rewriteValues = true;
      }
      const templateFields = this.validateValues(
        template,
        values,
        before.status === BusinessRecordStatus.pending_confirm
      );
      values = this.applyTemplateDefaults(values, templateFields);
      let amount = before.amount;
      let recordDate = before.recordDate;
      let category = template.accountingDirection === 'income' ? '收入' : '成本';
      if (before.status === BusinessRecordStatus.pending_confirm || this.hasCanonicalValues(template, values)) {
        const canonical = this.recordPolicy.resolveCanonicalValues(template, values, { requireValues: true });
        this.recordPolicy.assertTopLevelMatches(canonical, dto);
        amount = canonical.amount;
        recordDate = canonical.recordDate;
        category = canonical.category;
      } else if (dto.category?.trim() && dto.category.trim() !== category) {
        throw new BadRequestException('收支方向由模板决定，不能通过 category 覆盖');
      }

      const attachmentIds =
        dto.attachments !== undefined || rewriteValues
          ? this.resolveAttachmentIds(dto.attachments ?? this.toStringArray(before.attachments), values, templateFields)
          : undefined;
      if (attachmentIds) {
        await this.validateRecordAttachments(
          tx,
          attachmentIds,
          before.projectId,
          before.status !== BusinessRecordStatus.draft
        );
      }
      const changed = await tx.businessRecord.updateMany({
        where: { id, status: before.status, version: before.version },
        data: {
          templateVersion: template.version,
          templateSnapshot: this.recordPolicy.toSnapshot(template),
          accountingDirection: template.accountingDirection,
          dataLayer: template.dataLayer,
          recordDate,
          amount,
          category,
          subCategory: dto.subCategory,
          description: dto.description,
          attachments: attachmentIds,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw new ConflictException('记录已被其他请求修改，请刷新后重试');
      if (rewriteValues) {
        await tx.recordValue.deleteMany({ where: { recordId: id } });
        if (values.length) {
          await tx.recordValue.createMany({
            data: values.map((value) => ({
              recordId: id,
              ...this.buildRecordValueCreate(value, templateFields.get(value.fieldId)!.field)
            }))
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${before.projectId}, 22))`;
      if (before.status === BusinessRecordStatus.rejected) return { id, status: before.status };
      await this.ensureProjectWritable(before.projectId, tx);
      const now = new Date();
      const changed = await tx.businessRecord.updateMany({
        where: { id, status: before.status, version: before.version },
        data: {
          status: BusinessRecordStatus.rejected,
          confirmedAt: null,
          confirmedBy: null,
          voidedAt: now,
          voidedBy: actor.username,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) {
        const current = await this.findRecordOrThrow(id, tx);
        if (current.status === BusinessRecordStatus.rejected) return { id, status: current.status };
        throw new ConflictException('记录状态已被其他请求修改');
      }
      const record = await this.findRecordOrThrow(id, tx);
      await this.auditLogs.write(
        tx,
        actor,
        'business_record.void',
        'business_record',
        id,
        { before: toBusinessRecord(before), after: toBusinessRecord(record) },
        context
      );
      await this.ledgerEvents.write(
        tx,
        actor,
        'business_record_voided',
        'business_record',
        id,
        { status: record.status },
        `business_record:${id}:voided`
      );
      return { id, status: record.status };
    });
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
      '/api/records/:id/confirm',
      idempotencyKey,
      { recordId: id },
      false
    );
    return this.prisma.$transaction((tx) => this.idempotency.execute(tx, scope, 201, async () => {
      const before = await this.findRecordOrThrow(id, tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${before.projectId}, 22))`;
      if (before.status === BusinessRecordStatus.confirmed) return toBusinessRecord(before);
      if (before.status === BusinessRecordStatus.rejected) throw new ConflictException('已作废记录不能确认');
      const template = await this.recordPolicy.getWritableTemplate(
        tx,
        before.projectId,
        before.templateId,
        before.recordType
      );
      if (template.version !== before.templateVersion) {
        throw new ConflictException('模板已更新，请重新保存记录后再确认');
      }
      const values = this.toRecordValueInputs(before.values);
      const templateFields = this.validateValues(template, values, true);
      const canonical = this.recordPolicy.resolveCanonicalValues(template, values, { requireValues: true });
      this.recordPolicy.assertTopLevelMatches(canonical, {
        amount: before.amount.toFixed(2),
        recordDate: before.recordDate.toISOString().slice(0, 10),
        category: before.category ?? undefined
      });
      const attachmentIds = this.resolveAttachmentIds(
        this.toStringArray(before.attachments),
        values,
        templateFields
      );
      await this.validateRecordAttachments(tx, attachmentIds, before.projectId, true);
      const now = new Date();
      const changed = await tx.businessRecord.updateMany({
        where: { id, status: before.status, version: before.version },
        data: {
          status: BusinessRecordStatus.confirmed,
          accountingDirection: canonical.accountingDirection,
          amount: canonical.amount,
          recordDate: canonical.recordDate,
          category: canonical.category,
          confirmationSnapshot: this.recordPolicy.toConfirmationSnapshot(template, canonical, values, {
            projectId: before.projectId,
            sourceType: before.sourceType,
            sourceId: before.sourceId,
            confirmedAt: now,
            confirmedBy: actor.username,
            attachments: attachmentIds
          }),
          confirmedAt: now,
          confirmedBy: actor.username,
          voidedAt: null,
          voidedBy: null,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) {
        const current = await this.findRecordOrThrow(id, tx);
        if (current.status === BusinessRecordStatus.confirmed) return toBusinessRecord(current);
        throw new ConflictException('记录状态已被其他请求修改');
      }
      const record = await this.findRecordOrThrow(id, tx);
      await this.auditLogs.write(
        tx,
        actor,
        'business_record.confirm',
        'business_record',
        id,
        { before: toBusinessRecord(before), after: toBusinessRecord(record) },
        context
      );
      await this.ledgerEvents.write(
        tx,
        actor,
        'business_record_confirmed',
        'business_record',
        id,
        { status: record.status },
        `business_record:${id}:confirmed`
      );
      return toBusinessRecord(record);
    }));
  }

  private canonicalCreateRequest(dto: CreateRecordDto) {
    return {
      ...dto,
      attachments: dto.attachments ? [...dto.attachments].sort() : undefined,
      values: [...dto.values].sort((left, right) => left.fieldId.localeCompare(right.fieldId))
    };
  }

  private buildWhere(query: QueryRecordsDto): Prisma.BusinessRecordWhereInput {
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
    const dateTo = query.dateTo ? this.toInclusiveDateTo(query.dateTo) : undefined;
    if (dateFrom && dateTo && dateFrom > dateTo) throw new BadRequestException('开始日期不能晚于结束日期');
    return {
      projectId: query.projectId,
      templateId: query.templateId,
      importTaskId: query.importTaskId,
      recordType: query.recordType,
      sourceType: query.sourceType,
      status: query.status,
      dataLayer: query.dataLayer,
      recordDate: dateFrom || dateTo ? { gte: dateFrom, lte: dateTo } : undefined
    };
  }

  private validateValues(
    template: PolicyTemplate,
    values: RecordValueInputDto[],
    enforceRequired: boolean
  ) {
    const fields = new Map<string, TemplateFieldRule>(
      template.templateFields.map((item) => [
        item.fieldId,
        {
          field: item.field,
          isRequired: item.isRequired,
          isVisible: item.isVisible,
          defaultValue: item.defaultValue
        }
      ])
    );
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value.fieldId)) throw new BadRequestException('字段值不能重复提交');
      seen.add(value.fieldId);
      const rule = fields.get(value.fieldId);
      if (!rule) throw new BadRequestException('字段不属于该模板');
      if (!rule.field.isActive || !rule.isVisible) throw new BadRequestException('停用或隐藏字段不能写入');
    }
    if (enforceRequired) {
      const valuesByField = new Map(values.map((value) => [value.fieldId, value.value]));
      for (const [fieldId, rule] of fields) {
        if (!rule.isRequired) continue;
        if (!this.hasValue(valuesByField.get(fieldId)) && !this.hasValue(rule.defaultValue)) {
          throw new BadRequestException(`${rule.field.fieldName}为必填字段`);
        }
      }
    }
    return fields;
  }

  private buildRecordValueCreate(value: RecordValueInputDto, field: FieldDefinition) {
    const base = { fieldId: value.fieldId, fieldName: field.fieldName };
    if (value.value === null || value.value === undefined || value.value === '') return base;
    if (field.fieldType === FieldType.number || field.fieldType === FieldType.money) {
      return {
        ...base,
        valueNumber: this.recordPolicy.parseNumericValue(
          value.value,
          field.fieldName,
          field.fieldType === FieldType.money ? 2 : 4
        )
      };
    }
    if (field.fieldType === FieldType.date) {
      return { ...base, valueDate: this.recordPolicy.parseDateOnly(String(value.value), field.fieldName) };
    }
    if (field.fieldType === FieldType.file) {
      if (!Array.isArray(value.value) && typeof value.value !== 'string') {
        throw new BadRequestException(`${field.fieldName}的文件值格式不正确`);
      }
      const jsonValue = (Array.isArray(value.value) ? value.value : [value.value]).map((item) =>
        typeof item === 'string' ? item.trim() : item
      );
      if (
        jsonValue.length > 20 ||
        jsonValue.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 64) ||
        new Set(jsonValue).size !== jsonValue.length
      ) {
        throw new BadRequestException(`${field.fieldName}的文件值格式不正确`);
      }
      return { ...base, valueJson: jsonValue };
    }
    if (typeof value.value !== 'string') throw new BadRequestException(`${field.fieldName}必须是文本`);
    const maxLength = field.fieldType === FieldType.textarea ? 5000 : 500;
    if (value.value.length > maxLength) throw new BadRequestException(`${field.fieldName}不能超过 ${maxLength} 个字符`);
    return { ...base, valueText: value.value };
  }

  private applyTemplateDefaults(values: RecordValueInputDto[], fields: Map<string, TemplateFieldRule>) {
    const result = values.map((value) => {
      const defaultValue = fields.get(value.fieldId)?.defaultValue;
      return !this.hasValue(value.value) && this.hasValue(defaultValue)
        ? { fieldId: value.fieldId, value: defaultValue }
        : value;
    });
    const seen = new Set(result.map((value) => value.fieldId));
    for (const [fieldId, rule] of fields) {
      if (!seen.has(fieldId) && this.hasValue(rule.defaultValue)) {
        result.push({ fieldId, value: rule.defaultValue });
      }
    }
    return result;
  }

  private replaceCanonicalValue(
    template: PolicyTemplate,
    values: RecordValueInputDto[],
    kind: 'amount' | 'date',
    value: string
  ) {
    const fieldId = this.recordPolicy.getPrimaryField(template, kind).fieldId;
    const result = values.filter((item) => item.fieldId !== fieldId);
    result.push({ fieldId, value });
    return result;
  }

  private hasCanonicalValues(template: PolicyTemplate, values: PolicyValueInput[]) {
    if (!template.primaryAmountFieldId || !template.primaryDateFieldId) return false;
    const map = new Map(values.map((value) => [value.fieldId, value.value]));
    return this.hasValue(map.get(template.primaryAmountFieldId)) && this.hasValue(map.get(template.primaryDateFieldId));
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
      value:
        value.valueText ??
        value.valueNumber?.toString() ??
        value.valueDate?.toISOString().slice(0, 10) ??
        value.valueJson ??
        null
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
    const unique = [...new Set(attachmentIds.map((id) => id.trim()))];
    if (unique.length > 20 || unique.some((id) => !id || id.length > 64)) {
      throw new BadRequestException('业务记录最多关联 20 个有效附件');
    }
    return unique;
  }

  private async validateRecordAttachments(
    prisma: PrismaWriter,
    attachmentIds: string[],
    projectId: string,
    requireClean: boolean
  ) {
    if (!attachmentIds.length) return;
    const files = await prisma.rawFile.findMany({ where: { id: { in: attachmentIds }, isVoided: false } });
    if (files.length !== attachmentIds.length) throw new BadRequestException('附件不存在或已作废');
    if (files.some((file) => file.relatedProjectId !== projectId || file.relatedWorkOrderId !== null)) {
      throw new BadRequestException('附件不属于当前项目或已关联工单');
    }
    if (requireClean && files.some((file) => file.scanStatus !== FileScanStatus.clean)) {
      throw new ConflictException('附件尚未通过安全扫描');
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

  private isTerminal(status: BusinessRecordStatus) {
    return status === BusinessRecordStatus.confirmed || status === BusinessRecordStatus.rejected;
  }

  private async findRecordOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const record = await prisma.businessRecord.findUnique({ where: { id }, include: this.recordInclude() });
    if (!record) throw new NotFoundException('资源不存在');
    return record;
  }

  private async ensureProjectWritable(projectId: string, prisma: PrismaWriter) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.status !== ProjectStatus.active) throw new ConflictException('归档项目不能修改业务记录');
  }

  private toInclusiveDateTo(input: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T23:59:59.999Z`) : new Date(input);
  }

  private recordInclude() {
    return {
      project: true,
      template: true,
      values: { include: { field: true }, orderBy: { createdAt: 'asc' as const } }
    };
  }
}
