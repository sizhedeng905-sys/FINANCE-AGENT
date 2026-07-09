import type {
  BusinessRecord,
  DataTemplate,
  FieldDefinition,
  FieldSuggestion,
  ImportRow,
  ImportTask,
  MappingRule,
  Project,
  ProjectTemplate,
  RawFile,
  TemplateField,
} from '@/types/dataCenter';

export interface FieldUsageStat {
  fieldId: string;
  fieldName: string;
  fieldKey: string;
  fieldType: FieldDefinition['fieldType'];
  semanticType: FieldDefinition['semanticType'];
  templateNames: string[];
  usageCount: number;
  sourceTypes: BusinessRecord['sourceType'][];
  latestUsedAt?: string;
  isSuggestedField: boolean;
}

export interface LogicalTableSummary {
  tableName: string;
  description: string;
  relatedCount: number;
  keyFields: string[];
}

export interface ProjectStructureInput {
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
}

export interface EnabledTemplateInfo {
  projectTemplate: ProjectTemplate;
  template: DataTemplate;
  fields: TemplateField[];
  records: BusinessRecord[];
}

export interface ProjectStructure {
  project?: Project;
  enabledTemplates: EnabledTemplateInfo[];
  templateFields: TemplateField[];
  records: BusinessRecord[];
  rawFiles: RawFile[];
  importTasks: ImportTask[];
  fieldUsageStats: FieldUsageStat[];
  logicalTablesSummary: LogicalTableSummary[];
}

export function getEnabledTemplateInfos(projectId: string, input: ProjectStructureInput): EnabledTemplateInfo[] {
  return input.projectTemplates
    .filter((item) => item.projectId === projectId && item.isActive)
    .map((projectTemplate) => {
      const template = input.templates.find((item) => item.id === projectTemplate.templateId);
      if (!template) return null;
      return {
        projectTemplate,
        template,
        fields: input.templateFields
          .filter((item) => item.templateId === template.id)
          .sort((a, b) => a.displayOrder - b.displayOrder),
        records: input.records.filter((item) => item.projectId === projectId && item.templateId === template.id),
      };
    })
    .filter(Boolean) as EnabledTemplateInfo[];
}

export function getFieldUsageStats(projectId: string, input: ProjectStructureInput): FieldUsageStat[] {
  const enabledTemplates = getEnabledTemplateInfos(projectId, input);
  const projectRecords = input.records.filter((item) => item.projectId === projectId);
  const stats = new Map<string, FieldUsageStat>();

  enabledTemplates.forEach((templateInfo) => {
    templateInfo.fields.forEach((templateField) => {
      const existing = stats.get(templateField.fieldId);
      const base: FieldUsageStat =
        existing ?? {
          fieldId: templateField.fieldId,
          fieldName: templateField.field.fieldName,
          fieldKey: templateField.field.fieldKey,
          fieldType: templateField.field.fieldType,
          semanticType: templateField.field.semanticType,
          templateNames: [],
          usageCount: 0,
          sourceTypes: [],
          latestUsedAt: undefined,
          isSuggestedField: false,
        };
      base.templateNames = Array.from(new Set([...base.templateNames, templateInfo.projectTemplate.customName || templateInfo.template.name]));
      stats.set(templateField.fieldId, base);
    });
  });

  projectRecords.forEach((record) => {
    record.values.forEach((value) => {
      const field = input.fields.find((item) => item.id === value.fieldId);
      if (!field) return;
      const base =
        stats.get(value.fieldId) ??
        ({
          fieldId: value.fieldId,
          fieldName: value.fieldName,
          fieldKey: field.fieldKey,
          fieldType: field.fieldType,
          semanticType: field.semanticType,
          templateNames: [record.templateName],
          usageCount: 0,
          sourceTypes: [],
          latestUsedAt: undefined,
          isSuggestedField: false,
        } satisfies FieldUsageStat);
      if (value.value !== null && value.value !== '') {
        base.usageCount += 1;
      }
      base.sourceTypes = Array.from(new Set([...base.sourceTypes, record.sourceType]));
      if (!base.latestUsedAt || record.updatedAt > base.latestUsedAt) {
        base.latestUsedAt = record.updatedAt;
      }
      stats.set(value.fieldId, base);
    });
  });

  input.fieldSuggestions.forEach((suggestion) => {
    if (suggestion.projectId !== projectId || suggestion.status === 'rejected') return;
    const fieldId = suggestion.mappedFieldId || input.fields.find((item) => item.fieldName === suggestion.suggestedFieldName)?.id;
    if (!fieldId) return;
    const stat = stats.get(fieldId);
    if (stat) {
      stat.isSuggestedField = true;
      stats.set(fieldId, stat);
    }
  });

  return Array.from(stats.values()).sort((a, b) => b.usageCount - a.usageCount || a.fieldName.localeCompare(b.fieldName));
}

