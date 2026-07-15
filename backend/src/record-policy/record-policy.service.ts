import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccountingDirection,
  DataRecordType,
  FieldDefinition,
  FieldType,
  Prisma,
  ProjectStatus,
  RecordSourceType,
  Template,
  TemplateField
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

type PrismaWriter = Prisma.TransactionClient | PrismaService;
type PolicyTemplate = Template & {
  templateFields: Array<TemplateField & { field: FieldDefinition }>;
};

export interface PolicyValueInput {
  fieldId: string;
  value: unknown;
}

export interface CanonicalRecordValues {
  amount: Prisma.Decimal;
  recordDate: Date;
  accountingDirection: AccountingDirection;
  category: '收入' | '成本';
}

export interface ConfirmationSnapshotOptions {
  projectId: string;
  sourceType: RecordSourceType;
  sourceId: string;
  confirmedAt: Date;
  confirmedBy: string;
  attachments?: string[];
}

@Injectable()
export class RecordPolicyService {
  async getWritableTemplate(
    prisma: PrismaWriter,
    projectId: string,
    templateId: string,
    expectedRecordType?: DataRecordType
  ): Promise<PolicyTemplate> {
    const [project, projectTemplate, template] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.projectTemplate.findUnique({
        where: { projectId_templateId: { projectId, templateId } }
      }),
      prisma.template.findUnique({
        where: { id: templateId },
        include: {
          templateFields: {
            include: { field: true },
            orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }]
          }
        }
      })
    ]);

    if (!project) throw new NotFoundException('项目不存在');
    if (project.status !== ProjectStatus.active) {
      throw new ConflictException('归档项目不能写入业务记录');
    }
    if (!template || !projectTemplate || !projectTemplate.isActive) {
      throw new BadRequestException('模板未被该项目启用');
    }
    if (projectTemplate.recordType !== template.recordType) {
      throw new ConflictException('项目模板的业务类型配置不一致');
    }
    if (expectedRecordType && template.recordType !== expectedRecordType) {
      throw new BadRequestException('记录类型与模板类型不一致');
    }
    return template;
  }

  resolveCanonicalValues(
    template: PolicyTemplate,
    values: PolicyValueInput[],
    options: { requireValues?: boolean } = {}
  ): CanonicalRecordValues {
    const amountField = this.getPrimaryField(template, 'amount');
    const dateField = this.getPrimaryField(template, 'date');
    const valuesByField = new Map(values.map((value) => [value.fieldId, value.value]));
    const amountInput = valuesByField.get(amountField.fieldId);
    const dateInput = valuesByField.get(dateField.fieldId);

    if (options.requireValues !== false && !this.hasValue(amountInput)) {
      throw new BadRequestException(`${amountField.field.fieldName}为必填字段`);
    }
    if (options.requireValues !== false && !this.hasValue(dateInput)) {
      throw new BadRequestException(`${dateField.field.fieldName}为必填字段`);
    }

    const amount = this.parseMoney(amountInput, amountField.field.fieldName);
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('金额必须大于 0；冲销请使用显式作废流程');
    }
    const recordDate = this.parseDateOnly(String(dateInput ?? ''), dateField.field.fieldName);

    return {
      amount,
      recordDate,
      accountingDirection: template.accountingDirection,
      category: template.accountingDirection === AccountingDirection.income ? '收入' : '成本'
    };
  }

  assertTopLevelMatches(
    canonical: CanonicalRecordValues,
    input: { amount?: string; recordDate?: string; category?: string }
  ) {
    if (input.amount !== undefined) {
      const submitted = this.parseMoney(input.amount, 'amount');
      if (!submitted.equals(canonical.amount)) {
        throw new BadRequestException('顶层 amount 必须与模板主金额字段完全一致');
      }
    }
    if (input.recordDate !== undefined) {
      const submitted = this.parseDateOnly(input.recordDate, 'recordDate');
      if (submitted.getTime() !== canonical.recordDate.getTime()) {
        throw new BadRequestException('顶层 recordDate 必须与模板主日期字段完全一致');
      }
    }
    if (input.category?.trim() && input.category.trim() !== canonical.category) {
      throw new BadRequestException('收支方向由模板决定，不能通过 category 覆盖');
    }
  }

  getPrimaryField(template: PolicyTemplate, kind: 'amount' | 'date') {
    const fieldId = kind === 'amount' ? template.primaryAmountFieldId : template.primaryDateFieldId;
    const templateField = template.templateFields.find((item) => item.fieldId === fieldId);
    const expectedType = kind === 'amount' ? FieldType.money : FieldType.date;
    if (
      !templateField ||
      templateField.field.fieldType !== expectedType ||
      !templateField.field.isActive ||
      !templateField.isVisible ||
      !templateField.isRequired
    ) {
      const label = kind === 'amount' ? '主金额' : '主日期';
      throw new ConflictException(`模板缺少有效且必填的${label}字段`);
    }
    return templateField;
  }

  toSnapshot(template: PolicyTemplate): Prisma.InputJsonObject {
    return {
      schemaVersion: 1,
      templateId: template.id,
      version: template.version,
      recordType: template.recordType,
      accountingDirection: template.accountingDirection,
      dataLayer: template.dataLayer,
      primaryAmountFieldId: template.primaryAmountFieldId,
      primaryDateFieldId: template.primaryDateFieldId,
      fields: template.templateFields.map((item) => ({
        fieldId: item.fieldId,
        fieldKey: item.field.fieldKey,
        fieldName: item.field.fieldName,
        fieldType: item.field.fieldType,
        isRequired: item.isRequired,
        isVisible: item.isVisible,
        defaultValue: item.defaultValue,
        displayOrder: item.displayOrder
      }))
    } as Prisma.InputJsonObject;
  }

  toSourceSnapshot(
    sourceType: RecordSourceType,
    sourceId: string,
    metadata: Prisma.InputJsonObject = {}
  ): Prisma.InputJsonObject {
    return {
      schemaVersion: 1,
      sourceType,
      sourceId,
      metadata
    };
  }

  toConfirmationSnapshot(
    template: PolicyTemplate,
    canonical: CanonicalRecordValues,
    values: PolicyValueInput[],
    options: ConfirmationSnapshotOptions
  ): Prisma.InputJsonObject {
    const valuesByField = new Map(values.map((value) => [value.fieldId, value.value]));
    const snapshotValues = template.templateFields.flatMap((templateField) => {
      const value = valuesByField.get(templateField.fieldId);
      if (!this.hasValue(value)) return [];
      return [{
        fieldId: templateField.fieldId,
        fieldKey: templateField.field.fieldKey,
        fieldName: templateField.field.fieldName,
        fieldType: templateField.field.fieldType,
        value: this.snapshotFieldValue(templateField.field, value)
      }];
    });
    return {
      schemaVersion: 1,
      projectId: options.projectId,
      templateId: template.id,
      templateVersion: template.version,
      recordType: template.recordType,
      accountingDirection: canonical.accountingDirection,
      dataLayer: template.dataLayer,
      recordDate: canonical.recordDate.toISOString().slice(0, 10),
      amount: canonical.amount.toFixed(2),
      category: canonical.category,
      sourceType: options.sourceType,
      sourceId: options.sourceId,
      confirmedAt: options.confirmedAt.toISOString(),
      confirmedBy: options.confirmedBy,
      attachments: options.attachments ?? [],
      values: snapshotValues
    } as Prisma.InputJsonObject;
  }

  parseMoney(value: unknown, fieldName = 'amount') {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(value.trim())) {
      throw new BadRequestException(`${fieldName}必须是最多两位小数的非负十进制字符串`);
    }
    const amount = new Prisma.Decimal(value.trim());
    if (amount.greaterThan('9999999999999999.99')) {
      throw new BadRequestException(`${fieldName}超出允许范围`);
    }
    return amount;
  }

  parseNumericValue(value: unknown, fieldName: string, decimalPlaces = 4) {
    let input: string;
    if (typeof value === 'string') {
      input = value.trim();
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      const scaled = value * 10 ** decimalPlaces;
      if (!Number.isSafeInteger(scaled)) {
        throw new BadRequestException(`${fieldName}必须使用十进制字符串提交`);
      }
      input = String(value);
    } else {
      throw new BadRequestException(`${fieldName}必须是数字`);
    }
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) {
      throw new BadRequestException(`${fieldName}必须是数字`);
    }
    const decimal = new Prisma.Decimal(input);
    if (decimal.decimalPlaces() > decimalPlaces || decimal.abs().greaterThan('99999999999999.9999')) {
      throw new BadRequestException(`${fieldName}超出允许的数值范围或精度`);
    }
    return decimal;
  }

  parseDateOnly(value: string, fieldName: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(`${fieldName}必须是 YYYY-MM-DD 格式`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`${fieldName}必须是有效日期`);
    }
    return date;
  }

  formatMoney(value: Prisma.Decimal.Value) {
    return new Prisma.Decimal(value).toFixed(2);
  }

  private hasValue(value: unknown) {
    if (value === null || value === undefined) return false;
    return typeof value !== 'string' || value.trim().length > 0;
  }

  private snapshotFieldValue(field: FieldDefinition, value: unknown): Prisma.InputJsonValue {
    if (field.fieldType === FieldType.money) return this.parseMoney(String(value), field.fieldName).toFixed(2);
    if (field.fieldType === FieldType.number) return this.parseNumericValue(value, field.fieldName).toString();
    if (field.fieldType === FieldType.date) {
      const input = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
      return this.parseDateOnly(input, field.fieldName).toISOString().slice(0, 10);
    }
    if (field.fieldType === FieldType.file) {
      const values = Array.isArray(value) ? value : [value];
      if (values.some((item) => typeof item !== 'string')) {
        throw new BadRequestException(`${field.fieldName}的文件值格式不正确`);
      }
      return values as string[];
    }
    return String(value);
  }
}
