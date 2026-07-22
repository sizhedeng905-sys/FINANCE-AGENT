import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  bossApproveWorkOrderApi,
  createIdempotencyKey,
  createWorkOrderApi,
  fetchWorkOrderDetailApi,
  fetchWorkOrderSummaryApi,
  fetchWorkOrdersApi,
  financeReviewWorkOrderApi,
  reviewerReviewWorkOrderApi,
  runAiReviewApi,
  submitWorkOrderApi,
  supplementWorkOrderApi,
  updateWorkOrderApi,
  urgeWorkOrderApi,
} from '@/api/workOrderApi';
import type {
  CreateWorkOrderPayload,
  SupplementWorkOrderPayload,
  UpdateWorkOrderPayload,
  WorkOrder,
  WorkOrderListQuery,
  WorkOrderReviewPayload,
  WorkOrderSummary,
} from '@/types/workOrder';

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : '请求失败');
let listRequest: { key: string; promise: Promise<void> } | null = null;
let summaryRequest: Promise<WorkOrderSummary> | null = null;
const detailRequests = new Map<string, Promise<WorkOrder>>();
let requestGeneration = 0;

export function resetWorkOrderRequestState() {
  requestGeneration += 1;
  listRequest = null;
  summaryRequest = null;
  detailRequests.clear();
}

interface WorkOrderState {
  workOrders: WorkOrder[];
  selectedWorkOrderId?: string;
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  total: number;
  summary?: WorkOrderSummary;
  summaryLoading: boolean;
  summaryError: string | null;
  lastQuery: WorkOrderListQuery;
  setSelectedWorkOrder: (id?: string) => void;
  fetchWorkOrders: (query?: WorkOrderListQuery) => Promise<void>;
  fetchWorkOrder: (id: string) => Promise<WorkOrder>;
  fetchSummary: () => Promise<WorkOrderSummary>;
  createWorkOrder: (payload: CreateWorkOrderPayload, submitImmediately: boolean) => Promise<WorkOrder>;
  updateWorkOrder: (id: string, payload: UpdateWorkOrderPayload) => Promise<WorkOrder>;
  submitWorkOrder: (id: string) => Promise<WorkOrder>;
  supplementWorkOrder: (id: string, payload: SupplementWorkOrderPayload) => Promise<WorkOrder>;
  financeReview: (id: string, payload: Pick<WorkOrderReviewPayload, 'action' | 'comment'>) => Promise<WorkOrder>;
  reviewerReview: (id: string, payload: Pick<WorkOrderReviewPayload, 'action' | 'comment'>) => Promise<WorkOrder>;
  runAiReview: (id: string) => Promise<WorkOrder>;
  bossApprove: (id: string, payload: Pick<WorkOrderReviewPayload, 'action' | 'comment'>) => Promise<WorkOrder>;
  urgeWorkOrder: (id: string, reason: string) => Promise<WorkOrder>;
}

