import { runtimeConfig } from '@/config/runtime';
import type {
  CreateImportTaskPayload,
  ConfirmImportTaskPayload,
  ExcelAiSuggestionHistory,
  ExcelAiSuggestionResult,
  FieldSuggestion,
  FieldSuggestionListQuery,
  ImportConfirmResult,
  ImportAiReviewDecisionQuery,
  ImportPreview,
  ImportPreviewQuery,
  ImportRowsQuery,
  ImportTask,
  ImportTaskListQuery,
  ImportWorkbookInspection,
  ParseImportTaskPayload,
  PaginatedImportAiReviewDecisions,
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
  if (runtimeConfig.dataMode !== 'api') return mockSaveImportMappings(id, payload);
  const aiTaskId = payload.mappings.find((mapping) => mapping.aiReview)?.aiReview?.aiTaskId;
  return httpClient.put<ImportTask>(
    `/import-tasks/${encodeURIComponent(id)}/mappings`,
    payload,
    aiTaskId ? { headers: { 'Idempotency-Key': `import-ai-review-${aiTaskId}` } } : undefined,
  );
}

export function autoMatchImportTask(id: string): Promise<ImportTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<ImportTask>(`/import-tasks/${encodeURIComponent(id)}/auto-match`)
    : mockAutoMatchImportTask(id);
}

export function generateFieldDefinitionCandidates(id: string): Promise<{ count: number; suggestions: FieldSuggestion[] }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<{ count: number; suggestions: FieldSuggestion[] }>(`/import-tasks/${encodeURIComponent(id)}/generate-suggestions`)
    : mockGenerateImportSuggestions(id);
}

export function requestImportAiSuggestions(id: string): Promise<ExcelAiSuggestionResult> {
  if (runtimeConfig.dataMode === 'api') {
    return httpClient.post<ExcelAiSuggestionResult>(`/import-tasks/${encodeURIComponent(id)}/ai-suggestions`);
  }
  return Promise.resolve({
    status: 'manual_required',
    mode: 'manual',
    reasonCode: 'FRONTEND_MOCK_MODE',
    message: '当前是前端 Mock 数据模式，AI 映射建议未调用后端；请继续人工映射',
    mapping: null,
    businessRecordsCreated: 0,
  });
}

export function getImportAiSuggestionHistory(id: string): Promise<ExcelAiSuggestionHistory> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<ExcelAiSuggestionHistory>(`/import-tasks/${encodeURIComponent(id)}/ai-suggestions`)
    : Promise.resolve({ items: [] });
}

export function getImportAiReviewDecisions(
  id: string,
  query: ImportAiReviewDecisionQuery = {},
): Promise<PaginatedImportAiReviewDecisions> {
  if (runtimeConfig.dataMode === 'api') {
    return httpClient.get<PaginatedImportAiReviewDecisions>(
      `/import-tasks/${encodeURIComponent(id)}/ai-review-decisions${queryString(query)}`,
    );
  }
  return Promise.resolve({
    items: [],
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    total: 0,
    summary: { total: 0, accept: 0, edit: 0, reject: 0, ignore: 0, pending: 0 },
    digest: {
      schemaVersion: 'excel-ai-review-digest/1.0',
      mode: 'manual',
      taskReviewRevision: query.reviewRevision ?? 0,
      decisionCount: 0,
      summary: { total: 0, accept: 0, edit: 0, reject: 0, ignore: 0, pending: 0 },
      aiTaskIds: [],
      batches: [],
      digestHash: '0'.repeat(64),
    },
  });
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
