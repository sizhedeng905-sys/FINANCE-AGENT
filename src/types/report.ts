import type { RiskLevel } from './workOrder';

export interface FinanceReport {
  id: string;
  date: string;
  newWorkOrders: number;
  approvedCount: number;
  rejectedCount: number;
  totalIncome: number;
  totalExpense: number;
  estimatedProfit: number;
  aiSummary: string;
}

export interface BossReport {
  id: string;
  period: 'daily' | 'weekly' | 'monthly';
  title: string;
  income: number;
  expense: number;
  profit: number;
  anomalies: string[];
  pendingApprovals: number;
  aiSummary: string;
  aiSuggestion: string;
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
