import { FieldType, SemanticType } from '@prisma/client';

import { OcrBoundingBox } from './ocr-provider';

export type OcrValueSource = 'OCR_PROVIDER' | 'SYSTEM_FILE_BINDING' | 'MANUAL_OVERRIDE';

export interface CanonicalOcrFieldAlternative {
  page: number;
  rawValue: unknown;
  normalizedValue: unknown;
  confidence: number;
  evidenceRefs: string[];
  boundingBox?: OcrBoundingBox;
}

export interface CanonicalOcrFieldCandidate {
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
  boundingBox?: OcrBoundingBox;
  confidence: number;
  evidence: string;
  evidenceRefs: string[];
  valueSource: OcrValueSource;
  reviewRevision: number;
  evidenceConflict: boolean;
  alternatives: CanonicalOcrFieldAlternative[];
  missing: boolean;
  lowConfidence: boolean;
  corrected: boolean;
  validationError?: string;
}
