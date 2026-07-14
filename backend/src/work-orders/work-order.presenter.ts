import { Prisma, WorkOrderStatus } from '@prisma/client';

export const workOrderInclude = {
  attachments: {
    include: { rawFile: true },
    orderBy: { createdAt: 'asc' }
  },
  timeline: {
    orderBy: { createdAt: 'asc' }
  }
} satisfies Prisma.WorkOrderInclude;

export type WorkOrderWithRelations = Prisma.WorkOrderGetPayload<{ include: typeof workOrderInclude }>;

const stepByStatus: Record<WorkOrderStatus, number> = {
  draft: 0,
  finance_reviewing: 1,
  finance_rejected: 1,
  returned_for_supplement: 1,
  reviewer_reviewing: 2,
  reviewer_rejected: 2,
  ai_reviewing: 3,
  ai_passed: 3,
  ai_flagged: 3,
  boss_pending: 4,
  boss_rejected: 4,
  completed: 5
};

export function toTimelineItem(item: WorkOrderWithRelations['timeline'][number]) {
  return {
    id: item.id,
    time: item.createdAt.toISOString(),
    operator: item.operatorName ?? '系统',
    operatorId: item.operatorId ?? undefined,
    role: item.role,
    action: item.action,
    comment: item.comment ?? '',
    fromStatus: item.fromStatus ?? undefined,
    toStatus: item.toStatus ?? undefined
  };
}

export function toWorkOrder(workOrder: WorkOrderWithRelations) {
  return {
    id: workOrder.id,
    orderNo: workOrder.orderNo,
    type: workOrder.type,
    projectId: workOrder.projectId,
    projectName: workOrder.projectName,
    customerName: workOrder.customerName ?? '',
    creatorName: workOrder.creatorName,
    creatorId: workOrder.creatorId,
    amount: workOrder.amount.toFixed(2),
    income: workOrder.income.toFixed(2),
    cost: workOrder.cost.toFixed(2),
    profit: workOrder.profit.toFixed(2),
    status: workOrder.status,
    riskLevel: workOrder.riskLevel,
    occurredDate: workOrder.occurredDate?.toISOString(),
    submittedAt: workOrder.submittedAt?.toISOString(),
    templateId: workOrder.templateId ?? undefined,
    templateVersion: workOrder.templateVersion ?? undefined,
    version: workOrder.version,
    createdAt: workOrder.createdAt.toISOString(),
    updatedAt: workOrder.updatedAt.toISOString(),
    currentStep: stepByStatus[workOrder.status],
    description: workOrder.description ?? '',
    extraValues: workOrder.extraValues ?? {},
    attachments: workOrder.attachments.map((item) => item.rawFileId),
    financeOpinion: workOrder.financeOpinion ?? undefined,
    reviewerOpinion: workOrder.reviewerOpinion ?? undefined,
    aiSummary: workOrder.aiSummary ?? undefined,
    bossOpinion: workOrder.bossOpinion ?? undefined,
    timeline: workOrder.timeline.map(toTimelineItem),
    urgent: workOrder.urgent,
    urgentReason: workOrder.urgentReason ?? undefined,
    urgentTime: workOrder.urgentTime?.toISOString(),
    completedAt: workOrder.completedAt?.toISOString(),
    generatedRecordId: workOrder.generatedRecordId ?? undefined
  };
}
