import {
  AccountingDirection,
  DataRecordType,
  FieldType,
  Prisma,
  RecordDataLayer
} from '@prisma/client';

import { canonicalJsonSha256 } from '../common/utils/canonical-json';

export const EXCEL_AI_REVIEW_STATE_SCHEMA_VERSION = 'excel-ai-review-state/1.0';
export const EXCEL_AI_MAX_CANDIDATE_TEMPLATES = 64;

export const excelAiCandidateTemplateInclude = {
  templateFields: {
    where: { isVisible: true, field: { isActive: true } },
    include: { field: true },
    orderBy: { displayOrder: 'asc' as const }
  }
} satisfies Prisma.TemplateInclude;

export const excelAiReviewTaskInclude = {
  project: { select: { status: true } },
  rawFile: true,
  mappingProfile: { include: { rules: true } },
  sheets: { orderBy: { sheetIndex: 'asc' as const } },
  columns: {
    orderBy: { columnIndex: 'asc' as const },
    include: { decision: { include: { targetField: true } } }
  }
} satisfies Prisma.ImportTaskInclude;

export type ExcelAiCandidateTemplate = Prisma.TemplateGetPayload<{
  include: typeof excelAiCandidateTemplateInclude;
}>;

export type ExcelAiReviewTask = Prisma.ImportTaskGetPayload<{
  include: typeof excelAiReviewTaskInclude;
}>;

export interface ExcelAiCandidate {
  id: string;
  version: number;
  versionId: string;
  name: string;
  recordType: DataRecordType;
  fields: Array<{
    id: string;
    fieldKey: string;
    fieldName: string;
    fieldType: FieldType;
    required: boolean;
    aliases: string[];
  }>;
  hashInput: {
    templateId: string;
    version: number;
    recordType: DataRecordType;
    accountingDirection: AccountingDirection;
    dataLayer: RecordDataLayer;
    fields: ExcelAiCandidate['fields'];
  };
  contentHash: string;
}

export function toExcelAiCandidate(template: ExcelAiCandidateTemplate): ExcelAiCandidate {
  const fields = template.templateFields.map((item) => ({
    id: item.field.id,
    fieldKey: item.field.fieldKey,
    fieldName: normalizeBoundedText(item.field.fieldName, 80),
    fieldType: item.field.fieldType,
    required: item.isRequired,
    aliases: jsonStringArray(item.field.aliases)
      .slice(0, 16)
      .map((alias) => normalizeBoundedText(alias, 80))
  }));
  const hashInput = {
    templateId: template.id,
    version: template.version,
    recordType: template.recordType,
    accountingDirection: template.accountingDirection,
    dataLayer: template.dataLayer,
    fields
  };
  return {
    id: template.id,
    version: template.version,
    versionId: `${template.id}:v${template.version}`,
    name: normalizeBoundedText(template.name, 80),
    recordType: template.recordType,
    fields,
    hashInput,
    contentHash: canonicalJsonSha256(hashInput)
  };
}

export function buildExcelAiReviewState(task: ExcelAiReviewTask, candidates: ExcelAiCandidate[]) {
  const selectedTemplate = candidates.find(
    (candidate) => candidate.id === task.templateId && candidate.version === task.templateVersion
  );
  return {
    schemaVersion: EXCEL_AI_REVIEW_STATE_SCHEMA_VERSION,
    task: {
      id: task.id,
      projectId: task.projectId,
      templateId: task.templateId,
      templateVersion: task.templateVersion,
      templateSnapshotHash: canonicalJsonSha256(task.templateSnapshot ?? null),
      version: task.version,
      reviewRevision: task.reviewRevision,
      status: task.status,
      sourceSha256: task.sourceSha256,
      parserInputSha256: task.parserInputSha256,
      irSchemaVersion: task.irSchemaVersion,
      parserVersion: task.parserVersion,
      irHash: task.irHash,
      rowEvidenceDigest: task.rowEvidenceDigest,
      parseConfigHash: canonicalJsonSha256(task.parseConfig ?? null),
      structureFingerprint: task.structureFingerprint,
      fingerprintVersion: task.fingerprintVersion,
      transformRegistryVersion: task.transformRegistryVersion,
      mappingProfileId: task.mappingProfileId,
      mappingProfileVersion: task.mappingProfileVersion,
      mappingProfileSnapshotHash: task.mappingProfileSnapshotHash,
      totalRows: task.totalRows
    },
    project: { status: task.project.status },
    rawFile: {
      id: task.rawFile.id,
      sha256: task.rawFile.sha256,
      status: task.rawFile.status,
      scanStatus: task.rawFile.scanStatus,
      isVoided: task.rawFile.isVoided,
      relatedProjectId: task.rawFile.relatedProjectId
    },
    sheets: task.sheets.map((sheet) => ({
      id: sheet.id,
      stableId: sheet.stableId,
      name: sheet.sheetName,
      index: sheet.sheetIndex,
      visibility: sheet.visibility,
      headerStartRowIndex: sheet.headerStartRowIndex,
      headerRowIndex: sheet.headerRowIndex,
      selectedHeaderRows: sheet.selectedHeaderRows,
      mergedRanges: sheet.mergedRanges,
      dateSystem: sheet.dateSystem,
      timezone: sheet.timezone,
      rowCount: sheet.rowCount
    })),
    columns: task.columns.map((column) => ({
      id: column.id,
      sheetId: column.sheetId,
      sourceRef: column.sourceColumnId ?? `column:${column.columnIndex}`,
      columnIndex: column.columnIndex,
      columnLetter: column.columnLetter,
      sourceKey: column.sourceKey,
      sourceName: column.sourceName,
      normalizedName: column.normalizedName,
      inferredType: column.inferredType,
      duplicateName: column.duplicateName,
      headerPartsHash: canonicalJsonSha256(column.headerParts),
      sampleValuesHash: canonicalJsonSha256(column.sampleValues),
      statisticsHash: canonicalJsonSha256(column.statistics),
      mapping: {
        targetFieldId: column.decision?.targetFieldId ?? null,
        ignored: column.decision?.ignored ?? null,
        mappingType: column.decision?.mappingType ?? null,
        updatedAt: column.decision?.updatedAt.toISOString() ?? null
      }
    })),
    sourceRefs: task.columns.map(
      (column) => column.sourceColumnId ?? `column:${column.columnIndex}`
    ),
    selectedTemplate: selectedTemplate
      ? {
          versionId: selectedTemplate.versionId,
          contentHash: selectedTemplate.contentHash,
          fields: selectedTemplate.fields.map((field) => ({
            id: field.id,
            fieldKey: field.fieldKey,
            fieldType: field.fieldType,
            required: field.required
          }))
        }
      : null,
    candidateSetHash: canonicalJsonSha256(candidates.map((candidate) => candidate.hashInput)),
    candidates: candidates.map((candidate) => ({
      versionId: candidate.versionId,
      contentHash: candidate.contentHash
    }))
  };
}

export function excelAiReviewStateHash(task: ExcelAiReviewTask, candidates: ExcelAiCandidate[]) {
  return canonicalJsonSha256(buildExcelAiReviewState(task, candidates));
}

function normalizeBoundedText(value: string, maxLength: number) {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function jsonStringArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
    .map((item) => String(item));
}