export const useWorkOrderStore = create<WorkOrderState>()(
  persist(
    (set, get) => {
      const upsert = (workOrder: WorkOrder) => {
        set((state) => ({
          workOrders: [workOrder, ...state.workOrders.filter((item) => item.id !== workOrder.id)],
          summary: undefined,
          loading: false,
          error: null,
        }));
        return workOrder;
      };
      const runAction = async (request: () => Promise<WorkOrder>) => {
        const generation = requestGeneration;
        set({ loading: true, error: null });
        try {
          const workOrder = await request();
          if (generation === requestGeneration) upsert(workOrder);
          return workOrder;
        } catch (error) {
          if (generation === requestGeneration) {
            set({ loading: false, error: getErrorMessage(error) });
          }
          throw error;
        }
      };

      return {
        workOrders: [],
        selectedWorkOrderId: undefined,
        loading: false,
        error: null,
        page: 1,
        pageSize: 20,
        total: 0,
        summary: undefined,
        summaryLoading: false,
        summaryError: null,
        lastQuery: { page: 1, pageSize: 100 },
        setSelectedWorkOrder: (id) => set({ selectedWorkOrderId: id }),
        fetchWorkOrders: (query = get().lastQuery) => {
          const generation = requestGeneration;
          const normalized = { page: query.page ?? 1, pageSize: query.pageSize ?? 100, ...query };
          const key = JSON.stringify(normalized);
          if (listRequest?.key === key) return listRequest.promise;
          const promise = (async () => {
            set({ loading: true, error: null, lastQuery: normalized });
            try {
              const result = await fetchWorkOrdersApi(normalized);
              if (generation !== requestGeneration) return;
              set({
                workOrders: result.items,
                page: result.page,
                pageSize: result.pageSize,
                total: result.total,
                loading: false,
              });
            } catch (error) {
              if (generation !== requestGeneration) return;
              set({ loading: false, error: getErrorMessage(error) });
              throw error;
            }
          })();
          listRequest = { key, promise };
          const clear = () => {
            if (listRequest?.promise === promise) listRequest = null;
          };
          void promise.then(clear, clear);
          return promise;
        },
        fetchWorkOrder: (id) => {
          const existing = detailRequests.get(id);
          if (existing) return existing;
          const promise = runAction(() => fetchWorkOrderDetailApi(id));
          detailRequests.set(id, promise);
          const clear = () => {
            if (detailRequests.get(id) === promise) detailRequests.delete(id);
          };
          void promise.then(clear, clear);
          return promise;
        },
        fetchSummary: () => {
          if (summaryRequest) return summaryRequest;
          const generation = requestGeneration;
          set({ summaryLoading: true, summaryError: null });
          const promise = fetchWorkOrderSummaryApi();
          summaryRequest = promise;
          const clear = () => {
            if (summaryRequest === promise) summaryRequest = null;
          };
          void promise.then(
            (summary) => {
              if (generation === requestGeneration) set({ summary, summaryLoading: false });
            },
            (error) => {
              if (generation === requestGeneration) {
                set({ summaryLoading: false, summaryError: getErrorMessage(error) });
              }
            },
          ).finally(clear);
          return promise;
        },
        createWorkOrder: async (payload, submitImmediately) => {
          const generation = requestGeneration;
          set({ loading: true, error: null });
          const idempotencyKey = createIdempotencyKey('work-order-create');
          try {
            const draft = await createWorkOrderApi(payload, idempotencyKey);
            if (generation === requestGeneration) upsert(draft);
            if (!submitImmediately) return draft;
            const submitted = await submitWorkOrderApi(draft.id);
            if (generation === requestGeneration) upsert(submitted);
            return submitted;
          } catch (error) {
            if (generation === requestGeneration) {
              set({ loading: false, error: getErrorMessage(error) });
            }
            throw error;
          }
        },
        updateWorkOrder: (id, payload) => runAction(() => updateWorkOrderApi(
          id,
          payload,
          createIdempotencyKey('work-order-update'),
        )),
        submitWorkOrder: (id) => runAction(() => submitWorkOrderApi(id)),
        supplementWorkOrder: (id, payload) => runAction(() => supplementWorkOrderApi(id, payload)),
        financeReview: (id, payload) => runAction(() => financeReviewWorkOrderApi(id, payload)),
        reviewerReview: (id, payload) => runAction(() => reviewerReviewWorkOrderApi(id, payload)),
        runAiReview: (id) => runAction(() => runAiReviewApi(id)),
        bossApprove: (id, payload) => runAction(() => bossApproveWorkOrderApi(
          id,
          payload,
          createIdempotencyKey('work-order-approve'),
        )),
        urgeWorkOrder: (id, reason) => runAction(() => urgeWorkOrderApi(id, reason)),
      };
    },
    {
      name: 'audit-work-order-store-v4',
      partialize: (state) => ({ selectedWorkOrderId: state.selectedWorkOrderId }),
    },
  ),
);
