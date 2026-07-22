import type { RiskLevel } from './workOrder';

export type FinanceReportPeriod = 'today' | 'week' | 'month';
export type BossReportPeriod = 'daily' | 'weekly' | 'monthly';

export interface ReportRange {
  startDate: string;
  endDate: string;
  timezone: 'Asia/Shanghai';
}

export interface ExpenseCategory {
  name: string;
  amount: string;
  recordCount: number;
  percentage: number;
}

export interface ReportAnomaly {
  id: string;
  workOrderId: string;
  orderNo: string;
  projectId?: string;
  projectName: string;
  riskLevel: RiskLevel;
  reason: string;
  suggestion?: string;
  status: string;
  detectedAt: string;
}

export interface FinanceReport {
  id: string;
  date: string;
  period: FinanceReportPeriod;
  range: ReportRange;
  generatedAt: string;
  newWorkOrders: number;
  approvedCount: number;
  rejectedCount: number;
  supplementCount: number;
  reviewedCount: number;
  pendingFinanceReview: number;
  newRecords: number;
  confirmedRecords: number;
  recordCount: number;
  anomalyCount: number;
  totalIncome: string;
  totalExpense: string;
  estimatedProfit: string;
  expenseCategories: ExpenseCategory[];
  anomalies: ReportAnomaly[];
  aiSummary: string;
}

export interface ProjectRankingItem {
  projectId: string;
  projectName: string;
  income: string;
  expense: string;
  cost: string;
  profit: string;
  profitRate: number;
  riskCount: number;
}

export interface BossReport {
  id: string;
  period: BossReportPeriod;
  title: string;
  date: string;
  range: ReportRange;
  generatedAt: string;
  income: string;
  expense: string;
  profit: string;
  profitRate: number;
  recordCount: number;
  anomalies: string[];
  highRiskItems: ReportAnomaly[];
  anomalyCount: number;
  pendingApprovals: number;
  highRiskPending: number;
  approvedCount: number;
  rejectedCount: number;
  projectRanking: ProjectRankingItem[];
  expenseCategories: ExpenseCategory[];
  aiSummary: string;
  aiSuggestion: string;
  aiSuggestions: string[];
}

export interface ProjectReport {
  project: { id: string; name: string };
  projectId: string;
  projectName: string;
  date?: string;
  month?: string;
  range: ReportRange;
  generatedAt: string;
  income: string;
  expense: string;
  cost: string;
  profit: string;
  recordCount: number;
  recordsCount: number;
  anomalyCount: number;
  expenseCategories: ExpenseCategory[];
  categoryBreakdown?: Array<{ category: string; amount: string }>;
  dailyTrend?: Array<{ date: string; income: string; expense: string; profit: string }>;
}

export interface AIAnomaly {
  id: string;
  workOrderId: string;
  orderNo: string;
  projectName: string;
  type: string;
  amount: string;
  riskLevel: RiskLevel;
  reason: string;
  statusText: string;
}

export type ReportSnapshotType = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface ReportSnapshotWarning {
  code: string;
  message: string;
}

export interface ReportCurrencyMetrics {
  currency: string;
  income: string;
  cost: string;
  profit: string;
  recordCount: number;
}

export interface ReportSnapshot {
  schemaVersion: 'report-snapshot/1.0';
  snapshotId: string;
  reportType: ReportSnapshotType;
  period: { start: string; endExclusive: string; timezone: 'Asia/Shanghai' };
  scope: {
    organizationId: string;
    scopeType: 'COMPANY' | 'PROJECT' | 'PROJECT_SET';
    projectIds: string[];
  };
  dataPolicy: {
    recordStatus: 'CONFIRMED';
    dataLayer: 'ACTUAL';
    currencies: string[];
    currencyAggregation: 'SEPARATE_BY_CURRENCY';
  };
  metrics: {
    currency: string | null;
    income: string | null;
    cost: string | null;
    profit: string | null;
    recordCount: number;
    byCurrency: ReportCurrencyMetrics[];
  };
  breakdowns: Array<ReportCurrencyMetrics & { projectId: string; projectName: string }>;
  warnings: ReportSnapshotWarning[];
  queryVersion: string;
  dataWatermark: string;
  sourceDigest: string;
  canonicalizationVersion: string;
  snapshotHash: string;
  generatedAt: string;
  retentionClass: string;
}

