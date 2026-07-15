import { getAccessToken } from './authSession';
import { mockMe } from './mockIdentityRepository';
import { mockDataProjects, mockDataTemplates, mockTemplateFields } from '@/mock/mockDataCenter';
import type {
  BusinessRecord,
  CorrectOCRTaskPayload,
  CreateOCRTaskPayload,
  OCRConfirmResult,
  OCRFieldCandidate,
  OCRTask,
  OCRTaskListQuery,
  PaginatedOCRTasks,
  TemplateField,
} from '@/types/dataCenter';

const delay = (ms = 120) => new Promise((resolve) => window.setTimeout(resolve, ms));
let tasks: OCRTask[] = [];
const scenarios = new Map<string, CreateOCRTaskPayload['mockScenario']>();

async function assertFinance() {
  const user = await mockMe(getAccessToken());
  if (user.role !== 'finance') throw new Error('无权限');
  return user;
}

async function assertReader() {
  const user = await mockMe(getAccessToken());
  if (user.role !== 'finance' && user.role !== 'boss') throw new Error('无权限');
  return user;
}

function findTask(id: string) {
  const task = tasks.find((item) => item.id === id);
  if (!task) throw new Error('资源不存在');
  return task;
}

function clone(task: OCRTask): OCRTask {
  return {
    ...task,
    extractedFields: { ...task.extractedFields },
    fieldConfidence: { ...task.fieldConfidence },
    fields: task.fields.map((field) => ({ ...field, boundingBox: field.boundingBox ? { ...field.boundingBox } : undefined })),
    pages: task.pages.map((page) => ({ ...page })),
    textBlocks: task.textBlocks.map((block) => ({ ...block })),
    tables: task.tables.map((table) => ({ ...table })),
    rawFile: { ...task.rawFile },
    attempts: task.attempts.map((attempt) => ({ ...attempt })),
    corrections: task.corrections.map((correction) => ({ ...correction })),
  };
}

function valueFor(field: TemplateField, rawFileId: string): string | number | string[] {
  if (field.field.fieldType === 'file') return [rawFileId];
  if (field.field.fieldType === 'date') return new Date().toISOString().slice(0, 10);
  if (field.field.fieldType === 'money') return 1280.5;
  if (field.field.fieldType === 'number') return 3;
  if (field.field.semanticType === 'person') return '临时仓库';
  if (field.field.semanticType === 'category') return '票据费用';
  return `Mock识别-${field.field.fieldName}`;
}

function candidate(field: TemplateField, rawFileId: string, index: number): OCRFieldCandidate {
  const value = valueFor(field, rawFileId);
  return {
    fieldId: field.fieldId,
    fieldKey: field.field.fieldKey,
    fieldName: field.field.fieldName,
    fieldType: field.field.fieldType,
    semanticType: field.field.semanticType,
    isRequired: field.isRequired,
    sourceLabel: field.field.fieldName,
    rawValue: value,
    normalizedValue: value,
    page: 1,
    confidence: Math.max(0.82, 0.98 - index * 0.01),
    evidence: 'Mock OCR 第 1 页识别结果',
    missing: false,
    lowConfidence: false,
    corrected: false,
  };
}

