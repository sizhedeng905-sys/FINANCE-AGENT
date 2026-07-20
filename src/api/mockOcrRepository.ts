import { getAccessToken } from './authSession';
import { mockMe } from './mockIdentityRepository';
import { mockDataProjects, mockDataTemplates, mockTemplateFields } from '@/mock/mockDataCenter';
import type {
  BusinessRecord,
  CorrectOCRTaskPayload,
  CreateOCRTaskPayload,
  OCRConfirmResult,
  OCRAiSuggestionResult,
  OCRFieldCandidate,
  OCRTask,
  OCRTaskListQuery,
  PaginatedOCRTasks,
  RevalidateOCRTaskPayload,
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
    fields: task.fields.map((field) => ({
      ...field,
      boundingBox: field.boundingBox ? { ...field.boundingBox } : undefined,
      evidenceRefs: [...field.evidenceRefs],
      alternatives: field.alternatives.map((alternative) => ({
        ...alternative,
        evidenceRefs: [...alternative.evidenceRefs],
        boundingBox: alternative.boundingBox ? { ...alternative.boundingBox } : undefined,
      })),
    })),
    pages: task.pages.map((page) => ({ ...page })),
    textBlocks: task.textBlocks.map((block) => ({ ...block })),
    tables: task.tables.map((table) => ({ ...table })),
    rawFile: { ...task.rawFile },
    attempts: task.attempts.map((attempt) => ({ ...attempt })),
    corrections: task.corrections.map((correction) => ({ ...correction, evidenceRefs: [...correction.evidenceRefs] })),
    validation: task.validation ? {
      ...task.validation,
      snapshot: {
        ...task.validation.snapshot,
        blockingErrors: task.validation.snapshot.blockingErrors.map((item) => ({ ...item, evidenceRefs: [...item.evidenceRefs] })),
        warnings: task.validation.snapshot.warnings.map((item) => ({ ...item, evidenceRefs: [...item.evidenceRefs] })),
      },
    } : null,
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
    boundingBox: { x: 80, y: 80 + index * 70, width: 360, height: 48 },
    confidence: Math.max(0.82, 0.98 - index * 0.01),
    evidence: 'Mock OCR 第 1 页识别结果',
    evidenceRefs: [`p1-b${index + 1}`],
    valueSource: field.field.fieldType === 'file' ? 'SYSTEM_FILE_BINDING' : 'OCR_PROVIDER',
    reviewRevision: 0,
    evidenceConflict: false,
    alternatives: [],
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
    version: 1,
    reviewRevision: 0,
    provider: 'mock',
    modelName: 'mock-ocr-v1',
    modelVersion: '1',
    extractedText: '',
    extractedFields: {},
    fieldConfidence: {},
    fields: [],
    pages: [{ page: 1, width: 1000, height: 1400 }],
    textBlocks: [],
    tables: [],
    pageCount: 1,
    attemptCount: 0,
    retryCount: 0,
    uploadedBy: user.name,
    uploadedById: user.id,
    validation: null,
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
  task.textBlocks = fields.map((field, index) => ({
    blockId: `p1-b${index + 1}`,
    page: 1,
    text: `${field.fieldName}：${String(field.normalizedValue ?? '')}`,
    bbox: field.boundingBox
      ? [
        field.boundingBox.x,
        field.boundingBox.y,
        field.boundingBox.x + field.boundingBox.width,
        field.boundingBox.y + field.boundingBox.height,
      ]
      : null,
    confidence: String(field.confidence),
    tokens: [],
  }));
  task.avgConfidence = fields.reduce((sum, field) => sum + field.confidence, 0) / Math.max(fields.length, 1);
  task.status = 'pending_confirm';
  task.version += 1;
  task.reviewRevision = 0;
  task.validation = null;
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
  if (payload.expectedVersion !== undefined && payload.expectedVersion !== task.version) throw new Error('OCR 任务版本已变化，请刷新后重试');
  if (payload.expectedReviewRevision !== undefined && payload.expectedReviewRevision !== task.reviewRevision) throw new Error('OCR 审核版本已变化，请刷新后重试');
  const nextReviewRevision = task.reviewRevision + 1;
  payload.corrections.forEach((correction) => {
    const index = task.fields.findIndex((field) => field.fieldId === correction.fieldId);
    if (index < 0) throw new Error('OCR 字段候选不存在');
    const before = task.fields[index];
    const evidenceRefs = correction.evidenceRefs?.length ? correction.evidenceRefs : before.evidenceRefs;
    task.fields[index] = {
      ...before,
      rawValue: correction.correctedValue,
      normalizedValue: correction.correctedValue,
      confidence: 1,
      evidence: correction.reason,
      evidenceRefs,
      valueSource: 'MANUAL_OVERRIDE',
      reviewRevision: nextReviewRevision,
      evidenceConflict: false,
      alternatives: [],
      missing: false,
      lowConfidence: false,
      corrected: true,
      validationError: undefined,
    };
    task.corrections.unshift({
      id: `mock-correction-${Date.now()}-${correction.fieldId}`,
      fieldId: correction.fieldId,
      fieldName: before.fieldName,
      beforeValue: String(before.normalizedValue ?? ''),
      afterValue: String(correction.correctedValue),
      originalConfidence: before.confidence,
      reason: correction.reason,
      reviewRevision: nextReviewRevision,
      overrideType: 'MANUAL_OVERRIDE',
      evidenceRefs: [...evidenceRefs],
      correctedBy: user.name,
      correctedAt: new Date().toISOString(),
    });
  });
  task.extractedFields = Object.fromEntries(task.fields.map((field) => [field.fieldId, field.normalizedValue]));
  task.fieldConfidence = Object.fromEntries(task.fields.map((field) => [field.fieldId, field.confidence]));
  task.reviewRevision = nextReviewRevision;
  task.version += 1;
  task.validation = null;
  return clone(task);
}

