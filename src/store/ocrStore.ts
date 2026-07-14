import { create } from 'zustand';
import {
  cancelOCRTask,
  confirmOCRTask,
  correctOCRTask,
  createOCRTask,
  getOCRTask,
  getOCRTasks,
  retryOCRTask,
  runOCRTask,
} from '@/api/ocrApi';
import type {
  CorrectOCRTaskPayload,
  CreateOCRTaskPayload,
  OCRConfirmResult,
  OCRTask,
  OCRTaskListQuery,
} from '@/types/dataCenter';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'OCR 请求失败';

interface OCRState {
  tasks: OCRTask[];
  currentTask?: OCRTask;
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  error: string | null;
  fetchTasks: (query?: OCRTaskListQuery) => Promise<void>;
  fetchTask: (id: string) => Promise<OCRTask>;
  createAndRun: (payload: CreateOCRTaskPayload) => Promise<OCRTask>;
  runTask: (id: string) => Promise<OCRTask>;
  correctTask: (id: string, payload: CorrectOCRTaskPayload) => Promise<OCRTask>;
  confirmTask: (id: string, acknowledgeLowConfidence: boolean) => Promise<OCRConfirmResult>;
  retryTask: (id: string) => Promise<OCRTask>;
  cancelTask: (id: string) => Promise<OCRTask>;
  clearError: () => void;
}

export const useOCRStore = create<OCRState>((set) => {
  const upsert = (task: OCRTask) => {
    set((state) => ({
      currentTask: task,
      tasks: [task, ...state.tasks.filter((item) => item.id !== task.id)],
      loading: false,
      error: null,
    }));
    return task;
  };

  const run = async (request: () => Promise<OCRTask>) => {
    set({ loading: true, error: null });
    try {
      return upsert(await request());
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
      throw error;
    }
  };

  return {
    tasks: [],
    currentTask: undefined,
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    error: null,
    fetchTasks: async (query = {}) => {
      set({ loading: true, error: null });
      try {
        const result = await getOCRTasks({ page: 1, pageSize: 20, ...query });
        set({ tasks: result.items, page: result.page, pageSize: result.pageSize, total: result.total, loading: false });
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    fetchTask: (id) => run(() => getOCRTask(id)),
    createAndRun: async (payload) => {
      set({ loading: true, error: null });
      try {
        const created = await createOCRTask(payload);
        upsert(created);
        return upsert(await runOCRTask(created.id));
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    runTask: (id) => run(() => runOCRTask(id)),
    correctTask: (id, payload) => run(() => correctOCRTask(id, payload)),
    confirmTask: async (id, acknowledgeLowConfidence) => {
      set({ loading: true, error: null });
      try {
        const result = await confirmOCRTask(id, acknowledgeLowConfidence);
        upsert(result.task);
        return result;
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    retryTask: (id) => run(() => retryOCRTask(id)),
    cancelTask: (id) => run(() => cancelOCRTask(id)),
    clearError: () => set({ error: null }),
  };
});
