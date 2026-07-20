import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { runtimeConfig } from '@/config/runtime';
import {
  createProject as createProjectRequest,
  deleteProject as archiveProjectRequest,
  disableProjectTemplate as disableProjectTemplateRequest,
  enableProjectTemplate as enableProjectTemplateRequest,
  getProject as getProjectRequest,
  getProjectTemplates as getProjectTemplatesRequest,
  getProjects,
  updateProject as updateProjectRequest,
  updateProjectTemplate as updateProjectTemplateRequest,
} from '@/api/projectApi';
import {
  createField as createFieldRequest,
  disableField as disableFieldRequest,
  getField as getFieldRequest,
  getFields,
  getFieldUsage as getFieldUsageRequest,
  updateField as updateFieldRequest,
} from '@/api/fieldApi';
import {
  addTemplateField as addTemplateFieldRequest,
  cloneTemplate as cloneTemplateRequest,
  createTemplate as createTemplateRequest,
  deleteTemplate as deleteTemplateRequest,
  getTemplate as getTemplateRequest,
  getTemplateFields as getTemplateFieldsRequest,
  getTemplates,
  updateTemplate as updateTemplateRequest,
  updateTemplateField as updateTemplateFieldRequest,
  removeTemplateField as removeTemplateFieldRequest,
} from '@/api/templateApi';
import {
  confirmRecord as confirmRecordRequest,
  createRecord as createRecordRequest,
  deleteRecord as deleteRecordRequest,
  getProjectRecords as getProjectRecordsRequest,
  getRecord as getRecordRequest,
  getRecords,
  updateRecord as updateRecordRequest,
} from '@/api/recordApi';
import {
  mockExcelColumns,
  mockFieldSuggestions,
  mockImportRows,
  mockImportTasks,
  mockMappingRules,
  mockRawFiles,
} from '@/mock/mockDataCenter';
import type {
  BusinessRecord,
  CreateRecordPayload,
  CreateFieldPayload,
  CreateProjectTemplatePayload,
  CreateTemplateFieldPayload,
  CreateTemplatePayload,
  DataRecordType,
  DataTemplate,
  FieldDefinition,
  FieldListQuery,
  FieldUsage,
  FieldSuggestion,
  ImportRow,
  ImportTask,
  MappingRule,
  Project,
  CreateProjectPayload,
  ProjectListQuery,
  ProjectTemplate,
  RecordListQuery,
  RawFile,
  RecordValue,
  TemplateField,
  TemplateListQuery,
  UpdateProjectPayload,
  UpdateProjectTemplatePayload,
  UpdateRecordPayload,
  UpdateFieldPayload,
  UpdateTemplatePayload,
  UpdateTemplateFieldPayload,
} from '@/types/dataCenter';

if (runtimeConfig.dataMode === 'api' && typeof window !== 'undefined') {
  for (const key of ['audit-data-center-store-v7', 'audit-data-center-store-mock-v8']) {
    window.localStorage.removeItem(key);
  }
}

type ExcelColumn = (typeof mockExcelColumns)[number];

const now = () => new Date().toLocaleString('zh-CN', { hour12: false });

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : '请求失败');

function projectMatchesQuery(project: Project, query: ProjectListQuery): boolean {
  if (query.status && project.status !== query.status) return false;
  const keyword = query.keyword?.trim().toLowerCase();
  if (!keyword) return true;
  return [project.name, project.customerName, project.ownerName].some((value) =>
    value.toLowerCase().includes(keyword),
  );
}

function templateMatchesQuery(template: DataTemplate, query: TemplateListQuery): boolean {
  if (query.recordType && template.recordType !== query.recordType) return false;
  const keyword = query.keyword?.trim().toLowerCase();
  if (!keyword) return true;
  return [template.name, template.description].some((value) => value.toLowerCase().includes(keyword));
}

function fieldMatchesQuery(field: FieldDefinition, query: FieldListQuery): boolean {
  if (query.fieldType && field.fieldType !== query.fieldType) return false;
  if (query.semanticType && field.semanticType !== query.semanticType) return false;
  if (query.isActive !== undefined && field.isActive !== query.isActive) return false;
  const keyword = query.keyword?.trim().toLowerCase();
  if (!keyword) return true;
  return [field.fieldKey, field.fieldName, field.description].some((value) => value.toLowerCase().includes(keyword));
}

function recordMatchesQuery(record: BusinessRecord, query: RecordListQuery): boolean {
  if (query.projectId && record.projectId !== query.projectId) return false;
  if (query.templateId && record.templateId !== query.templateId) return false;
  if (query.recordType && record.recordType !== query.recordType) return false;
  if (query.sourceType && record.sourceType !== query.sourceType) return false;
  if (query.status && record.status !== query.status) return false;
  const recordDate = record.recordDate.slice(0, 10);
  if (query.dateFrom && recordDate < query.dateFrom.slice(0, 10)) return false;
  if (query.dateTo && recordDate > query.dateTo.slice(0, 10)) return false;
  return true;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createFieldKey(name: string) {
  const ascii = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fa5]/g, '');
  return ascii ? `field_${ascii}` : `field_${Date.now()}`;
}

function normalizeValue(value: unknown): string | number | string[] | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function inferFieldType(sourceName: string): FieldDefinition['fieldType'] {
  if (sourceName.includes('费') || sourceName.includes('补贴') || sourceName.includes('金额') || sourceName.includes('款')) {
    return 'money';
  }
  if (sourceName.includes('日期') || sourceName.includes('时间')) {
    return 'date';
  }
  if (sourceName.includes('数') || sourceName.includes('工时')) {
    return 'number';
  }
  return 'text';
}

