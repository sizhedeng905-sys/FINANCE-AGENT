import { httpClient } from '@/api/httpClient';
import {
  mockAiReview,
  mockBossApprove,
  mockCreateWorkOrder,
  mockFinanceReview,
  mockGetTimeline,
  mockGetWorkOrder,
  mockListWorkOrders,
  mockReviewerReview,
  mockSubmitWorkOrder,
  mockSupplementWorkOrder,
  mockUpdateWorkOrder,
  mockUrgeWorkOrder,
} from '@/api/mockWorkOrderRepository';
import { runtimeConfig } from '@/config/runtime';
import type {
  CreateWorkOrderPayload,
  PaginatedWorkOrders,
  SupplementWorkOrderPayload,
  TimelineItem,
  UpdateWorkOrderPayload,
  WorkOrder,
  WorkOrderListQuery,
  WorkOrderReviewPayload,
  WorkOrderStatus,
  WorkOrderSummary,
} from '@/types/workOrder';

function queryString(query: WorkOrderListQuery = {}): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function createIdempotencyKey(prefix: string): string {
  const id = typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${id}`;
}

export function fetchWorkOrdersApi(query: WorkOrderListQuery = {}): Promise<PaginatedWorkOrders> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<PaginatedWorkOrders>(`/work-orders${queryString(query)}`)
    : mockListWorkOrders(query);
}

export async function fetchWorkOrderSummaryApi(): Promise<WorkOrderSummary> {
  if (runtimeConfig.dataMode === 'api') return httpClient.get<WorkOrderSummary>('/work-orders/summary');
  const result = await mockListWorkOrders({ page: 1, pageSize: 100 });
  const statuses: WorkOrderStatus[] = [
    'draft', 'finance_reviewing', 'finance_rejected', 'reviewer_reviewing', 'reviewer_rejected',
    'ai_reviewing', 'ai_passed', 'ai_flagged', 'boss_pending', 'boss_rejected', 'completed',
    'returned_for_supplement',
  ];
  const risks = ['low', 'medium', 'high'] as const;
  const byStatus = Object.fromEntries(statuses.map((status) => [status, 0])) as WorkOrderSummary['byStatus'];
  const byRisk = Object.fromEntries(risks.map((risk) => [risk, 0])) as WorkOrderSummary['byRisk'];
  const byStatusAndRisk = Object.fromEntries(statuses.map((status) => [
    status,
    Object.fromEntries(risks.map((risk) => [risk, 0])),
  ])) as WorkOrderSummary['byStatusAndRisk'];
  for (const item of result.items) {
    byStatus[item.status] += 1;
    byRisk[item.riskLevel] += 1;
    byStatusAndRisk[item.status][item.riskLevel] += 1;
  }
  return { total: result.total, byStatus, byRisk, byStatusAndRisk };
}

export function fetchWorkOrderDetailApi(id: string): Promise<WorkOrder> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<WorkOrder>(`/work-orders/${encodeURIComponent(id)}`)
    : mockGetWorkOrder(id);
}

export function createWorkOrderApi(
  payload: CreateWorkOrderPayload,
  idempotencyKey: string,
): Promise<WorkOrder> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<WorkOrder>('/work-orders', payload, { headers: { 'Idempotency-Key': idempotencyKey } })
    : mockCreateWorkOrder(payload, idempotencyKey);
}

export function updateWorkOrderApi(
  id: string,
  payload: UpdateWorkOrderPayload,
  idempotencyKey: string,
): Promise<WorkOrder> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.patch<WorkOrder>(`/work-orders/${encodeURIComponent(id)}`, payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
    : mockUpdateWorkOrder(id, payload);
}

export function submitWorkOrderApi(id: string): Promise<WorkOrder> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<WorkOrder>(`/work-orders/${encodeURIComponent(id)}/submit`)
    : mockSubmitWorkOrder(id);
}

export function supplementWorkOrderApi(id: string, payload: SupplementWorkOrderPayload): Promise<WorkOrder> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<WorkOrder>(`/work-orders/${encodeURIComponent(id)}/supplement`, payload)
    : mockSupplementWorkOrder(id, payload);
}

export function financeReviewWorkOrderApi(
  id: string,
  payload: Pick<WorkOrderReviewPayload, 'action' | 'comment'>,
): Promise<WorkOrder> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<WorkOrder>(`/work-orders/${encodeURIComponent(id)}/finance-review`, payload)
    : mockFinanceReview(id, payload as WorkOrderReviewPayload);
}

export function reviewerReviewWorkOrderApi(
  id: string,
  payload: Pick<WorkOrderReviewPayload, 'action' | 'comment'>,
): Promise<WorkOrder> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<WorkOrder>(`/work-orders/${encodeURIComponent(id)}/reviewer-review`, payload)
    : mockReviewerReview(id, payload as WorkOrderReviewPayload);
}

export function runAiReviewApi(id: string): Promise<WorkOrder> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<WorkOrder>(`/work-orders/${encodeURIComponent(id)}/ai-review`)
    : mockAiReview(id);
}

export function bossApproveWorkOrderApi(
  id: string,
  payload: Pick<WorkOrderReviewPayload, 'action' | 'comment'>,
  idempotencyKey: string,
): Promise<WorkOrder> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<WorkOrder>(`/work-orders/${encodeURIComponent(id)}/boss-approve`, payload, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
    : mockBossApprove(id, payload, idempotencyKey);
}

export function urgeWorkOrderApi(id: string, reason: string): Promise<WorkOrder> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.post<WorkOrder>(`/work-orders/${encodeURIComponent(id)}/urge`, { reason })
    : mockUrgeWorkOrder(id, reason);
}

export function fetchWorkOrderTimelineApi(id: string): Promise<TimelineItem[]> {
  return runtimeConfig.dataMode === 'api'
    ? httpClient.get<TimelineItem[]>(`/work-orders/${encodeURIComponent(id)}/timeline`)
    : mockGetTimeline(id);
}
