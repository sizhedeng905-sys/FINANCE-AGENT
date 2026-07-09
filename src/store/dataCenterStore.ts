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
  ImportRow,
  ImportTask,
  MappingRule,
  Project,
  ProjectTemplate,
  RawFile,
  RecordValue,
  TemplateField,
} from '@/types/dataCenter';

type ExcelColumn = (typeof mockExcelColumns)[number];

const now = () => new Date().toLocaleString('zh-CN', { hour12: false });

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

function normalizeValue(value: string | number | string[] | null | undefined): string | number | string[] | null {
  if (value === undefined) return null;
  return value;
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
  templates: DataTemplate[];
  fields: FieldDefinition[];
  templateFields: TemplateField[];
  projectTemplates: ProjectTemplate[];
  records: BusinessRecord[];
  rawFiles: RawFile[];
  importTasks: ImportTask[];
  importRows: ImportRow[];
  mappingRules: MappingRule[];
  fieldSuggestions: FieldSuggestion[];
  excelColumns: ExcelColumn[];
  createProject: (payload: Pick<Project, 'name' | 'customerName' | 'description' | 'ownerName'>) => Project;
  updateProject: (id: string, payload: Partial<Project>) => void;
  archiveProject: (id: string) => void;
  createTemplate: (payload: Pick<DataTemplate, 'name' | 'recordType' | 'description'>, createdBy: string) => DataTemplate;
  cloneTemplate: (id: string, createdBy: string) => void;
  deleteTemplate: (id: string) => void;
  updateTemplate: (id: string, payload: Partial<DataTemplate>) => void;
  enableTemplateForProject: (projectId: string, templateId: string, customName?: string) => ProjectTemplate | undefined;
  disableTemplateForProject: (projectTemplateId: string) => void;
  updateProjectTemplate: (projectTemplateId: string, payload: Partial<ProjectTemplate>) => void;
  getProjectTemplates: (projectId: string) => ProjectTemplate[];
  addExistingFieldToTemplate: (templateId: string, fieldId: string) => void;
  createField: (payload: Omit<FieldDefinition, 'id' | 'createdAt' | 'updatedAt' | 'isActive'>) => FieldDefinition;
  updateField: (id: string, payload: Partial<FieldDefinition>) => void;
  deactivateField: (id: string) => void;
  updateTemplateField: (id: string, payload: Partial<TemplateField>) => void;
  removeTemplateField: (id: string) => void;
  moveTemplateField: (id: string, direction: 'up' | 'down') => void;
  createRecord: (payload: Omit<BusinessRecord, 'id' | 'createdAt' | 'updatedAt'>) => BusinessRecord;
  updateRecord: (id: string, payload: Partial<BusinessRecord>) => void;
  confirmRecord: (id: string, confirmedBy?: string) => void;
  deleteRecord: (id: string) => void;
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
          id: makeId('dp'),
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
          id: makeId('dt'),
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
          id: makeId('dt'),
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
          projectTemplates: state.projectTemplates.filter((item) => item.templateId !== id),
        })),
      updateTemplate: (id, payload) =>
        set((state) => ({
          templates: state.templates.map((item) => (item.id === id ? { ...item, ...payload, updatedAt: now() } : item)),
        })),
      enableTemplateForProject: (projectId, templateId, customName) => {
        const template = get().templates.find((item) => item.id === templateId);
        if (!template) return undefined;
        const existing = get().projectTemplates.find(
          (item) => item.projectId === projectId && item.templateId === templateId,
        );
        if (existing) {
          const updated = {
            ...existing,
            isActive: true,
            customName: customName || existing.customName || template.name,
            updatedAt: now(),
          };
          set((state) => ({
            projectTemplates: state.projectTemplates.map((item) => (item.id === existing.id ? updated : item)),
          }));
          return updated;
        }
        const projectTemplate: ProjectTemplate = {
          id: makeId('pt'),
          projectId,
          templateId,
          customName: customName || template.name,
          isActive: true,
          createdAt: now(),
          updatedAt: now(),
        };
        set((state) => ({ projectTemplates: [projectTemplate, ...state.projectTemplates] }));
        return projectTemplate;
      },
      disableTemplateForProject: (projectTemplateId) =>
        set((state) => ({
          projectTemplates: state.projectTemplates.map((item) =>
            item.id === projectTemplateId ? { ...item, isActive: false, updatedAt: now() } : item,
          ),
        })),
      updateProjectTemplate: (projectTemplateId, payload) =>
        set((state) => ({
          projectTemplates: state.projectTemplates.map((item) =>
            item.id === projectTemplateId ? { ...item, ...payload, updatedAt: now() } : item,
          ),
        })),
      getProjectTemplates: (projectId) => get().projectTemplates.filter((item) => item.projectId === projectId),
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
          id: makeId('f'),
          isActive: true,
          createdAt: now(),
          updatedAt: now(),
          ...payload,
          fieldKey: payload.fieldKey || createFieldKey(payload.fieldName),
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
        const recordId = makeId('br');
        const record: BusinessRecord = {
          id: recordId,
          createdAt: now(),
          updatedAt: now(),
          ...payload,
          values: payload.values.map((item, index) => ({
            ...item,
            id: item.id || `rv-${recordId}-${index}`,
            recordId,
            value: normalizeValue(item.value),
          })),
        };
        set((state) => ({ records: [record, ...state.records] }));
        return record;
      },
      updateRecord: (id, payload) =>
        set((state) => ({
          records: state.records.map((item) => (item.id === id ? { ...item, ...payload, updatedAt: now() } : item)),
        })),
      confirmRecord: (id, confirmedBy = '财务') =>
        set((state) => ({
          records: state.records.map((item) =>
            item.id === id
              ? { ...item, status: 'confirmed', confirmedAt: now(), confirmedBy, updatedAt: now() }
              : item,
          ),
        })),
      deleteRecord: (id) => set((state) => ({ records: state.records.filter((item) => item.id !== id) })),
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
          uploadedBy,
          createdAt: now(),
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
          let amount: number | undefined;
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
              const parsed = Number(rawValue);
              amount = Number.isFinite(parsed) ? parsed : undefined;
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
      approveSuggestion: (id, approvedBy) => {
        const suggestion = get().fieldSuggestions.find((item) => item.id === id);
        if (!suggestion) return;
        const field = get().createField({
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
        get().addExistingFieldToTemplate(suggestion.templateId, field.id);
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
      name: 'audit-data-center-store-v2',
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
        excelColumns: state.excelColumns,
      }),
    },
  ),
);
