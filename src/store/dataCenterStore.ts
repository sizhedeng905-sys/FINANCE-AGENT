import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  mockBusinessRecords,
  mockDataProjects,
  mockDataTemplates,
  mockExcelColumns,
  mockFieldDefinitions,
  mockFieldSuggestions,
  mockImportRows,
  mockImportTasks,
  mockMappingRules,
  mockProjectTemplates,
  mockRawFiles,
  mockTemplateFields,
} from '@/mock/mockDataCenter';
import type {
  BusinessRecord,
  DataRecordType,
  DataTemplate,
  FieldDefinition,
  FieldSuggestion,
  ImportTask,
  MappingRule,
  Project,
  ProjectTemplate,
  RawFile,
  RecordValue,
  TemplateField,
} from '@/types/dataCenter';

const now = () => new Date().toLocaleString('zh-CN', { hour12: false });

interface DataCenterState {
  projects: Project[];
  templates: DataTemplate[];
  fields: FieldDefinition[];
  templateFields: TemplateField[];
  projectTemplates: ProjectTemplate[];
  records: BusinessRecord[];
  rawFiles: RawFile[];
  importTasks: ImportTask[];
  importRows: typeof mockImportRows;
  mappingRules: MappingRule[];
  fieldSuggestions: FieldSuggestion[];
  excelColumns: typeof mockExcelColumns;
  createProject: (payload: Pick<Project, 'name' | 'customerName' | 'description' | 'ownerName'>) => Project;
  updateProject: (id: string, payload: Partial<Project>) => void;
  archiveProject: (id: string) => void;
  createTemplate: (payload: Pick<DataTemplate, 'name' | 'recordType' | 'description'>, createdBy: string) => DataTemplate;
  cloneTemplate: (id: string, createdBy: string) => void;
  deleteTemplate: (id: string) => void;
  updateTemplate: (id: string, payload: Partial<DataTemplate>) => void;
  addExistingFieldToTemplate: (templateId: string, fieldId: string) => void;
  createField: (payload: Omit<FieldDefinition, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>) => FieldDefinition;
  updateField: (id: string, payload: Partial<FieldDefinition>) => void;
  deactivateField: (id: string) => void;
  updateTemplateField: (id: string, payload: Partial<TemplateField>) => void;
  removeTemplateField: (id: string) => void;
  moveTemplateField: (id: string, direction: 'up' | 'down') => void;
  createRecord: (payload: Omit<BusinessRecord, 'id' | 'createdAt' | 'updatedAt'>) => BusinessRecord;
  updateRecord: (id: string, payload: Partial<BusinessRecord>) => void;
  confirmRecord: (id: string) => void;
  deleteRecord: (id: string) => void;
  createImportTask: (payload: {
    projectId: string;
    templateId: string;
    importType: ImportTask['importType'];
    fileName: string;
    uploadedBy: string;
  }) => ImportTask;
  updateImportTask: (id: string, payload: Partial<ImportTask>) => void;
  saveMappingRules: (taskId: string, rules: MappingRule[]) => void;
  generateFieldSuggestionsFromTask: (taskId: string) => void;
  confirmImportTask: (id: string) => void;
  cancelImportTask: (id: string) => void;
  approveSuggestion: (id: string, approvedBy: string) => void;
  mapSuggestion: (id: string, fieldId: string) => void;
  rejectSuggestion: (id: string) => void;
  getTemplateFields: (templateId: string) => TemplateField[];
}

