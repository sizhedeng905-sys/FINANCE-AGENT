import { runtimeConfig } from '@/config/runtime';
import type { FileBinary, RawFile } from '@/types/file';
import { httpClient } from './httpClient';
import { mockDeleteFile, mockGetFile, mockReadFile, mockUploadFile } from './mockFileRepository';

export type UploadedFile = RawFile;

function uploadIdempotencyKey(): string {
  const id = typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `file-upload-${id}`;
}

export function uploadFile(file: File, relatedProjectId: string, workOrderId?: string): Promise<RawFile> {
  if (runtimeConfig.dataMode !== 'api') return mockUploadFile(file, relatedProjectId, workOrderId);
  const formData = new FormData();
  formData.set('file', file);
  formData.set('relatedProjectId', relatedProjectId);
  if (workOrderId) formData.set('workOrderId', workOrderId);
  return httpClient.post<RawFile>('/files/upload', formData, {
    headers: { 'Idempotency-Key': uploadIdempotencyKey() },
  });
}

export function getFile(id: string): Promise<RawFile> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<RawFile>(`/files/${encodeURIComponent(id)}`)
    : mockGetFile(id);
}

export async function previewFile(id: string): Promise<FileBinary> {
  if (runtimeConfig.dataMode !== 'api') return mockReadFile(id);
  const result = await httpClient.binary(`/files/${encodeURIComponent(id)}/preview`);
  return {
    blob: result.blob,
    fileName: result.fileName ?? id,
    mimeType: result.mimeType,
  };
}

export async function downloadFile(id: string): Promise<FileBinary> {
  if (runtimeConfig.dataMode !== 'api') return mockReadFile(id);
  const result = await httpClient.binary(`/files/${encodeURIComponent(id)}/download`);
  return {
    blob: result.blob,
    fileName: result.fileName ?? id,
    mimeType: result.mimeType,
  };
}

export function deleteFile(id: string, reason?: string): Promise<RawFile> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.delete<RawFile>(`/files/${encodeURIComponent(id)}`, { body: { reason } })
    : mockDeleteFile(id, reason);
}
