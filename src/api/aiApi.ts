import { runtimeConfig } from '@/config/runtime';
import type { AIChatPayload, AIChatResponse } from '@/types/ai';
import { httpClient } from './httpClient';
import { mockPostAIChat } from './mockAiRepository';

const bossQuickQuestions = [
  '今天经营情况怎么样？',
  '本月总收入、总支出、总利润是多少？',
  '太和中转项目收入、成本、利润是多少？',
  '有哪些待老板审批工单？',
  '今天有哪些异常？',
  '不存在项目的利润是多少？',
];

export function getBossQuickQuestions(): string[] {
  return [...bossQuickQuestions];
}

export function postAIChatApi(payload: AIChatPayload): Promise<AIChatResponse> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<AIChatResponse>('/ai/chat', payload, { timeoutMs: 45_000 })
    : mockPostAIChat(payload);
}
