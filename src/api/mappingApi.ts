import { mockMappingRules } from '@/mock/mockDataCenter';
import type { MappingRule } from '@/types/dataCenter';
import { delay, ok } from './dataApiUtils';

export async function getMappingRules(params?: Record<string, string>) {
  await delay();
  return ok({ params, rules: mockMappingRules });
}

export async function createMappingRule(payload: Partial<MappingRule>) {
  await delay();
  return ok({ ...payload, id: `mr-${Date.now()}` } as MappingRule, '映射规则已创建');
}

export async function updateMappingRule(id: string, payload: Partial<MappingRule>) {
  await delay();
  return ok({ id, ...payload } as MappingRule, '映射规则已更新');
}

export async function deleteMappingRule(id: string) {
  await delay();
  return ok({ id }, '映射规则已删除');
}
