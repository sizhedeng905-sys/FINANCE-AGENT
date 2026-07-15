import { runtimeConfig } from '@/config/runtime';
import type {
  CreateTemplateFieldPayload,
  CreateTemplatePayload,
  DataTemplate,
  PaginatedTemplates,
  TemplateField,
  TemplateListQuery,
  UpdateTemplatePayload,
  UpdateTemplateFieldPayload,
} from '@/types/dataCenter';
import { httpClient } from './httpClient';
import {
  mockCloneTemplate,
  mockCreateTemplate,
  mockDeleteTemplate,
  mockGetTemplate,
  mockGetTemplates,
  mockUpdateTemplate,
} from './mockTemplateRepository';
import {
  mockAddTemplateField,
  mockGetTemplateFields,
  mockRemoveTemplateField,
  mockUpdateTemplateField,
} from './mockFieldRepository';

function queryString(query: TemplateListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function getTemplates(query: TemplateListQuery = {}): Promise<PaginatedTemplates> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedTemplates>(`/templates${queryString(query)}`)
    : mockGetTemplates(query);
}

export function createTemplate(payload: CreateTemplatePayload): Promise<DataTemplate> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<DataTemplate>('/templates', payload)
    : mockCreateTemplate(payload);
}

export function getTemplate(id: string): Promise<DataTemplate> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<DataTemplate>(`/templates/${encodeURIComponent(id)}`)
    : mockGetTemplate(id);
}

export function updateTemplate(id: string, payload: UpdateTemplatePayload): Promise<DataTemplate> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<DataTemplate>(`/templates/${encodeURIComponent(id)}`, payload)
    : mockUpdateTemplate(id, payload);
}

export function deleteTemplate(id: string): Promise<{ id: string }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.delete<{ id: string }>(`/templates/${encodeURIComponent(id)}`)
    : mockDeleteTemplate(id);
}

export function cloneTemplate(id: string): Promise<DataTemplate> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<DataTemplate>(`/templates/${encodeURIComponent(id)}/clone`)
    : mockCloneTemplate(id);
}

export function getTemplateFields(templateId: string): Promise<TemplateField[]> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<TemplateField[]>(`/templates/${encodeURIComponent(templateId)}/fields`)
    : mockGetTemplateFields(templateId);
}

export function addTemplateField(templateId: string, payload: CreateTemplateFieldPayload): Promise<TemplateField> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<TemplateField>(`/templates/${encodeURIComponent(templateId)}/fields`, payload)
    : mockAddTemplateField(templateId, payload);
}

export function updateTemplateField(id: string, payload: UpdateTemplateFieldPayload): Promise<TemplateField> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<TemplateField>(`/template-fields/${encodeURIComponent(id)}`, payload)
    : mockUpdateTemplateField(id, payload);
}

export function removeTemplateField(id: string): Promise<{ id: string }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.delete<{ id: string }>(`/template-fields/${encodeURIComponent(id)}`)
    : mockRemoveTemplateField(id);
}
