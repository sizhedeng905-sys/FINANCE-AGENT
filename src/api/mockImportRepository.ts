import { getAccessToken } from './authSession';
import { mockMe } from './mockIdentityRepository';
import {
  mockDataProjects,
  mockDataTemplates,
  mockExcelColumns,
  mockFieldSuggestions,
  mockImportRows,
  mockImportTasks,
  mockMappingRules,
} from '@/mock/mockDataCenter';
import type {
  CreateImportTaskPayload,
  FieldSuggestion,
  FieldSuggestionListQuery,
  ImportColumn,
  ImportConfirmResult,
  ImportPreview,
  ImportRowsQuery,
  ImportTask,
  ImportTaskListQuery,
  ImportWorkbookInspection,
  ParseImportTaskPayload,
  PaginatedFieldSuggestions,
  PaginatedImportRows,
  PaginatedImportTasks,
  SaveImportMappingsPayload,
} from '@/types/dataCenter';

const delay = (ms = 120) => new Promise((resolve) => window.setTimeout(resolve, ms));
const emptyCounts = () => ({ total: 0, valid: 0, errors: 0, duplicates: 0, ignored: 0, imported: 0 });

function detailedTask(task: Omit<ImportTask, 'counts' | 'rawFile' | 'sheets' | 'columns'> & Partial<ImportTask>): ImportTask {
  return {
    ...task,
    counts: task.counts ?? emptyCounts(),
    rawFile: task.rawFile ?? {
      id: task.rawFileId,
      fileName: task.fileName,
      fileSize: 0,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sha256: 'mock'.padEnd(64, '0'),
    },
    sheets: task.sheets ?? [],
    columns: task.columns ?? [],
  } as ImportTask;
}

let tasks = mockImportTasks.map((task) => detailedTask(task as ImportTask));
let rows = mockImportRows.map((row) => ({
  ...row,
  rowHash: `mock-${row.id}`.padEnd(64, '0'),
  errors: row.errorMessage ? [row.errorMessage] : [],
  warnings: [],
}));
let suggestions = mockFieldSuggestions.map((item) => ({ ...item }));
const idempotency = new Map<string, string>();

async function assertFinance() {
  const user = await mockMe(getAccessToken());
  if (user.role !== 'finance') throw new Error('无权限');
  return user;
}

function findTask(id: string) {
  const task = tasks.find((item) => item.id === id);
  if (!task) throw new Error('资源不存在');
  return task;
}

function cloneTask(task: ImportTask): ImportTask {
  return {
    ...task,
    counts: { ...task.counts },
    rawFile: { ...task.rawFile },
    sheets: task.sheets.map((item) => ({ ...item })),
    columns: task.columns.map((column) => ({
      ...column,
      sampleValues: [...column.sampleValues],
      decision: column.decision ? { ...column.decision } : undefined,
      suggestion: column.suggestion ? { ...column.suggestion, sampleValues: [...column.suggestion.sampleValues] } : undefined,
    })),
  };
}

function mappingFor(name: string) {
  const fixture = mockMappingRules.find((rule) => rule.sourceColumnName === name);
  return fixture ? {
    id: `mock-decision-${name}`,
    targetFieldId: fixture.targetFieldId,
    targetFieldName: fixture.targetFieldName,
    mappingType: 'exact_name' as const,
    confidence: fixture.confidence,
    ignored: false,
  } : undefined;
}

