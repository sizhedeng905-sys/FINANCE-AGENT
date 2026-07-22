import { JSONSchemaType } from 'ajv';

import { IMPORT_TRANSFORM_KEYS, ImportTransformKey } from '../import-tasks/import-transform-registry';

export const AI_REVIEW_DECISION = 'NEEDS_FINANCE_REVIEW' as const;

export const TRANSFORM_KEYS = IMPORT_TRANSFORM_KEYS;

export type TransformKey = ImportTransformKey;

export interface ClassificationSuggestionOutput {
  schemaVersion: 'classification/1.0';
  selectedTemplateVersionId: string | null;
  candidateTemplateVersionIds: string[];
  confidence: string;
  evidenceRefs: string[];
  reasonCodes: string[];
  warnings: string[];
  decision: typeof AI_REVIEW_DECISION;
}

export interface MappingSuggestionOutput {
  schemaVersion: 'mapping/1.0';
  templateVersionId: string;
  mappings: Array<{
    sourceRef: string;
    targetFieldKey: string;
    transformKey: TransformKey;
    confidence: string;
    evidenceRefs: string[];
  }>;
  unmappedSourceRefs: string[];
  unresolvedRequiredFields: string[];
  warnings: string[];
  decision: typeof AI_REVIEW_DECISION;
}

export type ReportClaimType = 'MONEY' | 'COUNT' | 'PERCENT' | 'DATE' | 'TEXT' | 'COMPARISON' | 'WARNING';

export interface ReportNarrativeOutput {
  schemaVersion: 'report-narrative/1.0';
  snapshotId: string;
  title: string;
  summary: string;
  claims: Array<{
    claimId: string;
    claimType: ReportClaimType;
    text: string;
    sourcePath: string;
    value: string;
  }>;
  warningPaths: string[];
  decision: typeof AI_REVIEW_DECISION;
}

export interface TemplateDraftOutput {
  schemaVersion: 'template-draft/1.0';
  proposedName: string;
  recordType: 'cost' | 'revenue' | 'reimbursement' | 'transport' | 'labor' | 'other';
  existingFieldKeys: string[];
  warnings: string[];
  decision: typeof AI_REVIEW_DECISION;
}

export interface MappingAnomalyReviewOutput {
  schemaVersion: 'mapping-anomaly-review/1.0';
  issues: Array<{
    code: string;
    severity: 'BLOCKING' | 'WARNING';
    evidenceRefs: string[];
    explanation: string;
  }>;
  decision: typeof AI_REVIEW_DECISION;
}

export interface UnmappedFieldSuggestionOutput {
  schemaVersion: 'unmapped-field-suggestion/1.0';
  suggestions: Array<{
    sourceRef: string;
    candidateExistingFieldKeys: string[];
    reasonCode: string;
  }>;
  decision: typeof AI_REVIEW_DECISION;
}

export interface ReportFactCheckOutput {
  schemaVersion: 'report-fact-check/1.0';
  snapshotId: string;
  narrativeHash: string;
  issues: Array<{
    claimId: string;
    code: 'VALUE_MISMATCH' | 'SOURCE_MISMATCH' | 'UNGROUNDED_FACT' | 'MISSING_WARNING';
    sourcePath: string;
  }>;
  decision: typeof AI_REVIEW_DECISION;
}

const boundedText = (maxLength: number) => ({
  type: 'string',
  minLength: 1,
  maxLength,
  pattern: '^[^\\u0000-\\u001F\\u007F]*$'
} as const);

const stableReference = {
  type: 'string',
  minLength: 1,
  maxLength: 256,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,255}$'
} as const;

const confidence = {
  type: 'string',
  pattern: '^(?:0(?:\\.[0-9]{1,6})?|1(?:\\.0{1,6})?)$'
} as const;

export const CLASSIFICATION_SUGGESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'selectedTemplateVersionId',
    'candidateTemplateVersionIds',
    'confidence',
    'evidenceRefs',
    'reasonCodes',
    'warnings',
    'decision'
  ],
  properties: {
    schemaVersion: { type: 'string', const: 'classification/1.0' },
    selectedTemplateVersionId: { anyOf: [stableReference, { type: 'null' }] },
    candidateTemplateVersionIds: {
      type: 'array',
      maxItems: 64,
      uniqueItems: true,
      items: stableReference
    },
    confidence,
    evidenceRefs: {
      type: 'array',
      maxItems: 256,
      uniqueItems: true,
      items: stableReference
    },
    reasonCodes: {
      type: 'array',
      maxItems: 64,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Z][A-Z0-9_]*$' }
    },
    warnings: {
      type: 'array',
      maxItems: 100,
      items: boundedText(500)
    },
    decision: { type: 'string', const: AI_REVIEW_DECISION }
  }
} as unknown as JSONSchemaType<ClassificationSuggestionOutput>;

