import { mockDataTemplates, mockTemplateFields } from '@/mock/mockDataCenter';
import type { DataTemplate, TemplateField } from '@/types/dataCenter';
import { delay, ok } from './dataApiUtils';

export async function getTemplates() {
  await delay();
  return ok(mockDataTemplates);
}

export async function createTemplate(payload: Partial<DataTemplate>) {
  await delay();
  return ok({ ...payload, id: `dt-${Date.now()}` } as DataTemplate, '模板已创建');
}

export async function getTemplate(id: string) {
  await delay();
  return ok(mockDataTemplates.find((item) => item.id === id));
}

export async function updateTemplate(id: string, payload: Partial<DataTemplate>) {
  await delay();
  return ok({ id, ...payload } as DataTemplate, '模板已更新');
}

export async function deleteTemplate(id: string) {
  await delay();
  return ok({ id }, '模板已删除');
}

export async function cloneTemplate(id: string) {
  await delay();
  const template = mockDataTemplates.find((item) => item.id === id);
  return ok(template ? { ...template, id: `dt-${Date.now()}`, name: `${template.name} 副本`, isSystem: false } : undefined);
}

export async function getTemplateFields(templateId: string) {
  await delay();
  return ok(mockTemplateFields.filter((item) => item.templateId === templateId));
}

export async function addTemplateField(templateId: string, payload: Partial<TemplateField>) {
  await delay();
  return ok({ ...payload, id: `tf-${Date.now()}`, templateId } as TemplateField, '字段已加入模板');
}

export async function updateTemplateField(templateId: string, fieldId: string, payload: Partial<TemplateField>) {
  await delay();
  return ok({ ...payload, templateId, fieldId } as TemplateField, '模板字段已更新');
}

export async function removeTemplateField(templateId: string, fieldId: string) {
  await delay();
  return ok({ templateId, fieldId }, '字段已从模板移除');
}
