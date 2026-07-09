import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWorkOrderApi, updateWorkOrderStatusApi, urgeWorkOrderApi } from '@/api/workOrderApi';
import { mockWorkOrders } from '@/mock/mockWorkOrders';
import type { Role } from '@/types/auth';
import type { TimelineItem, WorkOrder, WorkOrderStatus } from '@/types/workOrder';
import { currentTime } from '@/utils/format';
import { getStepByStatus } from '@/utils/statusMap';

interface StatusUpdate {
  id: string;
  status: WorkOrderStatus;
  operator: string;
  role: Role | 'system' | 'ai';
  action: string;
  comment: string;
  patch?: Partial<WorkOrder>;
}

interface WorkOrderState {
  workOrders: WorkOrder[];
  selectedWorkOrderId?: string;
  setSelectedWorkOrder: (id?: string) => void;
  createWorkOrder: (workOrder: WorkOrder) => Promise<void>;
  updateStatus: (update: StatusUpdate) => void;
  urgeWorkOrder: (payload: {
    id: string;
    operator: string;
    role: Role;
    reason: string;
  }) => void;
}

export const useWorkOrderStore = create<WorkOrderState>()(
  persist(
    (set) => ({
      workOrders: mockWorkOrders,
      selectedWorkOrderId: undefined,
      setSelectedWorkOrder: (id) => set({ selectedWorkOrderId: id }),
      createWorkOrder: async (workOrder) => {
        const created = await createWorkOrderApi(workOrder);
        set((state) => ({ workOrders: [created, ...state.workOrders] }));
      },
      updateStatus: ({ id, status, operator, role, action, comment, patch }) => {
        void updateWorkOrderStatusApi({ id, status, operator, role, action, comment, patch });
        const timelineItem: TimelineItem = {
          time: currentTime(),
          operator,
          role,
          action,
          comment,
        };
        set((state) => ({
          workOrders: state.workOrders.map((item) => {
            if (item.id !== id) {
              return item;
            }

            return {
              ...item,
              ...patch,
              status,
              currentStep: getStepByStatus(status),
              updatedAt: currentTime(),
              timeline: [...item.timeline, timelineItem],
            } as WorkOrder;
          }),
        }));
      },
      urgeWorkOrder: ({ id, operator, role, reason }) => {
        void urgeWorkOrderApi({ id, operator, role, reason });
        const timelineItem: TimelineItem = {
          time: currentTime(),
          operator,
          role,
          action: '员工申请加急',
          comment: `原因：${reason}`,
        };
        set((state) => ({
          workOrders: state.workOrders.map((item) =>
            item.id === id
              ? {
                  ...item,
                  urgent: true,
                  urgentReason: reason,
                  urgentTime: currentTime(),
                  updatedAt: currentTime(),
                  timeline: [...item.timeline, timelineItem],
                }
              : item,
          ),
        }));
      },
    }),
    {
      name: 'audit-work-order-store-v3',
      partialize: (state) => ({
        workOrders: state.workOrders,
        selectedWorkOrderId: state.selectedWorkOrderId,
      }),
    },
  ),
);
