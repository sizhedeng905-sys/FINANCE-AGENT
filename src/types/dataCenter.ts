export type DataRecordType = 'cost' | 'revenue' | 'reimbursement' | 'transport' | 'labor' | 'other';
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

export interface DataTemplate {
  id: string;
  name: string;
  recordType: DataRecordType;
  description: string;
  isSystem: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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

export interface ProjectTemplate {
  id: string;
  projectId: string;
  templateId: string;
  customName: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RecordValue {
  id: string;
  recordId: string;
  fieldId: string;
  fieldName: string;
  value: string | number | string[] | null;
}

export interface BusinessRecord {
  id: string;
  projectId: string;
  projectName: string;
  templateId: string;
  templateName: string;
  recordType: DataRecordType;
  recordDate: string;
  amount: number;
  category: string;
  subCategory: string;
  description: string;
  sourceType: 'manual' | 'excel' | 'ocr' | 'work_order';
  sourceId: string;
  status: 'draft' | 'pending_confirm' | 'confirmed' | 'rejected';
  values: RecordValue[];
  attachments: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
}

export interface RawFile {
  id: string;
  fileName: string;
  fileType: 'excel' | 'image' | 'pdf' | 'other';
  storagePath: string;
  uploadedBy: string;
  uploadedAt: string;
  relatedProjectId: string;
  relatedImportTaskId?: string;
  status: 'uploaded' | 'parsed' | 'failed';
}

export interface ImportTask {
  id: string;
  projectId: string;
  projectName: string;
  rawFileId: string;
  fileName: string;
  templateId: string;
  templateName: string;
  importType: 'cost' | 'revenue' | 'transport' | 'labor' | 'other';
  status: 'uploaded' | 'parsed' | 'mapping' | 'pending_confirm' | 'confirmed' | 'failed';
  uploadedBy: string;
  createdAt: string;
  confirmedAt?: string;
}

export interface ImportRow {
  id: string;
  importTaskId: string;
  rowNumber: number;
  rawData: Record<string, string | number>;
  mappedData: Record<string, string | number>;
  status: 'pending' | 'mapped' | 'error' | 'confirmed';
  errorMessage?: string;
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
  mappedFieldId?: string;
  mappedFieldName?: string;
}

export interface OCRTask {
  id: string;
  rawFileId: string;
  projectId: string;
  templateId: string;
  status: 'uploaded' | 'recognizing' | 'pending_confirm' | 'confirmed' | 'failed';
  extractedText: string;
  extractedFields: Record<string, string | number>;
  createdAt: string;
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}
