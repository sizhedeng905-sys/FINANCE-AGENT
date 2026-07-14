import {
  BusinessRecord,
  FieldDefinition,
  Prisma,
  Project,
  ProjectTemplate,
  RecordValue,
  Template,
  TemplateField
} from '@prisma/client';

type TemplateFieldWithField = TemplateField & {
  field: FieldDefinition;
};

type ProjectTemplateWithTemplate = ProjectTemplate & {
  template: Template;
};
type BusinessRecordWithRelations = BusinessRecord & {
  project: Project;
  template: Template;
  values: Array<RecordValue & { field?: FieldDefinition }>;
};

export function toProject(project: Project) {
  return {
    id: project.id,
    name: project.name,
    customerName: project.customerName,
    description: project.description ?? '',
    ownerName: project.ownerName,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString()
  };
}

export function toTemplate(template: Template) {
  return {
    id: template.id,
    name: template.name,
    recordType: template.recordType,
    accountingDirection: template.accountingDirection,
    primaryAmountFieldId: template.primaryAmountFieldId ?? undefined,
    primaryDateFieldId: template.primaryDateFieldId ?? undefined,
    version: template.version,
    description: template.description ?? '',
    isSystem: template.isSystem,
    createdBy: template.createdBy ?? '',
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

export function toFieldDefinition(field: FieldDefinition) {
  return {
    id: field.id,
    fieldKey: field.fieldKey,
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    unit: field.unit ?? '',
    semanticType: field.semanticType,
    aliases: normalizeAliases(field.aliases),
    description: field.description ?? '',
    isActive: field.isActive,
    createdAt: field.createdAt.toISOString(),
    updatedAt: field.updatedAt.toISOString()
  };
}

export function toTemplateField(templateField: TemplateFieldWithField) {
  return {
    id: templateField.id,
    templateId: templateField.templateId,
    fieldId: templateField.fieldId,
    field: toFieldDefinition(templateField.field),
    isRequired: templateField.isRequired,
    isVisible: templateField.isVisible,
    displayOrder: templateField.displayOrder,
    defaultValue: templateField.defaultValue ?? ''
  };
}

export function toProjectTemplate(projectTemplate: ProjectTemplate) {
  return {
    id: projectTemplate.id,
    projectId: projectTemplate.projectId,
    templateId: projectTemplate.templateId,
    recordType: projectTemplate.recordType,
    customName: projectTemplate.customName ?? '',
    isActive: projectTemplate.isActive,
    createdAt: projectTemplate.createdAt.toISOString(),
    updatedAt: projectTemplate.updatedAt.toISOString()
  };
}

export function toProjectTemplateWithTemplate(projectTemplate: ProjectTemplateWithTemplate) {
  return {
    ...toProjectTemplate(projectTemplate),
    template: toTemplate(projectTemplate.template)
  };
}

export function toRecordValue(recordValue: RecordValue & { field?: FieldDefinition }) {
  return {
    id: recordValue.id,
    recordId: recordValue.recordId,
    fieldId: recordValue.fieldId,
    fieldName: recordValue.fieldName,
    fieldType: recordValue.field?.fieldType,
    value: resolveRecordValue(recordValue)
  };
}

export function toBusinessRecord(record: BusinessRecordWithRelations) {
  return {
    id: record.id,
    projectId: record.projectId,
    projectName: record.project.name,
    templateId: record.templateId,
    templateName: record.template.name,
    recordType: record.recordType,
    accountingDirection: record.accountingDirection,
    templateVersion: record.templateVersion,
    version: record.version,
    recordDate: record.recordDate.toISOString(),
    amount: record.amount.toFixed(2),
    category: record.category ?? '',
    subCategory: record.subCategory ?? '',
    description: record.description ?? '',
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    importTaskId: record.importTaskId ?? undefined,
    status: record.status,
    values: record.values.map(toRecordValue),
    attachments: normalizeStringArray(record.attachments),
    createdBy: record.createdBy ?? '',
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    confirmedAt: record.confirmedAt?.toISOString(),
    confirmedBy: record.confirmedBy ?? undefined
  };
}

export function normalizeAliases(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function resolveRecordValue(recordValue: RecordValue & { field?: FieldDefinition }): string | string[] | null {
  if (recordValue.valueJson !== null && recordValue.valueJson !== undefined) {
    if (Array.isArray(recordValue.valueJson)) {
      return recordValue.valueJson.filter((item): item is string => typeof item === 'string');
    }

    return JSON.stringify(recordValue.valueJson);
  }

  if (recordValue.valueNumber !== null && recordValue.valueNumber !== undefined) {
    return recordValue.field?.fieldType === 'money'
      ? recordValue.valueNumber.toFixed(2)
      : recordValue.valueNumber.toString();
  }

  if (recordValue.valueDate) {
    return recordValue.valueDate.toISOString();
  }

  return recordValue.valueText ?? null;
}

function normalizeStringArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}
