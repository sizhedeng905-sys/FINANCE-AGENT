import { runtimeConfig } from '@/config/runtime';
import {
  mockExcelColumns,
  mockFieldSuggestions,
  mockImportRows,
  mockImportTasks,
  mockMappingRules,
  mockRawFiles,
} from '@/mock/mockDataCenter';
import { clearAppStorage } from '@/utils/cache';
import { useDataCenterStore } from './dataCenterStore';
import { resetImportRequestState, useImportStore } from './importStore';
import { useNotificationStore } from './notificationStore';
import { useOCRStore } from './ocrStore';
import { useReportStore } from './reportStore';
import { useUserStore } from './userStore';
import { resetWorkOrderRequestState, useWorkOrderStore } from './workOrderStore';

export function resetUserScopedState() {
  resetWorkOrderRequestState();
  resetImportRequestState();
  useWorkOrderStore.setState({
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
  });
  useDataCenterStore.setState({
    projects: [],
    projectPage: 1,
    projectPageSize: 20,
    projectTotal: 0,
    projectLoading: false,
    projectError: null,
    lastProjectQuery: { page: 1, pageSize: 20 },
    templates: [],
    templatePage: 1,
    templatePageSize: 20,
    templateTotal: 0,
    templateLoading: false,
    templateError: null,
    lastTemplateQuery: { page: 1, pageSize: 20 },
    fields: [],
    fieldPage: 1,
    fieldPageSize: 20,
    fieldTotal: 0,
    fieldLoading: false,
    fieldError: null,
    lastFieldQuery: { page: 1, pageSize: 20 },
    fieldUsage: {},
    templateFields: [],
    templateFieldLoading: false,
    templateFieldError: null,
    projectTemplates: [],
    projectTemplateLoading: false,
    projectTemplateError: null,
    records: [],
    recordPage: 1,
    recordPageSize: 20,
    recordTotal: 0,
    recordLoading: false,
    recordError: null,
    lastRecordQuery: { page: 1, pageSize: 20 },
    rawFiles: runtimeConfig.dataMode === 'mock' ? mockRawFiles : [],
    importTasks: runtimeConfig.dataMode === 'mock' ? mockImportTasks : [],
    importRows: runtimeConfig.dataMode === 'mock' ? mockImportRows : [],
    mappingRules: runtimeConfig.dataMode === 'mock' ? mockMappingRules : [],
    fieldSuggestions: runtimeConfig.dataMode === 'mock' ? mockFieldSuggestions : [],
    excelColumns: runtimeConfig.dataMode === 'mock' ? mockExcelColumns : [],
  });
  useImportStore.setState({
    tasks: [],
    currentTask: undefined,
    inspection: undefined,
    inspectionTaskId: undefined,
    rows: [],
    preview: undefined,
    suggestions: [],
    aiSuggestionsByTask: {},
    aiSuggestionHistoryByTask: {},
    aiSuggestionLoadingByTask: {},
    aiSuggestionErrorByTask: {},
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    error: null,
  });
  useOCRStore.setState({
    tasks: [],
    currentTask: undefined,
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    error: null,
  });
  useNotificationStore.getState().reset();
  useReportStore.getState().resetReports();
  useUserStore.setState({
    users: [],
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    error: null,
    lastQuery: { page: 1, pageSize: 20 },
  });
  clearAppStorage();
}
