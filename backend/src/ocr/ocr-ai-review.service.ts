import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  AiTaskStatus,
  FieldDefinition,
  FieldType,
  ImportAiReviewDecisionType,
  OcrTaskStatus,
  Prisma
} from '@prisma/client';

import { buildAiReviewBasis } from '../ai/ai-review-basis';
import { AiSuggestionValidatorService } from '../ai/ai-suggestion-validator.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import {
  isRegisteredImportTransformKey,
  transformKeyForFieldType
} from '../import-tasks/import-transform-registry';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryOcrAiReviewDecisionsDto } from './dto/query-ocr-ai-review-decisions.dto';
import {
  OcrAiFieldReviewDto,
  ReviewOcrAiSuggestionsDto
} from './dto/review-ocr-ai-suggestions.dto';
import {
  OCR_AI_REVIEW_STATE_SCHEMA_VERSION,
  OcrAiSuggestionService,
  OcrSourceUnit
} from './ocr-ai-suggestion.service';
import { normalizeOcrFieldValue } from './ocr-field-value';
import { CanonicalOcrFieldCandidate } from './ocr.types';

interface VerifiedSuggestion {
  sourceRef: string;
  targetFieldKey: string;
  transformKey: string;
  confidence: string;
  evidenceRefs: string[];
}

interface ReviewOutcome {
  review: OcrAiFieldReviewDto;
  source: OcrSourceUnit;
  sourceCandidate: CanonicalOcrFieldCandidate;
  suggestion?: VerifiedSuggestion;
  finalTargetFieldId: string | null;
  finalValue: string | string[] | null;
  finalEvidenceRefs: string[];
}

type ReviewReader = Prisma.TransactionClient | PrismaService;

export const OCR_AI_REVIEW_DIGEST_SCHEMA_VERSION = 'ocr-ai-review-digest/1.0';

