import { JSONSchemaType } from 'ajv';

export const AI_REVIEW_DECISION = 'NEEDS_FINANCE_REVIEW' as const;

export const TRANSFORM_KEYS = [
  'IDENTITY_V1',
  'TRIM_TEXT_V1',
  'DECIMAL_CANONICAL_V1',
  'DATE_ISO_WITH_LOCALE_V1',
  'ENUM_ALIAS_LOOKUP_V1',
  'PROJECT_ALIAS_LOOKUP_V1'
] as const;

export type TransformKey = typeof TRANSFORM_KEYS[number];

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
