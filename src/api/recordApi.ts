import { mockBusinessRecords } from '@/mock/mockDataCenter';
import type { BusinessRecord } from '@/types/dataCenter';
import { delay, ok } from './dataApiUtils';

export async function getRecords(params?: Record<string, string>) {
  await delay();
  return ok({ params, records: mockBusinessRecords });
}

export async function createRecord(payload: Partial<BusinessRecord>) {
  await delay();
  return ok({ ...payload, id: `br-${Date.now()}` } as BusinessRecord, '记录已创建');
}

export async function getRecord(id: string) {
  await delay();
  return ok(mockBusinessRecords.find((item) => item.id === id));
}

export async function updateRecord(id: string, payload: Partial<BusinessRecord>) {
  await delay();
  return ok({ id, ...payload } as BusinessRecord, '记录已更新');
}

export async function deleteRecord(id: string) {
  await delay();
  return ok({ id }, '记录已删除');
}

export async function confirmRecord(id: string) {
  await delay();
  return ok({ id, status: 'confirmed' }, '记录已确认');
}
