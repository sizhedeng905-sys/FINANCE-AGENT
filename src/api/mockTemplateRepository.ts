import { mockDataTemplates } from '@/mock/mockDataCenter';
import type {
  CreateTemplatePayload,
  DataTemplate,
  PaginatedTemplates,
  TemplateListQuery,
  UpdateTemplatePayload,
} from '@/types/dataCenter';
import { mockCloneTemplateFields, mockRemoveTemplateFields } from './mockFieldRepository';
import { mockProjectTemplateSnapshot } from './mockProjectRepository';
import { mockRecordSnapshot } from './mockRecordRepository';

const delay = (ms = 160) => new Promise((resolve) => window.setTimeout(resolve, ms));
let templates = mockDataTemplates.map((template) => ({ ...template }));

function clone(template: DataTemplate): DataTemplate {
  return { ...template };
}

function findOrThrow(id: string): DataTemplate {
  const template = templates.find((item) => item.id === id);
  if (!template) throw new Error('资源不存在');
  return template;
}

export async function mockGetTemplates(query: TemplateListQuery = {}): Promise<PaginatedTemplates> {
  await delay();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const keyword = query.keyword?.trim().toLowerCase();
  const filtered = templates.filter((template) => {
    if (query.recordType && template.recordType !== query.recordType) return false;
    if (!keyword) return true;
    return [template.name, template.description].some((value) => value.toLowerCase().includes(keyword));
  });
  const start = (page - 1) * pageSize;
  return {
    items: filtered.slice(start, start + pageSize).map(clone),
    page,
    pageSize,
    total: filtered.length,
  };
}

export async function mockGetTemplate(id: string): Promise<DataTemplate> {
  await delay();
  return clone(findOrThrow(id));
}

export async function mockCreateTemplate(payload: CreateTemplatePayload): Promise<DataTemplate> {
  await delay();
  const now = new Date().toISOString();
  const template: DataTemplate = {
    id: `mock-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: payload.name.trim(),
    recordType: payload.recordType,
    description: payload.description?.trim() ?? '',
    isSystem: false,
    createdBy: 'mock-finance',
    createdAt: now,
    updatedAt: now,
  };
  templates = [template, ...templates];
  return clone(template);
}

export async function mockUpdateTemplate(id: string, payload: UpdateTemplatePayload): Promise<DataTemplate> {
  await delay();
  const template = findOrThrow(id);
  const normalized = { ...payload };
  if (normalized.name !== undefined) normalized.name = normalized.name.trim();
  if (normalized.description !== undefined) normalized.description = normalized.description.trim();
  Object.assign(template, normalized, { updatedAt: new Date().toISOString() });
  return clone(template);
}

export async function mockDeleteTemplate(id: string): Promise<{ id: string }> {
  await delay();
  const template = findOrThrow(id);
  if (template.isSystem) throw new Error('系统内置模板不能删除');
  const inUse = mockProjectTemplateSnapshot().some((item) => item.templateId === id) ||
    mockRecordSnapshot().some((item) => item.templateId === id);
  if (inUse) throw new Error('模板已被项目或业务记录使用，不能删除');
  templates = templates.filter((item) => item.id !== id);
  mockRemoveTemplateFields(id);
  return { id };
}

export async function mockCloneTemplate(id: string): Promise<DataTemplate> {
  await delay();
  const source = findOrThrow(id);
  const now = new Date().toISOString();
  const template: DataTemplate = {
    ...source,
    id: `mock-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${source.name} 副本`,
    isSystem: false,
    createdBy: 'mock-finance',
    createdAt: now,
    updatedAt: now,
  };
  templates = [template, ...templates];
  mockCloneTemplateFields(source.id, template.id);
  return clone(template);
}
