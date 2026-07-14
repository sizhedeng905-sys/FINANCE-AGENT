import { getMockAIReply } from '@/mock/mockAI';
import type { AIChatPayload, AIChatResponse, AiToolName } from '@/types/ai';

const delay = (ms = 420) => new Promise((resolve) => window.setTimeout(resolve, ms));

function toolsFor(question: string, workOrderId?: string): AiToolName[] {
  const tools: AiToolName[] = [];
  if (workOrderId) tools.push('get_work_order_detail');
  if (/项目|客户|利润最高/.test(question)) tools.push('get_project_summary');
  if (/待审批|待老板/.test(question)) tools.push('get_pending_approvals');
  if (/异常|风险|油费/.test(question)) tools.push('get_anomalies');
  if (/财务日报|财务情况/.test(question)) tools.push('get_finance_report');
  if (/今天|今日|本周|本月|经营情况|日报|周报|月报/.test(question) || tools.length === 0) tools.push('get_today_report');
  return Array.from(new Set(tools));
}

export async function mockPostAIChat(payload: AIChatPayload): Promise<AIChatResponse> {
  await delay();
  const now = Date.now();
  const conversationId = payload.conversationId ?? `mock-conversation-${now}`;
  const toolsUsed = toolsFor(payload.message, payload.workOrderId);
  const reply = getMockAIReply(payload.message);
  return {
    conversationId,
    reply,
    answer: reply,
    content: reply,
    message: {
      id: `mock-ai-message-${now}`,
      role: 'assistant',
      content: reply,
      createdAt: new Date(now).toISOString(),
    },
    toolsUsed,
    toolCalls: toolsUsed.map((toolName) => ({ toolName })),
    callLogId: `mock-ai-call-${now}`,
    provider: 'mock',
    model: 'mock-ui-v1',
    fallback: false,
  };
}
