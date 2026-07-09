import { mockWorkOrders } from '@/mock/mockWorkOrders';
import { useDataCenterStore } from '@/store/dataCenterStore';
import type { Role } from '@/types/auth';
import type { WorkOrder } from '@/types/workOrder';
import type { WorkOrderStatus } from '@/types/workOrder';

const delay = (ms = 180) => new Promise((resolve) => window.setTimeout(resolve, ms));

export async function fetchWorkOrdersApi(): Promise<WorkOrder[]> {
  await delay();
  return mockWorkOrders;
}

// GET /api/work-orders/:id
export async function fetchWorkOrderDetailApi(id: string): Promise<WorkOrder | undefined> {
  await delay();
  return mockWorkOrders.find((item) => item.id === id);
}

// POST /api/work-orders
export async function createWorkOrderApi(workOrder: WorkOrder): Promise<WorkOrder> {
  await delay();
  return workOrder;
}

// PUT /api/work-orders/:id
export async function updateWorkOrderApi(workOrder: WorkOrder): Promise<WorkOrder> {
  await delay();
  return workOrder;
}

// POST /api/work-orders/:id/status
export async function updateWorkOrderStatusApi(payload: {
  id: string;
  status: WorkOrderStatus;
  operator: string;
  role: Role | 'system' | 'ai';
  action: string;
  comment: string;
  patch?: Partial<WorkOrder>;
}): Promise<typeof payload> {
  await delay();
  return payload;
}

// POST /api/work-orders/:id/urge
export async function urgeWorkOrderApi(payload: {
  id: string;
  operator: string;
  role: Role;
  reason: string;
}): Promise<typeof payload> {
  await delay();
  return payload;
}

// POST /api/work-orders/:id/attachments
export async function uploadWorkOrderAttachmentsApi(payload: {
  workOrderId: string;
  files: string[];
}): Promise<typeof payload> {
  await delay();
  return payload;
}

// POST /api/work-orders/:id/generate-record
export async function generateRecordFromWorkOrder(workOrder: WorkOrder): Promise<{ workOrderId: string; recordId: string }> {
  await delay();
  const dataStore = useDataCenterStore.getState();
  const templateId = workOrder.type === 'transport' ? 'dt-transport' : 'dt-reimbursement';
  const template = dataStore.templates.find((item) => item.id === templateId);
  const recordType = workOrder.type === 'transport' ? 'transport' : workOrder.type === 'expense' ? 'reimbursement' : 'other';
  const ensuredTemplate = template ?? dataStore.templates[0];
  dataStore.enableTemplateForProject(workOrder.projectId, ensuredTemplate.id, ensuredTemplate.name);

  const ensureField = (fieldName: string, fieldKey: string, fieldType: 'text' | 'money' | 'file' | 'textarea') => {
    const existing = useDataCenterStore.getState().fields.find((item) => item.fieldName === fieldName);
    if (existing) {
      dataStore.addExistingFieldToTemplate(ensuredTemplate.id, existing.id);
      return existing;
    }
    const field = useDataCenterStore.getState().createField({
      fieldKey,
      fieldName,
      fieldType,
      unit: fieldType === 'money' ? '元' : '',
      semanticType: fieldType === 'money' ? 'amount' : fieldType === 'file' ? 'file' : 'remark',
      aliases: [],
      description: '由工单归档自动补齐的字段定义。',
    });
    useDataCenterStore.getState().addExistingFieldToTemplate(ensuredTemplate.id, field.id);
    return field;
  };

  const fields = {
    workOrderNo: ensureField('工单编号', 'workOrderNo', 'text'),
    submitter: ensureField('提交人', 'submitter', 'text'),
    reason: ensureField('费用说明', 'expenseReason', 'textarea'),
    amount: ensureField('金额', 'amount', 'money'),
    attachment: ensureField('附件', 'attachment', 'file'),
    financeOpinion: ensureField('财务意见', 'financeOpinion', 'textarea'),
    reviewerOpinion: ensureField('复核意见', 'reviewerOpinion', 'textarea'),
    aiOpinion: ensureField('AI意见', 'aiOpinion', 'textarea'),
    bossOpinion: ensureField('老板意见', 'bossOpinion', 'textarea'),
  };

  const created = useDataCenterStore.getState().createRecord({
    projectId: workOrder.projectId,
    projectName: workOrder.projectName,
    templateId: ensuredTemplate.id,
    templateName: ensuredTemplate.name,
    recordType,
    recordDate: workOrder.type === 'transport' ? workOrder.createdAt.slice(0, 10) : workOrder.expenseDate,
    amount: workOrder.type === 'transport' ? workOrder.transportIncome || workOrder.amount : workOrder.amount,
    category: workOrder.type === 'transport' ? '运输' : workOrder.type === 'expense' ? '报销' : '其他支出',
    subCategory: ensuredTemplate.name,
    description: workOrder.description || workOrder.remark || '工单审批归档生成记录',
    sourceType: 'work_order',
    sourceId: workOrder.id,
    status: 'confirmed',
    values: [
      { id: '', recordId: '', fieldId: fields.workOrderNo.id, fieldName: fields.workOrderNo.fieldName, value: workOrder.orderNo },
      { id: '', recordId: '', fieldId: fields.submitter.id, fieldName: fields.submitter.fieldName, value: workOrder.creatorName },
      { id: '', recordId: '', fieldId: fields.reason.id, fieldName: fields.reason.fieldName, value: workOrder.description || workOrder.remark || '' },
      { id: '', recordId: '', fieldId: fields.amount.id, fieldName: fields.amount.fieldName, value: workOrder.amount },
      { id: '', recordId: '', fieldId: fields.attachment.id, fieldName: fields.attachment.fieldName, value: workOrder.attachments },
      { id: '', recordId: '', fieldId: fields.financeOpinion.id, fieldName: fields.financeOpinion.fieldName, value: workOrder.financeOpinion ?? '' },
      { id: '', recordId: '', fieldId: fields.reviewerOpinion.id, fieldName: fields.reviewerOpinion.fieldName, value: workOrder.reviewerOpinion ?? '' },
      { id: '', recordId: '', fieldId: fields.aiOpinion.id, fieldName: fields.aiOpinion.fieldName, value: workOrder.aiSummary ?? '' },
      { id: '', recordId: '', fieldId: fields.bossOpinion.id, fieldName: fields.bossOpinion.fieldName, value: workOrder.bossOpinion ?? '' },
    ],
    attachments: workOrder.attachments,
    createdBy: workOrder.creatorName,
    confirmedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    confirmedBy: '老板',
  });
  return {
    workOrderId: workOrder.id,
    recordId: created.id,
  };
}
