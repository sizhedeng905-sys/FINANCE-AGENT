import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProjectStatus, UserRole } from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  toProject,
  toProjectTemplate,
  toProjectTemplateWithTemplate,
  toBusinessRecord,
  toTemplate,
  toTemplateField
} from '../data-center/data-center.presenter';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { toRawFile } from '../files/file.presenter';
import { CreateProjectDto } from './dto/create-project.dto';
import { CreateProjectTemplateDto } from './dto/create-project-template.dto';
import { QueryProjectsDto } from './dto/query-projects.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectTemplateDto } from './dto/update-project-template.dto';

type PrismaWriter = Prisma.TransactionClient | PrismaService;
type PresentedProject = ReturnType<typeof toProject>;
type PresentedProjectTemplate = ReturnType<typeof toProjectTemplate>;
type PresentedTemplate = ReturnType<typeof toTemplate>;
type PresentedTemplateField = ReturnType<typeof toTemplateField>;
type PresentedBusinessRecord = ReturnType<typeof toBusinessRecord>;
type PresentedRawFile = ReturnType<typeof toRawFile>;

export interface EnabledTemplateInfo {
  projectTemplate: PresentedProjectTemplate;
  template: PresentedTemplate;
  fields: PresentedTemplateField[];
  records: PresentedBusinessRecord[];
}

export interface FieldUsageStat {
  fieldId: string;
  fieldName: string;
  fieldKey: string;
  fieldType: PresentedTemplateField['field']['fieldType'];
  semanticType: PresentedTemplateField['field']['semanticType'];
  templateNames: string[];
  usageCount: number;
  sourceTypes: string[];
  latestUsedAt?: string;
  isSuggestedField: boolean;
}

export interface ProjectStructure {
  project: PresentedProject;
  enabledTemplates: EnabledTemplateInfo[];
  templateFields: PresentedTemplateField[];
  records: PresentedBusinessRecord[];
  rawFiles: PresentedRawFile[];
  importTasks: never[];
  fieldUsageStats: FieldUsageStat[];
  logicalTablesSummary: Array<{
    projectId: string;
    tableName: string;
    description: string;
    relatedCount: number;
    keyFields: string[];
  }>;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async findMany(query: QueryProjectsDto, user: CurrentUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ProjectWhereInput = {};

    if (user.role === UserRole.employee) {
      where.status = ProjectStatus.active;
    } else if (query.status) {
      where.status = query.status;
    }

    if (query.keyword) {
      where.OR = [
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { customerName: { contains: query.keyword, mode: 'insensitive' } },
        { ownerName: { contains: query.keyword, mode: 'insensitive' } }
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy: {
          createdAt: 'desc'
        },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.project.count({ where })
    ]);

    return {
      items: items.map(toProject),
      page,
      pageSize,
      total
    };
  }

  async findOne(id: string) {
    return toProject(await this.findProjectOrThrow(id));
  }

