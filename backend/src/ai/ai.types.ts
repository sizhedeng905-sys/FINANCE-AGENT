import {
  AiDataClassification,
  AiFeatureCapability,
  AiProviderClass,
  AiScopeModes
} from '../ai-policy/ai-feature-policy.service';

export type AiToolName =
  | 'get_today_report'
  | 'get_finance_report'
  | 'get_project_summary'
  | 'get_period_comparison'
  | 'get_finance_ranking'
  | 'get_pending_approvals'
  | 'get_anomalies'
  | 'get_work_order_detail';

export interface AiToolContext {
  name: AiToolName;
  data: unknown;
}

export type AiClaimScopeType = 'company' | 'project' | 'customer' | 'work_order';
export type AiClaimMetric = 'income' | 'expense' | 'profit' | 'record_count' | 'risk';
export type AiClaimUnit = 'CNY' | 'count';

export interface AiFinancialClaim {
  scopeType: AiClaimScopeType;
  scopeId: string;
  period: string;
  metric: AiClaimMetric;
  value: string;
  unit: AiClaimUnit;
  sourceTool: AiToolName;
  sourcePath: string;
}

export interface AiClaimEnvelope {
  claims: AiFinancialClaim[];
}

export interface AiHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiProviderRequest {
  provider: string;
  model: string;
  modelVersion?: string;
  deploymentId?: string;
  deploymentKey?: string;
  baseUrl?: string | null;
  apiKey?: string;
  secretRef?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  maxConcurrency?: number;
  maxInputCharacters?: number;
  configHash?: string;
  capability?: AiFeatureCapability;
  providerClass?: AiProviderClass;
  dataClassification?: AiDataClassification;
  scopeModes?: AiScopeModes;
  instructions: string;
  question: string;
  history: AiHistoryMessage[];
  contexts: AiToolContext[];
  claimCandidates?: AiFinancialClaim[];
  mockScenario?: 'success' | 'unmapped' | 'invalid_json' | 'timeout' | 'injection';
  mockOutput?: unknown;
  mockTemplateVersionId?: string;
  structuredInput?: unknown;
  outputSchema?: unknown;
  requestIdempotencyKey?: string;
  beforeProviderRequest?: () => Promise<void>;
}

export interface AiProviderResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  raw: unknown;
}
