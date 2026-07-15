export type ChatRole = 'user' | 'assistant';

export type AiToolName =
  | 'get_today_report'
  | 'get_finance_report'
  | 'get_project_summary'
  | 'get_pending_approvals'
  | 'get_anomalies'
  | 'get_work_order_detail';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  toolsUsed?: AiToolName[];
  fallback?: boolean;
}

export interface AIChatPayload {
  message: string;
  conversationId?: string;
  history?: ChatMessage[];
  workOrderId?: string;
}

export interface AIChatResponse {
  conversationId: string;
  reply: string;
  answer: string;
  content: string;
  message: ChatMessage;
  toolsUsed: AiToolName[];
  toolCalls: Array<{ toolName: AiToolName }>;
  callLogId: string;
  provider: string;
  model: string;
  fallback: boolean;
}
