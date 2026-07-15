import {
  mockDataProjects,
  mockDataTemplates,
  mockFieldDefinitions,
  mockTemplateFields,
} from '@/mock/mockDataCenter';
import type {
  CreateFieldPayload,
  CreateTemplateFieldPayload,
  FieldDefinition,
  FieldListQuery,
  FieldUsage,
  PaginatedFields,
  TemplateField,
  UpdateFieldPayload,
  UpdateTemplateFieldPayload,
} from '@/types/dataCenter';
import { mockProjectTemplateSnapshot } from './mockProjectRepository';
import { mockRecordSnapshot } from './mockRecordRepository';

const delay = (ms = 160) => new Promise((resolve) => window.setTimeout(resolve, ms));
let fields = mockFieldDefinitions.map((field) => ({ ...field, aliases: [...field.aliases] }));
let templateFields = mockTemplateFields.map((item) => ({
  ...item,
  field: { ...item.field, aliases: [...item.field.aliases] },
}));

function cloneField(field: FieldDefinition): FieldDefinition {
  return { ...field, aliases: [...field.aliases] };
}

function cloneTemplateField(item: TemplateField): TemplateField {
  return { ...item, field: cloneField(item.field) };
}

function fieldOrThrow(id: string): FieldDefinition {
  const field = fields.find((item) => item.id === id);
  if (!field) throw new Error('资源不存在');
  return field;
}

function resolveFieldKey(input: string, currentId?: string): string {
  const normalized = input
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const base = normalized || `field_${Date.now().toString(36)}`;
  let candidate = base;
  let suffix = 1;
  while (fields.some((field) => field.id !== currentId && field.fieldKey === candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  return candidate;
}

function normalizeOrders(templateId: string): void {
  templateFields
    .filter((item) => item.templateId === templateId)
    .sort((first, second) => first.displayOrder - second.displayOrder)
    .forEach((item, index) => {
      item.displayOrder = index + 1;
    });
}

export async function mockGetFields(query: FieldListQuery = {}): Promise<PaginatedFields> {
  await delay();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const keyword = query.keyword?.trim().toLowerCase();
  const filtered = fields.filter((field) => {
    if (query.fieldType && field.fieldType !== query.fieldType) return false;
    if (query.semanticType && field.semanticType !== query.semanticType) return false;
    if (query.isActive !== undefined && field.isActive !== query.isActive) return false;
    if (!keyword) return true;
    return [field.fieldKey, field.fieldName, field.description].some((value) => value.toLowerCase().includes(keyword));
  });
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize).map(cloneField),
    page,
    pageSize,
    total: filtered.length,
  };
}

export async function mockGetField(id: string): Promise<FieldDefinition> {
  await delay();
  return cloneField(fieldOrThrow(id));
}

