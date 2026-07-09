import { getMockAIReply } from '@/mock/mockAI';
import type { ChatMessage } from '@/types/ai';

const delay = (ms = 450) => new Promise((resolve) => window.setTimeout(resolve, ms));

export interface AIChatPayload {
  message: string;
  history: ChatMessage[];
  workOrderId?: string;
}

// 未来真实接入：POST /api/ai/chat
export async function postAIChatApi(payload: AIChatPayload): Promise<string> {
  await delay();
  return getMockAIReply(payload.message);
}