interface DataCenterState {
  projects: Project[];
  projectPage: number;
  projectPageSize: number;
  projectTotal: number;
  projectLoading: boolean;
  projectError: string | null;
  lastProjectQuery: ProjectListQuery;
  templates: DataTemplate[];
  templatePage: number;
  templatePageSize: number;
  templateTotal: number;
  templateLoading: boolean;
  templateError: string | null;
  lastTemplateQuery: TemplateListQuery;
  fields: FieldDefinition[];
  fieldPage: number;
  fieldPageSize: number;
  fieldTotal: number;
  fieldLoading: boolean;
  fieldError: string | null;
  lastFieldQuery: FieldListQuery;
  fieldUsage: Record<string, FieldUsage>;
  templateFields: TemplateField[];
  templateFieldLoading: boolean;
  templateFieldError: string | null;
  projectTemplates: ProjectTemplate[];
  projectTemplateLoading: boolean;
  projectTemplateError: string | null;
  records: BusinessRecord[];
  recordPage: number;
  recordPageSize: number;
  recordTotal: number;
  recordLoading: boolean;
  recordError: string | null;
  lastRecordQuery: RecordListQuery;
  rawFiles: RawFile[];
  importTasks: ImportTask[];
  importRows: ImportRow[];
  mappingRules: MappingRule[];
  fieldSuggestions: FieldSuggestion[];
  excelColumns: ExcelColumn[];
  fetchProjects: (query?: ProjectListQuery) => Promise<void>;
  fetchProject: (id: string) => Promise<Project>;
  createProject: (payload: CreateProjectPayload) => Promise<Project>;
  updateProject: (id: string, payload: UpdateProjectPayload) => Promise<Project>;
  archiveProject: (id: string) => Promise<void>;
  fetchTemplates: (query?: TemplateListQuery) => Promise<void>;
  fetchTemplate: (id: string) => Promise<DataTemplate>;
  createTemplate: (payload: CreateTemplatePayload) => Promise<DataTemplate>;
  cloneTemplate: (id: string) => Promise<DataTemplate>;
  deleteTemplate: (id: string) => Promise<void>;
  updateTemplate: (id: string, payload: UpdateTemplatePayload) => Promise<DataTemplate>;
  fetchProjectTemplates: (projectId: string) => Promise<void>;
  enableTemplateForProject: (projectId: string, templateId: string, customName?: string) => Promise<ProjectTemplate>;
  disableTemplateForProject: (projectTemplateId: string) => Promise<void>;
  updateProjectTemplate: (projectTemplateId: string, payload: UpdateProjectTemplatePayload) => Promise<ProjectTemplate>;
  getProjectTemplates: (projectId: string) => ProjectTemplate[];
  fetchFields: (query?: FieldListQuery) => Promise<void>;
  fetchField: (id: string) => Promise<FieldDefinition>;
  fetchFieldUsage: (id: string) => Promise<FieldUsage>;
  fetchTemplateFields: (templateId: string) => Promise<void>;
  addExistingFieldToTemplate: (templateId: string, fieldId: string) => Promise<TemplateField>;
  createField: (payload: CreateFieldPayload) => Promise<FieldDefinition>;
  updateField: (id: string, payload: UpdateFieldPayload) => Promise<FieldDefinition>;
  deactivateField: (id: string) => Promise<void>;
  updateTemplateField: (id: string, payload: UpdateTemplateFieldPayload) => Promise<TemplateField>;
  removeTemplateField: (id: string) => Promise<void>;
  moveTemplateField: (id: string, direction: 'up' | 'down') => Promise<void>;
  createRecord: (payload: CreateRecordPayload) => Promise<BusinessRecord>;
  fetchRecords: (query?: RecordListQuery) => Promise<void>;
  fetchRecord: (id: string) => Promise<BusinessRecord>;
  fetchProjectRecords: (projectId: string, query?: RecordListQuery) => Promise<void>;
  updateRecord: (id: string, payload: UpdateRecordPayload) => Promise<BusinessRecord>;
  confirmRecord: (id: string) => Promise<BusinessRecord>;
  deleteRecord: (id: string) => Promise<void>;
  getRecordsByProject: (projectId: string) => BusinessRecord[];
  getImportTasksByProject: (projectId: string) => ImportTask[];
  getRawFilesByProject: (projectId: string) => RawFile[];
  getFieldUsageStats: (projectId: string) => Array<{
    fieldId: string;
    fieldName: string;
    fieldType: FieldDefinition['fieldType'];
    templateNames: string[];
    usageCount: number;
    sourceTypes: BusinessRecord['sourceType'][];
    latestUsedAt?: string;
    isSuggestedField: boolean;
  }>;
  createImportTask: (payload: {
    projectId: string;
    templateId: string;
    importType: ImportTask['importType'];
    fileName: string;
    uploadedBy: string;
  }) => ImportTask;
  updateImportTask: (id: string, payload: Partial<ImportTask>) => void;
  updateExcelColumns: (columns: ExcelColumn[]) => void;
  autoMatchColumns: (importTaskId: string) => MappingRule[];
  saveMappingRules: (taskId: string, rules: MappingRule[]) => void;
  generateFieldSuggestionsFromTask: (taskId: string) => void;
  createMappingRuleFromSuggestion: (suggestionId: string, targetFieldId: string) => MappingRule | undefined;
  confirmImportTask: (id: string) => BusinessRecord[];
  cancelImportTask: (id: string) => void;
  approveSuggestion: (id: string, approvedBy: string) => Promise<void>;
  mapSuggestion: (id: string, fieldId: string) => void;
  rejectSuggestion: (id: string) => void;
  getTemplateFields: (templateId: string) => TemplateField[];
}

