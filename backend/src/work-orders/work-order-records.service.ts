import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  BusinessRecordStatus,
  DataRecordType,
  FieldDefinition,
  FieldType,
  Prisma,
  RecordSourceType,
  TemplateField,
  WorkOrderType
} from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { toBusinessRecord } from '../data-center/data-center.presenter';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { workOrderInclude, WorkOrderWithRelations } from './work-order.presenter';

type TemplateFieldWithField = TemplateField & { field: FieldDefinition };
const TEXT_FIELD_TYPES: FieldType[] = [FieldType.text, FieldType.textarea, FieldType.select];
const NUMBER_FIELD_TYPES: FieldType[] = [FieldType.number, FieldType.money];

@Injectable()
export class WorkOrderRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly ledgerEvents: LedgerEventsService
  ) {}

  async generate(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.findUnique({ where: { id }, include: workOrderInclude });
      if (!workOrder) throw new NotFoundException('资源不存在');
      if (workOrder.status !== 'completed') throw new UnprocessableEntityException('只有已完成工单可以补生成经营记录');
      const record = await this.createWithinTransaction(tx, workOrder, actor, context);
      if (workOrder.generatedRecordId !== record.id) {
        await tx.workOrder.update({ where: { id }, data: { generatedRecordId: record.id } });
      }
      return toBusinessRecord(record);
    });
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
    const occurredDate = workOrder.occurredDate;
    if (!occurredDate) {
      throw new UnprocessableEntityException('工单缺少发生日期，不能生成经营记录');
    }

    const recordType = this.resolveRecordType(workOrder.type);
    const projectTemplate = await tx.projectTemplate.findFirst({
      where: {
        projectId: workOrder.projectId,
        isActive: true,
        template: { recordType }
      },
      include: {
        template: {
          include: {
            templateFields: {
              include: { field: true },
              orderBy: { displayOrder: 'asc' }
            }
          }
        }
      }
    });
    if (!projectTemplate) {
      throw new UnprocessableEntityException('项目未启用与工单类型匹配的数据模板');
    }

    const mappedValues = projectTemplate.template.templateFields.map((templateField) => ({
      templateField,
      value: this.toRecordValue(templateField, workOrder)
    }));
    const missingRequired = mappedValues
      .filter((item) => item.templateField.isRequired && item.value === null)
      .map((item) => item.templateField.field.fieldName);
    if (missingRequired.length) {
      throw new UnprocessableEntityException(`工单缺少业务记录必填字段：${missingRequired.join('、')}`);
    }
    const values = mappedValues
      .map((item) => item.value)
      .filter((value): value is NonNullable<typeof value> => value !== null);
    const now = new Date();
    const record = await tx.businessRecord.create({
      data: {
        projectId: workOrder.projectId,
        templateId: projectTemplate.templateId,
        recordType,
        recordDate: occurredDate,
        amount: workOrder.amount,
        category: workOrder.type === WorkOrderType.transport ? '收入' : '支出',
        subCategory: projectTemplate.customName ?? projectTemplate.template.name,
        description: workOrder.description,
        sourceType: RecordSourceType.work_order,
        sourceId: workOrder.id,
        status: BusinessRecordStatus.confirmed,
        attachments: workOrder.attachments.map((item) => item.rawFileId),
        createdBy: actor.username,
        confirmedAt: now,
        confirmedBy: actor.name,
        values: values.length ? { create: values } : undefined
      },
      include: this.recordInclude()
    });
    await this.auditLogs.write(tx, actor, 'work_order.generate_record', 'business_record', record.id, { workOrderId: workOrder.id }, context);
    await this.ledgerEvents.write(tx, actor, 'business_record_created', 'business_record', record.id, {
      sourceType: RecordSourceType.work_order,
      sourceId: workOrder.id,
      projectId: workOrder.projectId,
      amount: Number(workOrder.amount)
    });
    return record;
  }

  private toRecordValue(templateField: TemplateFieldWithField, workOrder: WorkOrderWithRelations) {
    const rawValue = this.resolveFieldValue(templateField, workOrder);
    if (rawValue === undefined || rawValue === null || rawValue === '') return null;
    const base = { fieldId: templateField.fieldId, fieldName: templateField.field.fieldName };
    if (TEXT_FIELD_TYPES.includes(templateField.field.fieldType)) {
      return { ...base, valueText: String(rawValue) };
    }
    if (NUMBER_FIELD_TYPES.includes(templateField.field.fieldType)) {
      const value = Number(rawValue);
      return Number.isFinite(value) ? { ...base, valueNumber: new Prisma.Decimal(value) } : null;
    }
    if (templateField.field.fieldType === FieldType.date) {
      const value = rawValue instanceof Date ? rawValue : new Date(String(rawValue));
      return Number.isNaN(value.getTime()) ? null : { ...base, valueDate: value };
    }
    if (templateField.field.fieldType === FieldType.file) {
      const value = Array.isArray(rawValue) ? rawValue : [String(rawValue)];
      return { ...base, valueJson: value };
    }
    return null;
  }

  private resolveFieldValue(templateField: TemplateFieldWithField, workOrder: WorkOrderWithRelations): unknown {
    const fieldKey = templateField.field.fieldKey;
    const standard: Record<string, unknown> = {
      date: workOrder.occurredDate,
      amount: workOrder.amount,
      incomeAmount: workOrder.type === WorkOrderType.transport ? workOrder.amount : undefined,
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

  private resolveRecordType(type: WorkOrderType) {
    if (type === WorkOrderType.transport) return DataRecordType.transport;
    if (type === WorkOrderType.expense) return DataRecordType.reimbursement;
    return DataRecordType.other;
  }

  private asObject(value: Prisma.JsonValue | null): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