export async function mockCreateField(payload: CreateFieldPayload): Promise<FieldDefinition> {
  await delay();
  const now = new Date().toISOString();
  const field: FieldDefinition = {
    id: `mock-field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fieldKey: resolveFieldKey(payload.fieldKey || payload.fieldName),
    fieldName: payload.fieldName.trim(),
    fieldType: payload.fieldType,
    unit: payload.unit?.trim() ?? '',
    semanticType: payload.semanticType,
    aliases: (payload.aliases ?? []).map((alias) => alias.trim()).filter(Boolean),
    description: payload.description?.trim() ?? '',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  fields = [field, ...fields];
  return cloneField(field);
}

export async function mockUpdateField(id: string, payload: UpdateFieldPayload): Promise<FieldDefinition> {
  await delay();
  const field = fieldOrThrow(id);
  if (
    payload.fieldType &&
    payload.fieldType !== field.fieldType &&
    mockRecordSnapshot().some((record) => record.values.some((value) => value.fieldId === id))
  ) {
    throw new Error('字段已有业务数据，不能修改字段类型');
  }
  const normalized = { ...payload };
  if (normalized.fieldKey) normalized.fieldKey = resolveFieldKey(normalized.fieldKey, id);
  if (normalized.fieldName) normalized.fieldName = normalized.fieldName.trim();
  if (normalized.unit !== undefined) normalized.unit = normalized.unit.trim();
  if (normalized.description !== undefined) normalized.description = normalized.description.trim();
  if (normalized.aliases) normalized.aliases = normalized.aliases.map((alias) => alias.trim()).filter(Boolean);
  Object.assign(field, normalized, { updatedAt: new Date().toISOString() });
  templateFields = templateFields.map((item) =>
    item.fieldId === id ? { ...item, field: cloneField(field) } : item,
  );
  return cloneField(field);
}

export async function mockDisableField(id: string): Promise<FieldDefinition> {
  await delay();
  const field = fieldOrThrow(id);
  field.isActive = false;
  field.updatedAt = new Date().toISOString();
  return cloneField(field);
}

export async function mockGetFieldUsage(id: string): Promise<FieldUsage> {
  await delay();
  const field = fieldOrThrow(id);
  const templateIds = [...new Set(templateFields.filter((item) => item.fieldId === id).map((item) => item.templateId))];
  const projectIds = [...new Set(
    mockProjectTemplateSnapshot()
      .filter((item) => item.isActive && templateIds.includes(item.templateId))
      .map((item) => item.projectId),
  )];
  return {
    field: cloneField(field),
    templateCount: templateIds.length,
    projectCount: projectIds.length,
    templates: mockDataTemplates.filter((item) => templateIds.includes(item.id)).map((item) => ({ ...item })),
    projects: mockDataProjects.filter((item) => projectIds.includes(item.id)).map((item) => ({ ...item })),
  };
}

export async function mockGetTemplateFields(templateId: string): Promise<TemplateField[]> {
  await delay();
  return templateFields
    .filter((item) => item.templateId === templateId)
    .sort((first, second) => first.displayOrder - second.displayOrder)
    .map(cloneTemplateField);
}

export async function mockAddTemplateField(
  templateId: string,
  payload: CreateTemplateFieldPayload,
): Promise<TemplateField> {
  await delay();
  const field = fieldOrThrow(payload.fieldId);
  if (!field.isActive) throw new Error('停用字段不能加入模板');
  if (templateFields.some((item) => item.templateId === templateId && item.fieldId === payload.fieldId)) {
    throw new Error('字段已经在模板中');
  }
  const siblings = templateFields.filter((item) => item.templateId === templateId);
  const displayOrder = Math.min(payload.displayOrder ?? siblings.length + 1, siblings.length + 1);
  siblings.filter((item) => item.displayOrder >= displayOrder).forEach((item) => { item.displayOrder += 1; });
  const item: TemplateField = {
    id: `mock-template-field-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateId,
    fieldId: field.id,
    field: cloneField(field),
    isRequired: payload.isRequired ?? false,
    isVisible: payload.isVisible ?? true,
    displayOrder,
    defaultValue: payload.defaultValue ?? '',
  };
  templateFields.push(item);
  return cloneTemplateField(item);
}

export async function mockUpdateTemplateField(
  id: string,
  payload: UpdateTemplateFieldPayload,
): Promise<TemplateField> {
  await delay();
  const item = templateFields.find((candidate) => candidate.id === id);
  if (!item) throw new Error('资源不存在');
  if (payload.displayOrder !== undefined && payload.displayOrder !== item.displayOrder) {
    const siblings = templateFields
      .filter((candidate) => candidate.templateId === item.templateId && candidate.id !== id)
      .sort((first, second) => first.displayOrder - second.displayOrder);
    const target = Math.min(payload.displayOrder, siblings.length + 1);
    const old = item.displayOrder;
    siblings.forEach((sibling) => {
      if (target < old && sibling.displayOrder >= target && sibling.displayOrder < old) sibling.displayOrder += 1;
      if (target > old && sibling.displayOrder > old && sibling.displayOrder <= target) sibling.displayOrder -= 1;
    });
    item.displayOrder = target;
  }
  Object.assign(item, { ...payload, displayOrder: item.displayOrder });
  return cloneTemplateField(item);
}

export async function mockRemoveTemplateField(id: string): Promise<{ id: string }> {
  await delay();
  const item = templateFields.find((candidate) => candidate.id === id);
  if (!item) throw new Error('资源不存在');
  templateFields = templateFields.filter((candidate) => candidate.id !== id);
  normalizeOrders(item.templateId);
  return { id };
}

export function mockCloneTemplateFields(sourceTemplateId: string, targetTemplateId: string): void {
  const clones = templateFields
    .filter((item) => item.templateId === sourceTemplateId)
    .map((item, index) => ({
      ...cloneTemplateField(item),
      id: `mock-template-field-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      templateId: targetTemplateId,
    }));
  templateFields.push(...clones);
}

export function mockRemoveTemplateFields(templateId: string): void {
  templateFields = templateFields.filter((item) => item.templateId !== templateId);
}
