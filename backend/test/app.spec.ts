import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccountingDirection,
  BusinessRecordStatus,
  DataRecordType,
  FieldType,
  ProjectStatus,
  RecordSourceType,
  SemanticType,
  UserRole,
  UserStatus
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { PrismaService } from '../src/prisma/prisma.service';

interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  department: string | null;
  phone: string | null;
  status: UserStatus;
  tokenVersion: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectRecord {
  id: string;
  name: string;
  customerName: string;
  description: string | null;
  ownerName: string;
  status: ProjectStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TemplateRecord {
  id: string;
  name: string;
  recordType: DataRecordType;
  accountingDirection: AccountingDirection;
  primaryAmountFieldId: string | null;
  primaryDateFieldId: string | null;
  version: number;
  description: string | null;
  isSystem: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FieldRecord {
  id: string;
  fieldKey: string;
  fieldName: string;
  fieldType: FieldType;
  unit: string | null;
  semanticType: SemanticType;
  aliases: string[];
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface TemplateFieldRecord {
  id: string;
  templateId: string;
  fieldId: string;
  isRequired: boolean;
  isVisible: boolean;
  displayOrder: number;
  defaultValue: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectTemplateRecord {
  id: string;
  projectId: string;
  templateId: string;
  recordType: DataRecordType;
  customName: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface BusinessRecordRecord {
  id: string;
  projectId: string;
  templateId: string;
  recordType: DataRecordType;
  accountingDirection: AccountingDirection;
  templateVersion: number;
  version: number;
  recordDate: Date;
  amount: number;
  category: string | null;
  subCategory: string | null;
  description: string | null;
  sourceType: RecordSourceType;
  sourceId: string;
  status: BusinessRecordStatus;
  attachments: string[];
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
}

interface RecordValueRecord {
  id: string;
  recordId: string;
  fieldId: string;
  fieldName: string;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  valueJson: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

class InMemoryPrisma {
  users: UserRecord[] = [];
  projects: ProjectRecord[] = [];
  templates: TemplateRecord[] = [];
  fieldDefinitions: FieldRecord[] = [];
  templateFields: TemplateFieldRecord[] = [];
  projectTemplates: ProjectTemplateRecord[] = [];
  businessRecords: BusinessRecordRecord[] = [];
  recordValues: RecordValueRecord[] = [];
  ledgerEvents: Array<Record<string, unknown>> = [];
  rawFiles: Array<Record<string, unknown>> = [];
  auditLogs: Array<Record<string, unknown>> = [];
  private userCounter = 0;
  private projectCounter = 0;
  private templateCounter = 0;
  private fieldCounter = 0;
  private templateFieldCounter = 0;
  private projectTemplateCounter = 0;
  private businessRecordCounter = 0;
  private recordValueCounter = 0;
  private ledgerEventCounter = 0;
  private auditCounter = 0;

  user = {
    findUnique: async ({ where }: { where: { id?: string; username?: string } }) =>
      this.users.find((user) => user.id === where.id || user.username === where.username) ?? null,
    findMany: async ({ where, skip = 0, take = 20 }: { where?: Record<string, unknown>; skip?: number; take?: number }) =>
      this.applyUserWhere(where)
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
        .slice(skip, skip + take),
    count: async ({ where }: { where?: Record<string, unknown> }) => this.applyUserWhere(where).length,
    create: async ({ data }: { data: Partial<UserRecord> & { passwordHash: string; username: string; name: string; role: UserRole } }) => {
      if (this.users.some((user) => user.username === data.username)) {
        throw { code: 'P2002', meta: { target: ['username'] } };
      }

      const now = new Date();
      const user: UserRecord = {
        id: `user_${++this.userCounter}`,
        username: data.username,
        passwordHash: data.passwordHash,
        name: data.name,
        role: data.role,
        department: data.department ?? null,
        phone: data.phone ?? null,
        status: data.status ?? UserStatus.active,
        tokenVersion: data.tokenVersion ?? 0,
        createdBy: data.createdBy ?? null,
        createdAt: now,
        updatedAt: now
      };

      this.users.push(user);
      return user;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<UserRecord> }) => {
      const user = this.users.find((item) => item.id === where.id);
      if (!user) {
        throw new Error('User not found');
      }

      if (data.username && this.users.some((item) => item.id !== where.id && item.username === data.username)) {
        throw { code: 'P2002', meta: { target: ['username'] } };
      }

      const tokenVersionUpdate = data.tokenVersion as unknown;
      const normalizedData = { ...data } as Partial<UserRecord>;
      if (typeof tokenVersionUpdate === 'object' && tokenVersionUpdate !== null && 'increment' in tokenVersionUpdate) {
        normalizedData.tokenVersion = user.tokenVersion + Number((tokenVersionUpdate as { increment: number }).increment);
      }
      Object.assign(user, normalizedData, { updatedAt: new Date() });
      return user;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = this.users.findIndex((item) => item.id === where.id);
      if (index < 0) {
        throw new Error('User not found');
      }

      const [deleted] = this.users.splice(index, 1);
      return deleted;
    }
  };

  project = {
    findUnique: async ({ where }: { where: { id: string } }) => this.projects.find((project) => project.id === where.id) ?? null,
    findMany: async ({ where, skip = 0, take = 20 }: { where?: Record<string, unknown>; skip?: number; take?: number }) =>
      this.applyProjectWhere(where)
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
        .slice(skip, skip + take),
    count: async ({ where }: { where?: Record<string, unknown> }) => this.applyProjectWhere(where).length,
    create: async ({ data }: { data: Partial<ProjectRecord> & Pick<ProjectRecord, 'name' | 'customerName' | 'ownerName'> }) => {
      const now = new Date();
      const project: ProjectRecord = {
        id: data.id ?? `project_${++this.projectCounter}`,
        name: data.name,
        customerName: data.customerName,
        description: data.description ?? null,
        ownerName: data.ownerName,
        status: data.status ?? ProjectStatus.active,
        createdBy: data.createdBy ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.projects.push(project);
      return project;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<ProjectRecord> }) => {
      const project = this.projects.find((item) => item.id === where.id);
      if (!project) throw new Error('Project not found');
      Object.assign(project, data, { updatedAt: new Date() });
      return project;
    }
  };

  template = {
    findUnique: async ({ where, include }: { where: { id: string }; include?: Record<string, unknown> }) => {
      const template = this.templates.find((item) => item.id === where.id);
      return template ? this.withTemplateInclude(template, include) : null;
    },
    findMany: async ({ where, skip = 0, take = 20 }: { where?: Record<string, unknown>; skip?: number; take?: number }) =>
      this.applyTemplateWhere(where)
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
        .slice(skip, skip + take),
    count: async ({ where }: { where?: Record<string, unknown> }) => {
      const primaryFilters = where?.OR as Array<{ primaryAmountFieldId?: string; primaryDateFieldId?: string }> | undefined;
      if (primaryFilters?.some((item) => item.primaryAmountFieldId !== undefined || item.primaryDateFieldId !== undefined)) {
        return this.templates.filter((template) => primaryFilters.some((filter) =>
          (filter.primaryAmountFieldId !== undefined && template.primaryAmountFieldId === filter.primaryAmountFieldId) ||
          (filter.primaryDateFieldId !== undefined && template.primaryDateFieldId === filter.primaryDateFieldId)
        )).length;
      }
      return this.applyTemplateWhere(where).length;
    },
    create: async ({ data }: { data: any }) => {
      const now = new Date();
      const template: TemplateRecord = {
        id: data.id ?? `template_${++this.templateCounter}`,
        name: data.name,
        recordType: data.recordType,
        accountingDirection:
          data.accountingDirection ??
          (data.recordType === DataRecordType.revenue ? AccountingDirection.income : AccountingDirection.expense),
        primaryAmountFieldId: data.primaryAmountFieldId ?? null,
        primaryDateFieldId: data.primaryDateFieldId ?? null,
        version: data.version ?? 1,
        description: data.description ?? null,
        isSystem: data.isSystem ?? false,
        createdBy: data.createdBy ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.templates.push(template);

      const nestedFields = data.templateFields?.create as Array<Partial<TemplateFieldRecord> & { fieldId: string }> | undefined;
      if (nestedFields) {
        for (const nestedField of nestedFields) {
          await this.templateField.create({
            data: {
              ...nestedField,
              templateId: template.id
            }
          });
        }
      }

      return template;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const template = this.templates.find((item) => item.id === where.id);
      if (!template) throw new Error('Template not found');
      const cleanData = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
      if (typeof data.version === 'object') cleanData.version = template.version + data.version.increment;
      Object.assign(template, cleanData, { updatedAt: new Date() });
      return template;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = this.templates.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error('Template not found');
      const [deleted] = this.templates.splice(index, 1);
      this.templateFields = this.templateFields.filter((item) => item.templateId !== where.id);
      this.projectTemplates = this.projectTemplates.filter((item) => item.templateId !== where.id);
      return deleted;
    }
  };

  fieldDefinition = {
    findUnique: async ({ where }: { where: { id?: string; fieldKey?: string } }) =>
      this.fieldDefinitions.find(
        (field) =>
          (where.id !== undefined && field.id === where.id) ||
          (where.fieldKey !== undefined && field.fieldKey === where.fieldKey)
      ) ?? null,
    findMany: async ({ where, skip = 0, take = 20 }: { where?: Record<string, unknown>; skip?: number; take?: number }) =>
      this.applyFieldWhere(where)
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
        .slice(skip, skip + take),
    count: async ({ where }: { where?: Record<string, unknown> }) => this.applyFieldWhere(where).length,
    create: async ({ data }: { data: Partial<FieldRecord> & Pick<FieldRecord, 'fieldKey' | 'fieldName' | 'fieldType' | 'semanticType'> }) => {
      if (this.fieldDefinitions.some((field) => field.fieldKey === data.fieldKey)) {
        throw { code: 'P2002', meta: { target: ['field_key'] } };
      }
      const now = new Date();
      const field: FieldRecord = {
        id: data.id ?? `field_${++this.fieldCounter}`,
        fieldKey: data.fieldKey,
        fieldName: data.fieldName,
        fieldType: data.fieldType,
        unit: data.unit ?? null,
        semanticType: data.semanticType,
        aliases: data.aliases ?? [],
        description: data.description ?? null,
        isActive: data.isActive ?? true,
        createdAt: now,
        updatedAt: now
      };
      this.fieldDefinitions.push(field);
      return field;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FieldRecord> }) => {
      const field = this.fieldDefinitions.find((item) => item.id === where.id);
      if (!field) throw new Error('Field not found');
      const definedData = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
      Object.assign(field, definedData, { updatedAt: new Date() });
      return field;
    }
  };

  templateField = {
    findUnique: async ({ where, include }: { where: { id?: string; templateId_fieldId?: { templateId: string; fieldId: string } }; include?: Record<string, unknown> }) => {
      const templateField = this.templateFields.find(
        (item) =>
          item.id === where.id ||
          (where.templateId_fieldId &&
            item.templateId === where.templateId_fieldId.templateId &&
            item.fieldId === where.templateId_fieldId.fieldId)
      );
      return templateField ? this.withTemplateFieldInclude(templateField, include) : null;
    },
    findMany: async ({ where, include, orderBy }: { where?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: Record<string, string> }) => {
      let items = this.templateFields.filter((item) => {
        if (where?.templateId && item.templateId !== where.templateId) return false;
        if (where?.fieldId && item.fieldId !== where.fieldId) return false;
        return true;
      });
      if (orderBy?.displayOrder === 'asc') {
        items = items.sort((first, second) => first.displayOrder - second.displayOrder);
      }
      if (orderBy?.displayOrder === 'desc') {
        items = items.sort((first, second) => second.displayOrder - first.displayOrder);
      }
      return items.map((item) => this.withTemplateFieldInclude(item, include));
    },
    findFirst: async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Record<string, string> }) => {
      const items = await this.templateField.findMany({ where, orderBy });
      return items[0] ?? null;
    },
    count: async ({ where }: { where?: { templateId?: string } }) =>
      this.templateFields.filter((item) => !where?.templateId || item.templateId === where.templateId).length,
    create: async ({ data, include }: { data: Partial<TemplateFieldRecord> & Pick<TemplateFieldRecord, 'templateId' | 'fieldId'>; include?: Record<string, unknown> }) => {
      if (this.templateFields.some((item) => item.templateId === data.templateId && item.fieldId === data.fieldId)) {
        throw { code: 'P2002', meta: { target: ['template_id', 'field_id'] } };
      }
      const now = new Date();
      const templateField: TemplateFieldRecord = {
        id: data.id ?? `template_field_${++this.templateFieldCounter}`,
        templateId: data.templateId,
        fieldId: data.fieldId,
        isRequired: data.isRequired ?? false,
        isVisible: data.isVisible ?? true,
        displayOrder: data.displayOrder ?? 0,
        defaultValue: data.defaultValue ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.templateFields.push(templateField);
      return this.withTemplateFieldInclude(templateField, include);
    },
    update: async ({ where, data, include }: { where: { id: string }; data: Partial<TemplateFieldRecord>; include?: Record<string, unknown> }) => {
      const templateField = this.templateFields.find((item) => item.id === where.id);
      if (!templateField) throw new Error('Template field not found');
      Object.assign(templateField, data, { updatedAt: new Date() });
      return this.withTemplateFieldInclude(templateField, include);
    },
    updateMany: async ({
      where,
      data
    }: {
      where: {
        templateId?: string;
        id?: { not?: string };
        fieldId?: string | { in?: string[] };
        displayOrder?: { gte?: number; gt?: number; lte?: number; lt?: number };
      };
      data: {
        displayOrder?: number | { increment?: number; decrement?: number };
        isRequired?: boolean;
        isVisible?: boolean;
      };
    }) => {
      let count = 0;
      for (const item of this.templateFields) {
        if (where.templateId && item.templateId !== where.templateId) continue;
        if (typeof where.fieldId === 'string' && item.fieldId !== where.fieldId) continue;
        if (typeof where.fieldId === 'object' && where.fieldId.in && !where.fieldId.in.includes(item.fieldId)) continue;
        if (where.id?.not && item.id === where.id.not) continue;
        if (where.displayOrder?.gte !== undefined && item.displayOrder < where.displayOrder.gte) continue;
        if (where.displayOrder?.gt !== undefined && item.displayOrder <= where.displayOrder.gt) continue;
        if (where.displayOrder?.lte !== undefined && item.displayOrder > where.displayOrder.lte) continue;
        if (where.displayOrder?.lt !== undefined && item.displayOrder >= where.displayOrder.lt) continue;
        if (typeof data.displayOrder === 'number') item.displayOrder = data.displayOrder;
        if (typeof data.displayOrder === 'object') {
          item.displayOrder += data.displayOrder.increment ?? 0;
          item.displayOrder -= data.displayOrder.decrement ?? 0;
        }
        if (data.isRequired !== undefined) item.isRequired = data.isRequired;
        if (data.isVisible !== undefined) item.isVisible = data.isVisible;
        item.updatedAt = new Date();
        count += 1;
      }
      return { count };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = this.templateFields.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error('Template field not found');
      const [deleted] = this.templateFields.splice(index, 1);
      return deleted;
    }
  };

  projectTemplate = {
    findUnique: async ({
      where
    }: {
      where: { id?: string; projectId_templateId?: { projectId: string; templateId: string } };
    }) =>
      this.projectTemplates.find(
        (item) =>
          item.id === where.id ||
          (where.projectId_templateId &&
            item.projectId === where.projectId_templateId.projectId &&
            item.templateId === where.projectId_templateId.templateId)
      ) ?? null,
    findFirst: async ({ where, include }: { where?: Record<string, unknown>; include?: Record<string, unknown> }) => {
      const items = await this.projectTemplate.findMany({ where, include });
      return items[0] ?? null;
    },
    findMany: async ({ where, include, orderBy }: { where?: Record<string, unknown>; include?: Record<string, unknown>; orderBy?: Record<string, string> }) => {
      let items = this.projectTemplates.filter((item) => {
        if (where?.projectId && item.projectId !== where.projectId) return false;
        if (where?.templateId && item.templateId !== where.templateId) return false;
        if (where?.recordType && item.recordType !== where.recordType) return false;
        if (typeof where?.isActive === 'boolean' && item.isActive !== where.isActive) return false;
        return true;
      });
      if (orderBy?.createdAt === 'asc') {
        items = items.sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
      }
      if (orderBy?.createdAt === 'desc') {
        items = items.sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
      }
      return items.map((item) => this.withProjectTemplateInclude(item, include));
    },
    count: async ({ where }: { where?: Record<string, unknown> }) =>
      (await this.projectTemplate.findMany({ where })).length,
    create: async ({ data }: { data: Partial<ProjectTemplateRecord> & Pick<ProjectTemplateRecord, 'projectId' | 'templateId'> }) => {
      if (this.projectTemplates.some((item) => item.projectId === data.projectId && item.templateId === data.templateId)) {
        throw { code: 'P2002', meta: { target: ['project_id', 'template_id'] } };
      }
      const now = new Date();
      const projectTemplate: ProjectTemplateRecord = {
        id: data.id ?? `project_template_${++this.projectTemplateCounter}`,
        projectId: data.projectId,
        templateId: data.templateId,
        recordType: data.recordType ?? this.templates.find((item) => item.id === data.templateId)!.recordType,
        customName: data.customName ?? null,
        isActive: data.isActive ?? true,
        createdAt: now,
        updatedAt: now
      };
      this.projectTemplates.push(projectTemplate);
      return projectTemplate;
    },
    upsert: async ({ where, create, update }: { where: { projectId_templateId: { projectId: string; templateId: string } }; create: Partial<ProjectTemplateRecord> & Pick<ProjectTemplateRecord, 'projectId' | 'templateId'>; update: Partial<ProjectTemplateRecord> }) => {
      const existing = this.projectTemplates.find(
        (item) =>
          item.projectId === where.projectId_templateId.projectId && item.templateId === where.projectId_templateId.templateId
      );
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }

      const now = new Date();
      const projectTemplate: ProjectTemplateRecord = {
        id: create.id ?? `project_template_${++this.projectTemplateCounter}`,
        projectId: create.projectId,
        templateId: create.templateId,
        recordType: create.recordType ?? this.templates.find((item) => item.id === create.templateId)!.recordType,
        customName: create.customName ?? null,
        isActive: create.isActive ?? true,
        createdAt: now,
        updatedAt: now
      };
      this.projectTemplates.push(projectTemplate);
      return projectTemplate;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<ProjectTemplateRecord> }) => {
      const projectTemplate = this.projectTemplates.find((item) => item.id === where.id);
      if (!projectTemplate) throw new Error('Project template not found');
      Object.assign(projectTemplate, data, { updatedAt: new Date() });
      return projectTemplate;
    }
  };

  rawFile = {
    findMany: async () => this.rawFiles
  };

  importTask = {
    findMany: async () => [],
    count: async () => 0
  };

  ocrTask = {
    findMany: async () => [],
    count: async () => 0
  };

  workOrder = {
    count: async () => 0
  };

  businessRecord = {
    findUnique: async ({ where, include }: { where: { id: string }; include?: Record<string, unknown> }) => {
      const record = this.businessRecords.find((item) => item.id === where.id);
      return record ? this.withBusinessRecordInclude(record, include) : null;
    },
    findMany: async ({
      where,
      include,
      orderBy,
      skip = 0,
      take = 20
    }: {
      where?: Record<string, unknown>;
      include?: Record<string, unknown>;
      orderBy?: Record<string, string>;
      skip?: number;
      take?: number;
    }) => {
      let records = this.applyBusinessRecordWhere(where);
      if (orderBy?.createdAt === 'desc') {
        records = records.sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
      }
      if (orderBy?.recordDate === 'desc') {
        records = records.sort((first, second) => second.recordDate.getTime() - first.recordDate.getTime());
      }
      return records.slice(skip, skip + take).map((record) => this.withBusinessRecordInclude(record, include));
    },
    count: async ({ where }: { where?: Record<string, unknown> }) => this.applyBusinessRecordWhere(where).length,
    create: async ({ data, include }: { data: any; include?: Record<string, unknown> }) => {
      const now = new Date();
      const record: BusinessRecordRecord = {
        id: data.id ?? `business_record_${++this.businessRecordCounter}`,
        projectId: data.projectId,
        templateId: data.templateId,
        recordType: data.recordType,
        accountingDirection: data.accountingDirection ?? AccountingDirection.expense,
        templateVersion: data.templateVersion ?? 1,
        version: data.version ?? 1,
        recordDate: new Date(data.recordDate),
        amount: Number(data.amount),
        category: data.category ?? null,
        subCategory: data.subCategory ?? null,
        description: data.description ?? null,
        sourceType: data.sourceType ?? RecordSourceType.manual,
        sourceId: data.sourceId ?? 'manual',
        status: data.status ?? BusinessRecordStatus.pending_confirm,
        attachments: data.attachments ?? [],
        createdBy: data.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
        confirmedAt: data.confirmedAt ?? null,
        confirmedBy: data.confirmedBy ?? null,
        voidedAt: data.voidedAt ?? null,
        voidedBy: data.voidedBy ?? null
      };

      this.businessRecords.push(record);

      const nestedValues = data.values?.create as Array<Record<string, unknown>> | undefined;
      if (nestedValues) {
        for (const value of nestedValues) {
          await this.recordValue.create({
            data: {
              ...value,
              recordId: record.id
            }
          });
        }
      }

      return this.withBusinessRecordInclude(record, include);
    },
    update: async ({ where, data, include }: { where: { id: string }; data: Partial<BusinessRecordRecord>; include?: Record<string, unknown> }) => {
      const record = this.businessRecords.find((item) => item.id === where.id);
      if (!record) throw new Error('Business record not found');

      const cleanData = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
      if (cleanData.recordDate) cleanData.recordDate = new Date(cleanData.recordDate as string | Date);
      if (cleanData.amount !== undefined) cleanData.amount = Number(cleanData.amount);
      Object.assign(record, cleanData, { updatedAt: new Date() });

      return this.withBusinessRecordInclude(record, include);
    },
    updateMany: async ({ where, data }: { where: { id: string; status?: BusinessRecordStatus; version?: number }; data: any }) => {
      const record = this.businessRecords.find(
        (item) =>
          item.id === where.id &&
          (where.status === undefined || item.status === where.status) &&
          (where.version === undefined || item.version === where.version)
      );
      if (!record) return { count: 0 };
      const cleanData = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
      if (typeof data.version === 'object') cleanData.version = record.version + Number(data.version.increment ?? 0);
      if (cleanData.amount !== undefined) cleanData.amount = Number(cleanData.amount);
      Object.assign(record, cleanData, { updatedAt: new Date() });
      return { count: 1 };
    }
  };

  recordValue = {
    findFirst: async ({ where }: { where?: { fieldId?: string } }) =>
      this.recordValues.find((item) => !where?.fieldId || item.fieldId === where.fieldId) ?? null,
    count: async ({ where }: { where?: { fieldId?: string } }) =>
      this.recordValues.filter((item) => !where?.fieldId || item.fieldId === where.fieldId).length,
    deleteMany: async ({ where }: { where: { recordId?: string } }) => {
      const before = this.recordValues.length;
      this.recordValues = this.recordValues.filter((item) => item.recordId !== where.recordId);
      return {
        count: before - this.recordValues.length
      };
    },
    create: async ({ data }: { data: any }) => {
      const now = new Date();
      const value: RecordValueRecord = {
        id: data.id ?? `record_value_${++this.recordValueCounter}`,
        recordId: data.recordId,
        fieldId: data.fieldId,
        fieldName: data.fieldName,
        valueText: data.valueText ?? null,
        valueNumber: data.valueNumber !== undefined && data.valueNumber !== null ? Number(data.valueNumber) : null,
        valueDate: data.valueDate ? new Date(data.valueDate) : null,
        valueJson: data.valueJson ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.recordValues.push(value);
      return value;
    }
  };

  ledgerEvent = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const event = {
        id: `ledger_event_${++this.ledgerEventCounter}`,
        ...data,
        createdAt: new Date()
      };
      this.ledgerEvents.push(event);
      return event;
    }
  };

  auditLog = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const log = {
        id: `audit_${++this.auditCounter}`,
        ...data,
        createdAt: new Date()
      };
      this.auditLogs.push(log);
      return log;
    }
  };

  async $transaction<T>(callback: (tx: this) => Promise<T>): Promise<T> {
    return callback(this);
  }

  async $executeRaw() {
    return 0;
  }

  async $disconnect() {
    return undefined;
  }

  async seed() {
    const passwordHash = await bcrypt.hash('123456', 10);
    const accounts: Array<Pick<UserRecord, 'username' | 'name' | 'role' | 'department' | 'phone'>> = [
      { username: '员工', name: '员工', role: UserRole.employee, department: '运营部', phone: '13800000001' },
      { username: '财务', name: '财务', role: UserRole.finance, department: '财务部', phone: '13800000002' },
      { username: '复核员', name: '复核员', role: UserRole.reviewer, department: '复核部', phone: '13800000003' },
      { username: '老板', name: '老板', role: UserRole.boss, department: '总经办', phone: '13800000004' },
      { username: 'employee', name: '员工', role: UserRole.employee, department: '运营部', phone: '13800000011' },
      { username: 'finance', name: '财务', role: UserRole.finance, department: '财务部', phone: '13800000012' },
      { username: 'reviewer', name: '复核员', role: UserRole.reviewer, department: '复核部', phone: '13800000013' },
      { username: 'boss', name: '老板', role: UserRole.boss, department: '总经办', phone: '13800000014' }
    ];

    for (const account of accounts) {
      await this.user.create({
        data: {
          ...account,
          passwordHash,
          status: UserStatus.active,
          createdBy: null
        }
      });
    }
  }

  private applyProjectWhere(where?: Record<string, unknown>) {
    let projects = [...this.projects];

    if (!where) return projects;

    if (where.status) {
      projects = projects.filter((project) => project.status === where.status);
    }

    const or = where.OR as Array<Record<string, { contains: string }>> | undefined;
    if (or?.length) {
      projects = projects.filter((project) =>
        or.some((condition) =>
          Object.entries(condition).some(([key, value]) => {
            const source = String(project[key as keyof ProjectRecord] ?? '').toLowerCase();
            return source.includes(value.contains.toLowerCase());
          })
        )
      );
    }

    return projects;
  }

  private applyTemplateWhere(where?: Record<string, unknown>) {
    let templates = [...this.templates];

    if (!where) return templates;

    if (where.recordType) {
      templates = templates.filter((template) => template.recordType === where.recordType);
    }

    const or = where.OR as Array<Record<string, { contains: string }>> | undefined;
    if (or?.length) {
      templates = templates.filter((template) =>
        or.some((condition) =>
          Object.entries(condition).some(([key, value]) => {
            const source = String(template[key as keyof TemplateRecord] ?? '').toLowerCase();
            return source.includes(value.contains.toLowerCase());
          })
        )
      );
    }

    return templates;
  }

  private applyFieldWhere(where?: Record<string, unknown>) {
    let fields = [...this.fieldDefinitions];

    if (!where) return fields;

    if (where.fieldType) {
      fields = fields.filter((field) => field.fieldType === where.fieldType);
    }

    if (where.semanticType) {
      fields = fields.filter((field) => field.semanticType === where.semanticType);
    }

    if (typeof where.isActive === 'boolean') {
      fields = fields.filter((field) => field.isActive === where.isActive);
    }

    const or = where.OR as Array<Record<string, { contains: string }>> | undefined;
    if (or?.length) {
      fields = fields.filter((field) =>
        or.some((condition) =>
          Object.entries(condition).some(([key, value]) => {
            const source = String(field[key as keyof FieldRecord] ?? '').toLowerCase();
            return source.includes(value.contains.toLowerCase());
          })
        )
      );
    }

    return fields;
  }

  private applyBusinessRecordWhere(where?: Record<string, unknown>) {
    let records = [...this.businessRecords];

    if (!where) return records;

    if (where.projectId) {
      records = records.filter((record) => record.projectId === where.projectId);
    }

    if (where.templateId) {
      records = records.filter((record) => record.templateId === where.templateId);
    }

    if (where.recordType) {
      records = records.filter((record) => record.recordType === where.recordType);
    }

    if (where.sourceType) {
      records = records.filter((record) => record.sourceType === where.sourceType);
    }

    if (where.status) {
      records = records.filter((record) => record.status === where.status);
    }

    const recordDate = where.recordDate as { gte?: Date; lte?: Date } | undefined;
    if (recordDate?.gte) {
      records = records.filter((record) => record.recordDate >= recordDate.gte!);
    }
    if (recordDate?.lte) {
      records = records.filter((record) => record.recordDate <= recordDate.lte!);
    }

    return records;
  }

  private withTemplateFieldInclude(templateField: TemplateFieldRecord, include?: Record<string, unknown>) {
    const result: Record<string, unknown> = { ...templateField };

    if (include?.field) {
      result.field = this.fieldDefinitions.find((field) => field.id === templateField.fieldId);
    }

    if (include?.template) {
      const templateInclude = typeof include.template === 'object' ? (include.template as { include?: Record<string, unknown> }).include : undefined;
      const template = this.templates.find((item) => item.id === templateField.templateId);
      result.template = template ? this.withTemplateInclude(template, templateInclude) : null;
    }

    return result;
  }

  private withTemplateInclude(template: TemplateRecord, include?: Record<string, unknown>) {
    const result: Record<string, unknown> = { ...template };

    if (include?.templateFields) {
      const templateFieldsConfig = include.templateFields as { include?: Record<string, unknown>; orderBy?: Record<string, string> };
      let fields = this.templateFields.filter((templateField) => templateField.templateId === template.id);
      if (templateFieldsConfig.orderBy?.displayOrder === 'asc') {
        fields = fields.sort((first, second) => first.displayOrder - second.displayOrder);
      }
      result.templateFields = fields.map((templateField) =>
        this.withTemplateFieldInclude(templateField, templateFieldsConfig.include)
      );
    }

    if (include?.projectTemplates) {
      const projectTemplateConfig = include.projectTemplates as { include?: Record<string, unknown> };
      result.projectTemplates = this.projectTemplates
        .filter((projectTemplate) => projectTemplate.templateId === template.id)
        .map((projectTemplate) => this.withProjectTemplateInclude(projectTemplate, projectTemplateConfig.include));
    }

    return result;
  }

  private withProjectTemplateInclude(projectTemplate: ProjectTemplateRecord, include?: Record<string, unknown>) {
    const result: Record<string, unknown> = { ...projectTemplate };

    if (include?.template) {
      const templateConfig = include.template as true | { include?: Record<string, unknown> };
      const templateInclude = typeof templateConfig === 'object' ? templateConfig.include : undefined;
      const template = this.templates.find((item) => item.id === projectTemplate.templateId);
      result.template = template ? this.withTemplateInclude(template, templateInclude) : null;
    }

    if (include?.project) {
      result.project = this.projects.find((project) => project.id === projectTemplate.projectId) ?? null;
    }

    return result;
  }

  private withBusinessRecordInclude(record: BusinessRecordRecord, include?: Record<string, unknown>) {
    const result: Record<string, unknown> = { ...record };

    if (include?.project) {
      result.project = this.projects.find((project) => project.id === record.projectId) ?? null;
    }

    if (include?.template) {
      result.template = this.templates.find((template) => template.id === record.templateId) ?? null;
    }

    if (include?.values) {
      const valuesConfig = include.values as { include?: Record<string, unknown>; orderBy?: Record<string, string> };
      let values = this.recordValues.filter((value) => value.recordId === record.id);
      if (valuesConfig.orderBy?.createdAt === 'asc') {
        values = values.sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());
      }
      result.values = values.map((value) => {
        const output: Record<string, unknown> = { ...value };
        if (valuesConfig.include?.field) {
          output.field = this.fieldDefinitions.find((field) => field.id === value.fieldId) ?? null;
        }
        return output;
      });
    }

    return result;
  }

  private applyUserWhere(where?: Record<string, unknown>) {
    let users = [...this.users];

    if (!where) {
      return users;
    }

    if (where.role) {
      users = users.filter((user) => user.role === where.role);
    }

    if (where.status) {
      users = users.filter((user) => user.status === where.status);
    }

    const idFilter = where.id as { not?: string } | string | undefined;
    if (typeof idFilter === 'string') {
      users = users.filter((user) => user.id === idFilter);
    } else if (idFilter?.not) {
      users = users.filter((user) => user.id !== idFilter.not);
    }

    const or = where.OR as Array<Record<string, { contains: string }>> | undefined;
    if (or?.length) {
      users = users.filter((user) =>
        or.some((condition) =>
          Object.entries(condition).some(([key, value]) => {
            const source = String(user[key as keyof UserRecord] ?? '').toLowerCase();
            return source.includes(value.contains.toLowerCase());
          })
        )
      );
    }

    return users;
  }
}

