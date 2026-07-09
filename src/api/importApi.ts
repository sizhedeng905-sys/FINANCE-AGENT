import { mockImportRows, mockImportTasks } from '@/mock/mockDataCenter';
import type { ImportTask, MappingRule } from '@/types/dataCenter';
import { delay, ok } from './dataApiUtils';

export async function createImportTask(payload: Partial<ImportTask>) {
  await delay();
  return ok({ ...payload, id: `it-${Date.now()}` } as ImportTask, '导入任务已创建');
}

export async function getImportTasks() {
  await delay();
  return ok(mockImportTasks);
}

export async function getImportTask(id: string) {
  await delay();
  return ok(mockImportTasks.find((item) => item.id === id));
}

export async function parseImportTask(id: string) {
  await delay();
  return ok({ id, status: 'mapping' }, '文件解析完成');
}

export async function saveImportMapping(id: string, mappingRules: MappingRule[]) {
  await delay();
  return ok({ id, mappingRules }, '字段映射已保存');
}

export async function getImportRows(id: string) {
  await delay();
  return ok(mockImportRows.filter((item) => item.importTaskId === id));
}

export async function confirmImportTask(id: string) {
  await delay();
  return ok({ id, status: 'confirmed' }, '导入已确认');
}

export async function cancelImportTask(id: string) {
  await delay();
  return ok({ id, status: 'failed' }, '导入任务已取消');
}