export async function mockRevalidateOCRTask(id: string, payload: RevalidateOCRTaskPayload): Promise<OCRTask> {
  const user = await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status !== 'pending_confirm') throw new Error('只有待复核 OCR 任务可以重新校验');
  if (payload.expectedVersion !== task.version || payload.expectedReviewRevision !== task.reviewRevision) {
    throw new Error('OCR 审核内容已变化，请刷新后重新校验');
  }
  const blockingErrors = task.fields
    .filter((field) => (field.isRequired && field.missing) || field.validationError || (!field.missing && field.evidenceRefs.length === 0))
    .map((field) => ({
      code: field.validationError ? 'FIELD_VALIDATION_ERROR' : field.missing ? 'REQUIRED_FIELD_MISSING' : 'EVIDENCE_MISSING',
      fieldId: field.fieldId,
      message: `${field.fieldName} 未通过确定性校验`,
      evidenceRefs: [...field.evidenceRefs],
    }));
  const warnings = task.fields.filter((field) => field.lowConfidence).map((field) => ({
    code: 'LOW_OCR_CONFIDENCE',
    fieldId: field.fieldId,
    message: `${field.fieldName} 需要人工核对`,
    evidenceRefs: [...field.evidenceRefs],
  }));
  const hashSource = JSON.stringify({ id, reviewRevision: task.reviewRevision, fields: task.fields, blockingErrors, warnings });
  const snapshotHash = Array.from(hashSource).reduce((hash, character) => ((hash * 31 + character.charCodeAt(0)) >>> 0), 0)
    .toString(16).padStart(8, '0').repeat(8).slice(0, 64);
  task.validation = {
    reviewRevision: task.reviewRevision,
    ruleVersion: 'ocr-deterministic-validation/1.0',
    snapshotHash,
    validatedAt: new Date().toISOString(),
    snapshot: {
      schemaVersion: 'ocr-validation/1.0',
      valid: blockingErrors.length === 0,
      candidatePayloadHash: snapshotHash,
      blockingErrors,
      warnings,
    },
  };
  task.version += 1;
  task.updatedAt = new Date().toISOString();
  return clone(task);
}