describe('FINANCE-AGENT backend phases 1 and 2', () => {
  let app: INestApplication;
  let prisma: InMemoryPrisma;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/finance_agent_test?schema=public';
    process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
    process.env.AI_PROVIDER = 'mock';
    prisma = new InMemoryPrisma();
    await prisma.seed();

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true
        }
      })
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(username: string, password = '123456') {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password })
      .expect(200);

    return response.body.data.accessToken as string;
  }

  it('GET /api/health returns the unified success envelope', async () => {
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({
        code: 0,
        message: 'success',
        data: {
          status: 'ok'
        }
      });
  });

  it('GET /api/not-found returns the unified error envelope', async () => {
    const response = await request(app.getHttpServer()).get('/api/not-found').expect(404);

    expect(response.body).toEqual({
      code: 40401,
      message: '资源不存在',
      data: {}
    });
  });

  it('allows all seeded Chinese and English accounts to login', async () => {
    for (const username of ['员工', '财务', '复核员', '老板', 'employee', 'finance', 'reviewer', 'boss']) {
      const token = await login(username);
      expect(token).toEqual(expect.any(String));
    }
  });

  it('returns unified 401 for wrong credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'finance', password: 'wrong-password' })
      .expect(401);

    expect(response.body).toMatchObject({
      code: 40101,
      message: '账号或密码错误',
      data: {}
    });
  });

  it('returns the current user from GET /api/auth/me', async () => {
    const token = await login('finance');
    const response = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${token}`).expect(200);

    expect(response.body.data).toMatchObject({
      username: 'finance',
      role: UserRole.finance,
      title: '财务审核'
    });
  });

  it('revokes the current token on logout', async () => {
    const token = await login('employee');
    const response = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await login('employee');
  });

  it('rate limits repeated failed login attempts and audits failures', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'missing_rate_limited_user', password: 'wrong-password' })
        .expect(401);
    }
    const blocked = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'missing_rate_limited_user', password: 'wrong-password' })
      .expect(429);
    expect(blocked.body).toMatchObject({ code: 42901 });
    expect(
      prisma.auditLogs.filter(
        (log) => log.action === 'auth.login.failure' && log.actorUsername === 'missing_rate_limited_user'
      )
    ).toHaveLength(6);
  });

  it('protects user management with auth and role guards', async () => {
    await request(app.getHttpServer()).get('/api/users').expect(401);

    const employeeToken = await login('employee');
    await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${employeeToken}`).expect(403);

    const reviewerToken = await login('reviewer');
    await request(app.getHttpServer()).get('/api/users').set('Authorization', `Bearer ${reviewerToken}`).expect(403);
  });

  it('allows only boss to access the full AI chat endpoint', async () => {
    for (const username of ['employee', 'finance', 'reviewer']) {
      const token = await login(username);
      await request(app.getHttpServer())
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${token}`)
        .send({ message: '今天经营情况', history: [] })
        .expect(403);
    }
  });

  it('allows finance and boss to manage users and writes audit logs', async () => {
    const financeToken = await login('finance');
    const bossToken = await login('boss');

    const financeCreateResponse = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        username: 'api_employee',
        password: '123456',
        name: '接口员工',
        role: UserRole.employee,
        department: '运营部',
        phone: '13900000001'
      })
      .expect(201);

    const createdUserId = financeCreateResponse.body.data.id as string;
    const createdUser = prisma.users.find((user) => user.id === createdUserId);
    expect(createdUser?.passwordHash).not.toBe('123456');
    expect(createdUser?.passwordHash).toMatch(/^\$2[aby]\$/);
    const oldToken = await login('api_employee');

    const bossCreateResponse = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({
        username: 'boss_employee',
        password: '123456',
        name: '老板新增员工',
        role: UserRole.employee,
        department: '运营部',
        phone: '13900000002'
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/users/${createdUserId}/password`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ newPassword: '654321' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${oldToken}`)
      .expect(401);

    await login('api_employee', '654321');

    await request(app.getHttpServer())
      .patch(`/api/users/${createdUserId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ name: '接口员工已更新' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/users/${createdUserId}/status`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ status: UserStatus.disabled })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'api_employee', password: '654321' })
      .expect(401);

    await request(app.getHttpServer())
      .delete(`/api/users/${bossCreateResponse.body.data.id}`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);

    expect(prisma.users.find((user) => user.id === bossCreateResponse.body.data.id)?.status).toBe(UserStatus.disabled);

    const actions = prisma.auditLogs.map((log) => log.action);
    expect(actions).toEqual(
      expect.arrayContaining(['user.create', 'user.password.reset', 'user.update', 'user.status.update', 'user.delete'])
    );
  });

  it('prevents finance from creating, promoting, resetting, disabling, or deleting boss accounts', async () => {
    const financeToken = await login('finance');
    const bossAccount = prisma.users.find((user) => user.username === '老板')!;
    const employeeAccount = prisma.users.find((user) => user.username === 'employee')!;

    await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ username: 'finance_created_boss', password: '123456', name: '禁止创建', role: UserRole.boss })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/users/${employeeAccount.id}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ role: UserRole.boss })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/users/${bossAccount.id}/password`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ newPassword: '654321' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/users/${bossAccount.id}/status`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ status: UserStatus.disabled })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/users/${bossAccount.id}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(403);
  });

  it('does not allow the last active boss to be disabled', async () => {
    const bossToken = await login('boss');
    const chineseBoss = prisma.users.find((user) => user.username === '老板')!;
    const englishBoss = prisma.users.find((user) => user.username === 'boss')!;

    await request(app.getHttpServer())
      .patch(`/api/users/${chineseBoss.id}/status`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ status: UserStatus.disabled })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/users/${englishBoss.id}/status`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ status: UserStatus.disabled })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`/api/users/${chineseBoss.id}/status`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ status: UserStatus.active })
      .expect(200);
  });

  it('returns a paginated users list for finance', async () => {
    const financeToken = await login('finance');
    const response = await request(app.getHttpServer())
      .get('/api/users?page=1&pageSize=5')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      page: 1,
      pageSize: 5
    });
    expect(response.body.data.items).toHaveLength(5);
    expect(response.body.data.total).toBeGreaterThanOrEqual(8);
  });

  it('allows finance to manage projects, templates, fields, and project structure', async () => {
    const financeToken = await login('finance');
    const bossToken = await login('boss');

    const projectResponse = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        name: '阶段二项目',
        customerName: '阶段二客户',
        ownerName: '林雪',
        description: '阶段二验收项目'
      })
      .expect(201);
    const projectId = projectResponse.body.data.id as string;

    const templateResponse = await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        name: '阶段二模板',
        recordType: DataRecordType.transport,
        description: '阶段二验收模板'
      })
      .expect(201);
    const templateId = templateResponse.body.data.id as string;

    await request(app.getHttpServer())
      .patch(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ name: '阶段二模板已更新' })
      .expect(200);

    const fieldCountBefore = prisma.fieldDefinitions.length;
    const fieldResponse = await request(app.getHttpServer())
      .post('/api/fields')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fieldName: '夜班补贴',
        fieldType: FieldType.money,
        unit: '元',
        semanticType: SemanticType.amount,
        aliases: ['夜补'],
        description: '夜班额外补贴'
      })
      .expect(201);
    const fieldId = fieldResponse.body.data.id as string;

    await request(app.getHttpServer())
      .patch(`/api/fields/${fieldId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ description: '夜班补贴已更新' })
      .expect(200);

    expect(prisma.fieldDefinitions).toHaveLength(fieldCountBefore + 1);
    expect(fieldResponse.body.data.fieldKey).toMatch(/^field_[a-f0-9]{8}$|^夜班补贴$/);
    expect(prisma.projects[0]).not.toHaveProperty('夜班补贴');

    const templateFieldResponse = await request(app.getHttpServer())
      .post(`/api/templates/${templateId}/fields`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fieldId,
        isRequired: true,
        isVisible: true,
        displayOrder: 1
      })
      .expect(201);
    const templateFieldId = templateFieldResponse.body.data.id as string;

    await request(app.getHttpServer())
      .patch(`/api/template-fields/${templateFieldId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ displayOrder: 2 })
      .expect(200);

    const projectTemplateResponse = await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/templates`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        templateId,
        customName: '阶段二项目运输费用'
      })
      .expect(201);
    const projectTemplateId = projectTemplateResponse.body.data.id as string;

    const structureResponse = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/structure`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(structureResponse.body.data).toMatchObject({
      project: {
        id: projectId,
        name: '阶段二项目'
      },
      records: [],
      rawFiles: [],
      importTasks: []
    });
    expect(structureResponse.body.data.enabledTemplates).toHaveLength(1);
    expect(structureResponse.body.data.fieldUsageStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId,
          fieldName: '夜班补贴',
          usageCount: 0
        })
      ])
    );

    await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/structure`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({
        name: '老板不能写',
        customerName: '客户',
        ownerName: '老板'
      })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ ownerName: '陈明' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/templates/${templateId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ name: '已发布模板不能原地更新' })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/fields/${fieldId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ description: '已发布字段不能原地更新' })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/template-fields/${templateFieldId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ displayOrder: 1 })
      .expect(409);

    await request(app.getHttpServer())
      .patch(`/api/project-templates/${projectTemplateId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ customName: '阶段二运输费用已更新' })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/fields/${fieldId}/disable`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(409);

    const unusedFieldResponse = await request(app.getHttpServer())
      .post('/api/fields')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fieldName: '阶段二待停用字段',
        fieldType: FieldType.text,
        semanticType: SemanticType.remark
      })
      .expect(201);
    const unusedFieldId = unusedFieldResponse.body.data.id as string;

    await request(app.getHttpServer())
      .patch(`/api/fields/${unusedFieldId}/disable`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/fields?isActive=false')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.items.map((field: { id: string }) => field.id)).toContain(unusedFieldId));

    await request(app.getHttpServer())
      .get('/api/fields?isActive=not-a-boolean')
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/project-templates/${projectTemplateId}/disable`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    const actions = prisma.auditLogs.map((log) => log.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'project.create',
        'project.update',
        'template.create',
        'template.update',
        'field_definition.create',
        'field_definition.update',
        'field_definition.disable',
        'template_field.add',
        'template_field.update',
        'project_template.enable',
        'project_template.update',
        'project_template.disable'
      ])
    );
  });

  it('enforces data center read/write permissions by role', async () => {
    const employeeToken = await login('employee');
    const reviewerToken = await login('reviewer');

    await request(app.getHttpServer())
      .get('/api/projects')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        name: '员工不能创建模板',
        recordType: DataRecordType.cost
      })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/fields')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        fieldName: '员工字段',
        fieldType: FieldType.text,
        semanticType: SemanticType.remark
      })
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/projects')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/fields')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(403);
  });

  it('allows finance to create manual business records and exposes them in project structure', async () => {
    const financeToken = await login('finance');
    const bossToken = await login('boss');
    const employeeToken = await login('employee');
    const reviewerToken = await login('reviewer');

    const projectResponse = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        name: '阶段三项目',
        customerName: '阶段三客户',
        ownerName: '赵敏',
        description: '阶段三手工补录验收'
      })
      .expect(201);
    const projectId = projectResponse.body.data.id as string;

    const templateResponse = await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        name: '阶段三运输费用模板',
        recordType: DataRecordType.transport,
        description: '阶段三验收模板'
      })
      .expect(201);
    const templateId = templateResponse.body.data.id as string;

    const dateFieldResponse = await request(app.getHttpServer())
      .post('/api/fields')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fieldName: '阶段三日期',
        fieldType: FieldType.date,
        semanticType: SemanticType.date
      })
      .expect(201);
    const dateFieldId = dateFieldResponse.body.data.id as string;

    const amountFieldResponse = await request(app.getHttpServer())
      .post('/api/fields')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fieldName: '阶段三金额',
        fieldType: FieldType.money,
        unit: '元',
        semanticType: SemanticType.amount
      })
      .expect(201);
    const amountFieldId = amountFieldResponse.body.data.id as string;

    const driverFieldResponse = await request(app.getHttpServer())
      .post('/api/fields')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fieldName: '阶段三司机',
        fieldType: FieldType.text,
        semanticType: SemanticType.person
      })
      .expect(201);
    const driverFieldId = driverFieldResponse.body.data.id as string;

    const unrelatedFieldResponse = await request(app.getHttpServer())
      .post('/api/fields')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        fieldName: '阶段三未入模板字段',
        fieldType: FieldType.text,
        semanticType: SemanticType.remark
      })
      .expect(201);
    const unrelatedFieldId = unrelatedFieldResponse.body.data.id as string;

    for (const [index, fieldId] of [dateFieldId, amountFieldId, driverFieldId].entries()) {
      await request(app.getHttpServer())
        .post(`/api/templates/${templateId}/fields`)
        .set('Authorization', `Bearer ${financeToken}`)
        .send({
          fieldId,
          isRequired: true,
          isVisible: true,
          displayOrder: index + 1
        })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post(`/api/projects/${projectId}/templates`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        templateId,
        customName: '阶段三运输费用'
      })
      .expect(201);

    const unenabledTemplateResponse = await request(app.getHttpServer())
      .post('/api/templates')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        name: '阶段三未启用模板',
        recordType: DataRecordType.transport
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/records')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        projectId,
        templateId: unenabledTemplateResponse.body.data.id,
        recordType: DataRecordType.transport,
        recordDate: '2026-07-10',
        amount: '99.00',
        sourceType: RecordSourceType.manual,
        values: []
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/records')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        projectId,
        templateId,
        recordType: DataRecordType.transport,
        recordDate: '2026-07-10',
        amount: '99.00',
        sourceType: RecordSourceType.manual,
        values: [{ fieldId: unrelatedFieldId, value: '不应入库' }]
      })
      .expect(400);

    const recordAttachmentId = 'stage3-file-id';
    prisma.rawFiles.push({
      id: recordAttachmentId,
      fileName: 'stage3-voucher.pdf',
      originalFileName: 'stage3-voucher.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      fileSize: BigInt(128),
      storagePath: 'test/stage3-voucher.pdf',
      sha256: 'a'.repeat(64),
      uploadedBy: 'finance-user',
      uploadedAt: new Date(),
      isVoided: false,
      relatedProjectId: projectId,
      relatedWorkOrderId: null,
      status: 'uploaded',
      scanStatus: 'clean',
      previewStatus: 'original',
      voidReason: null,
      voidedAt: null,
      voidedBy: null
    });

    const recordResponse = await request(app.getHttpServer())
      .post('/api/records')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        projectId,
        templateId,
        recordType: DataRecordType.transport,
        recordDate: '2026-07-10',
        amount: '1280.50',
        category: '成本',
        subCategory: '运输',
        description: '阶段三手工补录',
        sourceType: RecordSourceType.manual,
        sourceId: 'manual',
        status: BusinessRecordStatus.pending_confirm,
        values: [
          { fieldId: dateFieldId, value: '2026-07-10' },
          { fieldId: amountFieldId, value: '1280.50' },
          { fieldId: driverFieldId, value: '王师傅' }
        ],
        attachments: [recordAttachmentId]
      })
      .expect(201);
    const recordId = recordResponse.body.data.id as string;

    expect(prisma.businessRecords.find((record) => record.id === recordId)).toMatchObject({
      projectId,
      templateId,
      amount: 1280.5,
      sourceType: RecordSourceType.manual
    });
    expect(prisma.recordValues.filter((value) => value.recordId === recordId)).toHaveLength(3);
    expect(prisma.recordValues.find((value) => value.recordId === recordId && value.fieldId === amountFieldId)?.valueNumber).toBe(
      1280.5
    );

    const structureResponse = await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/structure`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);

    expect(structureResponse.body.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: recordId,
          amount: '1280.50',
          sourceType: RecordSourceType.manual
        })
      ])
    );
    expect(structureResponse.body.data.fieldUsageStats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: amountFieldId,
          usageCount: 1,
          sourceTypes: [RecordSourceType.manual]
        })
      ])
    );
    expect(structureResponse.body.data.logicalTablesSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableName: 'business_records',
          relatedCount: 1
        }),
        expect.objectContaining({
          tableName: 'record_values',
          relatedCount: 3
        })
      ])
    );

    await request(app.getHttpServer())
      .get(`/api/records/${recordId}`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/projects/${projectId}/records`)
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/records')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/records')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/records/${recordId}/confirm`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/records/${recordId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ description: '已确认后不允许覆盖' })
      .expect(409);

    const voidResponse = await request(app.getHttpServer())
      .delete(`/api/records/${recordId}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(200);
    expect(voidResponse.body.data).toMatchObject({
      id: recordId,
      status: BusinessRecordStatus.rejected
    });

    const requiredBase = {
      projectId,
      templateId,
      recordType: DataRecordType.transport,
      recordDate: '2026-07-11',
      amount: 10,
      values: [
        { fieldId: dateFieldId, value: '2026-07-11' },
        { fieldId: amountFieldId, value: 10 },
        { fieldId: driverFieldId, value: '李师傅' }
      ]
    };
    await request(app.getHttpServer())
      .post('/api/records')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ ...requiredBase, sourceId: 'forged-source' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/records')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ ...requiredBase, status: BusinessRecordStatus.pending_confirm, values: [] })
      .expect(400);
    const incompleteDraft = await request(app.getHttpServer())
      .post('/api/records')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ ...requiredBase, status: BusinessRecordStatus.draft, values: [] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/records/${incompleteDraft.body.data.id}/confirm`)
      .set('Authorization', `Bearer ${financeToken}`)
      .expect(400);

    const actions = prisma.auditLogs.map((log) => log.action);
    expect(actions).toEqual(
      expect.arrayContaining(['business_record.create', 'business_record.confirm', 'business_record.void'])
    );
    expect(prisma.ledgerEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['business_record_created', 'business_record_confirmed', 'business_record_voided'])
    );
  });
});
