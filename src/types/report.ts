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
  amount: number;
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
  anomalyCount: number;
  totalIncome: number;
  totalExpense: number;
  estimatedProfit: number;
  expenseCategories: ExpenseCategory[];
  anomalies: ReportAnomaly[];
  aiSummary: string;
}

export interface ProjectRankingItem {
  projectId: string;
  projectName: string;
  income: number;
  expense: number;
  cost: number;
  profit: number;
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
  income: number;
  expense: number;
  profit: number;
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
  income: number;
  expense: number;
  cost: number;
  profit: number;
  recordCount: number;
  recordsCount: number;
  anomalyCount: number;
  expenseCategories: ExpenseCategory[];
  categoryBreakdown?: Array<{ category: string; amount: number }>;
  dailyTrend?: Array<{ date: string; income: number; expense: number; profit: number }>;
}

export interface AIAnomaly {
  id: string;
  workOrderId: string;
  orderNo: string;
  projectName: string;
  type: string;
  amount: number;
  riskLevel: RiskLevel;
  reason: string;
  statusText: string;
}