export const MAPPING_SUGGESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'templateVersionId',
    'mappings',
    'unmappedSourceRefs',
    'unresolvedRequiredFields',
    'warnings',
    'decision'
  ],
  properties: {
    schemaVersion: { type: 'string', const: 'mapping/1.0' },
    templateVersionId: stableReference,
    mappings: {
      type: 'array',
      maxItems: 256,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceRef', 'targetFieldKey', 'transformKey', 'confidence', 'evidenceRefs'],
        properties: {
          sourceRef: stableReference,
          targetFieldKey: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            pattern: '^[A-Za-z][A-Za-z0-9_]*$'
          },
          transformKey: { type: 'string', enum: [...TRANSFORM_KEYS] },
          confidence,
          evidenceRefs: {
            type: 'array',
            minItems: 1,
            maxItems: 32,
            uniqueItems: true,
            items: stableReference
          }
        }
      }
    },
    unmappedSourceRefs: {
      type: 'array',
      maxItems: 256,
      uniqueItems: true,
      items: stableReference
    },
    unresolvedRequiredFields: {
      type: 'array',
      maxItems: 128,
      uniqueItems: true,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 128,
        pattern: '^[A-Za-z][A-Za-z0-9_]*$'
      }
    },
    warnings: {
      type: 'array',
      maxItems: 100,
      items: boundedText(500)
    },
    decision: { type: 'string', const: AI_REVIEW_DECISION }
  }
} as unknown as JSONSchemaType<MappingSuggestionOutput>;

const jsonPointer = {
  type: 'string',
  minLength: 1,
  maxLength: 512,
  pattern: '^/(?:[^~/\\u0000-\\u001F\\u007F]|~0|~1)+(?:/(?:[^~/\\u0000-\\u001F\\u007F]|~0|~1)+)*$'
} as const;

export const REPORT_NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'snapshotId', 'title', 'summary', 'claims', 'warningPaths', 'decision'],
  properties: {
    schemaVersion: { type: 'string', const: 'report-narrative/1.0' },
    snapshotId: stableReference,
    title: boundedText(120),
    summary: boundedText(4_000),
    claims: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claimId', 'claimType', 'text', 'sourcePath', 'value'],
        properties: {
          claimId: stableReference,
          claimType: {
            type: 'string',
            enum: ['MONEY', 'COUNT', 'PERCENT', 'DATE', 'TEXT', 'COMPARISON', 'WARNING']
          },
          text: boundedText(1_000),
          sourcePath: jsonPointer,
          value: boundedText(256)
        }
      }
    },
    warningPaths: {
      type: 'array',
      maxItems: 100,
      uniqueItems: true,
      items: jsonPointer
    },
    decision: { type: 'string', const: AI_REVIEW_DECISION }
  }
} as unknown as JSONSchemaType<ReportNarrativeOutput>;

const fieldKey = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z][A-Za-z0-9_]*$'
} as const;

export const TEMPLATE_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'proposedName', 'recordType', 'existingFieldKeys', 'warnings', 'decision'],
  properties: {
    schemaVersion: { type: 'string', const: 'template-draft/1.0' },
    proposedName: boundedText(120),
    recordType: {
      type: 'string',
      enum: ['cost', 'revenue', 'reimbursement', 'transport', 'labor', 'other']
    },
    existingFieldKeys: {
      type: 'array',
      maxItems: 128,
      uniqueItems: true,
      items: fieldKey
    },
    warnings: { type: 'array', maxItems: 100, items: boundedText(500) },
    decision: { type: 'string', const: AI_REVIEW_DECISION }
  }
} as unknown as JSONSchemaType<TemplateDraftOutput>;

export const MAPPING_ANOMALY_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'issues', 'decision'],
  properties: {
    schemaVersion: { type: 'string', const: 'mapping-anomaly-review/1.0' },
    issues: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'severity', 'evidenceRefs', 'explanation'],
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Z][A-Z0-9_]*$' },
          severity: { type: 'string', enum: ['BLOCKING', 'WARNING'] },
          evidenceRefs: {
            type: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: stableReference
          },
          explanation: boundedText(1_000)
        }
      }
    },
    decision: { type: 'string', const: AI_REVIEW_DECISION }
  }
} as unknown as JSONSchemaType<MappingAnomalyReviewOutput>;

export const UNMAPPED_FIELD_SUGGESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'suggestions', 'decision'],
  properties: {
    schemaVersion: { type: 'string', const: 'unmapped-field-suggestion/1.0' },
    suggestions: {
      type: 'array',
      maxItems: 128,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceRef', 'candidateExistingFieldKeys', 'reasonCode'],
        properties: {
          sourceRef: stableReference,
          candidateExistingFieldKeys: {
            type: 'array', maxItems: 16, uniqueItems: true, items: fieldKey
          },
          reasonCode: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Z][A-Z0-9_]*$' }
        }
      }
    },
    decision: { type: 'string', const: AI_REVIEW_DECISION }
  }
} as unknown as JSONSchemaType<UnmappedFieldSuggestionOutput>;

export const REPORT_FACT_CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'snapshotId', 'narrativeHash', 'issues', 'decision'],
  properties: {
    schemaVersion: { type: 'string', const: 'report-fact-check/1.0' },
    snapshotId: stableReference,
    narrativeHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    issues: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claimId', 'code', 'sourcePath'],
        properties: {
          claimId: stableReference,
          code: {
            type: 'string',
            enum: ['VALUE_MISMATCH', 'SOURCE_MISMATCH', 'UNGROUNDED_FACT', 'MISSING_WARNING']
          },
          sourcePath: jsonPointer
        }
      }
    },
    decision: { type: 'string', const: AI_REVIEW_DECISION }
  }
} as unknown as JSONSchemaType<ReportFactCheckOutput>;
