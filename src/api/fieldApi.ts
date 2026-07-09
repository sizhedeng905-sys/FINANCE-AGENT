import { mockFieldDefinitions, mockFieldSuggestions } from '@/mock/mockDataCenter';
import type { FieldDefinition } from '@/types/dataCenter';
import { delay, ok } from './dataApiUtils';

export async function getFields() {
  await delay();
  return ok(mockFieldDefinitions);
}

export async function createField(payload: Partial<FieldDefinition>) {
  await delay();
  return ok({ ...payload, id: `f-${Date.now()}` } as FieldDefinition, '字段已创建');
}

export async function updateField(id: string, payload: Partial<FieldDefinition>) {
  await delay();
  return ok({ id, ...payload } as FieldDefinition, '字段已更新');
}

export async function deleteField(id: string) {
  await delay();
  return ok({ id }, '字段已停用');
}

export async function getFieldSuggestions() {
  await delay();
  return ok(mockFieldSuggestions);
}

export async function approveFieldSuggestion(id: string) {
  await delay();
  return ok({ id }, '字段建议已批准');
}

export async function mapSuggestionToExistingField(id: string, fieldId: string) {
  await delay();
  return ok({ id, fieldId }, '字段建议已映射');
}

export async function rejectFieldSuggestion(id: string) {
  await delay();
  return ok({ id }, '字段建议已拒绝');
}
