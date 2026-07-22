import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountingDirection, DataRecordType, FieldDefinition, FieldType, Prisma } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { toTemplate, toTemplateField } from '../data-center/data-center.presenter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { CreateTemplateFieldDto } from './dto/create-template-field.dto';
import { QueryTemplatesDto } from './dto/query-templates.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { UpdateTemplateFieldDto } from './dto/update-template-field.dto';

type PrismaWriter = Prisma.TransactionClient | PrismaService;

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async findMany(query: QueryTemplatesDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.TemplateWhereInput = { recordType: query.recordType };
    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } }
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.template.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.template.count({ where })
    ]);
    return { items: items.map(toTemplate), page, pageSize, total };
  }

  async findOne(id: string) {
    return toTemplate(await this.findTemplateOrThrow(id));
  }

  async create(dto: CreateTemplateDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.template.create({
        data: {
          name: dto.name,
          recordType: dto.recordType,
          accountingDirection: dto.accountingDirection ?? this.defaultDirection(dto.recordType),
          dataLayer: dto.dataLayer,
          description: dto.description,
          isSystem: false,
          createdBy: actor.username
        }
      });
      await this.auditLogs.write(tx, actor, 'template.create', 'template', template.id, { after: toTemplate(template) }, context);
      return toTemplate(template);
    });
  }

  async update(id: string, dto: UpdateTemplateDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findTemplateOrThrow(id, tx);
      await this.assertTemplateMutable(id, tx);
      if (dto.primaryAmountFieldId) {
        await this.assertPrimaryField(id, dto.primaryAmountFieldId, FieldType.money, tx);
      }
      if (dto.primaryDateFieldId) {
        await this.assertPrimaryField(id, dto.primaryDateFieldId, FieldType.date, tx);
      }

      const template = await tx.template.update({
        where: { id },
        data: {
          name: dto.name,
          recordType: dto.recordType,
          accountingDirection:
            dto.accountingDirection ??
            (dto.recordType !== undefined && dto.recordType !== before.recordType
              ? this.defaultDirection(dto.recordType)
              : undefined),
          dataLayer: dto.dataLayer,
          primaryAmountFieldId: dto.primaryAmountFieldId,
          primaryDateFieldId: dto.primaryDateFieldId,
          description: dto.description,
          version: { increment: 1 }
        }
      });
      const primaryIds = [dto.primaryAmountFieldId, dto.primaryDateFieldId].filter(
        (value): value is string => Boolean(value)
      );
      if (primaryIds.length) {
        await tx.templateField.updateMany({
          where: { templateId: id, fieldId: { in: primaryIds } },
          data: { isRequired: true, isVisible: true }
        });
      }
      await this.auditLogs.write(
        tx,
        actor,
        'template.update',
        'template',
        template.id,
        { before: toTemplate(before), after: toTemplate(template) },
        context
      );
      return toTemplate(template);
    });
  }

  async remove(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findTemplateOrThrow(id, tx);
      if (before.isSystem) throw new ConflictException('系统内置模板不能删除');
      const referenceCount = await this.countReferences(id, tx);
      if (referenceCount > 0) throw new ConflictException('模板已被项目或业务数据引用，不能删除');
      await tx.template.delete({ where: { id } });
      await this.auditLogs.write(tx, actor, 'template.delete', 'template', id, { before: toTemplate(before) }, context);
      return { id };
    });
  }

  async clone(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.template.findUnique({ where: { id }, include: { templateFields: true } });
      if (!source) throw new NotFoundException('资源不存在');
      const template = await tx.template.create({
        data: {
          name: `${source.name} 副本`,
          recordType: source.recordType,
          accountingDirection: source.accountingDirection,
          dataLayer: source.dataLayer,
          primaryAmountFieldId: source.primaryAmountFieldId,
          primaryDateFieldId: source.primaryDateFieldId,
          description: source.description,
          isSystem: false,
          createdBy: actor.username,
          templateFields: {
            create: source.templateFields.map((item) => ({
              fieldId: item.fieldId,
              isRequired: item.isRequired,
              isVisible: item.isVisible,
              displayOrder: item.displayOrder,
              defaultValue: item.defaultValue
            }))
          }
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'template.clone',
        'template',
        template.id,
        { sourceTemplateId: source.id, after: toTemplate(template) },
        context
      );
      return toTemplate(template);
    });
  }

  async getFields(templateId: string) {
    await this.findTemplateOrThrow(templateId);
    const fields = await this.prisma.templateField.findMany({
      where: { templateId },
      include: { field: true },
      orderBy: { displayOrder: 'asc' }
    });
    return fields.map(toTemplateField);
  }

  async addField(templateId: string, dto: CreateTemplateFieldDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      await this.findTemplateOrThrow(templateId, tx);
      await this.assertStructureMutable(templateId, tx);
      const field = await this.findFieldOrThrow(dto.fieldId, tx);
      if (!field.isActive) throw new ConflictException('停用字段不能加入模板');
      this.validateDefaultValue(field, dto.defaultValue);
      const fieldCount = await tx.templateField.count({ where: { templateId } });
      const displayOrder = Math.min(dto.displayOrder ?? fieldCount + 1, fieldCount + 1);
      if (displayOrder <= fieldCount) {
        await tx.templateField.updateMany({
          where: { templateId, displayOrder: { gte: displayOrder } },
          data: { displayOrder: { increment: 1 } }
        });
      }
      const templateField = await tx.templateField.create({
        data: {
          templateId,
          fieldId: dto.fieldId,
          isRequired: dto.isRequired ?? false,
          isVisible: dto.isVisible ?? true,
          displayOrder,
          defaultValue: dto.defaultValue
        },
        include: { field: true }
      });
      await this.refreshCanonicalFields(templateId, tx);
      const after = await this.findTemplateFieldOrThrow(templateField.id, tx);
      await this.auditLogs.write(
        tx,
        actor,
        'template_field.add',
        'template_field',
        templateField.id,
        { after: toTemplateField(after) },
        context
      );
      return toTemplateField(after);
    });
  }

  async updateTemplateField(id: string, dto: UpdateTemplateFieldDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findTemplateFieldOrThrow(id, tx);
      await this.assertStructureMutable(before.templateId, tx);
      const template = await this.findTemplateOrThrow(before.templateId, tx);
      const isPrimary =
        before.fieldId === template.primaryAmountFieldId || before.fieldId === template.primaryDateFieldId;
      if (isPrimary && (dto.isRequired === false || dto.isVisible === false)) {
        throw new ConflictException('模板主金额和主日期字段必须保持启用、可见且必填');
      }
      this.validateDefaultValue(before.field, dto.defaultValue);
      let displayOrder = dto.displayOrder;
      if (displayOrder !== undefined && displayOrder !== before.displayOrder) {
        const siblingCount = await tx.templateField.count({ where: { templateId: before.templateId } });
        displayOrder = Math.min(displayOrder, siblingCount);
        if (displayOrder < before.displayOrder) {
          await tx.templateField.updateMany({
            where: {
              templateId: before.templateId,
              id: { not: id },
              displayOrder: { gte: displayOrder, lt: before.displayOrder }
            },
            data: { displayOrder: { increment: 1 } }
          });
        } else {
          await tx.templateField.updateMany({
            where: {
              templateId: before.templateId,
              id: { not: id },
              displayOrder: { gt: before.displayOrder, lte: displayOrder }
            },
            data: { displayOrder: { decrement: 1 } }
          });
        }
      }
      await tx.templateField.update({
        where: { id },
        data: {
          isRequired: dto.isRequired,
          isVisible: dto.isVisible,
          displayOrder,
          defaultValue: dto.defaultValue
        }
      });
      await this.refreshCanonicalFields(before.templateId, tx);
      const after = await this.findTemplateFieldOrThrow(id, tx);
      await this.auditLogs.write(
        tx,
        actor,
        'template_field.update',
        'template_field',
        id,
        { before: toTemplateField(before), after: toTemplateField(after) },
        context
      );
      return toTemplateField(after);
    });
  }

  async removeTemplateField(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findTemplateFieldOrThrow(id, tx);
      await this.assertStructureMutable(before.templateId, tx);
      await tx.templateField.delete({ where: { id } });
      await tx.templateField.updateMany({
        where: { templateId: before.templateId, displayOrder: { gt: before.displayOrder } },
        data: { displayOrder: { decrement: 1 } }
      });
      await this.refreshCanonicalFields(before.templateId, tx);
      await this.auditLogs.write(
        tx,
        actor,
        'template_field.remove',
        'template_field',
        id,
        { before: toTemplateField(before) },
        context
      );
      return { id };
    });
  }

  private defaultDirection(recordType: DataRecordType) {
    return recordType === DataRecordType.revenue ? AccountingDirection.income : AccountingDirection.expense;
  }

  private async assertTemplateMutable(templateId: string, prisma: PrismaWriter) {
    if ((await this.countReferences(templateId, prisma)) > 0) {
      throw new ConflictException('已发布或已被业务流程引用的模板版本不可原地修改，请克隆新模板后切换');
    }
  }

  private async assertStructureMutable(templateId: string, prisma: PrismaWriter) {
    const publishedCount = await prisma.projectTemplate.count({ where: { templateId } });
    if (publishedCount > 0) {
      throw new ConflictException('已发布到项目的模板版本不可原地修改字段，请克隆模板后切换');
    }
  }

  private async countReferences(templateId: string, prisma: PrismaWriter) {
    const counts = await Promise.all([
      prisma.projectTemplate.count({ where: { templateId } }),
      prisma.businessRecord.count({ where: { templateId } }),
      prisma.workOrder.count({ where: { templateId } }),
      prisma.importTask.count({ where: { templateId } }),
      prisma.ocrTask.count({ where: { templateId } })
    ]);
    return counts.reduce((sum, count) => sum + count, 0);
  }

  private async assertPrimaryField(
    templateId: string,
    fieldId: string,
    expectedType: FieldType,
    prisma: PrismaWriter
  ) {
    const relation = await prisma.templateField.findUnique({
      where: { templateId_fieldId: { templateId, fieldId } },
      include: { field: true }
    });
    if (!relation || relation.field.fieldType !== expectedType || !relation.field.isActive) {
      throw new BadRequestException(`主字段必须是当前模板中启用的 ${expectedType} 字段`);
    }
  }

  private async refreshCanonicalFields(templateId: string, prisma: PrismaWriter) {
    const template = await prisma.template.findUnique({
      where: { id: templateId },
      include: {
        templateFields: {
          include: { field: true },
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }]
        }
      }
    });
    if (!template) throw new NotFoundException('资源不存在');
    const usable = template.templateFields.filter((item) => item.isVisible && item.field.isActive);
    const currentAmount = usable.find(
      (item) => item.fieldId === template.primaryAmountFieldId && item.field.fieldType === FieldType.money
    );
    const currentDate = usable.find(
      (item) => item.fieldId === template.primaryDateFieldId && item.field.fieldType === FieldType.date
    );
    const amountCandidate = currentAmount ?? this.rankCanonicalField(usable, FieldType.money, ['incomeAmount', 'amount']);
    const dateCandidate = currentDate ?? this.rankCanonicalField(usable, FieldType.date, ['date']);
    const primaryIds = [amountCandidate?.fieldId, dateCandidate?.fieldId].filter(
      (value): value is string => Boolean(value)
    );
    if (primaryIds.length) {
      await prisma.templateField.updateMany({
        where: { templateId, fieldId: { in: primaryIds } },
        data: { isRequired: true, isVisible: true }
      });
    }
    await prisma.template.update({
      where: { id: templateId },
      data: {
        primaryAmountFieldId: amountCandidate?.fieldId ?? null,
        primaryDateFieldId: dateCandidate?.fieldId ?? null,
        version: { increment: 1 }
      }
    });
  }

  private rankCanonicalField<T extends { fieldId: string; field: FieldDefinition }>(
    fields: T[],
    fieldType: FieldType,
    preferredKeys: string[]
  ) {
    const candidates = fields.filter((item) => item.field.fieldType === fieldType);
    for (const key of preferredKeys) {
      const preferred = candidates.find((item) => item.field.fieldKey === key);
      if (preferred) return preferred;
    }
    return candidates[0];
  }

  private validateDefaultValue(field: FieldDefinition, value: string | undefined) {
    if (value === undefined || value === '') return;
    if (field.fieldType === FieldType.money || field.fieldType === FieldType.number) {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
        throw new BadRequestException('默认值与数字字段类型不匹配');
      }
      try {
        const decimal = new Prisma.Decimal(value);
        const maxDecimals = field.fieldType === FieldType.money ? 2 : 4;
        const maxValue = field.fieldType === FieldType.money ? '9999999999999999.99' : '99999999999999.9999';
        if (
          decimal.decimalPlaces() > maxDecimals ||
          decimal.abs().greaterThan(maxValue) ||
          (field.fieldType === FieldType.money && decimal.isNegative())
        ) {
          throw new Error('range');
        }
      } catch {
        throw new BadRequestException('默认值与数字字段类型不匹配');
      }
    }
    if (field.fieldType === FieldType.date) {
      const date = new Date(`${value}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new BadRequestException('默认值与日期字段类型不匹配');
      }
    }
    if (field.fieldType === FieldType.file) throw new BadRequestException('文件字段不能配置文本默认值');
  }

  private async findTemplateOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('资源不存在');
    return template;
  }

  private async findFieldOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const field = await prisma.fieldDefinition.findUnique({ where: { id } });
    if (!field) throw new NotFoundException('资源不存在');
    return field;
  }

  private async findTemplateFieldOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const field = await prisma.templateField.findUnique({ where: { id }, include: { field: true } });
    if (!field) throw new NotFoundException('资源不存在');
    return field;
  }
}
