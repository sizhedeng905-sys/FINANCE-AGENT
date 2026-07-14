import { runtimeConfig } from '@/config/runtime';
import { mockFieldSuggestions } from '@/mock/mockDataCenter';
import type {
  CreateFieldPayload,
  FieldDefinition,
  FieldListQuery,
  FieldUsage,
  PaginatedFields,
  UpdateFieldPayload,
} from '@/types/dataCenter';
import { delay, ok } from './dataApiUtils';
import { httpClient } from './httpClient';
import {
  mockCreateField,
  mockDisableField,
  mockGetField,
  mockGetFields,
  mockGetFieldUsage,
  mockUpdateField,
} from './mockFieldRepository';

function queryString(query: FieldListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function getFields(query: FieldListQuery = {}): Promise<PaginatedFields> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedFields>(`/fields${queryString(query)}`)
    : mockGetFields(query);
}

export function getField(id: string): Promise<FieldDefinition> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<FieldDefinition>(`/fields/${encodeURIComponent(id)}`)
    : mockGetField(id);
}

export function createField(payload: CreateFieldPayload): Promise<FieldDefinition> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<FieldDefinition>('/fields', payload)
    : mockCreateField(payload);
}

export function updateField(id: string, payload: UpdateFieldPayload): Promise<FieldDefinition> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<FieldDefinition>(`/fields/${encodeURIComponent(id)}`, payload)
    : mockUpdateField(id, payload);
}

export function disableField(id: string): Promise<FieldDefinition> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<FieldDefinition>(`/fields/${encodeURIComponent(id)}/disable`)
    : mockDisableField(id);
}

export function getFieldUsage(id: string): Promise<FieldUsage> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<FieldUsage>(`/fields/${encodeURIComponent(id)}/usage`)
    : mockGetFieldUsage(id);
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