export const useDataCenterStore = create<DataCenterState>()(
  persist(
    (set, get) => ({
      projects: mockDataProjects,
      templates: mockDataTemplates,
      fields: mockFieldDefinitions,
      templateFields: mockTemplateFields,
      projectTemplates: mockProjectTemplates,
      records: mockBusinessRecords,
      rawFiles: mockRawFiles,
      importTasks: mockImportTasks,
      importRows: mockImportRows,
      mappingRules: mockMappingRules,
      fieldSuggestions: mockFieldSuggestions,
      excelColumns: mockExcelColumns,

      createProject: (payload) => {
        const project: Project = {
          id: `dp-${Date.now()}`,
          status: 'active',
          createdAt: now(),
          updatedAt: now(),
          ...payload,
        };
        set((state) => ({ projects: [project, ...state.projects] }));
        return project;
      },
      updateProject: (id, payload) =>
        set((state) => ({
          projects: state.projects.map((item) => (item.id === id ? { ...item, ...payload, updatedAt: now() } : item)),
        })),
      archiveProject: (id) =>
        set((state) => ({
          projects: state.projects.map((item) =>
            item.id === id ? { ...item, status: 'archived', updatedAt: now() } : item,
          ),
        })),
      createTemplate: (payload, createdBy) => {
        const template: DataTemplate = {
          id: `dt-${Date.now()}`,
          isSystem: false,
          createdBy,
          createdAt: now(),
          updatedAt: now(),
          ...payload,
        };
        set((state) => ({ templates: [template, ...state.templates] }));
        return template;
      },
      cloneTemplate: (id, createdBy) => {
        const template = get().templates.find((item) => item.id === id);
        if (!template) return;
        const newTemplate: DataTemplate = {
          ...template,
          id: `dt-${Date.now()}`,
          name: `${template.name} 副本`,
          isSystem: false,
          createdBy,
          createdAt: now(),
          updatedAt: now(),
        };
        const newFields = get()
          .templateFields.filter((item) => item.templateId === id)
          .map((item, index) => ({
            ...item,
            id: `tf-${newTemplate.id}-${item.fieldId}-${index}`,
            templateId: newTemplate.id,
          }));
        set((state) => ({
          templates: [newTemplate, ...state.templates],
          templateFields: [...newFields, ...state.templateFields],
        }));
      },
      deleteTemplate: (id) =>
        set((state) => ({
          templates: state.templates.filter((item) => item.id !== id),
          templateFields: state.templateFields.filter((item) => item.templateId !== id),
        })),
      updateTemplate: (id, payload) =>
        set((state) => ({
          templates: state.templates.map((item) => (item.id === id ? { ...item, ...payload, updatedAt: now() } : item)),
        })),
      addExistingFieldToTemplate: (templateId, fieldId) => {
        const field = get().fields.find((item) => item.id === fieldId);
        if (!field) return;
        const current = get().templateFields.filter((item) => item.templateId === templateId);
        if (current.some((item) => item.fieldId === fieldId)) return;
        const templateField: TemplateField = {
          id: `tf-${templateId}-${fieldId}-${Date.now()}`,
          templateId,
          fieldId,
          field,
          isRequired: false,
          isVisible: true,
          displayOrder: current.length + 1,
          defaultValue: '',
        };
        set((state) => ({ templateFields: [...state.templateFields, templateField] }));
      },
      createField: (payload) => {
        const field: FieldDefinition = {
          id: `f-${Date.now()}`,
          isActive: true,
          createdAt: now(),
          updatedAt: now(),
          ...payload,
        };
        set((state) => ({ fields: [field, ...state.fields] }));
        return field;
      },
      updateField: (id, payload) =>
        set((state) => ({
          fields: state.fields.map((item) => (item.id === id ? { ...item, ...payload, updatedAt: now() } : item)),
          templateFields: state.templateFields.map((item) =>
            item.fieldId === id ? { ...item, field: { ...item.field, ...payload, updatedAt: now() } } : item,
          ),
        })),
      deactivateField: (id) =>
        set((state) => ({
          fields: state.fields.map((item) => (item.id === id ? { ...item, isActive: false, updatedAt: now() } : item)),
        })),
      updateTemplateField: (id, payload) =>
        set((state) => ({
          templateFields: state.templateFields.map((item) => (item.id === id ? { ...item, ...payload } : item)),
        })),
      removeTemplateField: (id) =>
        set((state) => ({ templateFields: state.templateFields.filter((item) => item.id !== id) })),
      moveTemplateField: (id, direction) => {
        const target = get().templateFields.find((item) => item.id === id);
        if (!target) return;
        const siblings = get()
          .templateFields.filter((item) => item.templateId === target.templateId)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        const index = siblings.findIndex((item) => item.id === id);
        const swap = direction === 'up' ? siblings[index - 1] : siblings[index + 1];
        if (!swap) return;
        set((state) => ({
          templateFields: state.templateFields.map((item) => {
            if (item.id === target.id) return { ...item, displayOrder: swap.displayOrder };
            if (item.id === swap.id) return { ...item, displayOrder: target.displayOrder };
            return item;
          }),
        }));
      },
      createRecord: (payload) => {
        const record: BusinessRecord = {
          id: `br-${Date.now()}`,
          createdAt: now(),
          updatedAt: now(),
          ...payload,
        };
        set((state) => ({ records: [record, ...state.records] }));
        return record;
      },
      updateRecord: (id, payload) =>
        set((state) => ({
          records: state.records.map((item) => (item.id === id ? { ...item, ...payload, updatedAt: now() } : item)),
        })),
      confirmRecord: (id) =>
        set((state) => ({
          records: state.records.map((item) => (item.id === id ? { ...item, status: 'confirmed', updatedAt: now() } : item)),
        })),
      deleteRecord: (id) => set((state) => ({ records: state.records.filter((item) => item.id !== id) })),
      createImportTask: ({ projectId, templateId, importType, fileName, uploadedBy }) => {
        const project = get().projects.find((item) => item.id === projectId);
        const template = get().templates.find((item) => item.id === templateId);
        const rawFile: RawFile = {
          id: `rf-${Date.now()}`,
          fileName,
          fileType: 'excel',
          storagePath: `/mock/${fileName}`,
          uploadedBy,
          uploadedAt: now(),
          relatedProjectId: projectId,
          status: 'uploaded',
        };
        const task: ImportTask = {
          id: `it-${Date.now()}`,
          projectId,
          projectName: project?.name ?? '-',
          rawFileId: rawFile.id,
          fileName,
          templateId,
          templateName: template?.name ?? '-',
          importType,
          status: 'mapping',
          uploadedBy,
          createdAt: now(),
        };
        set((state) => ({
          rawFiles: [rawFile, ...state.rawFiles],
          importTasks: [task, ...state.importTasks],
        }));
        return task;
      },
      updateImportTask: (id, payload) =>
        set((state) => ({
          importTasks: state.importTasks.map((item) => (item.id === id ? { ...item, ...payload } : item)),
        })),
      saveMappingRules: (taskId, rules) =>
        set((state) => ({
          mappingRules: [
            ...rules.map((item) => ({ ...item, id: item.id || `mr-${Date.now()}-${item.sourceColumnName}` })),
            ...state.mappingRules.filter((item) => !rules.some((rule) => rule.sourceColumnName === item.sourceColumnName)),
          ],
          importTasks: state.importTasks.map((item) =>
            item.id === taskId ? { ...item, status: 'pending_confirm' } : item,
          ),
        })),
      generateFieldSuggestionsFromTask: (taskId) => {
        const task = get().importTasks.find((item) => item.id === taskId);
        if (!task) return;
        const knownNames = get().fields.flatMap((item) => [item.fieldName, ...item.aliases]);
        const suggestions = get()
          .excelColumns.filter((item) => !knownNames.includes(item.name))
          .map<FieldSuggestion>((item) => ({
            id: `fs-${Date.now()}-${item.name}`,
            projectId: task.projectId,
            templateId: task.templateId,
            sourceName: item.name,
            suggestedFieldName: item.name,
            suggestedFieldType: item.name.includes('费') || item.name.includes('补贴') ? 'money' : 'text',
            sampleValues: [String(item.sample)],
            reason: '导入表头未在字段字典中找到，建议人工确认。',
            status: 'pending',
            createdAt: now(),
          }));
        set((state) => ({ fieldSuggestions: [...suggestions, ...state.fieldSuggestions] }));
      },
      confirmImportTask: (id) => {
        const task = get().importTasks.find((item) => item.id === id);
        if (!task) return;
        const rows = get().importRows.filter((item) => item.importTaskId === id);
        const newRecords: BusinessRecord[] = (rows.length ? rows : mockImportRows).slice(0, 2).map((row, index) => {
          const amount = Number(row.mappedData['金额'] ?? row.rawData['金额'] ?? 0);
          const values: RecordValue[] = Object.entries(row.mappedData).map(([fieldName, value], valueIndex) => ({
            id: `rv-${Date.now()}-${index}-${valueIndex}`,
            recordId: `br-import-${Date.now()}-${index}`,
            fieldId: `import-${fieldName}`,
            fieldName,
            value,
          }));
          return {
            id: `br-import-${Date.now()}-${index}`,
            projectId: task.projectId,
            projectName: task.projectName,
            templateId: task.templateId,
            templateName: task.templateName,
            recordType: task.importType as DataRecordType,
            recordDate: String(row.mappedData['日期'] ?? row.rawData['日期'] ?? '2026-07-09'),
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
          };
        });
        set((state) => ({
          records: [...newRecords, ...state.records],
          importTasks: state.importTasks.map((item) =>
            item.id === id ? { ...item, status: 'confirmed', confirmedAt: now() } : item,
          ),
        }));
      },
      cancelImportTask: (id) =>
        set((state) => ({
          importTasks: state.importTasks.map((item) => (item.id === id ? { ...item, status: 'failed' } : item)),
        })),
      approveSuggestion: (id, approvedBy) => {
        const suggestion = get().fieldSuggestions.find((item) => item.id === id);
        if (!suggestion) return;
        const field = get().createField({
          fieldKey: suggestion.suggestedFieldName.replace(/\s+/g, '_'),
          fieldName: suggestion.suggestedFieldName,
          fieldType: suggestion.suggestedFieldType,
          unit: suggestion.suggestedFieldType === 'money' ? '元' : '',
          semanticType: suggestion.suggestedFieldType === 'money' ? 'amount' : 'remark',
          aliases: [suggestion.sourceName],
          description: suggestion.reason,
        });
        get().addExistingFieldToTemplate(suggestion.templateId, field.id);
        set((state) => ({
          fieldSuggestions: state.fieldSuggestions.map((item) =>
            item.id === id ? { ...item, status: 'approved', approvedBy } : item,
          ),
        }));
      },
      mapSuggestion: (id) =>
        set((state) => ({
          fieldSuggestions: state.fieldSuggestions.map((item) =>
            item.id === id ? { ...item, status: 'mapped_to_existing' } : item,
          ),
        })),
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
      name: 'audit-data-center-store-v1',
      partialize: (state) => ({
        projects: state.projects,
        templates: state.templates,
        fields: state.fields,
        templateFields: state.templateFields,
        projectTemplates: state.projectTemplates,
        records: state.records,
        rawFiles: state.rawFiles,
        importTasks: state.importTasks,
        importRows: state.importRows,
        mappingRules: state.mappingRules,
        fieldSuggestions: state.fieldSuggestions,
      }),
    },
  ),
);
