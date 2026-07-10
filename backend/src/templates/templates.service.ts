import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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
    const where: Prisma.TemplateWhereInput = {
      recordType: query.recordType
    };

    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.template.findMany({
        where,
        orderBy: {
          createdAt: 'desc'
        },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.template.count({ where })
    ]);

    return {
      items: items.map(toTemplate),
      page,
      pageSize,
      total
    };
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
          description: dto.description,
          isSystem: dto.isSystem ?? false,
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
      const template = await tx.template.update({
        where: {
          id
        },
        data: dto
      });

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
      await tx.template.delete({
        where: {
          id
        }
      });

      await this.auditLogs.write(tx, actor, 'template.delete', 'template', id, { before: toTemplate(before) }, context);

      return {
        id
      };
    });
  }

  async clone(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.template.findUnique({
        where: {
          id
        },
        include: {
          templateFields: true
        }
      });

      if (!source) {
        throw new NotFoundException('资源不存在');
      }

      const template = await tx.template.create({
        data: {
          name: `${source.name} 副本`,
          recordType: source.recordType,
          description: source.description,
          isSystem: false,
          createdBy: actor.username,
          templateFields: {
            create: source.templateFields.map((templateField) => ({
              fieldId: templateField.fieldId,
              isRequired: templateField.isRequired,
              isVisible: templateField.isVisible,
              displayOrder: templateField.displayOrder,
              defaultValue: templateField.defaultValue
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
    const templateFields = await this.prisma.templateField.findMany({
      where: {
        templateId
      },
      include: {
        field: true
      },
      orderBy: {
        displayOrder: 'asc'
      }
    });

    return templateFields.map(toTemplateField);
  }

  async addField(templateId: string, dto: CreateTemplateFieldDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      await this.findTemplateOrThrow(templateId, tx);
      await this.findFieldOrThrow(dto.fieldId, tx);

      const displayOrder = dto.displayOrder ?? (await this.getNextDisplayOrder(templateId, tx));
      const templateField = await tx.templateField.create({
        data: {
          templateId,
          fieldId: dto.fieldId,
          isRequired: dto.isRequired ?? false,
          isVisible: dto.isVisible ?? true,
          displayOrder,
          defaultValue: dto.defaultValue
        },
        include: {
          field: true
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'template_field.add',
        'template_field',
        templateField.id,
        { after: toTemplateField(templateField) },
        context
      );

      return toTemplateField(templateField);
    });
  }

  async updateTemplateField(id: string, dto: UpdateTemplateFieldDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findTemplateFieldOrThrow(id, tx);
      const templateField = await tx.templateField.update({
        where: {
          id
        },
        data: dto,
        include: {
          field: true
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'template_field.update',
        'template_field',
        templateField.id,
        { before: toTemplateField(before), after: toTemplateField(templateField) },
        context
      );

      return toTemplateField(templateField);
    });
  }

  async removeTemplateField(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findTemplateFieldOrThrow(id, tx);
      await tx.templateField.delete({
        where: {
          id
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'template_field.remove',
        'template_field',
        id,
        { before: toTemplateField(before) },
        context
      );

      return {
        id
      };
    });
  }

  private async getNextDisplayOrder(templateId: string, prisma: PrismaWriter) {
    const latest = await prisma.templateField.findFirst({
      where: {
        templateId
      },
      orderBy: {
        displayOrder: 'desc'
      }
    });

    return (latest?.displayOrder ?? 0) + 1;
  }

  private async findTemplateOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const template = await prisma.template.findUnique({
      where: {
        id
      }
    });

    if (!template) {
      throw new NotFoundException('资源不存在');
    }

    return template;
  }

  private async findFieldOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const field = await prisma.fieldDefinition.findUnique({
      where: {
        id
      }
    });

    if (!field) {
      throw new NotFoundException('资源不存在');
    }

    return field;
  }

  private async findTemplateFieldOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const templateField = await prisma.templateField.findUnique({
      where: {
        id
      },
      include: {
        field: true
      }
    });

    if (!templateField) {
      throw new NotFoundException('资源不存在');
    }

    return templateField;
  }
}
