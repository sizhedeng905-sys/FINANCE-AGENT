export type DataRecordType = 'cost' | 'revenue' | 'reimbursement' | 'transport' | 'labor' | 'other';
export type AccountingDirection = 'income' | 'expense';
export type RecordDataLayer = 'actual' | 'reconciliation' | 'budget';
export type FieldType = 'text' | 'number' | 'money' | 'date' | 'select' | 'file' | 'textarea';
export type SemanticType =
  | 'amount'
  | 'date'
  | 'person'
  | 'vehicle'
  | 'project'
  | 'location'
  | 'category'
  | 'remark'
  | 'file';

export interface Project {
  id: string;
  name: string;
  customerName: string;
  description: string;
  ownerName: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export type CreateProjectPayload = Pick<Project, 'name' | 'customerName' | 'ownerName'> &
  Partial<Pick<Project, 'description' | 'status'>>;

export type UpdateProjectPayload = Partial<
  Pick<Project, 'name' | 'customerName' | 'ownerName' | 'description' | 'status'>
>;

export interface ProjectListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: Project['status'];
}

export interface PaginatedProjects {
  items: Project[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProjectSummary {
  project: Project;
  enabledTemplateCount: number;
  fieldCount: number;
  recordCount: number;
  rawFileCount: number;
  importTaskCount: number;
  totalIncome: string;
  totalCost: string;
  profit: string;
}

export interface DataTemplate {
  id: string;
  name: string;
  recordType: DataRecordType;
  accountingDirection: AccountingDirection;
  dataLayer: RecordDataLayer;
  primaryAmountFieldId?: string;
  primaryDateFieldId?: string;
  version: number;
  description: string;
  isSystem: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateTemplatePayload = Pick<DataTemplate, 'name' | 'recordType'> &
  Partial<Pick<DataTemplate, 'description' | 'accountingDirection' | 'dataLayer'>>;

export type UpdateTemplatePayload = Partial<
  Pick<DataTemplate, 'name' | 'recordType' | 'description' | 'accountingDirection' | 'dataLayer' | 'primaryAmountFieldId' | 'primaryDateFieldId'>
>;

export interface TemplateListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  recordType?: DataRecordType;
}

export interface PaginatedTemplates {
  items: DataTemplate[];
  page: number;
  pageSize: number;
  total: number;
}

export interface FieldDefinition {
  id: string;
  fieldKey: string;
  fieldName: string;
  fieldType: FieldType;
  unit?: string;
  semanticType: SemanticType;
  aliases: string[];
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateFieldPayload = Pick<FieldDefinition, 'fieldName' | 'fieldType' | 'semanticType'> &
  Partial<Pick<FieldDefinition, 'fieldKey' | 'unit' | 'aliases' | 'description'>>;

export type UpdateFieldPayload = Partial<
  Pick<FieldDefinition, 'fieldKey' | 'fieldName' | 'fieldType' | 'unit' | 'semanticType' | 'aliases' | 'description'>
>;

export interface FieldListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  fieldType?: FieldType;
  semanticType?: SemanticType;
  isActive?: boolean;
}

export interface PaginatedFields {
  items: FieldDefinition[];
  page: number;
  pageSize: number;
  total: number;
}

export interface FieldUsage {
  field: FieldDefinition;
  templateCount: number;
  projectCount: number;
  templates: DataTemplate[];
  projects: Project[];
}

export interface TemplateField {
  id: string;
  templateId: string;
  fieldId: string;
  field: FieldDefinition;
  isRequired: boolean;
  isVisible: boolean;
  displayOrder: number;
  defaultValue?: string;
}

export type CreateTemplateFieldPayload = Pick<TemplateField, 'fieldId'> &
  Partial<Pick<TemplateField, 'isRequired' | 'isVisible' | 'displayOrder' | 'defaultValue'>>;

export type UpdateTemplateFieldPayload = Partial<
  Pick<TemplateField, 'isRequired' | 'isVisible' | 'displayOrder' | 'defaultValue'>
>;

export interface ProjectTemplate {
  id: string;
  projectId: string;
  templateId: string;
  recordType?: DataRecordType;
  customName: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  template?: DataTemplate;
}

export interface CreateProjectTemplatePayload {
  templateId: string;
  customName?: string;
}

export interface UpdateProjectTemplatePayload {
  customName: string;
}

export interface RecordValue {
  id: string;
  recordId: string;
  fieldId: string;
  fieldName: string;
  fieldType?: FieldType;
  value: string | number | string[] | null;
}

export interface BusinessRecord {
  id: string;
  projectId: string;
  projectName: string;
  templateId: string;
  templateName: string;
  recordType: DataRecordType;
  accountingDirection: AccountingDirection;
  dataLayer: RecordDataLayer;
  templateVersion: number;
  templateSnapshot?: Record<string, unknown>;
  sourceSnapshot?: Record<string, unknown>;
  confirmationSnapshot?: Record<string, unknown>;
  version: number;
  recordDate: string;
  amount: string;
  category: string;
  subCategory: string;
  description: string;
  sourceType: 'manual' | 'excel' | 'ocr' | 'work_order';
  sourceId: string;
  importTaskId?: string;
  status: 'draft' | 'pending_confirm' | 'confirmed' | 'rejected';
  values: RecordValue[];
  attachments: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
}

export interface RecordValueInput {
  fieldId: string;
  value: string | number | string[] | null;
}

export interface RecordListQuery {
  page?: number;
  pageSize?: number;
  projectId?: string;
  templateId?: string;
  importTaskId?: string;
  recordType?: BusinessRecord['recordType'];
  sourceType?: BusinessRecord['sourceType'];
  status?: BusinessRecord['status'];
  dataLayer?: BusinessRecord['dataLayer'];
  dateFrom?: string;
  dateTo?: string;
}

export interface PaginatedRecords {
  items: BusinessRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateRecordPayload {
  projectId: string;
  templateId: string;
  recordType: BusinessRecord['recordType'];
  recordDate: string;
  amount: string;
  category?: string;
  subCategory?: string;
  description?: string;
  sourceType?: 'manual';
  sourceId?: string;
  status?: 'draft' | 'pending_confirm';
  values: RecordValueInput[];
  attachments?: string[];
}

export interface UpdateRecordPayload {
  recordDate?: string;
  amount?: string;
  category?: string;
  subCategory?: string;
  description?: string;
  values?: RecordValueInput[];
  attachments?: string[];
}

export interface RawFile {
  id: string;
  fileName: string;
  originalFileName?: string;
  fileType: 'excel' | 'image' | 'pdf' | 'word' | 'other';
  mimeType?: string;
  fileSize?: number;
  sha256?: string;
  storagePath?: string;
  uploadedBy: string;
  uploadedAt: string;
  relatedProjectId?: string;
  relatedWorkOrderId?: string;
  relatedImportTaskId?: string;
  status: 'uploaded' | 'parsed' | 'failed' | 'voided';
  scanStatus?: 'pending' | 'clean' | 'infected' | 'failed';
  previewStatus?: string;
  isVoided?: boolean;
  voidReason?: string;
}

export interface ImportTask {
  id: string;
  projectId: string;
  projectName: string;
  rawFileId: string;
  fileName: string;
  templateId: string;
  templateName: string;
  importType: DataRecordType;
  status: 'uploaded' | 'parsing' | 'parsed' | 'mapping' | 'pending_confirm' | 'confirmed' | 'failed' | 'cancelled';
  uploadedBy: string;
  uploadedById?: string;
  createdAt: string;
  parsedAt?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  errorMessage?: string;
  progress?: {
    executionMode?: 'synchronous' | 'background';
    processingMode?: 'document' | 'streaming';
    processed: number;
    total: number;
    percent: number;
    attempts: number;
  };
  counts: {
    total: number;
    valid: number;
    errors: number;
    duplicates: number;
    ignored: number;
    imported: number;
  };
  rawFile: {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    sha256: string;
  };
  sheets: ImportSheet[];
  columns: ImportColumn[];
}

export interface ImportSheet {
  id: string;
  name: string;
  index: number;
  headerRowIndex: number;
  rowCount: number;
}

export interface ImportHeaderCandidate {
  startRowIndex: number;
  endRowIndex: number;
  columnCount: number;
  labels: string[];
  score: number;
  merged: boolean;
}

export interface ImportWorkbookSheetInspection {
  sheetName: string;
  sheetIndex: number;
  state: 'visible' | 'hidden' | 'veryHidden';
  rowCount: number;
  columnCount: number;
  nonEmpty: boolean;
  mergeCount: number;
  formulaCellCount: number;
  headerCandidates: ImportHeaderCandidate[];
}

export interface ImportWorkbookInspection {
  sheets: ImportWorkbookSheetInspection[];
  requiresSheetSelection: boolean;
  processingMode: 'document' | 'streaming';
  mediaCount: number;
  mediaExpandedBytes: number;
  recommendedSelection?: ParseImportTaskPayload;
}

export interface ParseImportTaskPayload {
  sheetIndex?: number;
  headerStartRowIndex?: number;
  headerRowIndex?: number;
  allowHiddenSheet?: boolean;
  allowCachedFormulaResults?: boolean;
}

export type ImportMappingType = 'profile' | 'field_key' | 'exact_name' | 'alias' | 'normalized' | 'fuzzy' | 'manual' | 'ignored';

export interface MappingDecision {
  id: string;
  targetFieldId?: string;
  targetFieldName?: string;
  mappingType: ImportMappingType;
  confidence: number;
  ignored: boolean;
}

export interface ImportColumn {
  id: string;
  columnIndex: number;
  sourceKey: string;
  sourceName: string;
  normalizedName: string;
  sampleValues: string[];
  inferredType: 'date' | 'number' | 'text';
  duplicateName: boolean;
  decision?: MappingDecision;
  suggestion?: FieldSuggestion;
}

export interface ImportRow {
  id: string;
  importTaskId: string;
  rowNumber: number;
  rawData: Record<string, unknown>;
  mappedData: Record<string, unknown>;
  rowHash: string;
  status: 'pending' | 'mapped' | 'error' | 'confirmed' | 'duplicate' | 'ignored';
  errors: string[];
  warnings: string[];
  errorMessage?: string;
  generatedRecordId?: string;
  confirmedAt?: string;
}

export interface MappingRule {
  id: string;
  importTaskId?: string;
  templateId: string;
  sourceColumnName: string;
  targetFieldId: string;
  targetFieldName: string;
  mappingType: 'manual' | 'auto' | 'ai_suggested';
  confidence: number;
  createdBy: string;
  createdAt: string;
}

export interface FieldSuggestion {
  id: string;
  projectId: string;
  templateId: string;
  importTaskId?: string;
  sourceName: string;
  suggestedFieldName: string;
  suggestedFieldType: FieldType;
  sampleValues: string[];
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'mapped_to_existing';
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  mappedFieldId?: string;
  mappedFieldName?: string;
}

export interface ImportTaskListQuery {
  page?: number;
  pageSize?: number;
  projectId?: string;
  status?: ImportTask['status'];
}

export interface PaginatedImportTasks {
  items: ImportTask[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ImportRowsQuery {
  page?: number;
  pageSize?: number;
  status?: ImportRow['status'];
}

export interface PaginatedImportRows {
  items: ImportRow[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ImportPreviewRow {
  id: string;
  rowNumber: number;
  status: ImportRow['status'];
  recordDate?: string;
  amount?: string;
  category: string;
  subCategory: string;
  values: Array<{
    fieldId: string;
    fieldName: string;
    fieldType: FieldType;
    value: string | number | string[];
  }>;
  mappedData: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  generatedRecordId?: string;
}

export interface ImportPreview {
  task: ImportTask;
  unresolvedColumns: Array<{ id: string; sourceName: string; sourceKey: string }>;
  rows: ImportPreviewRow[];
  summary: { total: number; valid: number; errors: number; duplicates: number; ignored: number };
  strategy: 'valid_rows_only';
}

export interface CreateImportTaskPayload {
  projectId: string;
  templateId: string;
  importType: DataRecordType;
}

export interface ImportMappingInput {
  columnId: string;
  targetFieldId?: string;
  ignore?: boolean;
}

export interface SaveImportMappingsPayload {
  mappings: ImportMappingInput[];
  saveToProfile?: boolean;
}

export interface ImportConfirmResult {
  task: ImportTask;
  recordIds: string[];
  importedRows: number;
  errorRows: number;
  duplicateRows: number;
  ignoredRows: number;
  alreadyConfirmed: boolean;
}

export interface FieldSuggestionListQuery {
  page?: number;
  pageSize?: number;
  status?: FieldSuggestion['status'];
  projectId?: string;
  importTaskId?: string;
}

export interface PaginatedFieldSuggestions {
  items: FieldSuggestion[];
  page: number;
  pageSize: number;
  total: number;
}

export type OCRTaskStatus = 'uploaded' | 'queued' | 'processing' | 'pending_confirm' | 'confirmed' | 'failed' | 'cancelled';

export interface OCRFieldCandidate {
  fieldId: string;
  fieldKey: string;
  fieldName: string;
  fieldType: FieldType;
  semanticType: SemanticType;
  isRequired: boolean;
  sourceLabel: string;
  rawValue: unknown;
  normalizedValue: unknown;
  page: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
  confidence: number;
  evidence: string;
  missing: boolean;
  lowConfidence: boolean;
  corrected: boolean;
  validationError?: string;
}

export interface OCRAttempt {
  id: string;
  attemptNo: number;
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  provider: string;
  modelName: string;
  modelVersion?: string;
  endpointSnapshot?: string;
  correlationId: string;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  pageCount?: number;
  rawResultRef?: string;
  errorMessage?: string;
}

export interface OCRCorrection {
  id: string;
  fieldId: string;
  fieldName: string;
  beforeValue?: string;
  afterValue: string;
  originalConfidence?: number;
  reason?: string;
  correctedBy: string;
  correctedAt: string;
}

export interface OCRTask {
  id: string;
  rawFileId: string;
  projectId: string;
  projectName: string;
  templateId: string;
  templateName: string;
  recordType: DataRecordType;
  status: OCRTaskStatus;
  provider: string;
  modelName: string;
  modelVersion?: string;
  endpointSnapshot?: string;
  extractedText: string;
  extractedFields: Record<string, unknown>;
  fieldConfidence: Record<string, number>;
  fields: OCRFieldCandidate[];
  pages: Array<Record<string, unknown>>;
  textBlocks: Array<Record<string, unknown>>;
  tables: Array<Record<string, unknown>>;
  rawResultRef?: string;
  pageCount: number;
  avgConfidence?: number;
  latencyMs?: number;
  attemptCount: number;
  retryCount: number;
  errorMessage?: string;
  uploadedBy: string;
  uploadedById?: string;
  confirmedBy?: string;
  confirmedAt?: string;
  generatedRecordId?: string;
  createdAt: string;
  updatedAt: string;
  rawFile: {
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    sha256: string;
  };
  attempts: OCRAttempt[];
  corrections: OCRCorrection[];
}

export interface OCRTaskListQuery {
  page?: number;
  pageSize?: number;
  projectId?: string;
  status?: OCRTaskStatus;
}

export interface PaginatedOCRTasks {
  items: OCRTask[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateOCRTaskPayload {
  rawFileId: string;
  projectId: string;
  templateId: string;
  pageStart?: number;
  pageEnd?: number;
  mockScenario?: 'normal' | 'low_confidence' | 'missing_field' | 'failure' | 'failure_once';
}

export interface CorrectOCRTaskPayload {
  corrections: Array<{ fieldId: string; correctedValue: unknown; reason?: string }>;
}

export interface OCRConfirmResult {
  task: OCRTask;
  record: BusinessRecord;
  alreadyConfirmed: boolean;
}

export interface ProjectStructureFieldUsage {
  fieldId: string;
  fieldName: string;
  fieldKey: string;
  fieldType: FieldType;
  semanticType: SemanticType;
  templateNames: string[];
  usageCount: number;
  sourceTypes: BusinessRecord['sourceType'][];
  latestUsedAt?: string;
  isSuggestedField: boolean;
}

export interface LogicalTableSummary {
  projectId?: string;
  tableName: string;
  description: string;
  relatedCount: number;
  keyFields: string[];
}

export interface ProjectStructure {
  project: Project;
  enabledTemplates: Array<{
    projectTemplate: ProjectTemplate;
    template: DataTemplate;
    fields: TemplateField[];
    records: BusinessRecord[];
  }>;
  templateFields: TemplateField[];
  records: BusinessRecord[];
  rawFiles: RawFile[];
  importTasks: ImportTask[];
  ocrTasks: OCRTask[];
  fieldUsageStats: ProjectStructureFieldUsage[];
  logicalTablesSummary: LogicalTableSummary[];
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}
