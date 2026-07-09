import type { Role } from './auth';

export type WorkOrderType = 'transport' | 'expense' | 'other';

export type WorkOrderStatus =
  | 'draft'
  | 'submitted'
  | 'finance_reviewing'
  | 'finance_approved'
  | 'finance_rejected'
  | 'reviewer_reviewing'
  | 'reviewer_approved'
  | 'reviewer_rejected'
  | 'ai_reviewing'
  | 'ai_passed'
  | 'ai_flagged'
  | 'boss_pending'
  | 'boss_approved'
  | 'boss_rejected'
  | 'completed'
  | 'returned_for_supplement';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface TimelineItem {
  time: string;
  operator: string;
  role: Role | 'system' | 'ai';
  action: string;
  comment: string;
}

export interface BaseWorkOrder {
  id: string;
  orderNo: string;
  type: WorkOrderType;
  projectName: string;
  customerName: string;
  creatorName: string;
  creatorId: string;
  amount: number;
  income: number;
  cost: number;
  profit: number;
  status: WorkOrderStatus;
  riskLevel: RiskLevel;
  createdAt: string;
  updatedAt: string;
  currentStep: number;
  description: string;
  attachments: string[];
  financeOpinion?: string;
  reviewerOpinion?: string;
  aiSummary?: string;
  bossOpinion?: string;
  timeline: TimelineItem[];
  urgent?: boolean;
  urgentReason?: string;
  urgentTime?: string;
}

export interface TransportWorkOrder extends BaseWorkOrder {
  type: 'transport';
  vehiclePlate: string;
  driverName: string;
  vehicleOwnerType: 'self' | 'outsourced';
  startLocation: string;
  endLocation: string;
  distance: number;
  transportIncome: number;
  fuelCost: number;
  tollCost: number;
  driverCost: number;
  otherCost: number;
  remark?: string;
}

export interface ExpenseWorkOrder extends BaseWorkOrder {
  type: 'expense';
  expenseType: string;
  expenseAmount: number;
  expenseDate: string;
  paymentMethod: string;
  remark?: string;
}

export interface OtherWorkOrder extends BaseWorkOrder {
  type: 'other';
  expenseType: string;
  expenseAmount: number;
  expenseDate: string;
  paymentMethod: string;
  remark?: string;
}

export type WorkOrder = TransportWorkOrder | ExpenseWorkOrder | OtherWorkOrder;

export interface Project {
  id: string;
  projectName: string;
  customerName: string;
  ownerName: string;
  monthIncome: number;
  monthCost: number;
  anomalyCount: number;
  status: 'normal' | 'watch' | 'risk';
  aiSummary: string;
}