export async function mockRequestOCRAiSuggestions(id: string): Promise<OCRAiSuggestionResult> {
  await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status !== 'pending_confirm') throw new Error('只有待复核 OCR 任务可以生成 AI 建议');
  return {
    status: 'needs_finance_review',
    mode: 'suggest',
    mock: true,
    businessRecordsCreated: 0,
    classification: {
      status: 'succeeded',
      provider: 'mock',
      providerClass: 'mock',
      model: 'mock-structured-v1',
      promptVersion: '1',
      output: {
        selectedTemplateVersionId: `${task.templateId}:v1`,
        candidateTemplateVersionIds: [`${task.templateId}:v1`],
        confidence: '1.0',
        evidenceRefs: task.fields.flatMap((field) => field.evidenceRefs),
        reasonCodes: ['MOCK_CURRENT_TEMPLATE'],
        warnings: ['Mock 建议仅供测试，仍需财务复核。'],
        decision: 'NEEDS_FINANCE_REVIEW',
      },
    },
    mapping: {
      status: 'succeeded',
      provider: 'mock',
      providerClass: 'mock',
      model: 'mock-structured-v1',
      promptVersion: '1',
      output: {
        mappings: task.fields.filter((field) => field.fieldType !== 'file' && !field.missing).map((field) => ({
          sourceRef: `candidate:${field.fieldId}`,
          targetFieldKey: field.fieldKey,
          targetFieldId: field.fieldId,
          targetFieldName: field.fieldName,
          transformKey: mockTransformKey(field.field.fieldType),
          confidence: '1.0',
          evidenceRefs: [...field.evidenceRefs],
        })),
        unmappedSourceRefs: [],
        unresolvedRequiredFields: [],
        warnings: ['Mock 建议不会自动批准或入账。'],
        decision: 'NEEDS_FINANCE_REVIEW',
      },
    },
    conflicts: [],
    aiCalls: 2,
  };
}

export async function mockConfirmOCRTask(id: string, acknowledge: boolean): Promise<OCRConfirmResult> {
  const user = await assertFinance();
  await delay();
  const task = findTask(id);
  if (task.status === 'confirmed' && task.generatedRecordId) return { task: clone(task), record: mockRecord(task, task.generatedRecordId, user.name), alreadyConfirmed: true };
  if (task.status !== 'pending_confirm') throw new Error('OCR 结果尚未进入人工确认状态');
  if (!task.validation || task.validation.reviewRevision !== task.reviewRevision || !task.validation.snapshot.valid) {
    throw new Error('当前审核版本尚未通过确定性校验');
  }
  if (task.fields.some((field) => field.lowConfidence) && !acknowledge) throw new Error('存在低置信度字段，必须人工确认');
  if (task.fields.some((field) => field.isRequired && (field.missing || field.normalizedValue == null))) throw new Error('必填字段缺失');
  const recordId = `mock-ocr-record-${Date.now()}`;
  task.status = 'confirmed';
  task.generatedRecordId = recordId;
  task.confirmedBy = user.name;
  task.confirmedAt = new Date().toISOString();
  task.version += 1;
  task.updatedAt = task.confirmedAt;
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

function mockTransformKey(fieldType: TemplateField['field']['fieldType']) {
  if (fieldType === 'number' || fieldType === 'money') return 'DECIMAL_CANONICAL_V1';
  if (fieldType === 'date') return 'DATE_ISO_WITH_LOCALE_V1';
  if (fieldType === 'select') return 'ENUM_ALIAS_LOOKUP_V1';
  return fieldType === 'text' || fieldType === 'textarea' ? 'TRIM_TEXT_V1' : 'IDENTITY_V1';
}
