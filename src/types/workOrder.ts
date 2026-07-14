import type { Role } from './auth';

export type WorkOrderType = 'transport' | 'expense' | 'other';

export type WorkOrderStatus =
  | 'draft'
  | 'finance_reviewing'
  | 'finance_rejected'
  | 'reviewer_reviewing'
  | 'reviewer_rejected'
  | 'ai_reviewing'
  | 'ai_passed'
  | 'ai_flagged'
  | 'boss_pending'
  | 'boss_rejected'
  | 'completed'
  | 'returned_for_supplement';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface TimelineItem {
  id?: string;
  time: string;
  operator: string;
  operatorId?: string;
  role: Role | 'system' | 'ai';
  action: string;
  comment: string;
  fromStatus?: WorkOrderStatus;
  toStatus?: WorkOrderStatus;
}

export interface BaseWorkOrder {
  id: string;
  orderNo: string;
  type: WorkOrderType;
  projectId: string;
  projectName: string;
  customerName: string;
  creatorName: string;
  creatorId: string;
  amount: string;
  income: string;
  cost: string;
  profit: string;
  status: WorkOrderStatus;
  riskLevel: RiskLevel;
  occurredDate?: string;
  createdAt: string;
  updatedAt: string;
  currentStep: number;
  description: string;
  extraValues: Record<string, unknown>;
  attachments: string[];
  financeOpinion?: string;
  reviewerOpinion?: string;
  aiSummary?: string;
  bossOpinion?: string;
  timeline: TimelineItem[];
  urgent?: boolean;
  urgentReason?: string;
  urgentTime?: string;
  completedAt?: string;
  generatedRecordId?: string;
}

export interface WorkOrder extends BaseWorkOrder {
  type: WorkOrderType;
  vehiclePlate?: string;
  driverName?: string;
  vehicleOwnerType?: 'self' | 'outsourced';
  startLocation?: string;
  endLocation?: string;
  distance?: number;
  transportIncome?: string;
  fuelCost?: string;
  tollCost?: string;
  driverCost?: string;
  otherCost?: string;
  remark?: string;
  expenseType?: string;
  expenseAmount?: string;
  expenseDate?: string;
  paymentMethod?: string;
}

export interface CreateWorkOrderPayload {
  type: WorkOrderType;
  projectId: string;
  amount?: string;
  description?: string;
  occurredDate?: string;
  attachments?: string[];
  extraValues?: Record<string, unknown>;
}

export type UpdateWorkOrderPayload = Partial<CreateWorkOrderPayload>;

export interface WorkOrderListQuery {
  page?: number;
  pageSize?: number;
  projectId?: string;
  status?: WorkOrderStatus;
  type?: WorkOrderType;
  urgent?: boolean;
}

export interface PaginatedWorkOrders {
  items: WorkOrder[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WorkOrderReviewPayload {
  action: 'approve' | 'reject' | 'supplement' | 'reject_to_finance';
  comment?: string;
}

export interface SupplementWorkOrderPayload {
  comment: string;
  description?: string;
  attachments?: string[];
}

export interface Project {
  id: string;
  projectName: string;
  customerName: string;
  ownerName: string;
  monthIncome: string;
  monthCost: string;
  anomalyCount: number;
  status: 'normal' | 'watch' | 'risk';
  aiSummary: string;
}
