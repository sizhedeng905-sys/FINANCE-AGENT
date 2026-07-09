import { mockWorkOrders } from '@/mock/mockWorkOrders';
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
export async function generateRecordFromWorkOrder(workOrderId: string): Promise<{ workOrderId: string; recordId: string }> {
  await delay();
  return {
    workOrderId,
    recordId: `br-from-wo-${workOrderId}`,
  };
}
