export type ChatRole = 'user' | 'assistant';

export type AiToolName =
  | 'get_today_report'
  | 'get_finance_report'
  | 'get_project_summary'
  | 'get_period_comparison'
  | 'get_finance_ranking'
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
  callLogId?: string;
  provider?: string;
  model?: string;
  claims?: AiFinancialClaim[];
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
  claims?: AiFinancialClaim[];
}

export interface AiFinancialClaim {
  scopeType: 'company' | 'project' | 'customer' | 'work_order';
  scopeId: string;
  period: string;
  metric: 'income' | 'expense' | 'profit' | 'record_count' | 'risk';
  value: string;
  unit: 'CNY' | 'count';
  sourceTool: AiToolName;
  sourcePath: string;
}
