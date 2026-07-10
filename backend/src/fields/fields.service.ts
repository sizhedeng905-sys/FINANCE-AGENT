import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { toFieldDefinition, toProject, toTemplate } from '../data-center/data-center.presenter';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFieldDto } from './dto/create-field.dto';
import { QueryFieldsDto } from './dto/query-fields.dto';
import { UpdateFieldDto } from './dto/update-field.dto';

type PrismaWriter = Prisma.TransactionClient | PrismaService;

@Injectable()
export class FieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async findMany(query: QueryFieldsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.FieldDefinitionWhereInput = {
      fieldType: query.fieldType,
      semanticType: query.semanticType,
      isActive: query.isActive
    };

    if (query.keyword) {
      where.OR = [
        { fieldKey: { contains: query.keyword, mode: 'insensitive' } },
        { fieldName: { contains: query.keyword, mode: 'insensitive' } },
        { description: { contains: query.keyword, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.fieldDefinition.findMany({
        where,
        orderBy: {
          createdAt: 'desc'
        },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.fieldDefinition.count({ where })
    ]);

    return {
      items: items.map(toFieldDefinition),
      page,
      pageSize,
      total
    };
  }

  async findOne(id: string) {
    return toFieldDefinition(await this.findFieldOrThrow(id));
  }

  async create(dto: CreateFieldDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const fieldKey = await this.resolveFieldKey(dto.fieldKey ?? dto.fieldName, tx);
      const field = await tx.fieldDefinition.create({
        data: {
          fieldKey,
          fieldName: dto.fieldName,
          fieldType: dto.fieldType,
          unit: dto.unit,
          semanticType: dto.semanticType,
          aliases: dto.aliases ?? [],
          description: dto.description,
          isActive: true
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'field_definition.create',
        'field_definition',
        field.id,
        { after: toFieldDefinition(field) },
        context
      );

      return toFieldDefinition(field);
    });
  }

  async update(id: string, dto: UpdateFieldDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findFieldOrThrow(id, tx);
      const fieldKey = dto.fieldKey ? await this.resolveFieldKey(dto.fieldKey, tx, id) : undefined;
      const field = await tx.fieldDefinition.update({
        where: {
          id
        },
        data: {
          fieldKey,
          fieldName: dto.fieldName,
          fieldType: dto.fieldType,
          unit: dto.unit,
          semanticType: dto.semanticType,
          aliases: dto.aliases,
          description: dto.description
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'field_definition.update',
        'field_definition',
        field.id,
        { before: toFieldDefinition(before), after: toFieldDefinition(field) },
        context
      );

      return toFieldDefinition(field);
    });
  }

  async disable(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findFieldOrThrow(id, tx);
      const field = await tx.fieldDefinition.update({
        where: {
          id
        },
        data: {
          isActive: false
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'field_definition.disable',
        'field_definition',
        field.id,
        { before: before.isActive, after: field.isActive },
        context
      );

      return toFieldDefinition(field);
    });
  }

  async usage(id: string) {
    const field = await this.findFieldOrThrow(id);
    const templateFields = await this.prisma.templateField.findMany({
      where: {
        fieldId: id
      },
      include: {
        template: {
          include: {
            projectTemplates: {
              include: {
                project: true
              }
            }
          }
        }
      }
    });

    const templates = templateFields.map((templateField) => toTemplate(templateField.template));
    const projectMap = new Map(
      templateFields
        .flatMap((templateField) => templateField.template.projectTemplates)
        .filter((projectTemplate) => projectTemplate.isActive)
        .map((projectTemplate) => [projectTemplate.project.id, toProject(projectTemplate.project)])
    );

    return {
      field: toFieldDefinition(field),
      templateCount: new Set(templates.map((template) => template.id)).size,
      projectCount: projectMap.size,
      templates,
      projects: Array.from(projectMap.values())
    };
  }

  private async resolveFieldKey(input: string, prisma: PrismaWriter, currentFieldId?: string) {
    const base = this.toFieldKey(input);
    let candidate = base;
    let suffix = 1;

    while (await this.fieldKeyExists(candidate, prisma, currentFieldId)) {
      suffix += 1;
      candidate = `${base}_${suffix}`;
    }

    return candidate;
  }

  private async fieldKeyExists(fieldKey: string, prisma: PrismaWriter, currentFieldId?: string) {
    const existing = await prisma.fieldDefinition.findUnique({
      where: {
        fieldKey
      }
    });

    return Boolean(existing && existing.id !== currentFieldId);
  }

  private toFieldKey(input: string) {
    const normalized = input
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();

    if (normalized) {
      return normalized;
    }

    return `field_${createHash('sha1').update(input).digest('hex').slice(0, 8)}`;
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
}
