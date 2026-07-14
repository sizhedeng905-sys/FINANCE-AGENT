import { getAccessToken } from '@/api/authSession';
import { mockMe } from '@/api/mockIdentityRepository';
import { mockPushNotification } from './mockNotificationRepository';
import { mockGetProject } from '@/api/mockProjectRepository';
import { mockCreateGeneratedRecord } from '@/api/mockRecordRepository';
import { mockDataTemplates, mockTemplateFields } from '@/mock/mockDataCenter';
import { mockWorkOrders } from '@/mock/mockWorkOrders';
import type { UserAccount } from '@/types/user';
import type {
  CreateWorkOrderPayload,
  PaginatedWorkOrders,
  SupplementWorkOrderPayload,
  UpdateWorkOrderPayload,
  WorkOrder,
  WorkOrderListQuery,
  WorkOrderReviewPayload,
  WorkOrderStatus,
} from '@/types/workOrder';
import { getStepByStatus } from '@/utils/statusMap';

const delay = (ms = 160) => new Promise((resolve) => window.setTimeout(resolve, ms));
const reviewerVisible: WorkOrderStatus[] = [
  'reviewer_reviewing',
  'reviewer_rejected',
  'ai_reviewing',
  'ai_passed',
  'ai_flagged',
  'boss_pending',
  'boss_rejected',
  'completed',
];
const bossVisible: WorkOrderStatus[] = ['boss_pending', 'boss_rejected', 'completed'];

let workOrders = mockWorkOrders.map(cloneWorkOrder);
const creationKeys = new Map<string, string>();
const approvalKeys = new Map<string, string>();

function cloneWorkOrder(workOrder: WorkOrder): WorkOrder {
  return {
    ...workOrder,
    extraValues: { ...workOrder.extraValues },
    attachments: [...workOrder.attachments],
    timeline: workOrder.timeline.map((item) => ({ ...item })),
  };
}

async function actor(): Promise<UserAccount> {
  return mockMe(getAccessToken());
}

function findOrThrow(id: string): WorkOrder {
  const workOrder = workOrders.find((item) => item.id === id);
  if (!workOrder) throw new Error('资源不存在');
  return workOrder;
}

export function mockAttachFileToWorkOrder(workOrderId: string, fileId: string, uploaderId: string): void {
  const workOrder = findOrThrow(workOrderId);
  if (workOrder.creatorId !== uploaderId) throw new Error('只能给自己的工单上传附件');
  if (!['draft', 'returned_for_supplement'].includes(workOrder.status)) throw new Error('当前工单状态不能新增附件');
  if (!workOrder.attachments.includes(fileId) && workOrder.attachments.length >= 20) throw new Error('单个工单最多关联 20 个附件');
  workOrder.attachments = [...new Set([...workOrder.attachments, fileId])];
  workOrder.updatedAt = new Date().toISOString();
}

export function mockDetachFileFromWorkOrder(workOrderId: string, fileId: string, uploaderId: string): void {
  const workOrder = findOrThrow(workOrderId);
  if (workOrder.creatorId !== uploaderId) throw new Error('只能删除自己工单的附件');
  if (!['draft', 'returned_for_supplement'].includes(workOrder.status)) throw new Error('当前工单状态不能删除附件');
  workOrder.attachments = workOrder.attachments.filter((id) => id !== fileId);
  workOrder.updatedAt = new Date().toISOString();
}

function assertRole(user: UserAccount, role: UserAccount['role']): void {
  if (user.role !== role) throw new Error('无权限');
}

function assertAccessible(workOrder: WorkOrder, user: UserAccount): void {
  if (user.role === 'employee' && workOrder.creatorId !== user.id) throw new Error('无权访问该工单');
  if (user.role === 'reviewer' && !reviewerVisible.includes(workOrder.status)) throw new Error('无权访问该工单');
  if (user.role === 'boss' && !bossVisible.includes(workOrder.status)) throw new Error('无权访问该工单');
}