function parsedColumns(taskId: string): ImportColumn[] {
  return mockExcelColumns.map((column, index) => {
    const decision = mappingFor(column.name);
    const suggestion = decision ? undefined : {
      id: `mock-suggestion-${taskId}-${index}`,
      projectId: findTask(taskId).projectId,
      templateId: findTask(taskId).templateId,
      importTaskId: taskId,
      sourceName: column.name,
      suggestedFieldName: column.name,
      suggestedFieldType: /费|金额/.test(column.name) ? 'money' as const : 'text' as const,
      sampleValues: [String(column.sample)],
      reason: 'Mock 未知列，需人工确认',
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };
    if (suggestion && !suggestions.some((item) => item.id === suggestion.id)) suggestions = [suggestion, ...suggestions];
    return {
      id: `mock-column-${taskId}-${index}`,
      columnIndex: index + 1,
      sourceKey: column.name,
      sourceName: column.name,
      normalizedName: column.name,
      sampleValues: [String(column.sample)],
      inferredType: /日期/.test(column.name) ? 'date' : /费|金额/.test(column.name) ? 'number' : 'text',
      duplicateName: false,
      decision,
      suggestion,
    };
  });
}

export async function mockCreateImportTask(file: File, payload: CreateImportTaskPayload, key: string) {
  await assertFinance();
  await delay();
  const existingId = idempotency.get(key);
  if (existingId) return cloneTask(findTask(existingId));
  const project = mockDataProjects.find((item) => item.id === payload.projectId);
  const template = mockDataTemplates.find((item) => item.id === payload.templateId);
  if (!project || !template) throw new Error('项目或模板不存在');
  const id = `mock-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const task = detailedTask({
    id,
    projectId: project.id,
    projectName: project.name,
    rawFileId: `mock-file-${id}`,
    fileName: file.name,
    templateId: template.id,
    templateName: template.name,
    importType: payload.importType,
    status: 'uploaded',
    uploadedBy: '财务',
    createdAt: new Date().toISOString(),
    counts: emptyCounts(),
    rawFile: {
      id: `mock-file-${id}`,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      sha256: 'mock'.padEnd(64, '0'),
    },
    sheets: [],
    columns: [],
  });
  tasks = [task, ...tasks];
  idempotency.set(key, id);
  return cloneTask(task);
}

export async function mockGetImportTasks(query: ImportTaskListQuery = {}): Promise<PaginatedImportTasks> {
  await assertFinance();
  await delay();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const filtered = tasks.filter((task) => (!query.projectId || task.projectId === query.projectId) && (!query.status || task.status === query.status));
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize).map(cloneTask), page, pageSize, total: filtered.length };
}

export async function mockGetImportTask(id: string) {
  await assertFinance();
  await delay();
  return cloneTask(findTask(id));
}

export async function mockInspectImportTask(id: string): Promise<ImportWorkbookInspection> {
  await assertFinance();
  await delay();
  findTask(id);
  return {
    requiresSheetSelection: false,
    processingMode: 'document',
    mediaCount: 0,
    mediaExpandedBytes: 0,
    recommendedSelection: { sheetIndex: 0, headerStartRowIndex: 1, headerRowIndex: 1 },
    sheets: [{
      sheetName: 'Sheet1',
      sheetIndex: 0,
      state: 'visible',
      rowCount: 3,
      columnCount: mockExcelColumns.length,
      nonEmpty: true,
      mergeCount: 0,
      formulaCellCount: 0,
      headerCandidates: [{
        startRowIndex: 1,
        endRowIndex: 1,
        columnCount: mockExcelColumns.length,
        labels: mockExcelColumns.map((column) => column.name),
        score: 100,
        merged: false,
      }],
    }],
  };
}

export async function mockParseImportTask(id: string, _payload: ParseImportTaskPayload = {}) {
  await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status !== 'uploaded' && task.status !== 'failed') return cloneTask(task);
  task.columns = parsedColumns(id);
  task.sheets = [{ id: `mock-sheet-${id}`, name: 'Sheet1', index: 0, headerRowIndex: 1, rowCount: 2 }];
  task.status = 'mapping';
  task.parsedAt = new Date().toISOString();
  task.counts = { total: 2, valid: 2, errors: 0, duplicates: 0, ignored: 0, imported: 0 };
  rows = [
    {
      id: `mock-row-${id}-1`, importTaskId: id, rowNumber: 2,
      rawData: { 日期: '2026-07-01', 车牌号: '沪A12345', 司机: '王师傅', 金额: 8200, 夜班补贴: 300, 上楼费: 500 },
      mappedData: {}, rowHash: `mock-row-${id}-1`.padEnd(64, '0'), status: 'pending' as const, errors: [], warnings: [],
    },
    {
      id: `mock-row-${id}-2`, importTaskId: id, rowNumber: 3,
      rawData: { 日期: '2026-07-02', 车牌号: '沪B77889', 司机: '刘师傅', 金额: '错误金额', 夜班补贴: 100, 上楼费: 200 },
      mappedData: {}, rowHash: `mock-row-${id}-2`.padEnd(64, '0'), status: 'pending' as const, errors: [], warnings: [],
    },
    ...rows.filter((row) => row.importTaskId !== id),
  ];
  return cloneTask(task);
}

export async function mockGetImportRows(id: string, query: ImportRowsQuery = {}): Promise<PaginatedImportRows> {
  await assertFinance();
  await delay();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const filtered = rows.filter((row) => row.importTaskId === id && (!query.status || row.status === query.status));
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: filtered.length };
}

export async function mockSaveImportMappings(id: string, payload: SaveImportMappingsPayload) {
  await assertFinance();
  await delay();
  const task = findTask(id);
  for (const mapping of payload.mappings) {
    const column = task.columns.find((item) => item.id === mapping.columnId);
    if (!column) throw new Error('导入列不存在');
    column.decision = {
      id: `mock-decision-${column.id}`,
      targetFieldId: mapping.targetFieldId,
      targetFieldName: mapping.targetFieldId,
      mappingType: mapping.ignore ? 'ignored' : 'manual',
      confidence: 1,
      ignored: mapping.ignore === true,
    };
  }
  task.status = task.columns.every((column) => column.decision) ? 'pending_confirm' : 'mapping';
  return cloneTask(task);
}

export async function mockAutoMatchImportTask(id: string) {
  await assertFinance();
  await delay();
  const task = findTask(id);
  task.columns.forEach((column) => { if (!column.decision) column.decision = mappingFor(column.sourceName); });
  task.status = task.columns.every((column) => column.decision) ? 'pending_confirm' : 'mapping';
  return cloneTask(task);
}

export async function mockGenerateImportSuggestions(id: string) {
  await assertFinance();
  await delay();
  const task = findTask(id);
  const values = task.columns.flatMap((column) => column.suggestion ? [column.suggestion] : []);
  return { count: values.length, suggestions: values };
}

export async function mockGetImportPreview(id: string): Promise<ImportPreview> {
  await assertFinance();
  await delay();
  const task = findTask(id);
  const unresolvedColumns = task.columns.filter((column) => !column.decision).map((column) => ({ id: column.id, sourceName: column.sourceName, sourceKey: column.sourceKey }));
  const taskRows = rows.filter((row) => row.importTaskId === id);
  const previewRows = taskRows.map((row) => {
    const amount = Number(row.rawData['金额']);
    const errors = Number.isFinite(amount) ? [] : ['金额：数字格式错误'];
    return {
      id: row.id,
      rowNumber: row.rowNumber,
      status: errors.length ? 'error' as const : 'mapped' as const,
      recordDate: String(row.rawData['日期']),
      amount: Number.isFinite(amount) ? amount.toFixed(2) : undefined,
      category: task.importType === 'revenue' ? '收入' : '成本',
      subCategory: task.templateName,
      values: [],
      mappedData: {},
      errors,
      warnings: [],
    };
  });
  return {
    task: cloneTask(task),
    unresolvedColumns,
    rows: previewRows,
    summary: { total: previewRows.length, valid: previewRows.filter((row) => !row.errors.length).length, errors: previewRows.filter((row) => row.errors.length).length, duplicates: 0, ignored: 0 },
    strategy: 'valid_rows_only',
  };
}

export async function mockConfirmImportTask(id: string): Promise<ImportConfirmResult> {
  await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status === 'confirmed') {
    return {
      task: cloneTask(task),
      recordIds: [],
      importedRows: task.counts.imported,
      errorRows: task.counts.errors,
      duplicateRows: task.counts.duplicates,
      ignoredRows: task.counts.ignored,
      alreadyConfirmed: true,
    };
  }
  const preview = await mockGetImportPreview(id);
  if (preview.unresolvedColumns.length) throw new Error('所有未知列必须先映射或明确忽略');
  const valid = preview.rows.filter((row) => !row.errors.length);
  task.status = 'confirmed';
  task.confirmedAt = new Date().toISOString();
  task.counts = { ...task.counts, valid: valid.length, errors: preview.summary.errors, imported: valid.length };
  return {
    task: cloneTask(task),
    recordIds: valid.map((row) => `mock-record-${row.id}`),
    importedRows: valid.length,
    errorRows: preview.summary.errors,
    duplicateRows: preview.summary.duplicates,
    ignoredRows: preview.summary.ignored,
    alreadyConfirmed: false,
  };
}

export async function mockCancelImportTask(id: string) {
  await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status === 'confirmed') throw new Error('已确认任务不能取消');
  task.status = 'failed';
  task.errorMessage = '用户取消';
  return cloneTask(task);
}

export async function mockGetFieldSuggestions(query: FieldSuggestionListQuery = {}): Promise<PaginatedFieldSuggestions> {
  await assertFinance();
  await delay();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const filtered = suggestions.filter((item) => (!query.status || item.status === query.status) && (!query.projectId || item.projectId === query.projectId) && (!query.importTaskId || item.importTaskId === query.importTaskId));
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: filtered.length };
}

export async function mockApproveFieldSuggestion(id: string, payload: { fieldName?: string; fieldType?: FieldSuggestion['suggestedFieldType'] }) {
  await assertFinance();
  await delay();
  const suggestion = suggestions.find((item) => item.id === id);
  if (!suggestion) throw new Error('资源不存在');
  const fieldId = `mock-field-${id}`;
  Object.assign(suggestion, { status: 'approved' as const, suggestedFieldName: payload.fieldName ?? suggestion.suggestedFieldName, suggestedFieldType: payload.fieldType ?? suggestion.suggestedFieldType, mappedFieldId: fieldId, mappedFieldName: payload.fieldName ?? suggestion.suggestedFieldName });
  resolveMockSuggestion(suggestion, fieldId, false);
  return { fieldId, suggestion: { ...suggestion } };
}

export async function mockMapFieldSuggestion(id: string, fieldId: string) {
  await assertFinance();
  await delay();
  const suggestion = suggestions.find((item) => item.id === id);
  if (!suggestion) throw new Error('资源不存在');
  Object.assign(suggestion, { status: 'mapped_to_existing' as const, mappedFieldId: fieldId, mappedFieldName: fieldId });
  resolveMockSuggestion(suggestion, fieldId, false);
  return { ...suggestion };
}

export async function mockRejectFieldSuggestion(id: string) {
  await assertFinance();
  await delay();
  const suggestion = suggestions.find((item) => item.id === id);
  if (!suggestion) throw new Error('资源不存在');
  suggestion.status = 'rejected';
  resolveMockSuggestion(suggestion, undefined, true);
  return { ...suggestion };
}

function resolveMockSuggestion(suggestion: FieldSuggestion, fieldId: string | undefined, ignored: boolean) {
  if (!suggestion.importTaskId) return;
  const task = findTask(suggestion.importTaskId);
  const column = task.columns.find((item) => item.suggestion?.id === suggestion.id);
  if (!column) return;
  column.decision = {
    id: `mock-decision-${column.id}`,
    targetFieldId: fieldId,
    targetFieldName: suggestion.mappedFieldName,
    mappingType: ignored ? 'ignored' : 'manual',
    confidence: 1,
    ignored,
  };
  column.suggestion = { ...suggestion };
  task.status = task.columns.every((item) => item.decision) ? 'pending_confirm' : 'mapping';
}
