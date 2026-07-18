import { FieldType, SemanticType } from '@prisma/client';

import { OcrBoundingBox } from './ocr-provider';

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
  missing: boolean;
  lowConfidence: boolean;
  corrected: boolean;
  validationError?: string;
}
