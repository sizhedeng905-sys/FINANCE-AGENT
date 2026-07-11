import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusinessRecordStatus,
  DataRecordType,
  FieldDefinition,
  FieldType,
  Prisma,
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

    if (dto.status === BusinessRecordStatus.confirmed || dto.status === BusinessRecordStatus.rejected) {
      throw new BadRequestException('新建记录不能直接进入已确认或已作废状态');
    }

    return this.prisma.$transaction(async (tx) => {
      const templateFields = await this.validateProjectTemplateAndValues(
        tx,
        dto.projectId,
        dto.templateId,
        dto.recordType,
        dto.values
      );

      const record = await tx.businessRecord.create({
        data: {
          projectId: dto.projectId,
          templateId: dto.templateId,
          recordType: dto.recordType,
          recordDate: new Date(dto.recordDate),
          amount: new Prisma.Decimal(dto.amount),
          category: dto.category,
          subCategory: dto.subCategory,
          description: dto.description,
          sourceType: RecordSourceType.manual,
          sourceId: dto.sourceId ?? 'manual',
          status: dto.status ?? BusinessRecordStatus.pending_confirm,
          attachments: dto.attachments ?? [],
          createdBy: actor.username,
          values: {
            create: dto.values.map((value) => this.buildRecordValueCreate(value, templateFields.get(value.fieldId)!))
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
      if (before.status === BusinessRecordStatus.confirmed) {
        throw new BadRequestException('已确认记录不能直接修改');
      }

      const templateFields = dto.values
        ? await this.validateProjectTemplateAndValues(
            tx,
            before.projectId,
            before.templateId,
            dto.recordType ?? before.recordType,
            dto.values
          )
        : undefined;

      await tx.businessRecord.update({
        where: {
          id
        },
        data: {
          recordType: dto.recordType,
          recordDate: dto.recordDate ? new Date(dto.recordDate) : undefined,
          amount: dto.amount !== undefined ? new Prisma.Decimal(dto.amount) : undefined,
          category: dto.category,
          subCategory: dto.subCategory,
          description: dto.description,
          status: dto.status,
          attachments: dto.attachments
        }
      });

      if (dto.values && templateFields) {
        await tx.recordValue.deleteMany({
          where: {
            recordId: id
          }
        });

        for (const value of dto.values) {
          await tx.recordValue.create({
            data: {
              recordId: id,
              ...this.buildRecordValueCreate(value, templateFields.get(value.fieldId)!)
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
      if (before.status === BusinessRecordStatus.rejected) {
        throw new BadRequestException('已作废记录不能确认');
      }

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
    return {
      projectId: query.projectId,
      templateId: query.templateId,
      recordType: query.recordType,
      sourceType: query.sourceType,
      status: query.status,
      recordDate:
        query.dateFrom || query.dateTo
          ? {
              gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
              lte: query.dateTo ? new Date(query.dateTo) : undefined
            }
          : undefined
    };
  }

  private async validateProjectTemplateAndValues(
    prisma: PrismaWriter,
    projectId: string,
    templateId: string,
    recordType: DataRecordType,
    values: RecordValueInputDto[]
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

    if (!template || !projectTemplate || !projectTemplate.isActive) {
      throw new BadRequestException('模板未被该项目启用');
    }

    if (template.recordType !== recordType) {
      throw new BadRequestException('记录类型与模板类型不一致');
    }

    const templateFieldMap = new Map(template.templateFields.map((templateField) => [templateField.fieldId, templateField.field]));
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
      const numericValue = Number(value.value);
      if (Number.isNaN(numericValue)) {
        throw new BadRequestException(`${field.fieldName} 必须是数字`);
      }

      return {
        ...base,
        valueNumber: new Prisma.Decimal(numericValue)
      };
    }

    if (field.fieldType === FieldType.date) {
      const dateValue = new Date(String(value.value));
      if (Number.isNaN(dateValue.getTime())) {
        throw new BadRequestException(`${field.fieldName} 必须是日期`);
      }

      return {
        ...base,
        valueDate: dateValue
      };
    }

    if (field.fieldType === FieldType.file) {
      const jsonValue = Array.isArray(value.value) ? value.value : [String(value.value)];
      return {
        ...base,
        valueJson: jsonValue
      };
    }

    return {
      ...base,
      valueText: String(value.value)
    };
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
