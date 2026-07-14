import { create } from 'zustand';
import {
  approveFieldSuggestion as approveFieldSuggestionRequest,
  autoMatchImportTask,
  cancelImportTask as cancelImportTaskRequest,
  confirmImportTask as confirmImportTaskRequest,
  createImportTask,
  generateImportSuggestions,
  getFieldSuggestions,
  getImportPreview,
  getImportRows,
  getImportTask,
  getImportTasks,
  inspectImportTask,
  mapFieldSuggestion as mapFieldSuggestionRequest,
  parseImportTask,
  rejectFieldSuggestion as rejectFieldSuggestionRequest,
  saveImportMappings,
} from '@/api/importApi';
import type {
  CreateImportTaskPayload,
  FieldSuggestion,
  FieldSuggestionListQuery,
  ImportConfirmResult,
  ImportPreview,
  ImportRowsQuery,
  ImportTask,
  ImportTaskListQuery,
  ImportWorkbookInspection,
  ParseImportTaskPayload,
  SaveImportMappingsPayload,
} from '@/types/dataCenter';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '请求失败';

interface ImportState {
  tasks: ImportTask[];
  currentTask?: ImportTask;
  inspection?: ImportWorkbookInspection;
  inspectionTaskId?: string;
  rows: ImportStateRow[];
  preview?: ImportPreview;
  suggestions: FieldSuggestion[];
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  error: string | null;
  fetchTasks: (query?: ImportTaskListQuery) => Promise<void>;
  fetchTask: (id: string) => Promise<ImportTask>;
  createAndParse: (file: File, payload: CreateImportTaskPayload) => Promise<ImportTask>;
  inspectTask: (id: string) => Promise<ImportWorkbookInspection>;
  parseTask: (id: string, payload?: ParseImportTaskPayload) => Promise<ImportTask>;
  fetchRows: (id: string, query?: ImportRowsQuery) => Promise<void>;
  saveMappings: (id: string, payload: SaveImportMappingsPayload) => Promise<ImportTask>;
  autoMatch: (id: string) => Promise<ImportTask>;
  generateSuggestions: (id: string) => Promise<FieldSuggestion[]>;
  fetchPreview: (id: string) => Promise<ImportPreview>;
  confirmTask: (id: string) => Promise<ImportConfirmResult>;
  cancelTask: (id: string) => Promise<ImportTask>;
  fetchSuggestions: (query?: FieldSuggestionListQuery) => Promise<void>;
  approveSuggestion: (id: string, payload?: { fieldName?: string; fieldType?: FieldSuggestion['suggestedFieldType'] }) => Promise<void>;
  mapSuggestion: (id: string, fieldId: string) => Promise<void>;
  rejectSuggestion: (id: string) => Promise<void>;
  clearError: () => void;
}

type ImportStateRow = Awaited<ReturnType<typeof getImportRows>>['items'][number];

export const useImportStore = create<ImportState>((set, get) => {
  const upsertTask = (task: ImportTask) => {
    set((state) => ({
      currentTask: task,
      tasks: [task, ...state.tasks.filter((item) => item.id !== task.id)],
      loading: false,
      error: null,
    }));
    return task;
  };

  const runTask = async (request: () => Promise<ImportTask>) => {
    set({ loading: true, error: null });
    try {
      return upsertTask(await request());
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
      throw error;
    }
  };

  return {
    tasks: [],
    currentTask: undefined,
    inspection: undefined,
    inspectionTaskId: undefined,
    rows: [],
    preview: undefined,
    suggestions: [],
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    error: null,
    fetchTasks: async (query = {}) => {
      set({ loading: true, error: null });
      try {
        const result = await getImportTasks({ page: 1, pageSize: 20, ...query });
        set({ tasks: result.items, page: result.page, pageSize: result.pageSize, total: result.total, loading: false });
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    fetchTask: (id) => runTask(() => getImportTask(id)),
    createAndParse: async (file, payload) => {
      set({ loading: true, error: null, preview: undefined, inspection: undefined, inspectionTaskId: undefined });
      try {
        const created = await createImportTask(file, payload);
        upsertTask(created);
        const inspection = await inspectImportTask(created.id);
        set({ inspection, inspectionTaskId: created.id });
        if (inspection.requiresSheetSelection || !inspection.recommendedSelection) return created;
        const parsed = upsertTask(await parseImportTask(created.id, inspection.recommendedSelection));
        set({ inspection: undefined, inspectionTaskId: undefined });
        return parsed;
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    inspectTask: async (id) => {
      set({ loading: true, error: null });
      try {
        const inspection = await inspectImportTask(id);
        set({ inspection, inspectionTaskId: id, loading: false });
        return inspection;
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    parseTask: async (id, payload = {}) => {
      const task = await runTask(() => parseImportTask(id, payload));
      set({ inspection: undefined, inspectionTaskId: undefined });
      return task;
    },
    fetchRows: async (id, query = {}) => {
      set({ loading: true, error: null });
      try {
        const result = await getImportRows(id, { page: 1, pageSize: 100, ...query });
        set({ rows: result.items, loading: false });
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    saveMappings: (id, payload) => runTask(() => saveImportMappings(id, payload)),
    autoMatch: (id) => runTask(() => autoMatchImportTask(id)),
    generateSuggestions: async (id) => {
      set({ loading: true, error: null });
      try {
        const result = await generateImportSuggestions(id);
        set((state) => ({
          suggestions: [...result.suggestions, ...state.suggestions.filter((item) => !result.suggestions.some((next) => next.id === item.id))],
          loading: false,
        }));
        await get().fetchTask(id);
        return result.suggestions;
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    fetchPreview: async (id) => {
      set({ loading: true, error: null });
      try {
        const result = await getImportPreview(id);
        set({ preview: result, currentTask: result.task, loading: false });
        return result;
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    confirmTask: async (id) => {
      set({ loading: true, error: null });
      try {
        const result = await confirmImportTaskRequest(id);
        upsertTask(result.task);
        set({ loading: false });
        return result;
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    cancelTask: (id) => runTask(() => cancelImportTaskRequest(id)),
    fetchSuggestions: async (query = {}) => {
      set({ loading: true, error: null });
      try {
        const result = await getFieldSuggestions({ page: 1, pageSize: 100, ...query });
        set({ suggestions: result.items, loading: false });
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    approveSuggestion: async (id, payload = {}) => {
      set({ loading: true, error: null });
      try {
        const result = await approveFieldSuggestionRequest(id, payload);
        set((state) => ({ suggestions: state.suggestions.map((item) => item.id === id ? result.suggestion : item), loading: false }));
        if (result.suggestion.importTaskId) await get().fetchTask(result.suggestion.importTaskId);
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    mapSuggestion: async (id, fieldId) => {
      set({ loading: true, error: null });
      try {
        const result = await mapFieldSuggestionRequest(id, fieldId);
        set((state) => ({ suggestions: state.suggestions.map((item) => item.id === id ? result : item), loading: false }));
        if (result.importTaskId) await get().fetchTask(result.importTaskId);
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    rejectSuggestion: async (id) => {
      set({ loading: true, error: null });
      try {
        const result = await rejectFieldSuggestionRequest(id);
        set((state) => ({ suggestions: state.suggestions.map((item) => item.id === id ? result : item), loading: false }));
        if (result.importTaskId) await get().fetchTask(result.importTaskId);
      } catch (error) {
        set({ loading: false, error: errorMessage(error) });
        throw error;
      }
    },
    clearError: () => set({ error: null }),
  };
});
