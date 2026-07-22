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
  ConfirmImportTaskPayload,
  FieldSuggestion,
  FieldSuggestionListQuery,
  ImportColumn,
  ImportConfirmResult,
  ImportAiReviewDecisionQuery,
  ImportAiReviewDigest,
  ImportPreview,
  ImportPreviewQuery,
  ImportPreviewRow,
  ImportRowsQuery,
  ImportTask,
  ImportTaskListQuery,
  ImportWorkbookInspection,
  ParseImportTaskPayload,
  PaginatedFieldSuggestions,
  PaginatedImportAiReviewDecisions,
  PaginatedImportRows,
  PaginatedImportTasks,
  RevalidateImportTaskPayload,
  ReviewImportRowPayload,
  SaveImportMappingsPayload,
} from '@/types/dataCenter';

const delay = (ms = 120) => new Promise((resolve) => window.setTimeout(resolve, ms));
const emptyCounts = () => ({ total: 0, valid: 0, errors: 0, duplicates: 0, ignored: 0, imported: 0 });

function mockHash(value: unknown) {
  const source = JSON.stringify(value);
  return Array.from(source).reduce((hash, character) => ((hash * 31 + character.charCodeAt(0)) >>> 0), 0)
    .toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

function mockManualAiReviewDigest(task: Pick<ImportTask, 'id' | 'reviewRevision'>): ImportAiReviewDigest {
  const summary = { total: 0, accept: 0, edit: 0, reject: 0, ignore: 0, pending: 0 };
  const core = {
    schemaVersion: 'excel-ai-review-digest/1.0' as const,
    taskId: task.id,
    taskReviewRevision: task.reviewRevision,
    mode: 'manual' as const,
    decisionCount: 0,
    summary,
    batches: [],
    decisions: [],
  };
  return {
    schemaVersion: core.schemaVersion,
    mode: core.mode,
    taskReviewRevision: task.reviewRevision,
    decisionCount: 0,
    summary,
    aiTaskIds: [],
    batches: [],
    digestHash: mockHash(core),
  };
}

function detailedTask(task: Omit<ImportTask, 'counts' | 'rawFile' | 'sheets' | 'columns'> & Partial<ImportTask>): ImportTask {
  return {
    ...task,
    version: task.version ?? 1,
    reviewRevision: task.reviewRevision ?? 0,
    validation: task.validation ?? null,
    approval: task.approval ?? null,
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
  review: row.review ?? {},
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

function invalidateReview(task: ImportTask) {
  task.version += 1;
  task.reviewRevision += 1;
  task.validation = null;
  task.approval = null;
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
    validation: task.validation ? {
      ...task.validation,
      snapshot: {
        ...task.validation.snapshot,
        counts: { ...task.validation.snapshot.counts },
        blockingErrors: task.validation.snapshot.blockingErrors.map((issue) => ({ ...issue, sampleRowNumbers: [...issue.sampleRowNumbers] })),
        warnings: task.validation.snapshot.warnings.map((issue) => ({ ...issue, sampleRowNumbers: [...issue.sampleRowNumbers] })),
      },
    } : null,
    approval: task.approval ? { ...task.approval, snapshot: { ...task.approval.snapshot } } : null,
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
  const uploader = await assertFinance();
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
    uploadedBy: uploader.name,
    uploadedById: uploader.id,
    version: 1,
    reviewRevision: 0,
    validation: null,
    approval: null,
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
  task.version += 1;
  task.parsedAt = new Date().toISOString();
  task.counts = { total: 2, valid: 2, errors: 0, duplicates: 0, ignored: 0, imported: 0 };
  rows = [
    {
      id: `mock-row-${id}-1`, importTaskId: id, rowNumber: 2,
      rawData: { 日期: '2026-07-01', 车牌号: '沪A12345', 司机: '王师傅', 金额: 8200, 夜班补贴: 300, 上楼费: 500 },
      mappedData: {}, rowHash: `mock-row-${id}-1`.padEnd(64, '0'), status: 'pending' as const, errors: [], warnings: [], review: {},
    },
    {
      id: `mock-row-${id}-2`, importTaskId: id, rowNumber: 3,
      rawData: { 日期: '2026-07-02', 车牌号: '沪B77889', 司机: '刘师傅', 金额: '错误金额', 夜班补贴: 100, 上楼费: 200 },
      mappedData: {}, rowHash: `mock-row-${id}-2`.padEnd(64, '0'), status: 'pending' as const, errors: [], warnings: [], review: {},
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

export async function mockGetImportAiReviewDecisions(
  id: string,
  query: ImportAiReviewDecisionQuery = {},
): Promise<PaginatedImportAiReviewDecisions> {
  await delay();
  const task = findTask(id);
  const digest = task.validation?.reviewRevision === task.reviewRevision
    ? task.validation.snapshot.aiReview
    : mockManualAiReviewDigest(task);
  return {
    items: [],
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 20,
    total: 0,
    summary: digest.summary,
    digest,
  };
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
  invalidateReview(task);
  return cloneTask(task);
}

export async function mockAutoMatchImportTask(id: string) {
  await assertFinance();
  await delay();
  const task = findTask(id);
  task.columns.forEach((column) => { if (!column.decision) column.decision = mappingFor(column.sourceName); });
  task.status = task.columns.every((column) => column.decision) ? 'pending_confirm' : 'mapping';
  invalidateReview(task);
  return cloneTask(task);
}

export async function mockGenerateImportSuggestions(id: string) {
  await assertFinance();
  await delay();
  const task = findTask(id);
  const values = task.columns.flatMap((column) => column.suggestion ? [column.suggestion] : []);
  return { count: values.length, suggestions: values };
}

function buildMockPreviewRows(task: ImportTask): ImportPreviewRow[] {
  const taskRows = rows.filter((row) => row.importTaskId === task.id);
  return taskRows.map((row) => {
    const amount = Number(row.rawData['金额']);
    const summaryCandidate = Object.values(row.rawData).some((value) => (
      typeof value === 'string' && ['小计', '合计', '总计', '本页合计', '累计'].includes(value.trim().replace(/[\s:：]+/g, ''))
    ));
    const errors = Number.isFinite(amount) ? [] : ['金额：数字格式错误'];
    const warnings: string[] = [];
    if (summaryCandidate && !row.review.decision) errors.push('疑似汇总行，必须由财务明确按明细纳入或排除');
    if (row.review.decision === 'include') warnings.push('财务已将该行确认为业务明细');
    if (row.review.decision === 'exclude') warnings.push('财务已明确排除该行，不生成正式记录');
    const status = row.review.decision === 'exclude'
      ? 'ignored' as const
      : errors.length ? 'error' as const : row.status === 'confirmed' ? 'confirmed' as const : 'mapped' as const;
    return {
      id: row.id,
      rowNumber: row.rowNumber,
      status,
      recordDate: String(row.rawData['日期']),
      amount: Number.isFinite(amount) ? amount.toFixed(2) : undefined,
      category: task.importType === 'revenue' ? '收入' : '成本',
      subCategory: task.templateName,
      values: [],
      mappedData: {},
      errors: row.review.decision === 'exclude' ? [] : errors,
      warnings,
      summaryCandidate,
      review: { ...row.review },
    };
  });
}

export async function mockGetImportPreview(id: string, query: ImportPreviewQuery = {}): Promise<ImportPreview> {
  await assertFinance();
  await delay();
  const task = findTask(id);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  if (!Number.isInteger(page) || page < 1 || page > 50_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('分页参数无效');
  }
  const unresolvedColumns = task.columns.filter((column) => !column.decision).map((column) => ({ id: column.id, sourceName: column.sourceName, sourceKey: column.sourceKey }));
  const previewRows = buildMockPreviewRows(task);
  const pageRows = previewRows.slice((page - 1) * pageSize, page * pageSize);
  return {
    task: cloneTask(task),
    unresolvedColumns,
    rows: pageRows,
    summary: {
      total: previewRows.length,
      valid: previewRows.filter((row) => row.status === 'mapped' || row.status === 'confirmed').length,
      errors: previewRows.filter((row) => row.status === 'error').length,
      duplicates: previewRows.filter((row) => row.status === 'duplicate').length,
      ignored: previewRows.filter((row) => row.status === 'ignored').length,
    },
    pagination: {
      page,
      pageSize,
      total: previewRows.length,
      totalPages: Math.ceil(previewRows.length / pageSize),
      hasNext: page * pageSize < previewRows.length,
    },
    strategy: 'whole_batch_fail_closed',
  };
}

export async function mockReviewImportRow(id: string, rowId: string, payload: ReviewImportRowPayload) {
  const reviewer = await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status !== 'pending_confirm' && task.status !== 'mapping') throw new Error('当前任务不能修改行级复核');
  if (task.version !== payload.expectedVersion || task.reviewRevision !== payload.expectedReviewRevision) {
    throw new Error('导入审核内容已变化，请刷新后重试');
  }
  const row = rows.find((item) => item.id === rowId && item.importTaskId === id);
  if (!row) throw new Error('导入行不存在');
  const previewRow = buildMockPreviewRows(task).find((item) => item.id === rowId);
  if (!previewRow?.summaryCandidate) {
    throw new Error('逐行审核仅用于处置疑似汇总行，普通明细错误必须修正后重新导入');
  }
  if (payload.decision === 'include' && (row.status === 'ignored' || row.status === 'duplicate')) {
    throw new Error('空行或重复行在正式策略批准前不能强制纳入');
  }
  row.review = {
    decision: payload.decision,
    reason: payload.reason,
    reviewedBy: reviewer.id,
    reviewedAt: new Date().toISOString(),
  };
  invalidateReview(task);
  return cloneTask(task);
}

export async function mockRevalidateImportTask(id: string, payload: RevalidateImportTaskPayload) {
  const reviewer = await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status !== 'pending_confirm') throw new Error('只有待财务确认任务可以重新校验');
  if (task.version !== payload.expectedVersion || task.reviewRevision !== payload.expectedReviewRevision) {
    throw new Error('导入审核内容已变化，请刷新后重新校验');
  }
  const preview = await mockGetImportPreview(id);
  const previewRows = buildMockPreviewRows(task);
  if (preview.unresolvedColumns.length) throw new Error('所有未知列必须先映射或明确忽略');
  const valid = previewRows.filter((row) => row.status === 'mapped');
  const blockingErrors = previewRows.flatMap((row) => row.errors.map((message) => ({
    issueId: `error:${mockHash({ rowId: row.id, message })}`,
    code: 'ROW_VALIDATION_ERROR',
    message,
    count: 1,
    rowDigest: mockHash({ rowId: row.id, rowHash: rows.find((item) => item.id === row.id)?.rowHash }),
    sampleRowNumbers: [row.rowNumber],
  })));
  const warnings = previewRows.flatMap((row) => row.warnings.map((message) => ({
    issueId: `warning:${mockHash({ rowId: row.id, message })}`,
    code: 'ROW_REVIEW_WARNING',
    message,
    count: 1,
    rowDigest: mockHash({ rowId: row.id, rowHash: rows.find((item) => item.id === row.id)?.rowHash }),
    sampleRowNumbers: [row.rowNumber],
  })));
  const counts = {
    ...preview.summary,
    recordCount: valid.length,
    blockingErrorCount: blockingErrors.length + (valid.length ? 0 : 1),
    warningOccurrenceCount: warnings.length,
  };
  if (!valid.length) {
    blockingErrors.push({
      issueId: `error:${mockHash({ code: 'NO_DETAIL_ROWS' })}`,
      code: 'NO_DETAIL_ROWS',
      message: '没有可生成正式记录的有效业务明细行',
      count: 1,
      rowDigest: mockHash({ code: 'NO_DETAIL_ROWS' }),
      sampleRowNumbers: [],
    });
  }
  const aiReview = mockManualAiReviewDigest(task);
  const core = {
    schemaVersion: 'excel-validation/1.1' as const,
    taskId: task.id,
    projectId: task.projectId,
    reviewRevision: task.reviewRevision,
    rowSetHash: mockHash(previewRows.map((row) => ({ id: row.id, status: row.status, review: row.review }))),
    normalizedOutputHash: mockHash(valid.map((row) => ({ id: row.id, amount: row.amount, recordDate: row.recordDate }))),
    validationRuleVersion: 'excel-deterministic-validation/1.0',
    counts,
    blockingErrors,
    warnings,
    aiReview,
    valid: blockingErrors.length === 0,
  };
  task.version += 1;
  task.validation = {
    reviewRevision: task.reviewRevision,
    ruleVersion: core.validationRuleVersion,
    snapshotHash: mockHash(core),
    validatedAt: new Date().toISOString(),
    snapshot: { ...core, snapshotHash: mockHash(core) },
  };
  task.counts = { ...task.counts, ...preview.summary };
  for (const previewRow of previewRows) {
    const row = rows.find((item) => item.id === previewRow.id);
    if (row) Object.assign(row, { status: previewRow.status, errors: previewRow.errors, warnings: previewRow.warnings });
  }
  void reviewer;
  return cloneTask(task);
}

export async function mockConfirmImportTask(id: string, payload: ConfirmImportTaskPayload): Promise<ImportConfirmResult> {
  const approver = await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status !== 'pending_confirm') throw new Error('只有待确认任务可以批准');
  if (task.uploadedById === approver.id) throw new Error('上传者不能审批同一 Excel 导入任务');
  if (
    task.version !== payload.expectedVersion
    || task.reviewRevision !== payload.expectedReviewRevision
    || !task.validation
    || task.validation.reviewRevision !== task.reviewRevision
    || task.validation.snapshotHash !== payload.expectedValidationSnapshotHash
    || task.validation.snapshot.normalizedOutputHash !== payload.expectedPayloadHash
    || !task.validation.snapshot.valid
  ) throw new Error('当前审核修订没有有效的确定性校验快照');
  const expectedWarnings = task.validation.snapshot.warnings.map((warning) => warning.issueId).sort();
  const acknowledged = [...payload.acknowledgedWarningIds].sort();
  if (expectedWarnings.length !== acknowledged.length || expectedWarnings.some((value, index) => value !== acknowledged[index])) {
    throw new Error('必须逐项确认当前校验快照的全部警告');
  }
  const preview = await mockGetImportPreview(id);
  if (preview.summary.errors > 0) throw new Error('存在阻断错误，整批不会入账');
  const valid = buildMockPreviewRows(task).filter((row) => row.status === 'mapped');
  task.status = 'confirmed';
  task.version += 1;
  task.confirmedAt = new Date().toISOString();
  task.confirmedBy = approver.name;
  task.counts = { ...task.counts, valid: valid.length, errors: 0, imported: valid.length };
  const approvalHash = mockHash({ id, reviewRevision: task.reviewRevision, approvedBy: approver.id, output: payload.expectedPayloadHash });
  const requestKeyHash = mockHash({ id, reviewRevision: task.reviewRevision });
  const validation = task.validation;
  task.approval = {
    reviewRevision: task.reviewRevision,
    validationSnapshotHash: payload.expectedValidationSnapshotHash,
    policyVersion: 'finance-excel-approval/1.0-pending-h10',
    snapshotHash: approvalHash,
    requestKeyHash,
    snapshot: {
      schemaVersion: 'excel-approval/1.1',
      taskId: task.id,
      taskVersion: task.version,
      projectId: task.projectId,
      review: {
        reviewRevision: task.reviewRevision,
        validationSnapshotHash: payload.expectedValidationSnapshotHash,
        validationRuleVersion: validation.ruleVersion,
        rowSetHash: validation.snapshot.rowSetHash,
        normalizedOutputHash: validation.snapshot.normalizedOutputHash,
        aiReviewDigestHash: validation.snapshot.aiReview.digestHash,
        acknowledgedWarningIds: payload.acknowledgedWarningIds,
      },
      aiSuggestion: {
        appliedToFormalData: false,
        reviewDigest: validation.snapshot.aiReview,
      },
      approval: {
        approvedByUserId: approver.id,
        approvedByUsername: approver.username,
        approvedAt: task.confirmedAt,
        selfApproval: false,
        requestKeyHash,
      },
      output: {
        normalizedOutputHash: validation.snapshot.normalizedOutputHash,
        recordCount: valid.length,
      },
      snapshotHash: approvalHash,
    },
  };
  return {
    task: cloneTask(task),
    recordIds: valid.map((row) => `mock-record-${row.id}`),
    importedRows: valid.length,
    errorRows: 0,
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
  invalidateReview(task);
}
