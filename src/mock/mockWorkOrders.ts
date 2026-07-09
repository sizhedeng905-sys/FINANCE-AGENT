import type { TimelineItem, WorkOrder, WorkOrderStatus } from '@/types/workOrder';

const now = '2026-07-08 09:00';

function stepFromStatus(status: WorkOrderStatus) {
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

function timeline(status: WorkOrderStatus, extra: TimelineItem[] = []): TimelineItem[] {
  return [
    {
      time: '2026-07-08 08:30',
      operator: '陈明',
      role: 'employee',
      action: '提交工单',
      comment: '员工提交工单，等待财务审核。',
    },
    ...extra,
    {
      time: now,
      operator: '系统',
      role: 'system',
      action: '当前状态',
      comment: status,
    },
  ];
}

function base(
  index: number,
  status: WorkOrderStatus,
  riskLevel: WorkOrder['riskLevel'],
  type: WorkOrder['type'],
  amount: number,
): Omit<WorkOrder, 'type'> {
  const income = type === 'transport' ? amount : 0;
  const cost = type === 'transport' ? Math.round(amount * 0.64) : amount;
  const profit = income - cost;
  const projects = [
    { id: 'dp-001', name: '太和中转项目', customerName: '太和物流' },
    { id: 'dp-002', name: '得物项目', customerName: '得物' },
    { id: 'dp-003', name: '旧衣服项目', customerName: '旧衣回收' },
  ];
  const project = projects[(index - 1) % projects.length];

  return {
    id: `wo-${String(index).padStart(3, '0')}`,
    orderNo: `WO20260708${String(index).padStart(3, '0')}`,
    projectId: project.id,
    projectName: project.name,
    customerName: project.customerName,
    creatorName: '陈明',
    creatorId: 'u-employee',
    amount,
    income,
    cost,
    profit,
    status,
    riskLevel,
    createdAt: `2026-07-${String(Math.max(1, index)).padStart(2, '0')} 08:30`,
    updatedAt: now,
    currentStep: stepFromStatus(status),
    description: '用于物流项目运营结算和费用审核的 mock 工单。',
    attachments: ['回单照片.jpg', '费用凭证.pdf'],
    financeOpinion:
      stepFromStatus(status) >= 2 || status === 'finance_approved'
        ? '票据与项目匹配，金额基本合理。'
        : undefined,
    reviewerOpinion:
      stepFromStatus(status) >= 3 || status === 'reviewer_approved'
        ? '复核通过，建议进入 AI 自动复核。'
        : undefined,
    aiSummary:
      riskLevel === 'high'
        ? 'AI 检测到该工单金额偏高或附件说明不足，建议重点关注。'
        : riskLevel === 'medium'
          ? 'AI 提示存在轻微异常，建议结合附件复核。'
          : 'AI 未发现明显异常，流程资料较完整。',
    bossOpinion:
      status === 'completed'
        ? '同意归档。'
        : status === 'boss_rejected'
          ? '成本说明不足，暂不通过。'
          : undefined,
    timeline: timeline(status),
  };
}

function transport(
  index: number,
  status: WorkOrderStatus,
  riskLevel: WorkOrder['riskLevel'],
  amount: number,
): WorkOrder {
  const fuelCost = Math.round(amount * 0.18);
  const tollCost = Math.round(amount * 0.08);
  const driverCost = Math.round(amount * 0.26);
  const otherCost = Math.round(amount * 0.12);
  const common = base(index, status, riskLevel, 'transport', amount);

  return {
    ...common,
    type: 'transport',
    vehiclePlate: ['沪A8K21L', '苏E77M32', '浙B19P70'][index % 3],
    driverName: ['王师傅', '刘师傅', '孙师傅'][index % 3],
    vehicleOwnerType: index % 2 === 0 ? 'self' : 'outsourced',
    startLocation: '上海嘉定仓',
    endLocation: '杭州萧山门店',
    distance: 216 + index * 8,
    transportIncome: amount,
    fuelCost,
    tollCost,
    driverCost,
    otherCost,
    cost: fuelCost + tollCost + driverCost + otherCost,
    profit: amount - fuelCost - tollCost - driverCost - otherCost,
    remark: '运输订单模拟数据。',
  };
}

function expense(
  index: number,
  status: WorkOrderStatus,
  riskLevel: WorkOrder['riskLevel'],
  amount: number,
): WorkOrder {
  return {
    ...base(index, status, riskLevel, 'expense', amount),
    type: 'expense',
    expenseType: index % 2 === 0 ? '装卸费' : '维修费',
    expenseAmount: amount,
    expenseDate: `2026-07-${String(index).padStart(2, '0')}`,
    paymentMethod: '银行转账',
    remark: '费用报销模拟数据。',
  };
}

function other(index: number, status: WorkOrderStatus, riskLevel: WorkOrder['riskLevel'], amount: number): WorkOrder {
  return {
    ...base(index, status, riskLevel, 'other', amount),
    type: 'other',
    expenseType: '临时支出',
    expenseAmount: amount,
    expenseDate: `2026-07-${String(index).padStart(2, '0')}`,
    paymentMethod: '备用金',
    remark: '其他支出模拟数据。',
  };
}

export const mockWorkOrders: WorkOrder[] = [
  transport(1, 'submitted', 'low', 12800),
  expense(2, 'finance_reviewing', 'medium', 8600),
  transport(3, 'finance_approved', 'low', 15600),
  transport(4, 'reviewer_reviewing', 'medium', 21800),
  other(5, 'ai_reviewing', 'medium', 3200),
  transport(6, 'boss_pending', 'low', 19600),
  expense(7, 'boss_pending', 'high', 24800),
  transport(8, 'completed', 'low', 18200),
  other(9, 'boss_rejected', 'medium', 6400),
  expense(10, 'finance_rejected', 'high', 9200),
  transport(11, 'returned_for_supplement', 'medium', 14200),
  expense(12, 'finance_reviewing', 'high', 38800),
];