export function getLogicalTablesSummary(projectId: string, input: ProjectStructureInput): LogicalTableSummary[] {
  const enabledTemplates = getEnabledTemplateInfos(projectId, input);
  const templateIds = enabledTemplates.map((item) => item.template.id);
  const records = input.records.filter((item) => item.projectId === projectId);
  const recordIds = records.map((item) => item.id);
  const rawFiles = input.rawFiles.filter((item) => item.relatedProjectId === projectId);
  const importTasks = input.importTasks.filter((item) => item.projectId === projectId);
  const importTaskIds = importTasks.map((item) => item.id);
  const fieldIds = new Set(enabledTemplates.flatMap((item) => item.fields.map((field) => field.fieldId)));

  return [
    { tableName: 'projects', description: '项目主表', relatedCount: input.projects.some((item) => item.id === projectId) ? 1 : 0, keyFields: ['id', 'name', 'customerName', 'status'] },
    { tableName: 'templates', description: '数据模板表', relatedCount: enabledTemplates.length, keyFields: ['id', 'name', 'recordType', 'isSystem'] },
    { tableName: 'field_definitions', description: '字段字典表', relatedCount: fieldIds.size, keyFields: ['id', 'fieldKey', 'fieldName', 'fieldType', 'semanticType'] },
    { tableName: 'template_fields', description: '模板字段关系表', relatedCount: enabledTemplates.flatMap((item) => item.fields).length, keyFields: ['templateId', 'fieldId', 'isRequired', 'displayOrder'] },
    { tableName: 'project_templates', description: '项目启用模板关系表', relatedCount: input.projectTemplates.filter((item) => item.projectId === projectId).length, keyFields: ['projectId', 'templateId', 'customName', 'isActive'] },
    { tableName: 'business_records', description: '业务数据记录主表', relatedCount: records.length, keyFields: ['id', 'projectId', 'templateId', 'recordType', 'sourceType'] },
    { tableName: 'record_values', description: '动态字段值表', relatedCount: records.flatMap((item) => item.values).length, keyFields: ['recordId', 'fieldId', 'fieldName', 'value'] },
    { tableName: 'raw_files', description: '原始来源文件表', relatedCount: rawFiles.length, keyFields: ['id', 'fileName', 'fileType', 'relatedProjectId'] },
    { tableName: 'import_tasks', description: 'Excel导入任务表', relatedCount: importTasks.length, keyFields: ['id', 'projectId', 'templateId', 'status'] },
    { tableName: 'import_rows', description: '导入行明细表', relatedCount: input.importRows.filter((item) => importTaskIds.includes(item.importTaskId)).length, keyFields: ['importTaskId', 'rowNumber', 'rawData', 'mappedData'] },
    { tableName: 'mapping_rules', description: 'Excel字段映射规则表', relatedCount: input.mappingRules.filter((item) => importTaskIds.includes(item.importTaskId ?? '') || templateIds.includes(item.templateId)).length, keyFields: ['importTaskId', 'templateId', 'sourceColumnName', 'targetFieldId'] },
    { tableName: 'field_suggestions', description: '未知字段建议表', relatedCount: input.fieldSuggestions.filter((item) => item.projectId === projectId).length, keyFields: ['projectId', 'templateId', 'sourceName', 'status'] },
    { tableName: 'work_orders', description: '工单主表', relatedCount: records.filter((item) => item.sourceType === 'work_order').length, keyFields: ['id', 'projectId', 'status', 'amount'] },
  ];
}

export function getProjectStructure(projectId: string, input: ProjectStructureInput): ProjectStructure {
  const project = input.projects.find((item) => item.id === projectId);
  const enabledTemplates = getEnabledTemplateInfos(projectId, input);
  const records = input.records.filter((item) => item.projectId === projectId);
  const rawFiles = input.rawFiles.filter((item) => item.relatedProjectId === projectId);
  const importTasks = input.importTasks.filter((item) => item.projectId === projectId);

  return {
    project,
    enabledTemplates,
    templateFields: enabledTemplates.flatMap((item) => item.fields),
    records,
    rawFiles,
    importTasks,
    fieldUsageStats: getFieldUsageStats(projectId, input),
    logicalTablesSummary: getLogicalTablesSummary(projectId, input),
  };
}