export const useDataCenterStore = create<DataCenterState>()(
  persist(
    (set, get) => ({
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

      fetchProjects: async (query = get().lastProjectQuery) => {
        const normalizedQuery: ProjectListQuery = {
          page: query.page ?? 1,
          pageSize: query.pageSize ?? get().projectPageSize,
          keyword: query.keyword,
          status: query.status,
        };
        set({ projectLoading: true, projectError: null, lastProjectQuery: normalizedQuery });
        try {
          const result = await getProjects(normalizedQuery);
          set({
            projects: result.items,
            projectPage: result.page,
            projectPageSize: result.pageSize,
            projectTotal: result.total,
            projectLoading: false,
          });
        } catch (error) {
          set({ projectLoading: false, projectError: getErrorMessage(error) });
          throw error;
        }
      },
      fetchProject: async (id) => {
        set({ projectLoading: true, projectError: null });
        try {
          const project = await getProjectRequest(id);
          set((state) => ({
            projects: [project, ...state.projects.filter((item) => item.id !== project.id)],
            projectLoading: false,
          }));
          return project;
        } catch (error) {
          set({ projectLoading: false, projectError: getErrorMessage(error) });
          throw error;
        }
      },
      createProject: async (payload) => {
        set({ projectError: null });
        try {
          const project = await createProjectRequest(payload);
          set((state) => {
            const matches = projectMatchesQuery(project, state.lastProjectQuery);
            return {
              projects: matches ? [project, ...state.projects] : state.projects,
              projectTotal: matches ? state.projectTotal + 1 : state.projectTotal,
            };
          });
          return project;
        } catch (error) {
          set({ projectError: getErrorMessage(error) });
          throw error;
        }
      },
      updateProject: async (id, payload) => {
        set({ projectError: null });
        try {
          const project = await updateProjectRequest(id, payload);
          set((state) => {
            const existed = state.projects.some((item) => item.id === id);
            const matches = projectMatchesQuery(project, state.lastProjectQuery);
            return {
              projects: matches
                ? state.projects.map((item) => (item.id === id ? project : item))
                : state.projects.filter((item) => item.id !== id),
              projectTotal: existed && !matches ? Math.max(0, state.projectTotal - 1) : state.projectTotal,
            };
          });
          return project;
        } catch (error) {
          set({ projectError: getErrorMessage(error) });
          throw error;
        }
      },
      archiveProject: async (id) => {
        set({ projectError: null });
        try {
          const result = await archiveProjectRequest(id);
          set((state) => {
            const current = state.projects.find((item) => item.id === id);
            if (!current) return state;
            const project = { ...current, status: result.status, updatedAt: new Date().toISOString() };
            const matches = projectMatchesQuery(project, state.lastProjectQuery);
            return {
              projects: matches
                ? state.projects.map((item) => (item.id === id ? project : item))
                : state.projects.filter((item) => item.id !== id),
              projectTotal: matches ? state.projectTotal : Math.max(0, state.projectTotal - 1),
            };
          });
        } catch (error) {
          set({ projectError: getErrorMessage(error) });
          throw error;
        }
      },
      fetchTemplates: async (query = get().lastTemplateQuery) => {
        const normalizedQuery: TemplateListQuery = {
          page: query.page ?? 1,
          pageSize: query.pageSize ?? get().templatePageSize,
          keyword: query.keyword,
          recordType: query.recordType,
        };
        set({ templateLoading: true, templateError: null, lastTemplateQuery: normalizedQuery });
        try {
          const result = await getTemplates(normalizedQuery);
          set({
            templates: result.items,
            templatePage: result.page,
            templatePageSize: result.pageSize,
            templateTotal: result.total,
            templateLoading: false,
          });
        } catch (error) {
          set({ templateLoading: false, templateError: getErrorMessage(error) });
          throw error;
        }
      },
      fetchTemplate: async (id) => {
        set({ templateLoading: true, templateError: null });
        try {
          const template = await getTemplateRequest(id);
          set((state) => ({
            templates: [template, ...state.templates.filter((item) => item.id !== id)],
            templateLoading: false,
          }));
          return template;
        } catch (error) {
          set({ templateLoading: false, templateError: getErrorMessage(error) });
          throw error;
        }
      },
      createTemplate: async (payload) => {
        set({ templateError: null });
        try {
          const template = await createTemplateRequest(payload);
          set((state) => {
            const matches = templateMatchesQuery(template, state.lastTemplateQuery);
            return {
              templates: matches ? [template, ...state.templates] : state.templates,
              templateTotal: matches ? state.templateTotal + 1 : state.templateTotal,
            };
          });
          return template;
        } catch (error) {
          set({ templateError: getErrorMessage(error) });
          throw error;
        }
      },
      cloneTemplate: async (id) => {
        set({ templateError: null });
        try {
          const template = await cloneTemplateRequest(id);
          set((state) => {
            const matches = templateMatchesQuery(template, state.lastTemplateQuery);
            return {
              templates: matches ? [template, ...state.templates] : state.templates,
              templateTotal: matches ? state.templateTotal + 1 : state.templateTotal,
            };
          });
          return template;
        } catch (error) {
          set({ templateError: getErrorMessage(error) });
          throw error;
        }
      },
      deleteTemplate: async (id) => {
        set({ templateError: null });
        try {
          await deleteTemplateRequest(id);
          set((state) => ({
            templates: state.templates.filter((item) => item.id !== id),
            templateTotal: Math.max(0, state.templateTotal - 1),
          }));
        } catch (error) {
          set({ templateError: getErrorMessage(error) });
          throw error;
        }
      },
      updateTemplate: async (id, payload) => {
        set({ templateError: null });
        try {
          const template = await updateTemplateRequest(id, payload);
          set((state) => {
            const existed = state.templates.some((item) => item.id === id);
            const matches = templateMatchesQuery(template, state.lastTemplateQuery);
            return {
              templates: matches
                ? state.templates.map((item) => (item.id === id ? template : item))
                : state.templates.filter((item) => item.id !== id),
              templateTotal: existed && !matches ? Math.max(0, state.templateTotal - 1) : state.templateTotal,
            };
          });
          return template;
        } catch (error) {
          set({ templateError: getErrorMessage(error) });
          throw error;
        }
      },
      fetchProjectTemplates: async (projectId) => {
        set({ projectTemplateLoading: true, projectTemplateError: null });
        try {
          const items = await getProjectTemplatesRequest(projectId);
          set((state) => ({
            projectTemplates: [
              ...state.projectTemplates.filter((item) => item.projectId !== projectId),
              ...items,
            ],
            templates: [
              ...state.templates,
              ...items
                .map((item) => item.template)
                .filter((template): template is DataTemplate => Boolean(template))
                .filter((template) => !state.templates.some((candidate) => candidate.id === template.id)),
            ],
            projectTemplateLoading: false,
          }));
        } catch (error) {
          set({ projectTemplateLoading: false, projectTemplateError: getErrorMessage(error) });
          throw error;
        }
      },
      enableTemplateForProject: async (projectId, templateId, customName) => {
        set({ projectTemplateLoading: true, projectTemplateError: null });
        try {
          const payload: CreateProjectTemplatePayload = { templateId, customName };
          const item = await enableProjectTemplateRequest(projectId, payload);
          set((state) => ({
            projectTemplates: [
              item,
              ...state.projectTemplates.filter(
                (candidate) => candidate.id !== item.id &&
                  !(candidate.projectId === projectId && candidate.templateId === templateId),
              ),
            ],
            projectTemplateLoading: false,
          }));
          return item;
        } catch (error) {
          set({ projectTemplateLoading: false, projectTemplateError: getErrorMessage(error) });
          throw error;
        }
      },
      disableTemplateForProject: async (projectTemplateId) => {
        set({ projectTemplateLoading: true, projectTemplateError: null });
        try {
          const item = await disableProjectTemplateRequest(projectTemplateId);
          set((state) => ({
            projectTemplates: state.projectTemplates.map((candidate) => candidate.id === item.id ? item : candidate),
            projectTemplateLoading: false,
          }));
        } catch (error) {
          set({ projectTemplateLoading: false, projectTemplateError: getErrorMessage(error) });
          throw error;
        }
      },
      updateProjectTemplate: async (projectTemplateId, payload) => {
        set({ projectTemplateLoading: true, projectTemplateError: null });
        try {
          const item = await updateProjectTemplateRequest(projectTemplateId, payload);
          set((state) => ({
            projectTemplates: state.projectTemplates.map((candidate) => candidate.id === item.id ? item : candidate),
            projectTemplateLoading: false,
          }));
          return item;
        } catch (error) {
          set({ projectTemplateLoading: false, projectTemplateError: getErrorMessage(error) });
          throw error;
        }
      },
      getProjectTemplates: (projectId) => get().projectTemplates.filter((item) => item.projectId === projectId),
      fetchFields: async (query = get().lastFieldQuery) => {
        const normalizedQuery: FieldListQuery = {
          page: query.page ?? 1,
          pageSize: query.pageSize ?? get().fieldPageSize,
          keyword: query.keyword,
          fieldType: query.fieldType,
          semanticType: query.semanticType,
          isActive: query.isActive,
        };
        set({ fieldLoading: true, fieldError: null, lastFieldQuery: normalizedQuery });
        try {
          const result = await getFields(normalizedQuery);
          set({
            fields: result.items,
            fieldPage: result.page,
            fieldPageSize: result.pageSize,
            fieldTotal: result.total,
            fieldLoading: false,
          });
        } catch (error) {
          set({ fieldLoading: false, fieldError: getErrorMessage(error) });
          throw error;
        }
      },
      fetchField: async (id) => {
        set({ fieldLoading: true, fieldError: null });
        try {
          const field = await getFieldRequest(id);
          set((state) => ({
            fields: [field, ...state.fields.filter((item) => item.id !== id)],
            fieldLoading: false,
          }));
          return field;
        } catch (error) {
          set({ fieldLoading: false, fieldError: getErrorMessage(error) });
          throw error;
        }
      },
      fetchFieldUsage: async (id) => {
        set({ fieldError: null });
        try {
          const usage = await getFieldUsageRequest(id);
          set((state) => ({ fieldUsage: { ...state.fieldUsage, [id]: usage } }));
          return usage;
        } catch (error) {
          set({ fieldError: getErrorMessage(error) });
          throw error;
        }
      },
      fetchTemplateFields: async (templateId) => {
        set({ templateFieldLoading: true, templateFieldError: null });
        try {
          const items = await getTemplateFieldsRequest(templateId);
          set((state) => ({
            templateFields: [
              ...state.templateFields.filter((item) => item.templateId !== templateId),
              ...items,
            ],
            templateFieldLoading: false,
          }));
        } catch (error) {
          set({ templateFieldLoading: false, templateFieldError: getErrorMessage(error) });
          throw error;
        }
      },
      addExistingFieldToTemplate: async (templateId, fieldId) => {
        set({ templateFieldError: null });
        try {
          const item = await addTemplateFieldRequest(templateId, { fieldId } as CreateTemplateFieldPayload);
          set((state) => ({ templateFields: [...state.templateFields, item] }));
          return item;
        } catch (error) {
          set({ templateFieldError: getErrorMessage(error) });
          throw error;
        }
      },
      createField: async (payload) => {
        set({ fieldError: null });
        try {
          const field = await createFieldRequest(payload);
          set((state) => {
            const matches = fieldMatchesQuery(field, state.lastFieldQuery);
            return {
              fields: matches ? [field, ...state.fields] : state.fields,
              fieldTotal: matches ? state.fieldTotal + 1 : state.fieldTotal,
            };
          });
          return field;
        } catch (error) {
          set({ fieldError: getErrorMessage(error) });
          throw error;
        }
      },
      updateField: async (id, payload) => {
        set({ fieldError: null });
        try {
          const field = await updateFieldRequest(id, payload);
          set((state) => {
            const existed = state.fields.some((item) => item.id === id);
            const matches = fieldMatchesQuery(field, state.lastFieldQuery);
            return {
              fields: matches
                ? state.fields.map((item) => (item.id === id ? field : item))
                : state.fields.filter((item) => item.id !== id),
              fieldTotal: existed && !matches ? Math.max(0, state.fieldTotal - 1) : state.fieldTotal,
              templateFields: state.templateFields.map((item) =>
                item.fieldId === id ? { ...item, field } : item,
              ),
            };
          });
          return field;
        } catch (error) {
          set({ fieldError: getErrorMessage(error) });
          throw error;
        }
      },
      deactivateField: async (id) => {
        set({ fieldError: null });
        try {
          const field = await disableFieldRequest(id);
          set((state) => {
            const matches = fieldMatchesQuery(field, state.lastFieldQuery);
            return {
              fields: matches
                ? state.fields.map((item) => (item.id === id ? field : item))
                : state.fields.filter((item) => item.id !== id),
              fieldTotal: matches ? state.fieldTotal : Math.max(0, state.fieldTotal - 1),
              templateFields: state.templateFields.map((item) =>
                item.fieldId === id ? { ...item, field } : item,
              ),
            };
          });
        } catch (error) {
          set({ fieldError: getErrorMessage(error) });
          throw error;
        }
      },
      updateTemplateField: async (id, payload) => {
        set({ templateFieldError: null });
        try {
          const item = await updateTemplateFieldRequest(id, payload);
          set((state) => ({
            templateFields: state.templateFields.map((candidate) => candidate.id === id ? item : candidate),
          }));
          return item;
        } catch (error) {
          set({ templateFieldError: getErrorMessage(error) });
          throw error;
        }
      },
      removeTemplateField: async (id) => {
        set({ templateFieldError: null });
        try {
          const target = get().templateFields.find((item) => item.id === id);
          await removeTemplateFieldRequest(id);
          set((state) => ({ templateFields: state.templateFields.filter((item) => item.id !== id) }));
          if (target) await get().fetchTemplateFields(target.templateId);
        } catch (error) {
          set({ templateFieldError: getErrorMessage(error) });
          throw error;
        }
      },
      moveTemplateField: async (id, direction) => {
        const target = get().templateFields.find((item) => item.id === id);
        if (!target) return;
        const siblings = get()
          .templateFields.filter((item) => item.templateId === target.templateId)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        const index = siblings.findIndex((item) => item.id === id);
        const swap = direction === 'up' ? siblings[index - 1] : siblings[index + 1];
        if (!swap) return;
        set({ templateFieldError: null });
        try {
          await updateTemplateFieldRequest(id, { displayOrder: swap.displayOrder });
          await get().fetchTemplateFields(target.templateId);
        } catch (error) {
          set({ templateFieldError: getErrorMessage(error) });
          throw error;
        }
      },
      createRecord: async (payload) => {
        set({ recordLoading: true, recordError: null });
        try {
          const response = await createRecordRequest(payload);
          const record: BusinessRecord = {
            ...response,
            projectName: response.projectName === response.projectId
              ? get().projects.find((item) => item.id === response.projectId)?.name ?? response.projectName
              : response.projectName,
            templateName: response.templateName === response.templateId
              ? get().templates.find((item) => item.id === response.templateId)?.name ?? response.templateName
              : response.templateName,
            values: response.values.map((value) => ({
              ...value,
              fieldName: value.fieldName === value.fieldId
                ? get().fields.find((item) => item.id === value.fieldId)?.fieldName ?? value.fieldName
                : value.fieldName,
            })),
          };
          set((state) => {
            const isVisible = recordMatchesQuery(record, state.lastRecordQuery);
            return {
              records: isVisible
                ? [record, ...state.records.filter((item) => item.id !== record.id)]
                : state.records,
              recordTotal: state.recordTotal + (isVisible ? 1 : 0),
              recordLoading: false,
            };
          });
          return record;
        } catch (error) {
          set({ recordLoading: false, recordError: getErrorMessage(error) });
          throw error;
        }
      },
      fetchRecords: async (query = get().lastRecordQuery) => {
        const normalizedQuery: RecordListQuery = {
          page: query.page ?? 1,
          pageSize: query.pageSize ?? get().recordPageSize,
          projectId: query.projectId,
          templateId: query.templateId,
          recordType: query.recordType,
          sourceType: query.sourceType,
          status: query.status,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
        };
        set({ recordLoading: true, recordError: null, lastRecordQuery: normalizedQuery });
        try {
          const result = await getRecords(normalizedQuery);
          set({
            records: result.items,
            recordPage: result.page,
            recordPageSize: result.pageSize,
            recordTotal: result.total,
            recordLoading: false,
          });
        } catch (error) {
          set({ recordLoading: false, recordError: getErrorMessage(error) });
          throw error;
        }
      },
      fetchRecord: async (id) => {
        set({ recordLoading: true, recordError: null });
        try {
          const record = await getRecordRequest(id);
          set((state) => ({
            records: [record, ...state.records.filter((item) => item.id !== id)],
            recordLoading: false,
          }));
          return record;
        } catch (error) {
          set({ recordLoading: false, recordError: getErrorMessage(error) });
          throw error;
        }
      },
      fetchProjectRecords: async (projectId, query = {}) => {
        set({ recordLoading: true, recordError: null });
        try {
          const result = await getProjectRecordsRequest(projectId, {
            ...query,
            page: query.page ?? 1,
            pageSize: query.pageSize ?? 100,
          });
          set((state) => ({
            records: [
              ...state.records.filter((item) => item.projectId !== projectId),
              ...result.items,
            ],
            recordLoading: false,
          }));
        } catch (error) {
          set({ recordLoading: false, recordError: getErrorMessage(error) });
          throw error;
        }
      },
      updateRecord: async (id, payload) => {
        set({ recordLoading: true, recordError: null });
        try {
          const record = await updateRecordRequest(id, payload);
          set((state) => ({
            records: state.records.map((item) => item.id === id ? record : item),
            recordLoading: false,
          }));
          return record;
        } catch (error) {
          set({ recordLoading: false, recordError: getErrorMessage(error) });
          throw error;
        }
      },
      confirmRecord: async (id) => {
        set({ recordLoading: true, recordError: null });
        try {
          const record = await confirmRecordRequest(id);
          set((state) => ({
            records: state.records.map((item) => item.id === id ? record : item),
            recordLoading: false,
          }));
          return record;
        } catch (error) {
          set({ recordLoading: false, recordError: getErrorMessage(error) });
          throw error;
        }
      },
      deleteRecord: async (id) => {
        set({ recordLoading: true, recordError: null });
        try {
          const result = await deleteRecordRequest(id);
          set((state) => ({
            records: state.records.map((item) => item.id === id ? { ...item, status: result.status } : item),
            recordLoading: false,
          }));
        } catch (error) {
          set({ recordLoading: false, recordError: getErrorMessage(error) });
          throw error;
        }
      },
      getRecordsByProject: (projectId) => get().records.filter((item) => item.projectId === projectId),
      getImportTasksByProject: (projectId) => get().importTasks.filter((item) => item.projectId === projectId),
      getRawFilesByProject: (projectId) => get().rawFiles.filter((item) => item.relatedProjectId === projectId),
      getFieldUsageStats: (projectId) => {
        const projectTemplateIds = get()
          .projectTemplates.filter((item) => item.projectId === projectId && item.isActive)
          .map((item) => item.templateId);
        const templateNames = new Map(get().templates.map((item) => [item.id, item.name]));
        const relevantTemplateFields = get().templateFields.filter((item) => projectTemplateIds.includes(item.templateId));
        const records = get().records.filter((item) => item.projectId === projectId);
        return relevantTemplateFields.map((templateField) => {
          const usedRecords = records.filter((record) =>
            record.values.some((value) => value.fieldId === templateField.fieldId && value.value !== null && value.value !== ''),
          );
          const suggested = get().fieldSuggestions.some(
            (suggestion) =>
              suggestion.templateId === templateField.templateId &&
              (suggestion.mappedFieldId === templateField.fieldId ||
                suggestion.suggestedFieldName === templateField.field.fieldName) &&
              suggestion.status !== 'rejected',
          );
          return {
            fieldId: templateField.fieldId,
            fieldName: templateField.field.fieldName,
            fieldType: templateField.field.fieldType,
            templateNames: [templateNames.get(templateField.templateId) ?? templateField.templateId],
            usageCount: usedRecords.length,
            sourceTypes: Array.from(new Set(usedRecords.map((record) => record.sourceType))),
            latestUsedAt: usedRecords.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.updatedAt,
            isSuggestedField: suggested,
          };
        });
      },
      createImportTask: ({ projectId, templateId, importType, fileName, uploadedBy }) => {
        const project = get().projects.find((item) => item.id === projectId);
        const template = get().templates.find((item) => item.id === templateId);
        const taskId = makeId('it');
        const rawFile: RawFile = {
          id: makeId('rf'),
          fileName,
          fileType: 'excel',
          storagePath: `/mock/${fileName}`,
          uploadedBy,
          uploadedAt: now(),
          relatedProjectId: projectId,
          relatedImportTaskId: taskId,
          status: 'uploaded',
        };
        const task: ImportTask = {
          id: taskId,
          projectId,
          projectName: project?.name ?? '-',
          rawFileId: rawFile.id,
          fileName,
          templateId,
          templateName: template?.name ?? '-',
          importType,
          status: 'mapping',
          version: 1,
          reviewRevision: 0,
          validation: null,
          approval: null,
          uploadedBy,
          createdAt: now(),
          counts: { total: 0, valid: 0, errors: 0, duplicates: 0, ignored: 0, imported: 0 },
          rawFile: {
            id: rawFile.id,
            fileName,
            fileSize: 0,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            sha256: '',
          },
          sheets: [],
          columns: [],
        };
        set((state) => ({
          rawFiles: [rawFile, ...state.rawFiles],
          importTasks: [task, ...state.importTasks],
        }));
        get().autoMatchColumns(task.id);
        return task;
      },
      updateImportTask: (id, payload) =>
        set((state) => ({
          importTasks: state.importTasks.map((item) => (item.id === id ? { ...item, ...payload } : item)),
        })),
      updateExcelColumns: (columns) => set({ excelColumns: columns }),
      autoMatchColumns: (importTaskId) => {
        const task = get().importTasks.find((item) => item.id === importTaskId);
        if (!task) return [];
        const templateFieldIds = get()
          .templateFields.filter((item) => item.templateId === task.templateId)
          .map((item) => item.fieldId);
        const candidateFields = get().fields.filter((item) => item.isActive && templateFieldIds.includes(item.id));
        const rules: MappingRule[] = get()
          .excelColumns.map((column) => {
            const exact = candidateFields.find((field) => field.fieldName === column.name);
            const alias = candidateFields.find((field) => field.aliases.includes(column.name));
            const key = candidateFields.find((field) => field.fieldKey === column.name);
            const field = exact || alias || key;
            if (!field) return null;
            return {
              id: makeId('mr'),
              importTaskId,
              templateId: task.templateId,
              sourceColumnName: column.name,
              targetFieldId: field.id,
              targetFieldName: field.fieldName,
              mappingType: 'auto',
              confidence: exact ? 0.99 : alias ? 0.92 : 0.86,
              createdBy: '系统',
              createdAt: now(),
            } satisfies MappingRule;
          })
          .filter(Boolean) as MappingRule[];
        get().saveMappingRules(importTaskId, rules);
        return rules;
      },
      saveMappingRules: (taskId, rules) => {
        const task = get().importTasks.find((item) => item.id === taskId);
        const normalized = rules.map((item) => ({
          ...item,
          id: item.id || makeId('mr'),
          importTaskId: item.importTaskId ?? taskId,
          templateId: item.templateId || task?.templateId || '',
          createdAt: item.createdAt || now(),
        }));
        set((state) => ({
          mappingRules: [
            ...normalized,
            ...state.mappingRules.filter((item) => {
              return !normalized.some((rule) => {
                const sameTaskRule =
                  rule.importTaskId &&
                  item.importTaskId === rule.importTaskId &&
                  item.sourceColumnName === rule.sourceColumnName;
                const sameTemplateRule =
                  !rule.importTaskId &&
                  item.templateId === rule.templateId &&
                  item.sourceColumnName === rule.sourceColumnName;
                return sameTaskRule || sameTemplateRule;
              });
            }),
          ],
          importTasks: state.importTasks.map((item) =>
            item.id === taskId && item.status === 'mapping' ? { ...item, status: 'pending_confirm' } : item,
          ),
        }));
      },
      generateFieldSuggestionsFromTask: (taskId) => {
        const task = get().importTasks.find((item) => item.id === taskId);
        if (!task) return;
        const mappedColumns = new Set(
          get()
            .mappingRules.filter((item) => item.importTaskId === taskId || item.templateId === task.templateId)
            .map((item) => item.sourceColumnName),
        );
        const knownNames = get().fields.flatMap((item) => [item.fieldName, item.fieldKey, ...item.aliases]);
        const suggestions = get()
          .excelColumns.filter((item) => !mappedColumns.has(item.name) && !knownNames.includes(item.name))
          .filter(
            (item) =>
              !get().fieldSuggestions.some(
                (suggestion) =>
                  suggestion.importTaskId === taskId &&
                  suggestion.sourceName === item.name &&
                  suggestion.status === 'pending',
              ),
          )
          .map<FieldSuggestion>((item) => ({
            id: makeId('fs'),
            projectId: task.projectId,
            templateId: task.templateId,
            importTaskId: task.id,
            sourceName: item.name,
            suggestedFieldName: item.name,
            suggestedFieldType: inferFieldType(item.name),
            sampleValues: [String(item.sample)],
            reason: '导入表头未在字段字典中找到，建议人工确认。',
            status: 'pending',
            createdAt: now(),
          }));
        set((state) => ({ fieldSuggestions: [...suggestions, ...state.fieldSuggestions] }));
      },
      createMappingRuleFromSuggestion: (suggestionId, targetFieldId) => {
        const suggestion = get().fieldSuggestions.find((item) => item.id === suggestionId);
        const field = get().fields.find((item) => item.id === targetFieldId);
        if (!suggestion || !field) return undefined;
        const rule: MappingRule = {
          id: makeId('mr'),
          importTaskId: suggestion.importTaskId,
          templateId: suggestion.templateId,
          sourceColumnName: suggestion.sourceName,
          targetFieldId: field.id,
          targetFieldName: field.fieldName,
          mappingType: 'manual',
          confidence: 1,
          createdBy: suggestion.approvedBy ?? '财务',
          createdAt: now(),
        };
        set((state) => ({ mappingRules: [rule, ...state.mappingRules] }));
        return rule;
      },
      confirmImportTask: (id) => {
        const task = get().importTasks.find((item) => item.id === id);
        if (!task) return [];
        const rows = get().importRows.filter((item) => item.importTaskId === id);
        const sourceRows = (rows.length ? rows : mockImportRows.map((row) => ({ ...row, importTaskId: id }))).slice(0, 20);
        const taskRules = get().mappingRules.filter((item) => item.importTaskId === id || item.templateId === task.templateId);
        const findRule = (sourceColumnName: string) =>
          taskRules.find((item) => item.importTaskId === id && item.sourceColumnName === sourceColumnName) ??
          taskRules.find((item) => item.templateId === task.templateId && item.sourceColumnName === sourceColumnName);
        const fieldById = new Map(get().fields.map((field) => [field.id, field]));
        const records: BusinessRecord[] = [];

        sourceRows.forEach((row, rowIndex) => {
          const recordId = `br-import-${Date.now()}-${rowIndex}`;
          const values: RecordValue[] = [];
          let amount: string | undefined;
          let recordDate: string | undefined;

          Object.entries(row.rawData).forEach(([sourceColumnName, rawValue], valueIndex) => {
            const rule = findRule(sourceColumnName);
            if (!rule) return;
            const field = fieldById.get(rule.targetFieldId);
            if (!field) return;
            const value = normalizeValue(rawValue);
            values.push({
              id: `rv-${recordId}-${valueIndex}`,
              recordId,
              fieldId: field.id,
              fieldName: field.fieldName,
              value,
            });
            if ((field.semanticType === 'amount' || field.fieldType === 'money') && amount === undefined) {
              const parsed = String(rawValue).trim();
              amount = /^\d+(?:\.\d{1,2})?$/.test(parsed) ? Number(parsed).toFixed(2) : undefined;
            }
            if ((field.semanticType === 'date' || field.fieldType === 'date') && !recordDate) {
              recordDate = String(rawValue);
            }
          });

          if (amount === undefined) return;

          records.push({
            id: recordId,
            projectId: task.projectId,
            projectName: task.projectName,
            templateId: task.templateId,
            templateName: task.templateName,
            recordType: task.importType as DataRecordType,
            accountingDirection: task.importType === 'revenue' ? 'income' : 'expense',
            dataLayer: 'actual',
            templateVersion: 1,
            version: 1,
            recordDate: recordDate || task.createdAt.slice(0, 10),
            amount,
            category: task.importType === 'revenue' ? '收入' : '成本',
            subCategory: task.templateName,
            description: `${task.fileName} 第${row.rowNumber}行导入记录`,
            sourceType: 'excel',
            sourceId: task.id,
            status: 'confirmed',
            values,
            attachments: [task.fileName],
            createdBy: task.uploadedBy,
            createdAt: now(),
            updatedAt: now(),
            confirmedAt: now(),
            confirmedBy: task.uploadedBy,
          });
        });

        set((state) => ({
          records: [...records, ...state.records],
          importRows: state.importRows.map((item) => (item.importTaskId === id ? { ...item, status: 'confirmed' } : item)),
          importTasks: state.importTasks.map((item) =>
            item.id === id ? { ...item, status: 'confirmed', confirmedAt: now() } : item,
          ),
          rawFiles: state.rawFiles.map((item) =>
            item.relatedImportTaskId === id || item.id === task.rawFileId ? { ...item, status: 'parsed' } : item,
          ),
        }));
        return records;
      },
      cancelImportTask: (id) =>
        set((state) => ({
          importTasks: state.importTasks.map((item) => (item.id === id ? { ...item, status: 'failed' } : item)),
        })),
      approveSuggestion: async (id, approvedBy) => {
        const suggestion = get().fieldSuggestions.find((item) => item.id === id);
        if (!suggestion) return;
        const field = await get().createField({
          fieldKey: createFieldKey(suggestion.suggestedFieldName),
          fieldName: suggestion.suggestedFieldName,
          fieldType: suggestion.suggestedFieldType,
          unit: suggestion.suggestedFieldType === 'money' ? '元' : '',
          semanticType:
            suggestion.suggestedFieldType === 'money'
              ? 'amount'
              : suggestion.suggestedFieldType === 'date'
                ? 'date'
                : 'remark',
          aliases: [suggestion.sourceName],
          description: suggestion.reason,
        });
        await get().addExistingFieldToTemplate(suggestion.templateId, field.id);
        set((state) => ({
          fieldSuggestions: state.fieldSuggestions.map((item) =>
            item.id === id
              ? { ...item, status: 'approved', approvedBy, mappedFieldId: field.id, mappedFieldName: field.fieldName }
              : item,
          ),
        }));
        get().createMappingRuleFromSuggestion(id, field.id);
      },
      mapSuggestion: (id, fieldId) => {
        const field = get().fields.find((item) => item.id === fieldId);
        if (!field) return;
        set((state) => ({
          fieldSuggestions: state.fieldSuggestions.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: 'mapped_to_existing',
                  mappedFieldId: field.id,
                  mappedFieldName: field.fieldName,
                }
              : item,
          ),
        }));
        get().createMappingRuleFromSuggestion(id, field.id);
      },
      rejectSuggestion: (id) =>
        set((state) => ({
          fieldSuggestions: state.fieldSuggestions.map((item) =>
            item.id === id ? { ...item, status: 'rejected' } : item,
          ),
        })),
      getTemplateFields: (templateId) =>
        get()
          .templateFields.filter((item) => item.templateId === templateId)
          .sort((a, b) => a.displayOrder - b.displayOrder),
    }),
    {
      name: runtimeConfig.dataMode === 'mock' ? 'audit-data-center-store-mock-v8' : 'audit-data-center-store-api-v1',
      partialize: (state) =>
        runtimeConfig.dataMode === 'mock'
          ? {
              rawFiles: state.rawFiles,
              importTasks: state.importTasks,
              importRows: state.importRows,
              mappingRules: state.mappingRules,
              fieldSuggestions: state.fieldSuggestions,
              excelColumns: state.excelColumns,
            }
          : {},
    },
  ),
);