export async function mockCreateOCRTask(payload: CreateOCRTaskPayload): Promise<OCRTask> {
  const user = await assertFinance();
  await delay();
  const project = mockDataProjects.find((item) => item.id === payload.projectId);
  const template = mockDataTemplates.find((item) => item.id === payload.templateId);
  if (!project || !template) throw new Error('项目或模板不存在');
  const id = `mock-ocr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const task: OCRTask = {
    id,
    rawFileId: payload.rawFileId,
    projectId: project.id,
    projectName: project.name,
    templateId: template.id,
    templateName: template.name,
    recordType: template.recordType,
    status: 'uploaded',
    provider: 'mock',
    modelName: 'mock-ocr-v1',
    modelVersion: '1',
    extractedText: '',
    extractedFields: {},
    fieldConfidence: {},
    fields: [],
    pages: [{ page: 1 }],
    textBlocks: [],
    tables: [],
    pageCount: 1,
    attemptCount: 0,
    retryCount: 0,
    uploadedBy: user.name,
    uploadedById: user.id,
    createdAt: now,
    updatedAt: now,
    rawFile: {
      id: payload.rawFileId,
      fileName: 'Mock OCR 票据.pdf',
      fileSize: 1024,
      mimeType: 'application/pdf',
      sha256: 'mock-ocr'.padEnd(64, '0'),
    },
    attempts: [],
    corrections: [],
  };
  tasks = [task, ...tasks];
  scenarios.set(id, payload.mockScenario ?? 'normal');
  return clone(task);
}

export async function mockGetOCRTasks(query: OCRTaskListQuery = {}): Promise<PaginatedOCRTasks> {
  await assertReader();
  await delay();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const filtered = tasks.filter((task) => (!query.projectId || task.projectId === query.projectId) && (!query.status || task.status === query.status));
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize).map(clone), page, pageSize, total: filtered.length };
}

export async function mockGetOCRTask(id: string): Promise<OCRTask> {
  await assertReader();
  await delay();
  return clone(findTask(id));
}

export async function mockRunOCRTask(id: string): Promise<OCRTask> {
  await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status === 'pending_confirm' || task.status === 'confirmed') return clone(task);
  const scenario = scenarios.get(id) ?? 'normal';
  task.attemptCount += 1;
  if (scenario === 'failure' || (scenario === 'failure_once' && task.attemptCount === 1)) {
    task.status = 'failed';
    task.errorMessage = 'Mock OCR 按测试场景返回识别失败';
    task.attempts.unshift({ id: `attempt-${id}-${task.attemptCount}`, attemptNo: task.attemptCount, status: 'failed', provider: 'mock', modelName: task.modelName, correlationId: `mock-${Date.now()}`, errorMessage: task.errorMessage });
    throw new Error(task.errorMessage);
  }
  const templateFields = mockTemplateFields.filter((field) => field.templateId === task.templateId && field.isVisible);
  let fields = templateFields.map((field, index) => candidate(field, task.rawFileId, index));
  if (scenario === 'missing_field') {
    const required = fields.find((field) => field.isRequired);
    if (required) fields = fields.map((field) => field.fieldId === required.fieldId ? { ...field, normalizedValue: null, rawValue: null, confidence: 0, missing: true, lowConfidence: true, validationError: '必填字段未识别' } : field);
  }
  if (scenario === 'low_confidence' && fields.length) fields[0] = { ...fields[0], confidence: 0.55, lowConfidence: true, evidence: 'Mock 模糊区域，需人工确认' };
  task.fields = fields;
  task.extractedFields = Object.fromEntries(fields.map((field) => [field.fieldId, field.normalizedValue]));
  task.fieldConfidence = Object.fromEntries(fields.map((field) => [field.fieldId, field.confidence]));
  task.extractedText = fields.filter((field) => !field.missing).map((field) => `${field.fieldName}：${String(field.normalizedValue)}`).join('\n');
  task.avgConfidence = fields.reduce((sum, field) => sum + field.confidence, 0) / Math.max(fields.length, 1);
  task.status = 'pending_confirm';
  task.errorMessage = undefined;
  task.attempts.unshift({ id: `attempt-${id}-${task.attemptCount}`, attemptNo: task.attemptCount, status: 'succeeded', provider: 'mock', modelName: task.modelName, correlationId: `mock-${Date.now()}`, latencyMs: 30, pageCount: 1 });
  task.updatedAt = new Date().toISOString();
  return clone(task);
}

export async function mockCorrectOCRTask(id: string, payload: CorrectOCRTaskPayload): Promise<OCRTask> {
  const user = await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status !== 'pending_confirm') throw new Error('当前 OCR 状态不能人工纠错');
  payload.corrections.forEach((correction) => {
    const index = task.fields.findIndex((field) => field.fieldId === correction.fieldId);
    if (index < 0) throw new Error('OCR 字段候选不存在');
    const before = task.fields[index];
    task.fields[index] = { ...before, rawValue: correction.correctedValue, normalizedValue: correction.correctedValue, confidence: 1, missing: false, lowConfidence: false, corrected: true, validationError: undefined };
    task.corrections.unshift({
      id: `mock-correction-${Date.now()}-${correction.fieldId}`,
      fieldId: correction.fieldId,
      fieldName: before.fieldName,
      beforeValue: String(before.normalizedValue ?? ''),
      afterValue: String(correction.correctedValue),
      originalConfidence: before.confidence,
      reason: correction.reason,
      correctedBy: user.name,
      correctedAt: new Date().toISOString(),
    });
  });
  task.extractedFields = Object.fromEntries(task.fields.map((field) => [field.fieldId, field.normalizedValue]));
  task.fieldConfidence = Object.fromEntries(task.fields.map((field) => [field.fieldId, field.confidence]));
  return clone(task);
}

export async function mockConfirmOCRTask(id: string, acknowledge: boolean): Promise<OCRConfirmResult> {
  const user = await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status === 'confirmed' && task.generatedRecordId) return { task: clone(task), record: mockRecord(task, task.generatedRecordId, user.name), alreadyConfirmed: true };
  if (task.status !== 'pending_confirm') throw new Error('OCR 结果尚未进入人工确认状态');
  if (task.fields.some((field) => field.lowConfidence) && !acknowledge) throw new Error('存在低置信度字段，必须人工确认');
  if (task.fields.some((field) => field.isRequired && (field.missing || field.normalizedValue == null))) throw new Error('必填字段缺失');
  const recordId = `mock-ocr-record-${Date.now()}`;
  task.status = 'confirmed';
  task.generatedRecordId = recordId;
  task.confirmedBy = user.name;
  task.confirmedAt = new Date().toISOString();
  return { task: clone(task), record: mockRecord(task, recordId, user.name), alreadyConfirmed: false };
}

export async function mockRetryOCRTask(id: string): Promise<OCRTask> {
  await assertFinance();
  const task = findTask(id);
  if (task.status !== 'failed') throw new Error('只有失败任务可以重试');
  task.retryCount += 1;
  task.status = 'queued';
  return mockRunOCRTask(id);
}

export async function mockCancelOCRTask(id: string): Promise<OCRTask> {
  await assertFinance();
  const task = findTask(id);
  if (task.status === 'confirmed') throw new Error('已确认任务不能取消');
  task.status = 'cancelled';
  return clone(task);
}

function mockRecord(task: OCRTask, id: string, actor: string): BusinessRecord {
  const amountField = task.fields.find((field) => field.semanticType === 'amount');
  const dateField = task.fields.find((field) => field.semanticType === 'date');
  const now = new Date().toISOString();
  return {
    id,
    projectId: task.projectId,
    projectName: task.projectName,
    templateId: task.templateId,
    templateName: task.templateName,
    recordType: task.recordType,
    accountingDirection: task.recordType === 'revenue' ? 'income' : 'expense',
    dataLayer: 'actual',
    templateVersion: 1,
    version: 1,
    recordDate: String(dateField?.normalizedValue ?? now.slice(0, 10)),
    amount: Number(amountField?.normalizedValue ?? 0).toFixed(2),
    category: task.recordType === 'revenue' ? '收入' : '成本',
    subCategory: task.templateName,
    description: `${task.rawFile.fileName} OCR 人工确认记录`,
    sourceType: 'ocr',
    sourceId: task.id,
    status: 'confirmed',
    values: [],
    attachments: [task.rawFileId],
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
    confirmedAt: now,
    confirmedBy: actor,
  };
}
