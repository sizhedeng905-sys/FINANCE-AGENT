import type { RiskLevel, WorkOrderStatus, WorkOrderType } from '@/types/workOrder';
import type { Role } from '@/types/auth';

export const roleLabelMap: Record<Role, string> = {
  employee: '员工',
  finance: '财务',
  reviewer: '复核员',
  boss: '老板',
};

export const workOrderTypeMap: Record<WorkOrderType, string> = {
  transport: '运输订单',
  expense: '费用报销',
  other: '其他支出',
};

export const riskLabelMap: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
};

export const statusTextMap: Record<WorkOrderStatus, string> = {
  draft: '草稿',
  submitted: '已提交',
  finance_reviewing: '财务审核中',
  finance_approved: '财务已通过',
  finance_rejected: '财务已驳回',
  reviewer_reviewing: '复核中',
  reviewer_approved: '复核已通过',
  reviewer_rejected: '复核已驳回',
  ai_reviewing: 'AI复核中',
  ai_passed: 'AI已通过',
  ai_flagged: 'AI发现异常',
  boss_pending: '老板待审批',
  boss_approved: '老板已通过',
  boss_rejected: '老板已驳回',
  completed: '已归档',
  returned_for_supplement: '待补充材料',
};

export const statusColorMap: Record<WorkOrderStatus, string> = {
  draft: 'default',
  submitted: 'processing',
  finance_reviewing: 'processing',
  finance_approved: 'cyan',
  finance_rejected: 'error',
  reviewer_reviewing: 'processing',
  reviewer_approved: 'cyan',
  reviewer_rejected: 'error',
  ai_reviewing: 'geekblue',
  ai_passed: 'success',
  ai_flagged: 'warning',
  boss_pending: 'warning',
  boss_approved: 'success',
  boss_rejected: 'error',
  completed: 'success',
  returned_for_supplement: 'orange',
};

export function getStepByStatus(status: WorkOrderStatus) {
  if (status === 'completed') return 5;
  if (status === 'boss_pending' || status === 'boss_approved' || status === 'boss_rejected') return 4;
  if (status === 'ai_reviewing' || status === 'ai_passed' || status === 'ai_flagged') return 3;
  if (status === 'reviewer_reviewing' || status === 'reviewer_approved' || status === 'reviewer_rejected') return 2;
  if (
    status === 'finance_reviewing' ||
    status === 'finance_approved' ||
    status === 'finance_rejected' ||
    status === 'returned_for_supplement'
  ) {
    return 1;
  }
  return 0;
}

export function isRejectedStatus(status: WorkOrderStatus) {
  return status === 'finance_rejected' || status === 'reviewer_rejected' || status === 'boss_rejected';
}
