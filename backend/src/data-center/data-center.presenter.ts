import {
  FieldDefinition,
  Prisma,
  Project,
  ProjectTemplate,
  Template,
  TemplateField
} from '@prisma/client';

type TemplateFieldWithField = TemplateField & {
  field: FieldDefinition;
};

type ProjectTemplateWithTemplate = ProjectTemplate & {
  template: Template;
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

export function normalizeAliases(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}
