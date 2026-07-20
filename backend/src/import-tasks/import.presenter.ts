import { Prisma } from '@prisma/client';

export const importTaskDetailInclude = {
  project: true,
  template: true,
  rawFile: true,
  uploader: true,
  confirmer: true,
  sheets: { orderBy: { sheetIndex: 'asc' as const } },
  columns: {
    orderBy: { columnIndex: 'asc' as const },
    include: {
      decision: { include: { targetField: true } },
      suggestion: { include: { mappedField: true } }
    }
  }
} satisfies Prisma.ImportTaskInclude;

export type ImportTaskDetail = Prisma.ImportTaskGetPayload<{ include: typeof importTaskDetailInclude }>;

export function toImportTask(task: ImportTaskDetail) {
  return {
    id: task.id,
    projectId: task.projectId,
    projectName: task.project.name,
    templateId: task.templateId,
    templateName: task.template.name,
    rawFileId: task.rawFileId,
    fileName: task.fileName,
    importType: task.importType,
    status: task.status,
    version: task.version,
    reviewRevision: task.reviewRevision,
    uploadedBy: task.uploader.name,
    uploadedById: task.uploadedBy,
    createdAt: task.createdAt.toISOString(),
    parsedAt: task.parsedAt?.toISOString(),
    confirmedAt: task.confirmedAt?.toISOString(),
    confirmedBy: task.confirmer?.name,
    errorMessage: task.errorMessage ?? undefined,
    validation: task.validationSnapshotHash ? {
      reviewRevision: task.validationRevision,
      ruleVersion: task.validationRuleVersion,
      snapshotHash: task.validationSnapshotHash,
      validatedAt: task.validatedAt?.toISOString(),
      snapshot: objectValue(task.validationSnapshot)
    } : null,
    approval: task.approvalSnapshotHash ? {
      reviewRevision: task.approvalReviewRevision,
      validationSnapshotHash: task.approvalValidationHash,
      policyVersion: task.approvalPolicyVersion,
      snapshotHash: task.approvalSnapshotHash,
      requestKeyHash: task.approvalRequestKeyHash,
      snapshot: objectValue(task.approvalSnapshot)
    } : null,
    evidence: {
      schemaVersion: task.irSchemaVersion ?? undefined,
      parserVersion: task.parserVersion ?? undefined,
      sourceSha256: task.sourceSha256 ?? undefined,
      parserInputSha256: task.parserInputSha256 ?? undefined,
      irHash: task.irHash ?? undefined,
      rowEvidenceDigest: task.rowEvidenceDigest ?? undefined
    },
    mappingProfile: {
      structureFingerprint: task.structureFingerprint ?? undefined,
      fingerprintVersion: task.fingerprintVersion ?? undefined,
      transformRegistryVersion: task.transformRegistryVersion ?? undefined,
      profileId: task.mappingProfileId ?? undefined,
      profileVersion: task.mappingProfileVersion ?? undefined,
      approvalSnapshotHash: task.mappingProfileSnapshotHash ?? undefined
    },
    progress: {
      executionMode: task.executionMode ?? undefined,
      processingMode: task.processingMode ?? undefined,
      processed: task.processedRows,
      total: task.totalRows,
      percent: task.totalRows > 0
        ? Math.min(100, Math.round((task.processedRows / task.totalRows) * 100))
        : 0,
      attempts: task.parseAttempts
    },
    confirmationProgress: {
      processed: task.confirmationProcessedRows,
      total: task.confirmationTotalRows,
      success: task.confirmationSuccessRows,
      errors: task.confirmationErrorRows,
      percent: task.confirmationTotalRows > 0
        ? Math.min(100, Math.round((task.confirmationProcessedRows / task.confirmationTotalRows) * 100))
        : 0,
      attempts: task.confirmationAttempts
    },
    counts: {
      total: task.totalRows,
      valid: task.validRows,
      errors: task.errorRows,
      duplicates: task.duplicateRows,
      ignored: task.ignoredRows,
      imported: task.importedRows
    },
    rawFile: {
      id: task.rawFile.id,
      fileName: task.rawFile.originalFileName,
      fileSize: Number(task.rawFile.fileSize),
      mimeType: task.rawFile.mimeType,
      sha256: task.rawFile.sha256
    },
    sheets: task.sheets.map((sheet) => ({
      id: sheet.id,
      stableId: sheet.stableId ?? undefined,
      name: sheet.sheetName,
      index: sheet.sheetIndex,
      visibility: sheet.visibility ?? undefined,
      headerStartRowIndex: sheet.headerStartRowIndex ?? undefined,
      headerRowIndex: sheet.headerRowIndex,
      selectedHeaderRows: numberArray(sheet.selectedHeaderRows),
      mergedRanges: stringArray(sheet.mergedRanges),
      dateSystem: sheet.dateSystem ?? undefined,
      timezone: sheet.timezone ?? undefined,
      rowCount: sheet.rowCount
    })),
    columns: task.columns.map((column) => ({
      id: column.id,
      columnIndex: column.columnIndex,
      sourceColumnId: column.sourceColumnId ?? undefined,
      columnLetter: column.columnLetter ?? undefined,
      sourceKey: column.sourceKey,
      sourceName: column.sourceName,
      headerParts: stringArray(column.headerParts),
      normalizedName: column.normalizedName,
      sampleValues: stringArray(column.sampleValues),
      inferredType: column.inferredType,
      duplicateName: column.duplicateName,
      statistics: objectValue(column.statistics),
      decision: column.decision ? {
        id: column.decision.id,
        targetFieldId: column.decision.targetFieldId ?? undefined,
        targetFieldName: column.decision.targetField?.fieldName,
        mappingType: column.decision.mappingType,
        confidence: Number(column.decision.confidence),
        ignored: column.decision.ignored
      } : undefined,
      suggestion: column.suggestion ? toFieldSuggestion(column.suggestion) : undefined
    }))
  };
}

