import { FieldType, SemanticType } from '@prisma/client';

export type MockOcrScenario = 'normal' | 'low_confidence' | 'missing_field' | 'failure' | 'failure_once';

export interface OcrDocumentPage {
  page: number;
  width?: number;
  height?: number;
  rotation?: number;
  preprocessing: {
    rotationReserved: true;
    compressionReserved: true;
    scalingReserved: true;
    renderingReserved: boolean;
    version?: string;
    operations?: string[];
    rotationApplied?: number;
  };
}

export interface OcrTemplateField {
  id: string;
  fieldKey: string;
  fieldName: string;
  fieldType: FieldType;
  semanticType: SemanticType;
  aliases: string[];
  isRequired: boolean;
  isVisible: boolean;
}

export interface OcrProviderInput {
  documentId: string;
  rawFileId: string;
  fileName: string;
  mimeType: string;
  sha256: string;
  buffer: Buffer;
  pages: OcrDocumentPage[];
  fields: OcrTemplateField[];
  attemptNo: number;
  scenario?: MockOcrScenario;
}

export interface OcrBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrFieldCandidate {
  targetFieldId?: string;
  targetFieldKey?: string;
  sourceLabel: string;
  rawValue: unknown;
  normalizedValue: unknown;
  page: number;
  boundingBox?: OcrBoundingBox;
  confidence: number;
  evidence: string;
}

export interface OcrProviderResult {
  documentId: string;
  extractedText: string;
  pages: OcrDocumentPage[];
  textBlocks: Array<Record<string, unknown>>;
  tables: Array<Record<string, unknown>>;
  fieldCandidates: OcrFieldCandidate[];
  rawResult: Record<string, unknown>;
  rawResultRef?: string;
}

export interface OcrProviderSnapshot {
  provider: string;
  modelName: string;
  modelVersion?: string;
  endpoint?: string;
  secretRef?: string;
  timeoutMs: number;
  maxConcurrency: number;
  configSummary: Record<string, unknown>;
  configHash?: string;
}

export interface OcrProviderExecutionConfig extends OcrProviderSnapshot {
  secret?: string;
}

export interface OcrProvider {
  readonly name: string;
  snapshot(): OcrProviderSnapshot;
  recognize(input: OcrProviderInput, config?: OcrProviderExecutionConfig): Promise<OcrProviderResult>;
}