function addTimeline(
  workOrder: WorkOrder,
  user: Pick<UserAccount, 'id' | 'name' | 'role'> | { id?: string; name: string; role: 'system' | 'ai' },
  action: string,
  comment: string,
  fromStatus: WorkOrderStatus,
  toStatus: WorkOrderStatus,
): void {
  workOrder.timeline.push({
    id: `mock-timeline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: new Date().toISOString(),
    operator: user.name,
    operatorId: user.id,
    role: user.role,
    action,
    comment,
    fromStatus,
    toStatus,
  });
}

function setStatus(workOrder: WorkOrder, status: WorkOrderStatus): void {
  workOrder.status = status;
  workOrder.currentStep = getStepByStatus(status);
  workOrder.updatedAt = new Date().toISOString();
}

function assertComplete(workOrder: WorkOrder): void {
  const missing = [];
  if (!(Number(workOrder.amount) > 0)) missing.push('amount');
  if (!workOrder.description.trim()) missing.push('description');
  if (!workOrder.occurredDate) missing.push('occurredDate');
  if (missing.length) throw new Error(`工单信息不完整：${missing.join(', ')}`);
}

function filteredForUser(query: WorkOrderListQuery, user: UserAccount): WorkOrder[] {
  if (user.role === 'reviewer' && query.status && !reviewerVisible.includes(query.status)) throw new Error('无权查询该状态的工单');
  if (user.role === 'boss' && query.status && !bossVisible.includes(query.status)) throw new Error('无权查询该状态的工单');
  return workOrders.filter((item) => {
    if (user.role === 'employee' && item.creatorId !== user.id) return false;
    if (user.role === 'reviewer' && !reviewerVisible.includes(item.status)) return false;
    if (user.role === 'boss' && !bossVisible.includes(item.status)) return false;
    if (query.projectId && item.projectId !== query.projectId) return false;
    if (query.status && item.status !== query.status) return false;
    if (query.type && item.type !== query.type) return false;
    if (query.urgent !== undefined && Boolean(item.urgent) !== query.urgent) return false;
    return true;
  });
}

export async function mockListWorkOrders(query: WorkOrderListQuery = {}): Promise<PaginatedWorkOrders> {
  await delay();
  const user = await actor();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const filtered = filteredForUser(query, user);
  const start = (page - 1) * pageSize;
  return { items: filtered.slice(start, start + pageSize).map(cloneWorkOrder), page, pageSize, total: filtered.length };
}

export async function mockGetWorkOrder(id: string): Promise<WorkOrder> {
  await delay();
  const user = await actor();
  const workOrder = findOrThrow(id);
  assertAccessible(workOrder, user);
  return cloneWorkOrder(workOrder);
}

export async function mockCreateWorkOrder(payload: CreateWorkOrderPayload, idempotencyKey: string): Promise<WorkOrder> {
  await delay();
  const user = await actor();
  assertRole(user, 'employee');
  const existingId = creationKeys.get(idempotencyKey);
  if (existingId) return cloneWorkOrder(findOrThrow(existingId));
  const project = await mockGetProject(payload.projectId);
  if (project.status !== 'active') throw new Error('项目不存在或未启用');
  const now = new Date().toISOString();
  const id = `mock-work-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workOrder: WorkOrder = {
    id,
    orderNo: `WO${now.slice(0, 10).replace(/-/g, '')}${String(Date.now()).slice(-7)}`,
    type: payload.type,
    projectId: project.id,
    projectName: project.name,
    customerName: project.customerName,
    creatorName: user.name,
    creatorId: user.id,
    amount: payload.amount ?? '0.00',
    income: '0.00',
    cost: '0.00',
    profit: '0.00',
    status: 'draft',
    riskLevel: 'low',
    occurredDate: payload.occurredDate,
    createdAt: now,
    updatedAt: now,
    currentStep: 0,
    description: payload.description ?? '',
    extraValues: { ...(payload.extraValues ?? {}) },
    attachments: [...(payload.attachments ?? [])],
    timeline: [{
      id: `mock-timeline-${Date.now()}`,
      time: now,
      operator: user.name,
      operatorId: user.id,
      role: user.role,
      action: '保存草稿',
      comment: '员工创建工单草稿。',
      toStatus: 'draft',
    }],
  };
  Object.assign(workOrder, payload.extraValues ?? {});
  workOrders = [workOrder, ...workOrders];
  creationKeys.set(idempotencyKey, id);
  return cloneWorkOrder(workOrder);
}

export async function mockUpdateWorkOrder(id: string, payload: UpdateWorkOrderPayload): Promise<WorkOrder> {
  await delay();
  const user = await actor();
  assertRole(user, 'employee');
  const workOrder = findOrThrow(id);
  if (workOrder.creatorId !== user.id) throw new Error('只能操作自己的工单');
  if (!['draft', 'returned_for_supplement'].includes(workOrder.status)) throw new Error('当前状态不能修改');
  if (payload.projectId) {
    const project = await mockGetProject(payload.projectId);
    workOrder.projectId = project.id;
    workOrder.projectName = project.name;
    workOrder.customerName = project.customerName;
  }
  if (payload.type) workOrder.type = payload.type;
  if (payload.amount !== undefined) workOrder.amount = payload.amount;
  if (payload.description !== undefined) workOrder.description = payload.description.trim();
  if (payload.occurredDate !== undefined) workOrder.occurredDate = payload.occurredDate;
  if (payload.attachments !== undefined) workOrder.attachments = [...payload.attachments];
  if (payload.extraValues !== undefined) {
    workOrder.extraValues = { ...payload.extraValues };
    Object.assign(workOrder, payload.extraValues);
  }
  workOrder.updatedAt = new Date().toISOString();
  return cloneWorkOrder(workOrder);
}

export async function mockSubmitWorkOrder(id: string): Promise<WorkOrder> {
  await delay();
  const user = await actor();
  assertRole(user, 'employee');
  const workOrder = findOrThrow(id);
  if (workOrder.creatorId !== user.id) throw new Error('只能操作自己的工单');
  if (!['draft', 'returned_for_supplement'].includes(workOrder.status)) throw new Error('非法状态流转');
  assertComplete(workOrder);
  const from = workOrder.status;
  setStatus(workOrder, 'finance_reviewing');
  addTimeline(workOrder, user, '提交工单', '工单已提交，等待财务审核。', from, 'finance_reviewing');
  mockPushNotification({
    title: '新工单待财务审核',
    content: `${user.name}提交工单 ${workOrder.orderNo}`,
    type: 'audit',
    sender: user.name,
    targetRole: 'finance',
    relatedWorkOrderId: workOrder.id,
  });
  return cloneWorkOrder(workOrder);
}

export async function mockSupplementWorkOrder(id: string, payload: SupplementWorkOrderPayload): Promise<WorkOrder> {
  await delay();
  const user = await actor();
  assertRole(user, 'employee');
  const workOrder = findOrThrow(id);
  if (workOrder.creatorId !== user.id || workOrder.status !== 'returned_for_supplement') throw new Error('非法状态流转');
  if (payload.description !== undefined) workOrder.description = payload.description.trim();
  if (payload.attachments) workOrder.attachments = [...new Set([...workOrder.attachments, ...payload.attachments])];
  assertComplete(workOrder);
  setStatus(workOrder, 'finance_reviewing');
  addTimeline(workOrder, user, '补充材料并重新提交', payload.comment, 'returned_for_supplement', 'finance_reviewing');
  mockPushNotification({
    title: '补充材料待财务复审',
    content: `${user.name}已补充工单 ${workOrder.orderNo}`,
    type: 'audit',
    sender: user.name,
    targetRole: 'finance',
    relatedWorkOrderId: workOrder.id,
  });
  return cloneWorkOrder(workOrder);
}

export async function mockFinanceReview(id: string, payload: WorkOrderReviewPayload): Promise<WorkOrder> {
  await delay();
  const user = await actor();
  assertRole(user, 'finance');
  const workOrder = findOrThrow(id);
  if (!['finance_reviewing', 'reviewer_rejected'].includes(workOrder.status)) throw new Error('非法状态流转');
  if (payload.action !== 'approve' && !payload.comment?.trim()) throw new Error('请填写审核意见');
  const next: WorkOrderStatus = payload.action === 'approve'
    ? 'reviewer_reviewing'
    : payload.action === 'supplement'
      ? 'returned_for_supplement'
      : 'finance_rejected';
  const from = workOrder.status;
  workOrder.financeOpinion = payload.comment;
  setStatus(workOrder, next);
  addTimeline(workOrder, user, payload.action, payload.comment ?? '', from, next);
  mockPushNotification({
    title: '工单流程更新',
    content: `工单 ${workOrder.orderNo} 已由${user.name}处理`,
    type: 'audit',
    sender: user.name,
    targetRole: next === 'reviewer_reviewing' ? 'reviewer' : 'employee',
    targetUserId: next === 'reviewer_reviewing' ? undefined : workOrder.creatorId,
    relatedWorkOrderId: workOrder.id,
  });
  return cloneWorkOrder(workOrder);
}

export async function mockReviewerReview(id: string, payload: WorkOrderReviewPayload): Promise<WorkOrder> {
  await delay();
  const user = await actor();
  assertRole(user, 'reviewer');
  const workOrder = findOrThrow(id);
  if (workOrder.status !== 'reviewer_reviewing') throw new Error('非法状态流转');
  if (payload.action !== 'approve' && !payload.comment?.trim()) throw new Error('请填写复核意见');
  const next: WorkOrderStatus = payload.action === 'approve'
    ? 'ai_reviewing'
    : payload.action === 'supplement'
      ? 'returned_for_supplement'
      : 'reviewer_rejected';
  workOrder.reviewerOpinion = payload.comment;
  setStatus(workOrder, next);
  addTimeline(workOrder, user, payload.action, payload.comment ?? '', 'reviewer_reviewing', next);
  if (next === 'ai_reviewing') return mockRunAiReview(workOrder.id, user);
  mockPushNotification({
    title: '工单流程更新',
    content: `工单 ${workOrder.orderNo} 已由${user.name}处理`,
    type: 'audit',
    sender: user.name,
    targetRole: next === 'reviewer_rejected' ? 'finance' : 'employee',
    targetUserId: next === 'returned_for_supplement' ? workOrder.creatorId : undefined,
    relatedWorkOrderId: workOrder.id,
  });
  return cloneWorkOrder(workOrder);
}

async function mockRunAiReview(id: string, requester?: UserAccount): Promise<WorkOrder> {
  const user = requester ?? await actor();
  const workOrder = findOrThrow(id);
  if (workOrder.status === 'boss_pending') return cloneWorkOrder(workOrder);
  if (workOrder.status !== 'ai_reviewing') throw new Error('非法状态流转');
  const reviewStatus: WorkOrderStatus = Number(workOrder.amount) > 20_000 || workOrder.attachments.length === 0 ? 'ai_flagged' : 'ai_passed';
  workOrder.riskLevel = reviewStatus === 'ai_flagged' ? 'high' : 'low';
  workOrder.aiSummary = reviewStatus === 'ai_flagged' ? '规则复核发现高额或附件异常。' : '规则复核未发现明显异常。';
  setStatus(workOrder, reviewStatus);
  addTimeline(workOrder, { name: '系统规则', role: 'system' }, '规则复核完成', workOrder.aiSummary, 'ai_reviewing', reviewStatus);
  setStatus(workOrder, 'boss_pending');
  addTimeline(workOrder, { name: '系统规则', role: 'system' }, '提交老板审批', '等待老板最终审批。', reviewStatus, 'boss_pending');
  mockPushNotification({
    title: '工单待老板审批',
    content: `${workOrder.orderNo} 规则复核完成，风险等级：${workOrder.riskLevel}`,
    type: 'boss_approval',
    sender: '系统规则',
    targetRole: 'boss',
    relatedWorkOrderId: workOrder.id,
  });
  void user;
  return cloneWorkOrder(workOrder);
}

export async function mockAiReview(id: string): Promise<WorkOrder> {
  await delay();
  const user = await actor();
  assertRole(user, 'finance');
  return mockRunAiReview(id, user);
}

async function createGeneratedRecord(workOrder: WorkOrder, user: UserAccount): Promise<string> {
  const templateId = workOrder.type === 'transport' ? 'dt-transport' : 'dt-reimbursement';
  const template = mockDataTemplates.find((item) => item.id === templateId) ?? mockDataTemplates[0];
  const fields = mockTemplateFields.filter((item) => item.templateId === template.id);
  const dynamicValue = (fieldKey: string): string | number | string[] | null => {
    if (fieldKey === 'date') return workOrder.occurredDate?.slice(0, 10) ?? null;
    if (fieldKey === 'amount' || fieldKey === 'incomeAmount') return workOrder.amount;
    if (fieldKey === 'expenseReason' || fieldKey === 'remark') return workOrder.description;
    if (fieldKey === 'attachment') return workOrder.attachments;
    const value = workOrder.extraValues[fieldKey];
    return typeof value === 'string' || typeof value === 'number' || Array.isArray(value) ? value as string | number | string[] : null;
  };
  const created = await mockCreateGeneratedRecord({
    projectId: workOrder.projectId,
    projectName: workOrder.projectName,
    templateId: template.id,
    templateName: template.name,
    recordType: workOrder.type === 'transport' ? 'transport' : workOrder.type === 'expense' ? 'reimbursement' : 'other',
    accountingDirection: 'expense',
    templateVersion: template.version,
    version: 1,
    recordDate: workOrder.occurredDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    amount: workOrder.amount,
    category: '成本',
    subCategory: template.name,
    description: workOrder.description,
    sourceType: 'work_order',
    sourceId: workOrder.id,
    status: 'confirmed',
    values: fields.map((item) => ({
      id: '',
      recordId: '',
      fieldId: item.fieldId,
      fieldName: item.field.fieldName,
      value: dynamicValue(item.field.fieldKey),
    })).filter((item) => item.value !== null),
    attachments: [...workOrder.attachments],
    createdBy: user.name,
    confirmedAt: new Date().toISOString(),
    confirmedBy: user.name,
  });
  return created.id;
}

export async function mockBossApprove(
  id: string,
  payload: Pick<WorkOrderReviewPayload, 'action' | 'comment'>,
  idempotencyKey: string,
): Promise<WorkOrder> {
  await delay();
  const user = await actor();
  assertRole(user, 'boss');
  const workOrder = findOrThrow(id);
  if (workOrder.status === 'completed' || (workOrder.status === 'boss_rejected' && approvalKeys.get(idempotencyKey) === id)) {
    return cloneWorkOrder(workOrder);
  }
  if (workOrder.status !== 'boss_pending') throw new Error('非法状态流转');
  if (payload.action === 'reject' && !payload.comment?.trim()) throw new Error('请填写驳回原因');
  const next: WorkOrderStatus = payload.action === 'approve' ? 'completed' : 'boss_rejected';
  workOrder.bossOpinion = payload.comment;
  if (next === 'completed') {
    workOrder.generatedRecordId = await createGeneratedRecord(workOrder, user);
    workOrder.completedAt = new Date().toISOString();
  }
  setStatus(workOrder, next);
  addTimeline(workOrder, user, payload.action, payload.comment ?? '', 'boss_pending', next);
  approvalKeys.set(idempotencyKey, id);
  mockPushNotification({
    title: payload.action === 'approve' ? '工单审批通过' : '工单被老板驳回',
    content: `工单 ${workOrder.orderNo} 已完成老板审批`,
    type: 'system',
    sender: user.name,
    targetRole: 'employee',
    targetUserId: workOrder.creatorId,
    relatedWorkOrderId: workOrder.id,
  });
  return cloneWorkOrder(workOrder);
}

export async function mockUrgeWorkOrder(id: string, reason: string): Promise<WorkOrder> {
  await delay();
  const user = await actor();
  assertRole(user, 'employee');
  const workOrder = findOrThrow(id);
  if (workOrder.creatorId !== user.id) throw new Error('只能操作自己的工单');
  if (['draft', 'returned_for_supplement', 'finance_rejected', 'boss_rejected', 'completed'].includes(workOrder.status)) {
    throw new Error('当前状态不能催办');
  }
  if (workOrder.urgentTime && Date.now() - new Date(workOrder.urgentTime).getTime() < 30 * 60 * 1000) {
    throw new Error('同一工单30分钟内只能催办一次');
  }
  workOrder.urgent = true;
  workOrder.urgentReason = reason;
  workOrder.urgentTime = new Date().toISOString();
  addTimeline(workOrder, user, '催办', reason, workOrder.status, workOrder.status);
  const targetRole = ['reviewer_reviewing', 'reviewer_rejected', 'ai_reviewing', 'ai_passed', 'ai_flagged'].includes(workOrder.status)
    ? 'reviewer'
    : ['boss_pending'].includes(workOrder.status)
      ? 'boss'
      : 'finance';
  mockPushNotification({
    title: '员工催办通知',
    content: `${user.name}催办工单 ${workOrder.orderNo}：${reason}`,
    type: 'urgent',
    sender: user.name,
    targetRole,
    relatedWorkOrderId: workOrder.id,
  });
  return cloneWorkOrder(workOrder);
}

export async function mockGetTimeline(id: string) {
  return (await mockGetWorkOrder(id)).timeline;
}