  async create(dto: CreateProjectDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: dto.name,
          customerName: dto.customerName,
          description: dto.description,
          ownerName: dto.ownerName,
          status: dto.status ?? ProjectStatus.active,
          createdBy: actor.username
        }
      });

      await this.auditLogs.write(tx, actor, 'project.create', 'project', project.id, { after: toProject(project) }, context);

      return toProject(project);
    });
  }

  async update(id: string, dto: UpdateProjectDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findProjectOrThrow(id, tx);
      const project = await tx.project.update({
        where: {
          id
        },
        data: dto
      });

      await this.auditLogs.write(
        tx,
        actor,
        'project.update',
        'project',
        project.id,
        { before: toProject(before), after: toProject(project) },
        context
      );

      return toProject(project);
    });
  }

  async archive(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findProjectOrThrow(id, tx);
      const project = await tx.project.update({
        where: {
          id
        },
        data: {
          status: ProjectStatus.archived
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'project.archive',
        'project',
        project.id,
        { before: before.status, after: project.status },
        context
      );

      return {
        id: project.id,
        status: project.status
      };
    });
  }

  async getStructure(id: string): Promise<ProjectStructure> {
    const project = await this.findProjectOrThrow(id);
    const projectTemplates = await this.prisma.projectTemplate.findMany({
      where: {
        projectId: id,
        isActive: true
      },
      include: {
        template: {
          include: {
            templateFields: {
              include: {
                field: true
              },
              orderBy: {
                displayOrder: 'asc'
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    const records = (
      await this.prisma.businessRecord.findMany({
        where: {
          projectId: id
        },
        include: {
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
        },
        orderBy: {
          recordDate: 'desc'
        }
      })
    ).map(toBusinessRecord);
    const rawFiles = (
      await this.prisma.rawFile.findMany({
        where: { relatedProjectId: id },
        orderBy: { uploadedAt: 'desc' }
      })
    ).map(toRawFile);

    const enabledTemplates = projectTemplates.map((projectTemplate) => ({
      projectTemplate: toProjectTemplate(projectTemplate),
      template: toTemplate(projectTemplate.template),
      fields: projectTemplate.template.templateFields.map(toTemplateField),
      records: records.filter((record) => record.templateId === projectTemplate.templateId)
    }));
    const templateFields = enabledTemplates.flatMap((item) => item.fields);

    return {
      project: toProject(project),
      enabledTemplates,
      templateFields,
      records,
      rawFiles,
      importTasks: [],
      fieldUsageStats: this.getFieldUsageStats(enabledTemplates, records),
      logicalTablesSummary: this.getLogicalTablesSummary(id, enabledTemplates, records, rawFiles.length)
    };
  }

  async getSummary(id: string) {
    const structure = await this.getStructure(id);
    const activeRecords = structure.records.filter((record) => record.status !== 'rejected');
    const incomeRecords = activeRecords.filter(
      (record) => record.recordType === 'revenue' || record.category === '收入'
    );
    const costRecords = activeRecords.filter(
      (record) => record.recordType !== 'revenue' && record.category !== '收入'
    );
    const totalIncome = incomeRecords.reduce((sum, record) => sum + record.amount, 0);
    const totalCost = costRecords.reduce((sum, record) => sum + record.amount, 0);

    return {
      project: structure.project,
      enabledTemplateCount: structure.enabledTemplates.length,
      fieldCount: structure.fieldUsageStats.length,
      recordCount: structure.records.length,
      rawFileCount: structure.rawFiles.length,
      importTaskCount: structure.importTasks.length,
      totalIncome,
      totalCost,
      profit: totalIncome - totalCost
    };
  }

  async getProjectTemplates(projectId: string) {
    await this.findProjectOrThrow(projectId);
    const projectTemplates = await this.prisma.projectTemplate.findMany({
      where: {
        projectId
      },
      include: {
        template: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return projectTemplates.map(toProjectTemplateWithTemplate);
  }

  async enableTemplate(projectId: string, dto: CreateProjectTemplateDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      await this.findProjectOrThrow(projectId, tx);
      await this.findTemplateOrThrow(dto.templateId, tx);

      const projectTemplate = await tx.projectTemplate.upsert({
        where: {
          projectId_templateId: {
            projectId,
            templateId: dto.templateId
          }
        },
        create: {
          projectId,
          templateId: dto.templateId,
          customName: dto.customName,
          isActive: dto.isActive ?? true
        },
        update: {
          customName: dto.customName,
          isActive: dto.isActive ?? true
        }
      });

      await this.auditLogs.write(
        tx,
        actor,
        'project_template.enable',
        'project_template',
        projectTemplate.id,
        { after: toProjectTemplate(projectTemplate) },
        context
      );

      return toProjectTemplate(projectTemplate);
    });
  }

  async updateProjectTemplate(id: string, dto: UpdateProjectTemplateDto, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findProjectTemplateOrThrow(id, tx);
      const projectTemplate = await tx.projectTemplate.update({
        where: {
          id
        },
        data: dto
      });

      await this.auditLogs.write(
        tx,
        actor,
        'project_template.update',
        'project_template',
        projectTemplate.id,
        { before: toProjectTemplate(before), after: toProjectTemplate(projectTemplate) },
        context
      );

      return toProjectTemplate(projectTemplate);
    });
  }

  async disableProjectTemplate(id: string, actor: CurrentUser, context: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findProjectTemplateOrThrow(id, tx);
      const projectTemplate = await tx.projectTemplate.update({
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
        'project_template.disable',
        'project_template',
        projectTemplate.id,
        { before: before.isActive, after: projectTemplate.isActive },
        context
      );

      return toProjectTemplate(projectTemplate);
    });
  }

  private getFieldUsageStats(enabledTemplates: EnabledTemplateInfo[], records: PresentedBusinessRecord[]): FieldUsageStat[] {
    const stats = new Map<string, FieldUsageStat>();

    for (const templateInfo of enabledTemplates) {
      for (const templateField of templateInfo.fields) {
        const existing = stats.get(templateField.fieldId);
        const templateName = templateInfo.projectTemplate.customName || templateInfo.template.name;
        const base =
          existing ??
          ({
            fieldId: templateField.fieldId,
            fieldName: templateField.field.fieldName,
            fieldKey: templateField.field.fieldKey,
            fieldType: templateField.field.fieldType,
            semanticType: templateField.field.semanticType,
            templateNames: [],
            usageCount: 0,
            sourceTypes: [],
            latestUsedAt: undefined,
            isSuggestedField: false
          });

        stats.set(templateField.fieldId, {
          ...base,
          templateNames: Array.from(new Set([...base.templateNames, templateName]))
        });
      }
    }

    for (const record of records) {
      for (const value of record.values) {
        const field = enabledTemplates.flatMap((template) => template.fields).find((item) => item.fieldId === value.fieldId)?.field;
        const existing = stats.get(value.fieldId);
        const base =
          existing ??
          (field && {
            fieldId: value.fieldId,
            fieldName: value.fieldName,
            fieldKey: field.fieldKey,
            fieldType: field.fieldType,
            semanticType: field.semanticType,
            templateNames: [record.templateName],
            usageCount: 0,
            sourceTypes: [],
            latestUsedAt: undefined,
            isSuggestedField: false
          });

        if (!base) {
          continue;
        }

        stats.set(value.fieldId, {
          ...base,
          usageCount: value.value === null || value.value === '' ? base.usageCount : base.usageCount + 1,
          sourceTypes: Array.from(new Set([...base.sourceTypes, record.sourceType])),
          latestUsedAt: !base.latestUsedAt || record.updatedAt > base.latestUsedAt ? record.updatedAt : base.latestUsedAt
        });
      }
    }

    return Array.from(stats.values()).sort((first, second) => second.usageCount - first.usageCount || first.fieldName.localeCompare(second.fieldName));
  }

  private getLogicalTablesSummary(
    projectId: string,
    enabledTemplates: EnabledTemplateInfo[],
    records: PresentedBusinessRecord[],
    rawFileCount: number
  ) {
    const fieldIds = new Set(enabledTemplates.flatMap((item) => item.fields.map((field) => field.fieldId)));
    const recordValuesCount = records.flatMap((record) => record.values).length;

    return [
      {
        tableName: 'projects',
        description: '项目主表',
        relatedCount: 1,
        keyFields: ['id', 'name', 'customerName', 'status']
      },
      {
        tableName: 'templates',
        description: '数据模板表',
        relatedCount: enabledTemplates.length,
        keyFields: ['id', 'name', 'recordType', 'isSystem']
      },
      {
        tableName: 'field_definitions',
        description: '字段字典表',
        relatedCount: fieldIds.size,
        keyFields: ['id', '系统识别名', '字段名称', '字段类型', '语义类型']
      },
      {
        tableName: 'template_fields',
        description: '模板字段关系表',
        relatedCount: enabledTemplates.flatMap((item) => item.fields).length,
        keyFields: ['templateId', 'fieldId', 'isRequired', 'displayOrder']
      },
      {
        tableName: 'project_templates',
        description: '项目启用模板关系表',
        relatedCount: enabledTemplates.length,
        keyFields: ['projectId', 'templateId', 'customName', 'isActive']
      },
      {
        tableName: 'business_records',
        description: '业务数据记录主表',
        relatedCount: records.length,
        keyFields: ['id', 'projectId', 'templateId', 'recordType', 'sourceType']
      },
      {
        tableName: 'record_values',
        description: '动态字段值表',
        relatedCount: recordValuesCount,
        keyFields: ['recordId', 'fieldId', 'fieldName', 'value']
      },
      {
        tableName: 'raw_files',
        description: '原始来源文件表',
        relatedCount: rawFileCount,
        keyFields: ['id', 'fileName', 'fileType', 'relatedProjectId']
      },
      {
        tableName: 'import_tasks',
        description: 'Excel导入任务表',
        relatedCount: 0,
        keyFields: ['id', 'projectId', 'templateId', 'status']
      },
      {
        tableName: 'work_orders',
        description: '工单主表',
        relatedCount: 0,
        keyFields: ['id', 'projectId', 'status', 'amount']
      }
    ].map((item) => ({
      ...item,
      projectId
    }));
  }

  private async findProjectOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const project = await prisma.project.findUnique({
      where: {
        id
      }
    });

    if (!project) {
      throw new NotFoundException('资源不存在');
    }

    return project;
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

  private async findProjectTemplateOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const projectTemplate = await prisma.projectTemplate.findUnique({
      where: {
        id
      }
    });

    if (!projectTemplate) {
      throw new NotFoundException('资源不存在');
    }

    return projectTemplate;
  }
}
