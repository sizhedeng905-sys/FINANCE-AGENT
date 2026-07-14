import { Prisma } from '@prisma/client';

import { CanonicalOcrFieldCandidate } from './ocr.types';

export const ocrTaskDetailInclude = {
  rawFile: true,
  project: true,
  template: {
    include: {
      templateFields: {
        include: { field: true },
        orderBy: { displayOrder: 'asc' as const }
      }
    }
  },
  uploader: true,
  confirmer: true,
  generatedRecord: true,
  attempts: { orderBy: { attemptNo: 'desc' as const } },
  corrections: {
    include: { corrector: true, field: true },
    orderBy: { createdAt: 'desc' as const }
  }
} satisfies Prisma.OcrTaskInclude;

export type OcrTaskDetail = Prisma.OcrTaskGetPayload<{ include: typeof ocrTaskDetailInclude }>;

export function toOcrTask(task: OcrTaskDetail) {
  return {
    id: task.id,
    rawFileId: task.rawFileId,
    projectId: task.projectId,
    projectName: task.project.name,
    templateId: task.templateId,
    templateName: task.template.name,
    recordType: task.template.recordType,
    status: task.status,
    provider: task.provider,
    modelName: task.modelName,
    modelVersion: task.modelVersion ?? undefined,
    endpointSnapshot: task.endpointSnapshot ?? undefined,
    extractedText: task.extractedText ?? '',
    extractedFields: objectValue(task.extractedFields),
    fieldConfidence: numberObject(task.fieldConfidence),
    fields: candidateArray(task.fieldCandidates),
    pages: arrayValue(task.pages),
    textBlocks: arrayValue(task.textBlocks),
    tables: arrayValue(task.tables),
    rawResultRef: task.rawResultRef ?? undefined,
    pageCount: task.pageCount,
    avgConfidence: task.avgConfidence?.toNumber(),
    latencyMs: task.latencyMs ?? undefined,
    attemptCount: task.attemptCount,
    retryCount: task.retryCount,
    errorMessage: task.errorMessage ?? undefined,
    uploadedBy: task.uploader.name,
    uploadedById: task.uploadedBy,
    confirmedBy: task.confirmer?.name,
    confirmedAt: task.confirmedAt?.toISOString(),
    generatedRecordId: task.generatedRecordId ?? undefined,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    rawFile: {
      id: task.rawFile.id,
      fileName: task.rawFile.originalFileName,
      fileSize: Number(task.rawFile.fileSize),
      mimeType: task.rawFile.mimeType,
      sha256: task.rawFile.sha256
    },
    attempts: task.attempts.map((attempt) => ({
      id: attempt.id,
      attemptNo: attempt.attemptNo,
      status: attempt.status,
      provider: attempt.provider,
      modelName: attempt.modelName,
      modelVersion: attempt.modelVersion ?? undefined,
      endpointSnapshot: attempt.endpointSnapshot ?? undefined,
      correlationId: attempt.correlationId,
      startedAt: attempt.startedAt?.toISOString(),
      completedAt: attempt.completedAt?.toISOString(),
      latencyMs: attempt.latencyMs ?? undefined,
      pageCount: attempt.pageCount ?? undefined,
      rawResultRef: attempt.rawResultRef ?? undefined,
      errorMessage: attempt.errorMessage ?? undefined
    })),
    corrections: task.corrections.map((correction) => ({
      id: correction.id,
      fieldId: correction.fieldId,
      fieldName: correction.fieldName,
      beforeValue: correction.beforeValue ?? undefined,
      afterValue: correction.afterValue,
      originalConfidence: correction.originalConfidence?.toNumber(),
      reason: correction.reason ?? undefined,
      correctedBy: correction.corrector.name,
      correctedAt: correction.createdAt.toISOString()
    }))
  };
}

function candidateArray(value: Prisma.JsonValue): CanonicalOcrFieldCandidate[] {
  return Array.isArray(value) ? value as unknown as CanonicalOcrFieldCandidate[] : [];
}

function arrayValue(value: Prisma.JsonValue): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberObject(value: Prisma.JsonValue): Record<string, number> {
  return Object.fromEntries(
    Object.entries(objectValue(value)).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  );
}
