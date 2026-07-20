import { runtimeConfig } from '@/config/runtime';
import type {
  CreateImportTaskPayload,
  ConfirmImportTaskPayload,
  FieldSuggestion,
  FieldSuggestionListQuery,
  ImportConfirmResult,
  ImportPreview,
  ImportPreviewQuery,
  ImportRowsQuery,
  ImportTask,
  ImportTaskListQuery,
  ImportWorkbookInspection,
  ParseImportTaskPayload,
  PaginatedFieldSuggestions,
  PaginatedImportRows,
  PaginatedImportTasks,
  RevalidateImportTaskPayload,
  ReviewImportRowPayload,
  SaveImportMappingsPayload,
} from '@/types/dataCenter';
import { httpClient } from './httpClient';
import {
  mockApproveFieldSuggestion,
  mockAutoMatchImportTask,
  mockCancelImportTask,
  mockConfirmImportTask,
  mockCreateImportTask,
  mockGenerateImportSuggestions,
  mockGetFieldSuggestions,
  mockGetImportPreview,
  mockGetImportRows,
  mockGetImportTask,
  mockGetImportTasks,
  mockInspectImportTask,
  mockMapFieldSuggestion,
  mockParseImportTask,
  mockRejectFieldSuggestion,
  mockRevalidateImportTask,
  mockReviewImportRow,
  mockSaveImportMappings,
} from './mockImportRepository';

function queryString(query: object) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

function idempotencyKey() {
  const id = typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `import-task-${id}`;
}

export function createImportTask(file: File, payload: CreateImportTaskPayload): Promise<ImportTask> {
  const key = idempotencyKey();
  if (runtimeConfig.dataMode !== 'api') return mockCreateImportTask(file, payload, key);
  const body = new FormData();
  body.set('file', file);
  body.set('projectId', payload.projectId);
  body.set('templateId', payload.templateId);
  body.set('importType', payload.importType);
  return httpClient.post<ImportTask>('/import-tasks', body, { headers: { 'Idempotency-Key': key } });
}

export function getImportTasks(query: ImportTaskListQuery = {}): Promise<PaginatedImportTasks> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedImportTasks>(`/import-tasks${queryString(query)}`)
    : mockGetImportTasks(query);
}

export function getImportTask(id: string): Promise<ImportTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<ImportTask>(`/import-tasks/${encodeURIComponent(id)}`)
    : mockGetImportTask(id);
}

export function inspectImportTask(id: string): Promise<ImportWorkbookInspection> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<ImportWorkbookInspection>(`/import-tasks/${encodeURIComponent(id)}/inspect`)
    : mockInspectImportTask(id);
}

export function parseImportTask(id: string, payload: ParseImportTaskPayload = {}): Promise<ImportTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<ImportTask>(`/import-tasks/${encodeURIComponent(id)}/parse`, payload)
    : mockParseImportTask(id, payload);
}

export function getImportRows(id: string, query: ImportRowsQuery = {}): Promise<PaginatedImportRows> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedImportRows>(`/import-tasks/${encodeURIComponent(id)}/rows${queryString(query)}`)
    : mockGetImportRows(id, query);
}

export function saveImportMappings(id: string, payload: SaveImportMappingsPayload): Promise<ImportTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.put<ImportTask>(`/import-tasks/${encodeURIComponent(id)}/mappings`, payload)
    : mockSaveImportMappings(id, payload);
}

export function autoMatchImportTask(id: string): Promise<ImportTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<ImportTask>(`/import-tasks/${encodeURIComponent(id)}/auto-match`)
    : mockAutoMatchImportTask(id);
}

export function generateImportSuggestions(id: string): Promise<{ count: number; suggestions: FieldSuggestion[] }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<{ count: number; suggestions: FieldSuggestion[] }>(`/import-tasks/${encodeURIComponent(id)}/generate-suggestions`)
    : mockGenerateImportSuggestions(id);
}

export function getImportPreview(id: string, query: ImportPreviewQuery = {}): Promise<ImportPreview> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<ImportPreview>(`/import-tasks/${encodeURIComponent(id)}/preview${queryString(query)}`)
    : mockGetImportPreview(id, query);
}

export function reviewImportRow(id: string, rowId: string, payload: ReviewImportRowPayload): Promise<ImportTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.put<ImportTask>(
      `/import-tasks/${encodeURIComponent(id)}/rows/${encodeURIComponent(rowId)}/review`,
      payload,
    )
    : mockReviewImportRow(id, rowId, payload);
}

export function revalidateImportTask(id: string, payload: RevalidateImportTaskPayload): Promise<ImportTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<ImportTask>(`/import-tasks/${encodeURIComponent(id)}/revalidate`, payload)
    : mockRevalidateImportTask(id, payload);
}

export function confirmImportTask(id: string, payload: ConfirmImportTaskPayload): Promise<ImportConfirmResult> {
  const approvalKey = `import-confirm-${id}-${payload.expectedReviewRevision}-${payload.expectedValidationSnapshotHash.slice(0, 24)}`;
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<ImportConfirmResult>(
      `/import-tasks/${encodeURIComponent(id)}/confirm`,
      payload,
      { headers: { 'Idempotency-Key': approvalKey } },
    )
    : mockConfirmImportTask(id, payload);
}

export function cancelImportTask(id: string): Promise<ImportTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<ImportTask>(`/import-tasks/${encodeURIComponent(id)}/cancel`)
    : mockCancelImportTask(id);
}

export function getFieldSuggestions(query: FieldSuggestionListQuery = {}): Promise<PaginatedFieldSuggestions> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedFieldSuggestions>(`/field-suggestions${queryString(query)}`)
    : mockGetFieldSuggestions(query);
}

export function approveFieldSuggestion(
  id: string,
  payload: { fieldName?: string; fieldType?: FieldSuggestion['suggestedFieldType'] } = {},
): Promise<{ fieldId: string; suggestion: FieldSuggestion }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<{ fieldId: string; suggestion: FieldSuggestion }>(`/field-suggestions/${encodeURIComponent(id)}/approve`, payload)
    : mockApproveFieldSuggestion(id, payload);
}

export function mapFieldSuggestion(id: string, fieldId: string): Promise<FieldSuggestion> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<FieldSuggestion>(`/field-suggestions/${encodeURIComponent(id)}/map`, { fieldId })
    : mockMapFieldSuggestion(id, fieldId);
}

export function rejectFieldSuggestion(id: string): Promise<FieldSuggestion> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<FieldSuggestion>(`/field-suggestions/${encodeURIComponent(id)}/reject`)
    : mockRejectFieldSuggestion(id);
}
