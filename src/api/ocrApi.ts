import { runtimeConfig } from '@/config/runtime';
import type {
  CorrectOCRTaskPayload,
  CreateOCRTaskPayload,
  OCRConfirmResult,
  OCRAiSuggestionResult,
  OCRTask,
  OCRTaskListQuery,
  PaginatedOCRTasks,
  RevalidateOCRTaskPayload,
} from '@/types/dataCenter';
import { httpClient } from './httpClient';
import {
  mockCancelOCRTask,
  mockConfirmOCRTask,
  mockCorrectOCRTask,
  mockCreateOCRTask,
  mockGetOCRTask,
  mockGetOCRTasks,
  mockRequestOCRAiSuggestions,
  mockRevalidateOCRTask,
  mockRetryOCRTask,
  mockRunOCRTask,
} from './mockOcrRepository';

function queryString(query: object) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

function idempotencyKey(prefix: string) {
  const id = typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${id}`;
}

export function createOCRTask(payload: CreateOCRTaskPayload): Promise<OCRTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<OCRTask>('/ocr-tasks', payload, { headers: { 'Idempotency-Key': idempotencyKey('ocr-task') } })
    : mockCreateOCRTask(payload);
}

export async function uploadAndCreateOCRTask(
  file: File,
  payload: Omit<CreateOCRTaskPayload, 'rawFileId'>,
): Promise<OCRTask> {
  if (runtimeConfig.dataMode !== 'api') {
    const { mockUploadFile } = await import('./mockFileRepository');
    const rawFile = await mockUploadFile(file, payload.projectId);
    return mockCreateOCRTask({ ...payload, rawFileId: rawFile.id });
  }
  const formData = new FormData();
  formData.set('file', file);
  formData.set('projectId', payload.projectId);
  formData.set('templateId', payload.templateId);
  if (payload.pageStart !== undefined) formData.set('pageStart', String(payload.pageStart));
  if (payload.pageEnd !== undefined) formData.set('pageEnd', String(payload.pageEnd));
  if (payload.mockScenario) formData.set('mockScenario', payload.mockScenario);
  return httpClient.post<OCRTask>('/ocr-tasks/upload', formData, {
    headers: { 'Idempotency-Key': idempotencyKey('ocr-upload') },
  });
}

export function getOCRTasks(query: OCRTaskListQuery = {}): Promise<PaginatedOCRTasks> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedOCRTasks>(`/ocr-tasks${queryString(query)}`)
    : mockGetOCRTasks(query);
}

export function getOCRTask(id: string): Promise<OCRTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<OCRTask>(`/ocr-tasks/${encodeURIComponent(id)}`)
    : mockGetOCRTask(id);
}

export function runOCRTask(id: string): Promise<OCRTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<OCRTask>(`/ocr-tasks/${encodeURIComponent(id)}/run`)
    : mockRunOCRTask(id);
}

export function correctOCRTask(id: string, payload: CorrectOCRTaskPayload): Promise<OCRTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.put<OCRTask>(`/ocr-tasks/${encodeURIComponent(id)}/corrections`, payload)
    : mockCorrectOCRTask(id, payload);
}

export function revalidateOCRTask(id: string, payload: RevalidateOCRTaskPayload): Promise<OCRTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<OCRTask>(`/ocr-tasks/${encodeURIComponent(id)}/revalidate`, payload)
    : mockRevalidateOCRTask(id, payload);
}

export function requestOCRAiSuggestions(id: string): Promise<OCRAiSuggestionResult> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<OCRAiSuggestionResult>(`/ocr-tasks/${encodeURIComponent(id)}/ai-suggestions`)
    : mockRequestOCRAiSuggestions(id);
}

export function confirmOCRTask(id: string, acknowledgeLowConfidence: boolean): Promise<OCRConfirmResult> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<OCRConfirmResult>(
      `/ocr-tasks/${encodeURIComponent(id)}/confirm`,
      { acknowledgeLowConfidence },
      { headers: { 'Idempotency-Key': idempotencyKey('ocr-confirm') } },
    )
    : mockConfirmOCRTask(id, acknowledgeLowConfidence);
}

export function retryOCRTask(id: string): Promise<OCRTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<OCRTask>(`/ocr-tasks/${encodeURIComponent(id)}/retry`)
    : mockRetryOCRTask(id);
}

export function cancelOCRTask(id: string): Promise<OCRTask> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<OCRTask>(`/ocr-tasks/${encodeURIComponent(id)}/cancel`)
    : mockCancelOCRTask(id);
}