export interface ReportSnapshotResult {
  snapshot: ReportSnapshot;
  reused: boolean;
  sourceCount: number;
}

export type ReportAccountingDirection = 'income' | 'expense';

export interface ReportSnapshotSource {
  recordId: string;
  recordVersion: number;
  recordHash: string;
  projectId: string;
  projectName: string;
  recordDate: string;
  currency: string;
  accountingDirection: ReportAccountingDirection;
  amount: string;
}

export interface ReportSnapshotSourceQuery {
  page?: number;
  pageSize?: number;
  projectId?: string;
  currency?: string;
  accountingDirection?: ReportAccountingDirection;
}

export interface PaginatedReportSnapshotSources {
  items: ReportSnapshotSource[];
  page: number;
  pageSize: number;
  total: number;
  snapshot: {
    snapshotId: string;
    snapshotHash: string;
    sourceDigest: string;
    dataWatermark: string;
    sourceCount: number;
  };
}

export interface ReportNarrativeClaim {
  claimId: string;
  claimType: 'MONEY' | 'COUNT' | 'PERCENT' | 'DATE' | 'TEXT' | 'COMPARISON' | 'WARNING';
  text: string;
  sourcePath: string;
  value: string;
  sourceValueHash: string;
}

export type ReportNarrativeReviewStatus =
  | 'NEEDS_FINANCE_REVIEW'
  | 'NEEDS_BOSS_REVIEW'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'ACCEPTED';

export type ReportNarrativeReviewStage = 'FINANCE' | 'BOSS';
export type ReportNarrativeReviewCommand = 'ACCEPT' | 'REQUEST_CHANGES' | 'REJECT';

export interface ReportNarrativeReviewPolicy {
  mode: 'disabled' | 'finance_then_boss';
  enabled: boolean;
  policyVersion: string;
  workflow: 'FINANCE_THEN_BOSS';
}

export interface ReportNarrativeReviewEvent {
  id: string;
  reviewVersion: number;
  stage: ReportNarrativeReviewStage;
  command: ReportNarrativeReviewCommand;
  fromStatus: ReportNarrativeReviewStatus;
  toStatus: ReportNarrativeReviewStatus;
  reason: string;
  actor: { id: string; username: string; name: string };
  createdAt: string;
}

export interface ReportNarrativeReviewState {
  status: ReportNarrativeReviewStatus;
  version: number;
  policy: ReportNarrativeReviewPolicy;
  history: ReportNarrativeReviewEvent[];
}

export interface ReportNarrative {
  id: string;
  snapshotId: string;
  snapshotHash: string;
  schemaVersion: 'report-narrative/1.0';
  title: string;
  summary: string;
  warningPaths: string[];
  decision: 'NEEDS_FINANCE_REVIEW';
  narrativeHash: string;
  provider: string;
  model: string;
  promptVersion: string;
  versionVectorHash: string;
  aiTaskId: string;
  claims: ReportNarrativeClaim[];
  review: ReportNarrativeReviewState;
  createdAt: string;
}

export interface PaginatedReportNarratives {
  items: ReportNarrative[];
  page: number;
  pageSize: number;
  total: number;
  policy: ReportNarrativeReviewPolicy;
}

export interface ReviewReportNarrativePayload {
  expectedReviewVersion: number;
  expectedNarrativeHash: string;
  expectedSnapshotHash: string;
  command: ReportNarrativeReviewCommand;
  reason: string;
}

export interface ReportNarrativeGenerationResult {
  status: 'needs_finance_review' | 'disabled' | 'failed' | 'in_progress';
  snapshotId?: string;
  reasonCode?: string;
  message?: string;
  policy?: unknown;
  aiTaskId?: string;
  narrative?: ReportNarrative;
}
