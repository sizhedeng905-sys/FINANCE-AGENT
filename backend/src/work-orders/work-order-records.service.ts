import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  AccountingDirection,
  BusinessRecordStatus,
  DataRecordType,
  FieldDefinition,
  FieldType,
  FileScanStatus,
  Prisma,
  RecordDataLayer,
  RecordSourceType,
  Template,
  TemplateField,
  WorkOrderType
} from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { toBusinessRecord } from '../data-center/data-center.presenter';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CanonicalRecordValues,
  PolicyValueInput,
  RecordPolicyService
} from '../record-policy/record-policy.service';
import { workOrderInclude, WorkOrderWithRelations } from './work-order.presenter';

type PolicyTemplate = Template & {
  templateFields: Array<TemplateField & { field: FieldDefinition }>;
};

export interface WorkOrderSubmissionPreparation {
  template: PolicyTemplate;
  recordType: DataRecordType;
  values: Array<{
    fieldId: string;
    fieldName: string;
    valueText?: string;
    valueNumber?: Prisma.Decimal;
    valueDate?: Date;
    valueJson?: Prisma.InputJsonValue;
  }>;
  templateSnapshot: Prisma.InputJsonObject;
  submissionSnapshot: Prisma.InputJsonObject;
  canonical: CanonicalRecordValues;
  policyValues: PolicyValueInput[];
}

