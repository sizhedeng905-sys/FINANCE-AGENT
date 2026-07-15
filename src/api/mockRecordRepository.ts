import { mockBusinessRecords } from '@/mock/mockDataCenter';
import type {
  BusinessRecord,
  CreateRecordPayload,
  PaginatedRecords,
  RecordListQuery,
  UpdateRecordPayload,
} from '@/types/dataCenter';

const delay = (ms = 160) => new Promise((resolve) => window.setTimeout(resolve, ms));
let records = mockBusinessRecords.map(cloneRecord);

type MockGeneratedRecordPayload = Omit<BusinessRecord, 'id' | 'createdAt' | 'updatedAt'>;

function cloneRecord(record: BusinessRecord): BusinessRecord {
  return {
    ...record,
    values: record.values.map((value) => ({ ...value, value: Array.isArray(value.value) ? [...value.value] : value.value })),
    attachments: [...record.attachments],
  };
}

function findOrThrow(id: string): BusinessRecord {
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error('资源不存在');
  return record;
}

export function mockRecordSnapshot(): BusinessRecord[] {
  return records.map(cloneRecord);
}

export async function mockGetRecords(query: RecordListQuery = {}): Promise<PaginatedRecords> {
  await delay();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const items = records.filter((record) => {
    if (query.projectId && record.projectId !== query.projectId) return false;
    if (query.templateId && record.templateId !== query.templateId) return false;
    if (query.recordType && record.recordType !== query.recordType) return false;
    if (query.sourceType && record.sourceType !== query.sourceType) return false;
    if (query.status && record.status !== query.status) return false;
    if (query.dataLayer && record.dataLayer !== query.dataLayer) return false;
    const date = record.recordDate.slice(0, 10);
    if (query.dateFrom && date < query.dateFrom.slice(0, 10)) return false;
    if (query.dateTo && date > query.dateTo.slice(0, 10)) return false;
    return true;
  });
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize).map(cloneRecord), page, pageSize, total: items.length };
}

export async function mockGetRecord(id: string): Promise<BusinessRecord> {
  await delay();
  return cloneRecord(findOrThrow(id));
}

export async function mockCreateRecord(payload: CreateRecordPayload): Promise<BusinessRecord> {
  await delay();
  const now = new Date().toISOString();
  const id = `mock-record-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record: BusinessRecord = {
    id,
    projectId: payload.projectId,
    projectName: payload.projectId,
    templateId: payload.templateId,
    templateName: payload.templateId,
    recordType: payload.recordType,
    accountingDirection: payload.recordType === 'revenue' ? 'income' : 'expense',
    dataLayer: 'actual',
    templateVersion: 1,
    version: 1,
    recordDate: payload.recordDate,
    amount: payload.amount,
    category: payload.category ?? '',
    subCategory: payload.subCategory ?? '',
    description: payload.description ?? '',
    sourceType: 'manual',
    sourceId: payload.sourceId ?? 'manual',
    status: payload.status ?? 'pending_confirm',
    values: payload.values.map((value, index) => ({
      id: `mock-record-value-${Date.now()}-${index}`,
      recordId: id,
      fieldId: value.fieldId,
      fieldName: value.fieldId,
      value: Array.isArray(value.value) ? [...value.value] : value.value,
    })),
    attachments: [...(payload.attachments ?? [])],
    createdBy: '财务',
    createdAt: now,
    updatedAt: now,
  };
  records = [record, ...records];
  return cloneRecord(record);
}

export async function mockCreateGeneratedRecord(payload: MockGeneratedRecordPayload): Promise<BusinessRecord> {
  await delay();
  const existing = records.find((record) => record.sourceType === payload.sourceType && record.sourceId === payload.sourceId);
  if (existing) return cloneRecord(existing);
  const now = new Date().toISOString();
  const record: BusinessRecord = {
    ...payload,
    id: `mock-record-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    values: [],
  };
  record.values = payload.values.map((value, index) => ({
    ...value,
    id: value.id || `mock-record-value-${Date.now()}-${index}`,
    recordId: record.id,
    value: Array.isArray(value.value) ? [...value.value] : value.value,
  }));
  records = [record, ...records];
  return cloneRecord(record);
}

export async function mockUpdateRecord(id: string, payload: UpdateRecordPayload): Promise<BusinessRecord> {
  await delay();
  const record = findOrThrow(id);
  if (record.status === 'confirmed' || record.status === 'rejected') {
    throw new Error('已确认或已作废记录不能直接修改');
  }
  Object.assign(record, payload, { updatedAt: new Date().toISOString() });
  if (payload.values) {
    record.values = payload.values.map((value, index) => ({
      id: `mock-record-value-${Date.now()}-${index}`,
      recordId: id,
      fieldId: value.fieldId,
      fieldName: record.values.find((item) => item.fieldId === value.fieldId)?.fieldName ?? value.fieldId,
      value: Array.isArray(value.value) ? [...value.value] : value.value,
    }));
  }
  if (payload.attachments) record.attachments = [...payload.attachments];
  return cloneRecord(record);
}

export async function mockConfirmRecord(id: string): Promise<BusinessRecord> {
  await delay();
  const record = findOrThrow(id);
  if (record.status === 'rejected') throw new Error('已作废记录不能确认');
  if (record.status === 'confirmed') return cloneRecord(record);
  record.status = 'confirmed';
  record.confirmedAt = new Date().toISOString();
  record.confirmedBy = '财务';
  record.updatedAt = record.confirmedAt;
  return cloneRecord(record);
}

export async function mockVoidRecord(id: string): Promise<{ id: string; status: BusinessRecord['status'] }> {
  await delay();
  const record = findOrThrow(id);
  if (record.status !== 'rejected') {
    record.status = 'rejected';
    record.updatedAt = new Date().toISOString();
  }
  return { id, status: record.status };
}