export function toImportRow(row: {
  id: string;
  importTaskId: string;
  rowNumber: number;
  rawData: Prisma.JsonValue;
  normalizedData: Prisma.JsonValue | null;
  rowHash: string;
  status: string;
  errors: Prisma.JsonValue;
  warnings: Prisma.JsonValue;
  reviewDecision: string | null;
  reviewReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  generatedRecordId: string | null;
  confirmedAt: Date | null;
}) {
  return {
    id: row.id,
    importTaskId: row.importTaskId,
    rowNumber: row.rowNumber,
    rawData: row.rawData,
    mappedData: row.normalizedData ?? {},
    rowHash: row.rowHash,
    status: row.status,
    errors: stringArray(row.errors),
    warnings: stringArray(row.warnings),
    errorMessage: stringArray(row.errors).join('；') || undefined,
    review: {
      decision: row.reviewDecision ?? undefined,
      reason: row.reviewReason ?? undefined,
      reviewedBy: row.reviewedBy ?? undefined,
      reviewedAt: row.reviewedAt?.toISOString()
    },
    generatedRecordId: row.generatedRecordId ?? undefined,
    confirmedAt: row.confirmedAt?.toISOString()
  };
}

export function toFieldSuggestion(suggestion: {
  id: string;
  projectId: string;
  templateId: string;
  importTaskId: string;
  sourceName: string;
  suggestedFieldName: string;
  suggestedFieldType: string;
  sampleValues: Prisma.JsonValue;
  reason: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: Date | null;
  mappedFieldId: string | null;
  mappedField?: { fieldName: string } | null;
  createdAt: Date;
}) {
  return {
    id: suggestion.id,
    projectId: suggestion.projectId,
    templateId: suggestion.templateId,
    importTaskId: suggestion.importTaskId,
    sourceName: suggestion.sourceName,
    suggestedFieldName: suggestion.suggestedFieldName,
    suggestedFieldType: suggestion.suggestedFieldType,
    sampleValues: stringArray(suggestion.sampleValues),
    reason: suggestion.reason ?? '',
    status: suggestion.status,
    createdAt: suggestion.createdAt.toISOString(),
    approvedBy: suggestion.approvedBy ?? undefined,
    approvedAt: suggestion.approvedAt?.toISOString(),
    mappedFieldId: suggestion.mappedFieldId ?? undefined,
    mappedFieldName: suggestion.mappedField?.fieldName
  };
}

function stringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
    .map((item) => String(item));
}

function numberArray(value: Prisma.JsonValue): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item));
}

function objectValue(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
