export interface AiToolContext {
  name:
    | 'get_today_report'
    | 'get_finance_report'
    | 'get_project_summary'
    | 'get_pending_approvals'
    | 'get_anomalies'
    | 'get_work_order_detail';
  data: unknown;
}

export interface AiHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiProviderRequest {
  provider: string;
  model: string;
  baseUrl?: string | null;
  apiKey?: string;
  instructions: string;
  question: string;
  history: AiHistoryMessage[];
  contexts: AiToolContext[];
}

export interface AiProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  raw: unknown;
}
