import { runtimeConfig } from '@/config/runtime';
import type {
  BusinessRecord,
  CreateRecordPayload,
  PaginatedRecords,
  RecordListQuery,
  UpdateRecordPayload,
} from '@/types/dataCenter';
import { httpClient } from './httpClient';
import {
  mockConfirmRecord,
  mockCreateRecord,
  mockGetRecord,
  mockGetRecords,
  mockUpdateRecord,
  mockVoidRecord,
} from './mockRecordRepository';

function queryString(query: RecordListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function getRecords(query: RecordListQuery = {}): Promise<PaginatedRecords> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedRecords>(`/records${queryString(query)}`)
    : mockGetRecords(query);
}

export function getProjectRecords(projectId: string, query: RecordListQuery = {}): Promise<PaginatedRecords> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedRecords>(`/projects/${encodeURIComponent(projectId)}/records${queryString(query)}`)
    : mockGetRecords({ ...query, projectId });
}

export function createRecord(payload: CreateRecordPayload): Promise<BusinessRecord> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<BusinessRecord>('/records', payload)
    : mockCreateRecord(payload);
}

export function getRecord(id: string): Promise<BusinessRecord> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<BusinessRecord>(`/records/${encodeURIComponent(id)}`)
    : mockGetRecord(id);
}

export function updateRecord(id: string, payload: UpdateRecordPayload): Promise<BusinessRecord> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<BusinessRecord>(`/records/${encodeURIComponent(id)}`, payload)
    : mockUpdateRecord(id, payload);
}

export function deleteRecord(id: string): Promise<{ id: string; status: BusinessRecord['status'] }> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.delete<{ id: string; status: BusinessRecord['status'] }>(`/records/${encodeURIComponent(id)}`)
    : mockVoidRecord(id);
}

export function confirmRecord(id: string): Promise<BusinessRecord> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<BusinessRecord>(`/records/${encodeURIComponent(id)}/confirm`)
    : mockConfirmRecord(id);
}