@Injectable()
export class WorkOrderRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly ledgerEvents: LedgerEventsService,
    private readonly recordPolicy: RecordPolicyService
  ) {}

  async generate(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      const workOrder = await tx.workOrder.findUnique({ where: { id }, include: workOrderInclude });
      if (!workOrder) throw new NotFoundException('资源不存在');
      if (workOrder.status !== 'completed') {
        throw new UnprocessableEntityException('只有已完成工单可以补生成经营记录');
      }
      const record = await this.createWithinTransaction(tx, workOrder, actor, context);
      if (workOrder.generatedRecordId !== record.id) {
        await tx.workOrder.update({
          where: { id },
          data: { generatedRecordId: record.id, version: { increment: 1 } }
        });
      }
      return toBusinessRecord(record);
    });
  }

  async prepareSubmission(tx: Prisma.TransactionClient, workOrder: WorkOrderWithRelations) {
    if (!workOrder.occurredDate) throw new UnprocessableEntityException('工单缺少发生日期');
    if (workOrder.amount.lessThanOrEqualTo(0)) throw new UnprocessableEntityException('工单金额必须大于 0');
    const recordType = this.resolveRecordType(workOrder.type);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workOrder.projectId}, 22))`;
    const templateId = workOrder.templateId ?? (await this.resolveTemplateId(tx, workOrder.projectId, recordType));
    const template = await this.recordPolicy.getWritableTemplate(
      tx,
      workOrder.projectId,
      templateId,
      recordType
    );
    if (template.dataLayer !== RecordDataLayer.actual) {
      throw new UnprocessableEntityException('工单只能使用实际经营数据层模板');
    }
    const mapped = template.templateFields.map((templateField) => ({
      templateField,
      rawValue: this.resolveFieldValue(templateField, template, workOrder)
    }));
    const missingRequired = mapped
      .filter((item) => item.templateField.isRequired && !this.hasValue(item.rawValue))
      .map((item) => item.templateField.field.fieldName);
    if (missingRequired.length) {
      throw new UnprocessableEntityException(`工单缺少业务记录必填字段：${missingRequired.join('、')}`);
    }
    const policyValues = mapped
      .filter((item) => this.hasValue(item.rawValue))
      .map((item) => ({
        fieldId: item.templateField.fieldId,
        value: this.normalizePolicyValue(item.templateField.field, item.rawValue)
      }));
    const canonical = this.recordPolicy.resolveCanonicalValues(template, policyValues, { requireValues: true });
    if (!canonical.amount.equals(workOrder.amount)) {
      throw new UnprocessableEntityException('工单金额与模板主金额字段不一致');
    }
    if (canonical.recordDate.getTime() !== workOrder.occurredDate.getTime()) {
      throw new UnprocessableEntityException('工单日期与模板主日期字段不一致');
    }
    const unsafeAttachment = workOrder.attachments.find(
      (item) => item.rawFile.isVoided || item.rawFile.scanStatus !== FileScanStatus.clean
    );
    if (unsafeAttachment) throw new ConflictException('工单附件尚未通过安全扫描或已经作废');
    const values = mapped
      .map((item) => this.toRecordValue(item.templateField, item.rawValue))
      .filter((value): value is NonNullable<typeof value> => value !== null);
    const templateSnapshot = this.recordPolicy.toSnapshot(template);
    const submissionSnapshot = {
      workOrderId: workOrder.id,
      version: workOrder.version,
      projectId: workOrder.projectId,
      templateId: template.id,
      templateVersion: template.version,
      type: workOrder.type,
      recordType,
      accountingDirection: template.accountingDirection,
      dataLayer: template.dataLayer,
      amount: workOrder.amount.toFixed(2),
      occurredDate: workOrder.occurredDate.toISOString().slice(0, 10),
      description: workOrder.description,
      extraValues: workOrder.extraValues,
      attachments: workOrder.attachments.map((item) => ({
        rawFileId: item.rawFileId,
        sha256: item.rawFile.sha256,
        fileSize: item.rawFile.fileSize.toString()
      }))
    } as Prisma.InputJsonObject;
    return { template, recordType, values, templateSnapshot, submissionSnapshot, canonical, policyValues };
  }

  async createWithinTransaction(
    tx: Prisma.TransactionClient,
    workOrder: WorkOrderWithRelations,
    actor: CurrentUser,
    context: RequestContext
  ) {
    if (workOrder.generatedRecordId) {
      const generated = await this.findRecord(tx, workOrder.generatedRecordId);
      if (generated) return generated;
    }
    const existing = await tx.businessRecord.findFirst({
      where: { sourceType: RecordSourceType.work_order, sourceId: workOrder.id },
      include: this.recordInclude()
    });
    if (existing) return existing;
    const preparation = await this.prepareSubmission(tx, workOrder);
    if (
      workOrder.templateId !== preparation.template.id ||
      workOrder.templateVersion !== preparation.template.version
    ) {
      throw new ConflictException('工单提交模板快照与当前配置不一致');
    }
    const now = new Date();
    const record = await tx.businessRecord.create({
      data: {
        projectId: workOrder.projectId,
        templateId: preparation.template.id,
        templateVersion: preparation.template.version,
        templateSnapshot: preparation.templateSnapshot,
        sourceSnapshot: this.recordPolicy.toSourceSnapshot(
          RecordSourceType.work_order,
          workOrder.id,
          {
            workOrderId: workOrder.id,
            workOrderVersion: workOrder.version,
            submissionSnapshot: preparation.submissionSnapshot
          }
        ),
        confirmationSnapshot: this.recordPolicy.toConfirmationSnapshot(
          preparation.template,
          preparation.canonical,
          preparation.policyValues,
          {
            projectId: workOrder.projectId,
            sourceType: RecordSourceType.work_order,
            sourceId: workOrder.id,
            confirmedAt: now,
            confirmedBy: actor.username,
            attachments: workOrder.attachments.map((item) => item.rawFileId)
          }
        ),
        recordType: preparation.recordType,
        accountingDirection: preparation.template.accountingDirection,
        dataLayer: preparation.template.dataLayer,
        recordDate: workOrder.occurredDate!,
        amount: workOrder.amount,
        category:
          preparation.template.accountingDirection === AccountingDirection.income ? '收入' : '成本',
        subCategory: preparation.template.name,
        description: workOrder.description,
        sourceType: RecordSourceType.work_order,
        sourceId: workOrder.id,
        status: BusinessRecordStatus.confirmed,
        attachments: workOrder.attachments.map((item) => item.rawFileId),
        createdBy: actor.username,
        confirmedAt: now,
        confirmedBy: actor.username,
        values: preparation.values.length ? { create: preparation.values } : undefined
      },
      include: this.recordInclude()
    });
    await this.auditLogs.write(
      tx,
      actor,
      'work_order.generate_record',
      'business_record',
      record.id,
      { workOrderId: workOrder.id, submissionSnapshot: workOrder.submissionSnapshot },
      context
    );
    await this.ledgerEvents.write(
      tx,
      actor,
      'business_record_created',
      'business_record',
      record.id,
      {
        sourceType: RecordSourceType.work_order,
        sourceId: workOrder.id,
        projectId: workOrder.projectId,
        accountingDirection: preparation.template.accountingDirection,
        amount: workOrder.amount.toFixed(2)
      },
      `work_order:${workOrder.id}:business_record_created`
    );
    return record;
  }

  private async resolveTemplateId(
    tx: Prisma.TransactionClient,
    projectId: string,
    recordType: DataRecordType
  ) {
    const matches = await tx.projectTemplate.findMany({
      where: { projectId, recordType, isActive: true },
      select: { templateId: true },
      take: 2
    });
    if (matches.length !== 1) {
      throw new UnprocessableEntityException(
        matches.length ? '项目存在多个同类型活动模板' : '项目未启用与工单类型匹配的数据模板'
      );
    }
    return matches[0].templateId;
  }

  private toRecordValue(
    templateField: TemplateField & { field: FieldDefinition },
    rawValue: unknown
  ) {
    if (!this.hasValue(rawValue)) return null;
    const base = { fieldId: templateField.fieldId, fieldName: templateField.field.fieldName };
    if (
      templateField.field.fieldType === FieldType.text ||
      templateField.field.fieldType === FieldType.textarea ||
      templateField.field.fieldType === FieldType.select
    ) {
      return { ...base, valueText: String(rawValue) };
    }
    if (
      templateField.field.fieldType === FieldType.number ||
      templateField.field.fieldType === FieldType.money
    ) {
      try {
        return { ...base, valueNumber: new Prisma.Decimal(String(rawValue)) };
      } catch {
        return null;
      }
    }
    if (templateField.field.fieldType === FieldType.date) {
      const value = rawValue instanceof Date ? rawValue : new Date(String(rawValue));
      return Number.isNaN(value.getTime()) ? null : { ...base, valueDate: value };
    }
    if (templateField.field.fieldType === FieldType.file) {
      return { ...base, valueJson: (Array.isArray(rawValue) ? rawValue : [String(rawValue)]) as Prisma.InputJsonValue };
    }
    return null;
  }

  private resolveFieldValue(
    templateField: TemplateField & { field: FieldDefinition },
    template: PolicyTemplate,
    workOrder: WorkOrderWithRelations
  ): unknown {
    if (templateField.fieldId === template.primaryAmountFieldId) return workOrder.amount.toFixed(2);
    if (templateField.fieldId === template.primaryDateFieldId) return workOrder.occurredDate;
    const fieldKey = templateField.field.fieldKey;
    const standard: Record<string, unknown> = {
      date: workOrder.occurredDate,
      amount: workOrder.amount.toFixed(2),
      incomeAmount:
        template.accountingDirection === AccountingDirection.income ? workOrder.amount.toFixed(2) : undefined,
      expenseReason: workOrder.description,
      remark: workOrder.description,
      attachment: workOrder.attachments.map((item) => item.rawFileId)
    };
    if (fieldKey in standard) return standard[fieldKey];
    const extra = this.asObject(workOrder.extraValues);
    if (fieldKey === 'costCategory') {
      return extra.costCategory ?? extra.expenseType ?? templateField.defaultValue ?? undefined;
    }
    return extra[fieldKey] ?? templateField.defaultValue ?? undefined;
  }

  private normalizePolicyValue(field: FieldDefinition, value: unknown) {
    if (field.fieldType === FieldType.date && value instanceof Date) return value.toISOString().slice(0, 10);
    if (field.fieldType === FieldType.money && value instanceof Prisma.Decimal) return value.toFixed(2);
    return value;
  }

  private resolveRecordType(type: WorkOrderType) {
    if (type === WorkOrderType.transport) return DataRecordType.transport;
    if (type === WorkOrderType.expense) return DataRecordType.reimbursement;
    return DataRecordType.other;
  }

  private hasValue(value: unknown) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  private asObject(value: Prisma.JsonValue | null): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async findRecord(tx: Prisma.TransactionClient, id: string) {
    return tx.businessRecord.findUnique({ where: { id }, include: this.recordInclude() });
  }

  private recordInclude() {
    return {
      project: true,
      template: true,
      values: { include: { field: true }, orderBy: { createdAt: 'asc' as const } }
    };
  }
}