@Injectable()
export class OcrAiReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly suggestions: OcrAiSuggestionService,
    private readonly validator: AiSuggestionValidatorService,
    private readonly auditLogs: AuditLogsService,
    private readonly ledgerEvents: LedgerEventsService
  ) {}

  async review(
    taskId: string,
    dto: ReviewOcrAiSuggestionsDto,
    actor: CurrentUser,
    context: RequestContext
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ocr_tasks" WHERE "id" = ${taskId} FOR UPDATE`;
      const current = await this.suggestions.currentReviewContext(tx, taskId);
      const { task } = current;
      if (current.blockedReason || task.status !== OcrTaskStatus.pending_confirm) {
        throw new ConflictException(current.blockedReason ?? 'OCR task is not awaiting finance review');
      }
      if (dto.expectedVersion !== task.version || dto.expectedReviewRevision !== task.reviewRevision) {
        throw new ConflictException('OCR review state changed; refresh before saving AI decisions');
      }
      const prepared = current.prepared;
      if ('reasonCode' in prepared) {
        throw new ConflictException(prepared.message);
      }
      if (dto.reviewStateHash !== current.stateHash) {
        throw new ConflictException('OCR AI review state changed after suggestion generation');
      }

      const latest = await tx.aiTask.findFirst({
        where: {
          resourceType: 'ocr_task',
          resourceId: taskId,
          taskType: 'ocr_field_mapping'
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      });
      if (!latest || latest.id !== dto.aiTaskId || latest.status !== AiTaskStatus.succeeded) {
        throw new ConflictException('OCR AI mapping is stale or is not the latest successful result');
      }
      if (
        !latest.outputHash
        || !latest.versionVectorHash
        || latest.outputHash !== dto.outputHash
        || latest.versionVectorHash !== dto.versionVectorHash
      ) {
        throw new ConflictException('OCR AI mapping hashes do not match the persisted execution');
      }
      if (await tx.ocrAiReviewDecision.count({ where: { aiTaskId: latest.id } })) {
        throw new ConflictException('This OCR AI mapping has already been reviewed');
      }

      const versionVector = this.object(latest.versionVector);
      if (
        !versionVector
        || canonicalJsonSha256(versionVector) !== latest.versionVectorHash
        || versionVector.inputSha256 !== latest.inputHash
        || versionVector.reviewStateSha256 !== current.stateHash
      ) {
        throw this.provenanceConflict('OCR AI version vector does not match the current review state');
      }
      const outputContainer = this.outputContainer(latest.outputPayload);
      const storedOutput = this.object(outputContainer.validatedOutput);
      if (!storedOutput || canonicalJsonSha256(storedOutput) !== latest.outputHash) {
        throw this.provenanceConflict('OCR AI output content does not match its persisted hash');
      }
      const expectedReviewBasis = buildAiReviewBasis({
        taskType: latest.taskType,
        resourceType: latest.resourceType!,
        resourceId: latest.resourceId!,
        aiTaskId: latest.id,
        reviewState: {
          schemaVersion: OCR_AI_REVIEW_STATE_SCHEMA_VERSION,
          stateHash: current.stateHash
        },
        inputHash: latest.inputHash,
        outputHash: latest.outputHash,
        versionVectorHash: latest.versionVectorHash
      });
      const persistedReviewBasis = this.object(outputContainer.reviewBasis);
      if (
        dto.reviewBasisHash !== expectedReviewBasis.basisHash
        || !persistedReviewBasis
        || canonicalJsonSha256(persistedReviewBasis) !== canonicalJsonSha256(expectedReviewBasis)
      ) {
        throw this.provenanceConflict('OCR AI review basis is stale or has been altered');
      }

      const expectedTemplateVersionId = `${task.templateId}:v${task.templateVersion}`;
      const selected = current.candidates.find((candidate) => candidate.versionId === expectedTemplateVersionId);
      if (!selected) throw new ConflictException('The OCR task template is no longer in the active project allowlist');
      const sourceRefs = new Set(prepared.sourceUnits.map((unit) => unit.sourceRef));
      const fieldKeys = new Set(selected.fields.map((field) => field.fieldKey));
      const requiredFieldKeys = new Set(
        selected.fields.filter((field) => field.required).map((field) => field.fieldKey)
      );
      const transformKeysByField = new Map(
        selected.fields.map((field) => [field.fieldKey, new Set([transformKeyForFieldType(field.fieldType)])])
      );
      const evidenceRefsBySource = new Map(
        prepared.sourceUnits.map((unit) => [unit.sourceRef, new Set(unit.evidenceRefs)])
      );
      const blockedSourceRefs = new Set(
        prepared.sourceUnits.filter((unit) => unit.conflict).map((unit) => unit.sourceRef)
      );
      let output;
      try {
        output = this.validator.mapping(JSON.stringify(storedOutput), {
          templateVersionIds: new Set([expectedTemplateVersionId]),
          evidenceRefs: prepared.evidenceRefs,
          sourceRefs,
          fieldKeys,
          requiredFieldKeys,
          transformKeysByField,
          evidenceRefsBySource,
          blockedSourceRefs
        });
      } catch {
        throw this.provenanceConflict('Persisted OCR AI output no longer satisfies the strict mapping contract');
      }

      const suggestions = output.mappings as VerifiedSuggestion[];
      const suggestionBySource = new Map(suggestions.map((suggestion) => [suggestion.sourceRef, suggestion]));
      const unmapped = new Set(output.unmappedSourceRefs);
      const coveredByAi = new Set([...suggestionBySource.keys(), ...unmapped]);
      if (
        suggestionBySource.size !== suggestions.length
        || coveredByAi.size !== sourceRefs.size
        || [...sourceRefs].some((sourceRef) => !coveredByAi.has(sourceRef))
        || [...coveredByAi].some((sourceRef) => !sourceRefs.has(sourceRef))
        || [...suggestionBySource.keys()].some((sourceRef) => unmapped.has(sourceRef))
      ) {
        throw this.provenanceConflict('OCR AI output does not cover the complete current evidence set');
      }

      const submittedRefs = dto.reviews.map((review) => review.sourceRef);
      const submittedRefSet = new Set(submittedRefs);
      const missingRefs = [...sourceRefs].filter((sourceRef) => !submittedRefSet.has(sourceRef));
      const unexpectedRefs = [...submittedRefSet].filter((sourceRef) => !sourceRefs.has(sourceRef));
      if (
        submittedRefSet.size !== submittedRefs.length
        || submittedRefSet.size !== sourceRefs.size
        || missingRefs.length > 0
        || unexpectedRefs.length > 0
      ) {
        throw new BadRequestException({
          message: 'OCR AI review must process every current evidence source exactly once',
          data: {
            reason: 'OCR_AI_REVIEW_BATCH_INCOMPLETE',
            total: sourceRefs.size,
            submitted: submittedRefs.length,
            missing: missingRefs.length,
            unexpected: unexpectedRefs.length,
            duplicate: submittedRefs.length - submittedRefSet.size
          }
        });
      }

      const fieldDefinitions = await tx.fieldDefinition.findMany({
        where: { id: { in: selected.fields.map((field) => field.id) }, isActive: true }
      });
      const fieldById = new Map(fieldDefinitions.map((field) => [field.id, field]));
      const fieldByKey = new Map(fieldDefinitions.map((field) => [field.fieldKey, field]));
      const storedCandidates = this.candidateArray(task.fieldCandidates);
      const candidateByFieldId = new Map(storedCandidates.map((candidate) => [candidate.fieldId, candidate]));
      const sourceByRef = new Map(prepared.sourceUnits.map((source) => [source.sourceRef, source]));
      const outcomes = dto.reviews.map((review) => this.reviewOutcome({
        review,
        source: sourceByRef.get(review.sourceRef)!,
        suggestion: suggestionBySource.get(review.sourceRef),
        candidateByFieldId,
        fieldById,
        fieldByKey,
        allEvidenceRefs: prepared.allEvidenceRefs,
        rawFileId: task.rawFileId
      }));
      const targetIds = outcomes
        .map((outcome) => outcome.finalTargetFieldId)
        .filter((fieldId): fieldId is string => fieldId !== null);
      if (new Set(targetIds).size !== targetIds.length) {
        throw new BadRequestException('OCR AI review cannot assign multiple sources to the same final field');
      }

      const nextReviewRevision = task.reviewRevision + 1;
      const nextCandidates = structuredClone(storedCandidates);
      this.applyOutcomes(nextCandidates, outcomes, fieldById, nextReviewRevision);
      const decisions = outcomes.map((outcome) => {
        const suggestedField = outcome.suggestion
          ? fieldByKey.get(outcome.suggestion.targetFieldKey)
          : undefined;
        return {
          ocrTaskId: taskId,
          sourceFieldId: outcome.sourceCandidate.fieldId,
          aiTaskId: latest.id,
          outputHash: latest.outputHash!,
          versionVectorHash: latest.versionVectorHash!,
          reviewStateHash: current.stateHash,
          reviewBasisHash: expectedReviewBasis.basisHash,
          sourceRef: outcome.review.sourceRef,
          templateVersionId: expectedTemplateVersionId,
          rawOcrValue: this.requiredJson(outcome.sourceCandidate.rawValue),
          rawEvidenceRefs: this.inputJson(outcome.sourceCandidate.evidenceRefs),
          suggestedTargetFieldId: suggestedField?.id ?? null,
          suggestedTargetFieldKey: outcome.suggestion?.targetFieldKey ?? null,
          suggestedTransformKey: outcome.suggestion?.transformKey ?? null,
          suggestedConfidence: outcome.suggestion?.confidence ?? null,
          suggestedValue: outcome.suggestion
            ? this.requiredJson(outcome.sourceCandidate.normalizedValue)
            : Prisma.DbNull,
          suggestedEvidenceRefs: this.inputJson(outcome.suggestion?.evidenceRefs ?? []),
          finalTargetFieldId: outcome.finalTargetFieldId,
          finalValue: outcome.finalValue === null
            ? Prisma.DbNull
            : this.requiredJson(outcome.finalValue),
          finalEvidenceRefs: this.inputJson(outcome.finalEvidenceRefs),
          decision: outcome.review.decision as ImportAiReviewDecisionType,
          reason: outcome.review.reason,
          reviewRevision: nextReviewRevision,
          actorId: actor.id
        } satisfies Prisma.OcrAiReviewDecisionCreateManyInput;
      });
      await tx.ocrAiReviewDecision.createMany({ data: decisions });
      await tx.ocrCorrection.createMany({
        data: outcomes.map((outcome) => {
          const fieldId = outcome.finalTargetFieldId ?? outcome.sourceCandidate.fieldId;
          const field = fieldById.get(fieldId)!;
          const before = candidateByFieldId.get(fieldId);
          return {
            ocrTaskId: taskId,
            fieldId,
            fieldName: field.fieldName,
            beforeValue: this.displayValue(before?.normalizedValue),
            afterValue: this.displayValue(outcome.finalValue),
            originalConfidence: before ? new Prisma.Decimal(before.confidence) : null,
            reason: outcome.review.reason,
            reviewRevision: nextReviewRevision,
            overrideType: `AI_${outcome.review.decision.toUpperCase()}`,
            evidenceRefs: this.inputJson(outcome.finalEvidenceRefs),
            correctedBy: actor.id
          };
        })
      });
      const updated = await tx.ocrTask.updateMany({
        where: {
          id: taskId,
          status: OcrTaskStatus.pending_confirm,
          version: dto.expectedVersion,
          reviewRevision: dto.expectedReviewRevision
        },
        data: {
          fieldCandidates: this.inputJson(nextCandidates),
          extractedFields: this.inputJson(this.extractedFields(nextCandidates)),
          fieldConfidence: this.inputJson(this.fieldConfidence(nextCandidates)),
          avgConfidence: new Prisma.Decimal(this.averageConfidence(nextCandidates)),
          reviewRevision: nextReviewRevision,
          validationRevision: null,
          validationSnapshot: Prisma.DbNull,
          validationSnapshotHash: null,
          validationRuleVersion: null,
          validatedAt: null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) {
        throw new ConflictException('OCR AI review lost an optimistic concurrency race');
      }

      const summary = this.summary(outcomes.map((outcome) => outcome.review.decision));
      await this.auditLogs.write(tx, actor, 'ocr_task.ai_review', 'ocr_task', taskId, {
        aiTaskId: latest.id,
        outputHash: latest.outputHash,
        versionVectorHash: latest.versionVectorHash,
        reviewStateHash: current.stateHash,
        reviewBasisHash: expectedReviewBasis.basisHash,
        reviewRevision: nextReviewRevision,
        summary,
        invalidatedValidationSnapshotHash: task.validationSnapshotHash
      }, context);
      await this.ledgerEvents.write(tx, actor, 'ocr_ai_reviewed', 'ocr_task', taskId, {
        aiTaskId: latest.id,
        reviewRevision: nextReviewRevision,
        reviewBasisHash: expectedReviewBasis.basisHash,
        summary
      });
      return {
        taskId,
        version: task.version + 1,
        reviewRevision: nextReviewRevision,
        decisionCount: outcomes.length,
        summary,
        aiTaskId: latest.id,
        outputHash: latest.outputHash,
        versionVectorHash: latest.versionVectorHash,
        reviewStateHash: current.stateHash,
        reviewBasisHash: expectedReviewBasis.basisHash,
        businessRecordsCreated: 0 as const
      };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (this.isConcurrentWriteConflict(error)) {
        throw new ConflictException({
          message: 'OCR AI review changed concurrently; refresh before retrying',
          data: {
            reason: 'OCR_AI_REVIEW_CONCURRENT_CHANGE',
            retryable: true
          }
        });
      }
      throw error;
    }
  }

  async findMany(taskId: string, query: QueryOcrAiReviewDecisionsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.ocrTask.findUnique({
        where: { id: taskId },
        select: { id: true, reviewRevision: true }
      });
      if (!task) throw new NotFoundException('OCR task does not exist');
      const where = {
        ocrTaskId: taskId,
        ...(query.reviewRevision ? { reviewRevision: query.reviewRevision } : {})
      };
      const [items, total, grouped, digest] = await Promise.all([
        tx.ocrAiReviewDecision.findMany({
          where,
          include: { actor: { select: { id: true, username: true, name: true } } },
          orderBy: [{ reviewRevision: 'desc' }, { sourceRef: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize
        }),
        tx.ocrAiReviewDecision.count({ where }),
        tx.ocrAiReviewDecision.groupBy({
          by: ['decision'],
          where,
          orderBy: { decision: 'asc' },
          _count: { _all: true }
        }),
        this.canonicalDigest(tx, taskId, task.reviewRevision)
      ]);
      return {
        items: items.map((item) => ({
          id: item.id,
          ocrTaskId: item.ocrTaskId,
          sourceFieldId: item.sourceFieldId,
          aiTaskId: item.aiTaskId,
          outputHash: item.outputHash,
          versionVectorHash: item.versionVectorHash,
          reviewStateHash: item.reviewStateHash,
          reviewBasisHash: item.reviewBasisHash,
          sourceRef: item.sourceRef,
          templateVersionId: item.templateVersionId,
          raw: { value: item.rawOcrValue, evidenceRefs: item.rawEvidenceRefs },
          suggested: {
            targetFieldId: item.suggestedTargetFieldId,
            targetFieldKey: item.suggestedTargetFieldKey,
            transformKey: item.suggestedTransformKey,
            confidence: item.suggestedConfidence,
            value: item.suggestedValue,
            evidenceRefs: item.suggestedEvidenceRefs
          },
          final: {
            targetFieldId: item.finalTargetFieldId,
            value: item.finalValue,
            evidenceRefs: item.finalEvidenceRefs
          },
          decision: item.decision,
          reason: item.reason,
          reviewRevision: item.reviewRevision,
          actor: item.actor,
          createdAt: item.createdAt.toISOString()
        })),
        page,
        pageSize,
        total,
        summary: this.summaryFromGroups(total, grouped.map((group) => ({
          decision: group.decision,
          count: typeof group._count === 'object' ? group._count._all ?? 0 : 0
        }))),
        digest
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async canonicalDigest(reader: ReviewReader, taskId: string, taskReviewRevision: number) {
    const decisions = await reader.ocrAiReviewDecision.findMany({
      where: { ocrTaskId: taskId },
      include: { aiTask: true },
      orderBy: [{ reviewRevision: 'asc' }, { sourceRef: 'asc' }, { id: 'asc' }]
    });
    const batchByTaskId = new Map<string, ReturnType<OcrAiReviewService['aiBatchFact']>>();
    const decisionFacts = decisions.map((item) => {
      const batch = this.aiBatchFact(item);
      const existing = batchByTaskId.get(item.aiTaskId);
      if (existing && canonicalJsonSha256(existing) !== canonicalJsonSha256(batch)) {
        throw this.provenanceConflict('OCR AI review provenance is inconsistent within one AI task');
      }
      batchByTaskId.set(item.aiTaskId, batch);
      return {
        id: item.id,
        sourceFieldId: item.sourceFieldId,
        aiTaskId: item.aiTaskId,
        outputHash: item.outputHash,
        versionVectorHash: item.versionVectorHash,
        reviewStateHash: item.reviewStateHash,
        reviewBasisHash: item.reviewBasisHash,
        sourceRef: item.sourceRef,
        templateVersionId: item.templateVersionId,
        raw: {
          value: item.rawOcrValue,
          evidenceRefs: this.strictStringArray(item.rawEvidenceRefs, 'Raw OCR evidence references are invalid')
        },
        suggested: {
          targetFieldId: item.suggestedTargetFieldId,
          targetFieldKey: item.suggestedTargetFieldKey,
          transformKey: item.suggestedTransformKey,
          confidence: item.suggestedConfidence,
          value: item.suggestedValue,
          evidenceRefs: this.strictStringArray(
            item.suggestedEvidenceRefs,
            'Suggested OCR evidence references are invalid'
          )
        },
        final: {
          targetFieldId: item.finalTargetFieldId,
          value: item.finalValue,
          evidenceRefs: this.strictStringArray(item.finalEvidenceRefs, 'Final OCR evidence references are invalid')
        },
        decision: item.decision,
        reason: item.reason,
        reviewRevision: item.reviewRevision,
        actorId: item.actorId,
        reviewedAt: item.createdAt.toISOString()
      };
    });
    const batches = [...batchByTaskId.values()].sort((left, right) => left.aiTaskId.localeCompare(right.aiTaskId));
    const summary = this.summary(decisions.map((item) => item.decision));
    const core = {
      schemaVersion: OCR_AI_REVIEW_DIGEST_SCHEMA_VERSION,
      taskId,
      taskReviewRevision,
      mode: decisions.length > 0 ? 'ai_reviewed' as const : 'manual' as const,
      decisionCount: decisions.length,
      summary,
      batches,
      decisions: decisionFacts
    };
    return {
      schemaVersion: core.schemaVersion,
      mode: core.mode,
      taskReviewRevision,
      decisionCount: core.decisionCount,
      summary,
      aiTaskIds: batches.map((batch) => batch.aiTaskId),
      batches,
      digestHash: canonicalJsonSha256(core)
    };
  }

  private reviewOutcome(args: {
    review: OcrAiFieldReviewDto;
    source: OcrSourceUnit;
    suggestion?: VerifiedSuggestion;
    candidateByFieldId: Map<string, CanonicalOcrFieldCandidate>;
    fieldById: Map<string, FieldDefinition>;
    fieldByKey: Map<string, FieldDefinition>;
    allEvidenceRefs: Set<string>;
    rawFileId: string;
  }): ReviewOutcome {
    const { review, source, suggestion, candidateByFieldId, fieldById, fieldByKey } = args;
    const sourceCandidate = candidateByFieldId.get(source.sourceRef.slice('candidate:'.length));
    if (!sourceCandidate || sourceCandidate.fieldId !== source.sourceRef.slice('candidate:'.length)) {
      throw new ConflictException('OCR AI review source no longer matches the task candidate');
    }
    const hasFinalValue = Object.prototype.hasOwnProperty.call(review, 'finalValue');
    const rejectClientFinal = () => {
      if (review.finalTargetFieldId !== undefined || hasFinalValue) {
        throw new BadRequestException(`${review.decision} decisions cannot submit a client-selected final target or value`);
      }
    };
    let finalTargetFieldId: string | null;
    let finalValue: string | string[] | null;
    let finalEvidenceRefs: string[];

    if (review.decision === 'accept') {
      if (!suggestion) throw new BadRequestException('An unmapped OCR source cannot be accepted');
      const suggestedField = fieldByKey.get(suggestion.targetFieldKey);
      if (!suggestedField || suggestedField.fieldType === FieldType.file) {
        throw new ConflictException('OCR AI suggested a field outside the writable non-file template allowlist');
      }
      if (review.finalTargetFieldId && review.finalTargetFieldId !== suggestedField.id) {
        throw new BadRequestException('An accept decision must use the AI-suggested target field');
      }
      finalValue = normalizeOcrFieldValue(suggestedField, sourceCandidate.normalizedValue, args.rawFileId);
      if (hasFinalValue) {
        const submitted = normalizeOcrFieldValue(suggestedField, review.finalValue, args.rawFileId);
        if (canonicalJsonSha256(submitted) !== canonicalJsonSha256(finalValue)) {
          throw new BadRequestException('An accept decision cannot alter the AI-suggested value');
        }
      }
      finalTargetFieldId = suggestedField.id;
      finalEvidenceRefs = [...suggestion.evidenceRefs];
    } else if (review.decision === 'edit') {
      if (!review.finalTargetFieldId || !hasFinalValue) {
        throw new BadRequestException('An edit decision requires a final target field and value');
      }
      const finalField = fieldById.get(review.finalTargetFieldId);
      if (!finalField || finalField.fieldType === FieldType.file) {
        throw new BadRequestException('The edited final field is outside the writable non-file template allowlist');
      }
      finalTargetFieldId = finalField.id;
      finalValue = normalizeOcrFieldValue(finalField, review.finalValue, args.rawFileId);
      finalEvidenceRefs = review.evidenceRefs?.length
        ? [...review.evidenceRefs]
        : [...sourceCandidate.evidenceRefs];
      if (suggestion) {
        const suggestedField = fieldByKey.get(suggestion.targetFieldKey);
        const suggestedValue = suggestedField
          ? normalizeOcrFieldValue(suggestedField, sourceCandidate.normalizedValue, args.rawFileId)
          : null;
        if (
          suggestedField?.id === finalTargetFieldId
          && canonicalJsonSha256(suggestedValue) === canonicalJsonSha256(finalValue)
          && canonicalJsonSha256(suggestion.evidenceRefs) === canonicalJsonSha256(finalEvidenceRefs)
        ) {
          throw new BadRequestException('An unchanged AI suggestion must use the accept decision');
        }
      }
    } else if (review.decision === 'reject') {
      if (!suggestion) throw new BadRequestException('There is no AI mapping to reject for this source');
      rejectClientFinal();
      const sourceField = fieldById.get(sourceCandidate.fieldId);
      if (!sourceField || sourceField.fieldType === FieldType.file) {
        throw new ConflictException('The original OCR target is outside the writable template allowlist');
      }
      finalTargetFieldId = sourceField.id;
      finalValue = normalizeOcrFieldValue(sourceField, sourceCandidate.normalizedValue, args.rawFileId);
      finalEvidenceRefs = [...sourceCandidate.evidenceRefs];
    } else {
      rejectClientFinal();
      finalTargetFieldId = null;
      finalValue = null;
      finalEvidenceRefs = [...sourceCandidate.evidenceRefs];
    }
    if (
      finalEvidenceRefs.length === 0
      || finalEvidenceRefs.some((evidenceRef) => !args.allEvidenceRefs.has(evidenceRef))
    ) {
      throw new BadRequestException('Every OCR AI review outcome must retain evidence from the current source IR');
    }
    if (suggestion && !isRegisteredImportTransformKey(suggestion.transformKey)) {
      throw this.provenanceConflict('OCR AI mapping references an unregistered transform');
    }
    return {
      review,
      source,
      sourceCandidate,
      suggestion,
      finalTargetFieldId,
      finalValue,
      finalEvidenceRefs
    };
  }

  private applyOutcomes(
    candidates: CanonicalOcrFieldCandidate[],
    outcomes: ReviewOutcome[],
    fieldById: Map<string, FieldDefinition>,
    reviewRevision: number
  ) {
    const candidateById = new Map(candidates.map((candidate) => [candidate.fieldId, candidate]));
    const finalTargetIds = new Set(
      outcomes.map((outcome) => outcome.finalTargetFieldId).filter((id): id is string => id !== null)
    );
    for (const outcome of outcomes) {
      if (finalTargetIds.has(outcome.sourceCandidate.fieldId)) continue;
      const source = candidateById.get(outcome.sourceCandidate.fieldId)!;
      Object.assign(source, {
        normalizedValue: null,
        evidence: outcome.review.reason,
        evidenceRefs: outcome.finalEvidenceRefs,
        valueSource: 'MANUAL_OVERRIDE',
        reviewRevision,
        evidenceConflict: false,
        alternatives: [],
        missing: true,
        lowConfidence: false,
        corrected: true,
        validationError: undefined
      });
    }
    for (const outcome of outcomes) {
      if (!outcome.finalTargetFieldId || outcome.finalValue === null) continue;
      const target = candidateById.get(outcome.finalTargetFieldId);
      const field = fieldById.get(outcome.finalTargetFieldId);
      if (!target || !field) throw new ConflictException('The final OCR review target candidate no longer exists');
      Object.assign(target, {
        normalizedValue: outcome.finalValue,
        confidence: 1,
        evidence: outcome.review.reason,
        evidenceRefs: outcome.finalEvidenceRefs,
        valueSource: 'MANUAL_OVERRIDE',
        reviewRevision,
        evidenceConflict: false,
        alternatives: [],
        missing: false,
        lowConfidence: false,
        corrected: true,
        validationError: undefined
      });
    }
  }

  private summary(decisions: Array<typeof ReviewOcrAiSuggestionsDto.prototype.reviews[number]['decision']>) {
    const result = { total: decisions.length, accept: 0, edit: 0, reject: 0, ignore: 0, pending: decisions.length };
    for (const decision of decisions) {
      result[decision] += 1;
      result.pending -= 1;
    }
    return result;
  }

  private summaryFromGroups(
    total: number,
    groups: Array<{ decision: ImportAiReviewDecisionType; count: number }>
  ) {
    const result = { total, accept: 0, edit: 0, reject: 0, ignore: 0, pending: total };
    for (const group of groups) {
      result[group.decision] = group.count;
      result.pending -= group.count;
    }
    return result;
  }

  private aiBatchFact(item: Prisma.OcrAiReviewDecisionGetPayload<{ include: { aiTask: true } }>) {
    const task = item.aiTask;
    if (
      task.status !== AiTaskStatus.succeeded
      || task.outputHash !== item.outputHash
      || task.versionVectorHash !== item.versionVectorHash
    ) {
      throw this.provenanceConflict('OCR AI review references a changed AI task status or hash');
    }
    const versionVector = this.object(task.versionVector);
    if (!versionVector || canonicalJsonSha256(versionVector) !== item.versionVectorHash) {
      throw this.provenanceConflict('OCR AI review version vector does not match its persisted hash');
    }
    const outputContainer = this.outputContainer(task.outputPayload);
    const output = this.object(outputContainer.validatedOutput);
    if (!output || canonicalJsonSha256(output) !== item.outputHash) {
      throw this.provenanceConflict('OCR AI review output does not match its persisted hash');
    }
    const reviewBasis = this.object(outputContainer.reviewBasis);
    const reviewBasisHash = reviewBasis?.basisHash;
    const reviewBasisCore = reviewBasis
      ? Object.fromEntries(Object.entries(reviewBasis).filter(([key]) => key !== 'basisHash'))
      : undefined;
    const reviewState = this.object(reviewBasis?.reviewState);
    if (
      !reviewBasisCore
      || reviewBasisHash !== item.reviewBasisHash
      || canonicalJsonSha256(reviewBasisCore) !== item.reviewBasisHash
      || reviewBasis?.taskType !== task.taskType
      || reviewBasis.resourceType !== task.resourceType
      || reviewBasis.resourceId !== task.resourceId
      || reviewBasis.aiTaskId !== task.id
      || reviewBasis.inputHash !== task.inputHash
      || reviewBasis.outputHash !== item.outputHash
      || reviewBasis.versionVectorHash !== item.versionVectorHash
      || reviewState?.stateHash !== item.reviewStateHash
    ) {
      throw this.provenanceConflict('OCR AI review basis does not match its persisted hash');
    }
    const provider = this.object(versionVector.provider);
    const prompt = this.object(versionVector.prompt);
    const contracts = this.object(versionVector.contracts);
    if (
      !provider
      || !prompt
      || !contracts
      || !['mock', 'local', 'external'].includes(String(provider.providerClass))
      || typeof provider.provider !== 'string'
      || typeof provider.modelName !== 'string'
      || versionVector.inputSha256 !== task.inputHash
      || versionVector.reviewStateSha256 !== item.reviewStateHash
      || typeof prompt.promptKey !== 'string'
      || !Number.isInteger(prompt.versionNo)
      || typeof contracts.inputSchemaVersion !== 'string'
      || typeof contracts.outputSchemaVersion !== 'string'
    ) {
      throw this.provenanceConflict('OCR AI review version vector lacks Provider, Prompt, or Schema facts');
    }
    return {
      aiTaskId: task.id,
      inputHash: task.inputHash,
      outputHash: item.outputHash,
      versionVectorHash: item.versionVectorHash,
      reviewStateHash: item.reviewStateHash,
      reviewBasisHash: item.reviewBasisHash,
      provider: {
        providerClass: String(provider.providerClass),
        provider: provider.provider,
        modelName: provider.modelName,
        modelRevision: typeof provider.modelRevision === 'string' ? provider.modelRevision : null
      },
      prompt: {
        promptKey: prompt.promptKey,
        versionNo: Number(prompt.versionNo),
        contentSha256: typeof prompt.contentSha256 === 'string' ? prompt.contentSha256 : null
      },
      contracts: {
        inputSchemaVersion: contracts.inputSchemaVersion,
        outputSchemaVersion: contracts.outputSchemaVersion
      },
      warnings: Array.isArray(output.warnings)
        ? this.strictStringArray(output.warnings, 'OCR AI mapping warnings are invalid')
        : [],
      generatedAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null
    };
  }

  private strictStringArray(value: Prisma.JsonValue, message: string) {
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
      throw this.provenanceConflict(message);
    }
    return value;
  }

  private candidateArray(value: Prisma.JsonValue): CanonicalOcrFieldCandidate[] {
    return Array.isArray(value) ? value as unknown as CanonicalOcrFieldCandidate[] : [];
  }

  private extractedFields(candidates: CanonicalOcrFieldCandidate[]) {
    return Object.fromEntries(candidates.map((candidate) => [candidate.fieldId, candidate.normalizedValue]));
  }

  private fieldConfidence(candidates: CanonicalOcrFieldCandidate[]) {
    return Object.fromEntries(candidates.map((candidate) => [candidate.fieldId, candidate.confidence]));
  }

  private averageConfidence(candidates: CanonicalOcrFieldCandidate[]) {
    const recognized = candidates.filter((candidate) => !candidate.missing);
    if (recognized.length === 0) return 0;
    return Number((recognized.reduce((sum, candidate) => sum + candidate.confidence, 0) / recognized.length).toFixed(4));
  }

  private outputContainer(payload: Prisma.JsonValue | null) {
    const container = this.object(payload);
    if (!container) throw this.provenanceConflict('OCR AI output is missing its persisted container');
    return container;
  }

  private object(value: Prisma.JsonValue | undefined | null) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, Prisma.JsonValue>
      : undefined;
  }

  private inputJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private requiredJson(value: unknown): Prisma.InputJsonValue | Prisma.JsonNullValueInput {
    if (value === null || value === undefined) return Prisma.JsonNull;
    return this.inputJson(value);
  }

  private displayValue(value: unknown) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  private provenanceConflict(message: string) {
    return new ConflictException({
      message,
      data: { reason: 'OCR_AI_REVIEW_PROVENANCE_INVALID' }
    });
  }

  private isConcurrentWriteConflict(error: unknown) {
    if (typeof error !== 'object' || error === null) return false;
    const candidate = error as { code?: unknown; meta?: { code?: unknown } };
    if (candidate.code === 'P2034') return true;
    return candidate.meta?.code === '40001' || candidate.meta?.code === '40P01';
  }
}
