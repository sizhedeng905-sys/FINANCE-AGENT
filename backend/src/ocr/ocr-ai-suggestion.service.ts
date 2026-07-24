import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FieldType,
  FileScanStatus,
  OcrTaskStatus,
  Prisma,
  ProjectStatus
} from '@prisma/client';

import { AiStructuredSuggestionService } from '../ai/ai-structured-suggestion.service';
import {
  CLASSIFICATION_SUGGESTION_SCHEMA,
  ClassificationSuggestionOutput,
  MAPPING_SUGGESTION_SCHEMA,
  MappingSuggestionOutput
} from '../ai/ai-suggestion.schemas';
import { AiSuggestionValidatorService } from '../ai/ai-suggestion-validator.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import {
  IMPORT_TRANSFORM_KEYS,
  IMPORT_TRANSFORM_REGISTRY_VERSION,
  transformKeyForFieldType
} from '../import-tasks/import-transform-registry';
import { normalizeStructuralText } from '../import-tasks/mapping-profile-fingerprint';
import { PrismaService } from '../prisma/prisma.service';
import { NormalizedOcrIr, OcrIrPage } from './ocr-ir';
import { CanonicalOcrFieldCandidate } from './ocr.types';

export const OCR_AI_VALIDATION_RULE_VERSION = 'ocr-ai-mapping-validation/1.0';
export const OCR_AI_AUTHORIZATION_POLICY_VERSION = 'finance-ocr-ai-authz/1.0';
export const OCR_AI_REVIEW_STATE_SCHEMA_VERSION = 'ocr-ai-review-state/1.0';

const CLASSIFICATION_INPUT_MAX_BYTES = 20_000;
const MAPPING_INPUT_MAX_BYTES = 28_000;
const MAX_CANDIDATE_TEMPLATES = 64;
const MAX_TEMPLATE_FIELDS = 128;
const MAX_SOURCE_UNITS = 256;
const MAX_EVIDENCE_REFS = 256;

const candidateTemplateInclude = {
  templateFields: {
    where: { isVisible: true, field: { isActive: true } },
    include: { field: true },
    orderBy: { displayOrder: 'asc' as const }
  }
} satisfies Prisma.TemplateInclude;

const suggestionTaskInclude = {
  project: { select: { status: true } },
  rawFile: {
    select: {
      id: true,
      sha256: true,
      status: true,
      scanStatus: true,
      isVoided: true,
      relatedProjectId: true,
      mimeType: true
    }
  }
} satisfies Prisma.OcrTaskInclude;

export type OcrAiSuggestionTask = Prisma.OcrTaskGetPayload<{ include: typeof suggestionTaskInclude }>;
type SuggestionTask = OcrAiSuggestionTask;
type CandidateTemplate = Prisma.TemplateGetPayload<{ include: typeof candidateTemplateInclude }>;
type StoredCandidate = CanonicalOcrFieldCandidate & {
  evidenceConflict?: boolean;
  reviewRevision?: number;
  valueSource?: 'OCR_PROVIDER' | 'SYSTEM_FILE_BINDING' | 'MANUAL_OVERRIDE';
};

interface EvidenceSummary {
  ref: string;
  page: number;
  kind: 'block' | 'token' | 'provider_candidate';
  text: string | null;
  bbox: [number, number, number, number] | null;
  confidence: string | null;
}

export interface OcrSourceUnit {
  sourceRef: string;
  existingFieldKey: string;
  sourceLabel: string;
  fieldType: string;
  page: number;
  confidence: string;
  evidenceRefs: string[];
  evidence: EvidenceSummary[];
  conflict: boolean;
}

export interface PreparedOcrSuggestionState {
  ir: NormalizedOcrIr;
  sourceUnits: OcrSourceUnit[];
  evidenceRefs: Set<string>;
  allEvidenceRefs: Set<string>;
}

type PreparedSuggestionState = PreparedOcrSuggestionState;

@Injectable()
export class OcrAiSuggestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: AiStructuredSuggestionService,
    private readonly validator: AiSuggestionValidatorService
  ) {}

  async suggest(taskId: string, actor: CurrentUser, context: RequestContext): Promise<unknown> {
    const loaded = await this.loadSuggestionState(taskId);
    if (!loaded) throw new NotFoundException('OCR task does not exist');
    const blocked = this.suggestionBlockReason(loaded.task);
    if (blocked) throw new ConflictException(blocked);
    if (loaded.candidates.length === 0) {
      return this.manual('NO_ENABLED_TEMPLATE', 'No active project template is available for OCR classification');
    }
    if (loaded.candidates.length > MAX_CANDIDATE_TEMPLATES) {
      return this.manual('CANDIDATE_BUDGET_EXCEEDED', 'The template candidate set exceeds the safe AI budget');
    }

    const prepared = this.prepareState(loaded.task);
    if ('reasonCode' in prepared) return this.manual(prepared.reasonCode, prepared.message);
    if (prepared.sourceUnits.length === 0) {
      return this.manual('NO_TRACEABLE_OCR_VALUE', 'OCR produced no traceable value that can be mapped safely');
    }
    if (prepared.sourceUnits.length > MAX_SOURCE_UNITS || prepared.evidenceRefs.size > MAX_EVIDENCE_REFS) {
      return this.manual('OCR_EVIDENCE_BUDGET_EXCEEDED', 'OCR evidence exceeds the safe AI suggestion budget');
    }

    const currentTemplateVersionId = this.templateVersionId(loaded.task.templateId, loaded.task.templateVersion);
    const currentCandidate = loaded.candidates.find((candidate) => candidate.versionId === currentTemplateVersionId);
    if (!currentCandidate) {
      return this.manual('TASK_TEMPLATE_STALE', 'The template version frozen by this OCR task is no longer active');
    }
    const candidateSetHash = canonicalJsonSha256(loaded.candidates.map((candidate) => candidate.hashInput));
    const initialStateHash = this.suggestionStateHash(loaded.task, loaded.candidates);
    const sourceVector = this.sourceVector(loaded.task);

    const classificationInputWithText = this.classificationInput(
      loaded.task,
      loaded.candidates,
      prepared,
      true
    );
    const classificationInput = this.withinBudget(classificationInputWithText, CLASSIFICATION_INPUT_MAX_BYTES)
      ? classificationInputWithText
      : this.classificationInput(loaded.task, loaded.candidates, prepared, false);
    if (!this.withinBudget(classificationInput, CLASSIFICATION_INPUT_MAX_BYTES)) {
      return this.manual('CLASSIFICATION_INPUT_BUDGET_EXCEEDED', 'The bounded OCR classification input is still too large');
    }

    const classificationMock: ClassificationSuggestionOutput = {
      schemaVersion: 'classification/1.0',
      selectedTemplateVersionId: currentTemplateVersionId,
      candidateTemplateVersionIds: [currentTemplateVersionId],
      confidence: '1.0',
      evidenceRefs: [...prepared.evidenceRefs],
      reasonCodes: ['MOCK_CURRENT_TEMPLATE'],
      warnings: ['Mock output is deterministic and still requires finance review.'],
      decision: 'NEEDS_FINANCE_REVIEW'
    };
    const classification = await this.executor.execute({
      taskType: 'ocr_document_classification',
      promptKey: 'ocr_document_classification',
      resourceType: 'ocr_task',
      resourceId: loaded.task.id,
      actor,
      context,
      dataClassification: 'real',
      structuredInput: classificationInput,
      inputAudit: this.inputAudit(loaded.task, loaded.candidates.length, prepared, 'classification', classificationInput),
      outputSchema: CLASSIFICATION_SUGGESTION_SCHEMA as unknown as Record<string, unknown>,
      source: sourceVector,
      template: {
        templateVersionId: currentTemplateVersionId,
        templateContentSha256: currentCandidate.contentHash,
        candidateSetSha256: candidateSetHash
      },
      transformRegistryVersion: IMPORT_TRANSFORM_REGISTRY_VERSION,
      validationRuleVersion: OCR_AI_VALIDATION_RULE_VERSION,
      mappingProfileVersion: null,
      authorizationPolicyVersion: OCR_AI_AUTHORIZATION_POLICY_VERSION,
      reviewState: {
        schemaVersion: OCR_AI_REVIEW_STATE_SCHEMA_VERSION,
        stateHash: initialStateHash
      },
      mockOutput: classificationMock,
      validate: (text) => this.validator.classification(text, {
        templateVersionIds: new Set(loaded.candidates.map((candidate) => candidate.versionId)),
        evidenceRefs: prepared.evidenceRefs
      })
    });
    if (classification.status !== 'succeeded') {
      return this.manualFromExecution('CLASSIFICATION_UNAVAILABLE', classification);
    }

    const refreshed = await this.loadSuggestionState(taskId);
    if (!refreshed || this.suggestionBlockReason(refreshed.task)) {
      return this.manual('SUGGESTION_INPUT_STALE', 'OCR source or authorization state changed during classification', classification);
    }
    const refreshedPrepared = this.prepareState(refreshed.task);
    if (
      'reasonCode' in refreshedPrepared
      || this.suggestionStateHash(refreshed.task, refreshed.candidates) !== initialStateHash
    ) {
      return this.manual('SUGGESTION_INPUT_STALE', 'OCR evidence, template, or review state changed during classification', classification);
    }
    if (!classification.output.selectedTemplateVersionId) {
      return {
        status: 'needs_finance_review',
        mode: 'suggest',
        classification,
        mapping: null,
        reasonCode: 'TEMPLATE_UNRESOLVED',
        businessRecordsCreated: 0
      };
    }

    const selected = refreshed.candidates.find(
      (candidate) => candidate.versionId === classification.output.selectedTemplateVersionId
    );
    if (!selected) {
      return this.manual('SUGGESTION_INPUT_STALE', 'The selected template left the active project allowlist', classification);
    }
    if (selected.fields.length > MAX_TEMPLATE_FIELDS) {
      return this.manual('FIELD_BUDGET_EXCEEDED', 'The selected template exceeds the safe AI field budget', classification);
    }

    const mappingInputWithText = this.mappingInput(refreshed.task, selected, refreshedPrepared, true);
    const mappingInput = this.withinBudget(mappingInputWithText, MAPPING_INPUT_MAX_BYTES)
      ? mappingInputWithText
      : this.mappingInput(refreshed.task, selected, refreshedPrepared, false);
    if (!this.withinBudget(mappingInput, MAPPING_INPUT_MAX_BYTES)) {
      return this.manual('MAPPING_INPUT_BUDGET_EXCEEDED', 'The bounded OCR mapping input is still too large', classification);
    }

    const sourceRefs = new Set(refreshedPrepared.sourceUnits.map((unit) => unit.sourceRef));
    const fieldKeys = new Set(selected.fields.map((field) => field.fieldKey));
    const requiredFieldKeys = new Set(
      selected.fields.filter((field) => field.required).map((field) => field.fieldKey)
    );
    const transformKeysByField = new Map(
      selected.fields.map((field) => [field.fieldKey, new Set([transformKeyForFieldType(field.fieldType)])])
    );
    const evidenceRefsBySource = new Map(
      refreshedPrepared.sourceUnits.map((unit) => [unit.sourceRef, new Set(unit.evidenceRefs)])
    );
    const blockedSourceRefs = new Set(
      refreshedPrepared.sourceUnits.filter((unit) => unit.conflict).map((unit) => unit.sourceRef)
    );
    const mappingMock = this.mockMapping(refreshed.task, selected, refreshedPrepared.sourceUnits);
    const activeCandidateSetHash = canonicalJsonSha256(refreshed.candidates.map((candidate) => candidate.hashInput));
    const mapping = await this.executor.execute({
      taskType: 'ocr_field_mapping',
      promptKey: 'ocr_field_mapping',
      resourceType: 'ocr_task',
      resourceId: refreshed.task.id,
      actor,
      context,
      dataClassification: 'real',
      structuredInput: mappingInput,
      inputAudit: this.inputAudit(refreshed.task, 1, refreshedPrepared, 'mapping', mappingInput),
      outputSchema: MAPPING_SUGGESTION_SCHEMA as unknown as Record<string, unknown>,
      source: this.sourceVector(refreshed.task),
      template: {
        templateVersionId: selected.versionId,
        templateContentSha256: selected.contentHash,
        candidateSetSha256: activeCandidateSetHash
      },
      transformRegistryVersion: IMPORT_TRANSFORM_REGISTRY_VERSION,
      validationRuleVersion: OCR_AI_VALIDATION_RULE_VERSION,
      mappingProfileVersion: null,
      authorizationPolicyVersion: OCR_AI_AUTHORIZATION_POLICY_VERSION,
      reviewState: {
        schemaVersion: OCR_AI_REVIEW_STATE_SCHEMA_VERSION,
        stateHash: initialStateHash
      },
      mockOutput: mappingMock,
      validate: (text) => this.validator.mapping(text, {
        templateVersionIds: new Set([selected.versionId]),
        evidenceRefs: refreshedPrepared.evidenceRefs,
        sourceRefs,
        fieldKeys,
        requiredFieldKeys,
        transformKeysByField,
        evidenceRefsBySource,
        blockedSourceRefs
      })
    });
    if (mapping.status !== 'succeeded') {
      return this.manualFromExecution('MAPPING_UNAVAILABLE', mapping, classification);
    }

    const completedState = await this.loadSuggestionState(taskId);
    if (
      !completedState
      || this.suggestionBlockReason(completedState.task)
      || this.suggestionStateHash(completedState.task, completedState.candidates) !== initialStateHash
    ) {
      return this.manualFromExecution('SUGGESTION_OUTPUT_STALE', mapping, classification);
    }

    const fieldByKey = new Map(selected.fields.map((field) => [field.fieldKey, field]));
    const sourceByRef = new Map(refreshedPrepared.sourceUnits.map((unit) => [unit.sourceRef, unit]));
    return {
      status: 'needs_finance_review',
      mode: 'suggest',
      mock: classification.providerClass === 'mock' || mapping.providerClass === 'mock',
      classification,
      mapping: {
        ...mapping,
        output: {
          ...mapping.output,
          mappings: mapping.output.mappings.map((item) => ({
            ...item,
            targetFieldId: fieldByKey.get(item.targetFieldKey)!.id,
            targetFieldName: fieldByKey.get(item.targetFieldKey)!.fieldName,
            source: sourceByRef.get(item.sourceRef)
          }))
        }
      },
      conflicts: refreshedPrepared.sourceUnits
        .filter((unit) => unit.conflict)
        .map((unit) => ({ sourceRef: unit.sourceRef, evidenceRefs: unit.evidenceRefs })),
      aiCalls: Number(!classification.reused) + Number(!mapping.reused),
      deterministicApplication: {
        performed: false,
        reason: 'OCR suggestions remain isolated until finance review and deterministic validation complete'
      },
      businessRecordsCreated: 0
    };
  }

  async latest(taskId: string) {
    const exists = await this.prisma.ocrTask.count({ where: { id: taskId } });
    if (!exists) throw new NotFoundException('OCR task does not exist');
    const items = await this.prisma.aiTask.findMany({
      where: {
        resourceType: 'ocr_task',
        resourceId: taskId,
        taskType: { in: ['ocr_document_classification', 'ocr_field_mapping'] }
      },
      include: { attempts: { orderBy: { attemptNo: 'desc' }, take: 1 } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 10
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        taskType: item.taskType,
        status: item.status,
        requestKey: item.requestKey,
        inputHash: item.inputHash,
        versionVectorHash: item.versionVectorHash,
        outputHash: item.outputHash,
        output: this.outputValue(item.outputPayload),
        reviewBasis: this.reviewBasisValue(item.outputPayload),
        provenance: this.historyProvenance(item.versionVector),
        error: item.errorMessage ? 'AI suggestion is unavailable; manual review remains available' : undefined,
        attempt: item.attempts[0] ? {
          attemptNo: item.attempts[0].attemptNo,
          provider: item.attempts[0].provider,
          model: item.attempts[0].modelName,
          status: item.attempts[0].status,
          latencyMs: item.attempts[0].latencyMs,
          completedAt: item.attempts[0].completedAt?.toISOString()
        } : undefined,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString()
      }))
    };
  }

  async currentReviewContext(tx: Prisma.TransactionClient, taskId: string) {
    const task = await tx.ocrTask.findUnique({ where: { id: taskId }, include: suggestionTaskInclude });
    if (!task) throw new NotFoundException('OCR task does not exist');
    const candidates = await this.loadCandidates(task.projectId, tx);
    return {
      task,
      candidates,
      prepared: this.prepareState(task),
      blockedReason: this.suggestionBlockReason(task),
      stateHash: this.suggestionStateHash(task, candidates)
    };
  }

  private async loadSuggestionState(taskId: string) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.ocrTask.findUnique({ where: { id: taskId }, include: suggestionTaskInclude });
      if (!task) return undefined;
      const candidates = await this.loadCandidates(task.projectId, tx);
      return { task, candidates };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async loadCandidates(
    projectId: string,
    db: Pick<Prisma.TransactionClient, 'projectTemplate'> = this.prisma
  ) {
    const links = await db.projectTemplate.findMany({
      where: { projectId, isActive: true },
      include: { template: { include: candidateTemplateInclude } },
      orderBy: [{ template: { name: 'asc' } }, { templateId: 'asc' }],
      take: MAX_CANDIDATE_TEMPLATES + 1
    });
    return links.map(({ template }) => this.toCandidate(template));
  }

  private toCandidate(template: CandidateTemplate) {
    const fields = template.templateFields.map((item) => ({
      id: item.field.id,
      fieldKey: item.field.fieldKey,
      fieldName: this.safeText(item.field.fieldName, 80),
      fieldType: item.field.fieldType,
      required: item.isRequired,
      aliases: this.stringArray(item.field.aliases).slice(0, 16).map((alias) => this.safeText(alias, 80))
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
      versionId: this.templateVersionId(template.id, template.version),
      name: this.safeText(template.name, 80),
      recordType: template.recordType,
      fields,
      hashInput,
      contentHash: canonicalJsonSha256(hashInput)
    };
  }

  private prepareState(task: SuggestionTask): PreparedSuggestionState | { reasonCode: string; message: string } {
    const ir = this.readIr(task);
    if (!ir) return { reasonCode: 'OCR_IR_INVALID', message: 'Stored OCR evidence IR is missing or fails integrity checks' };
    const evidence = this.evidenceIndex(ir);
    if (!evidence) return { reasonCode: 'OCR_IR_INVALID', message: 'Stored OCR evidence references are invalid or duplicated' };

    const candidates = this.candidateArray(task.fieldCandidates);
    if (candidates.some((candidate) =>
      !candidate.missing
      && candidate.fieldType !== FieldType.file
      && candidate.evidenceRefs.length === 0
    )) {
      return { reasonCode: 'SOURCE_EVIDENCE_INCOMPLETE', message: 'A recognized OCR value has no stable evidence reference' };
    }

    const sourceUnits: OcrSourceUnit[] = [];
    for (const candidate of candidates) {
      if (candidate.missing || candidate.fieldType === FieldType.file) continue;
      const summaries: EvidenceSummary[] = [];
      for (const evidenceRef of candidate.evidenceRefs) {
        const summary = evidence.get(evidenceRef);
        if (!summary) {
          return { reasonCode: 'SOURCE_EVIDENCE_INCOMPLETE', message: 'An OCR value references evidence outside its immutable IR' };
        }
        summaries.push(summary);
      }
      const pages = new Set(summaries.map((summary) => summary.page));
      sourceUnits.push({
        sourceRef: `candidate:${candidate.fieldId}`,
        existingFieldKey: candidate.fieldKey,
        sourceLabel: this.safeText(candidate.sourceLabel, 128),
        fieldType: candidate.fieldType,
        page: candidate.page,
        confidence: this.confidence(candidate.confidence),
        evidenceRefs: [...new Set(candidate.evidenceRefs)],
        evidence: summaries,
        conflict: candidate.evidenceConflict === true || pages.size > 1
      });
    }
    const evidenceRefs = new Set(sourceUnits.flatMap((unit) => unit.evidenceRefs));
    return { ir, sourceUnits, evidenceRefs, allEvidenceRefs: new Set(evidence.keys()) };
  }

  private readIr(task: SuggestionTask): NormalizedOcrIr | undefined {
    const value = task.normalizedIr;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const ir = value as unknown as NormalizedOcrIr;
    if (
      ir.schemaVersion !== task.irSchemaVersion
      || ir.sourceId !== task.id
      || ir.sourceSha256 !== task.sourceSha256
      || ir.hash !== task.irHash
      || ir.coordinateVersion !== task.coordinateVersion
      || !Array.isArray(ir.pages)
    ) return undefined;
    const core = {
      schemaVersion: ir.schemaVersion,
      sourceSha256: ir.sourceSha256,
      providerVersion: ir.providerVersion,
      coordinateVersion: ir.coordinateVersion,
      pages: ir.pages
    };
    return canonicalJsonSha256(core) === ir.hash ? ir : undefined;
  }

  private evidenceIndex(ir: NormalizedOcrIr): Map<string, EvidenceSummary> | undefined {
    const index = new Map<string, EvidenceSummary>();
    const add = (item: EvidenceSummary) => {
      if (!this.stableRef(item.ref) || index.has(item.ref)) return false;
      index.set(item.ref, item);
      return true;
    };
    for (const page of ir.pages) {
      if (!this.validPage(page)) return undefined;
      for (const block of page.blocks) {
        if (!add({
          ref: block.blockId,
          page: page.page,
          kind: 'block',
          text: this.safeText(block.text, 160),
          bbox: block.bbox,
          confidence: block.confidence
        })) return undefined;
        for (const token of block.tokens) {
          if (!add({
            ref: token.tokenId,
            page: page.page,
            kind: 'token',
            text: this.safeText(token.text, 80),
            bbox: token.bbox,
            confidence: token.confidence
          })) return undefined;
        }
      }
      for (const candidate of page.candidateEvidence) {
        if (!add({
          ref: candidate.evidenceId,
          page: page.page,
          kind: 'provider_candidate',
          text: this.safeText(candidate.sourceLabel, 80),
          bbox: candidate.bbox,
          confidence: candidate.confidence
        })) return undefined;
      }
    }
    return index;
  }

  private validPage(page: OcrIrPage) {
    return Number.isInteger(page.page)
      && page.page > 0
      && Array.isArray(page.blocks)
      && Array.isArray(page.candidateEvidence);
  }

  private classificationInput(
    task: SuggestionTask,
    candidates: Awaited<ReturnType<OcrAiSuggestionService['loadCandidates']>>,
    prepared: PreparedSuggestionState,
    includeText: boolean
  ) {
    return {
      schemaVersion: 'ocr-classification-input/1.0',
      sourceId: task.id,
      document: {
        mimeType: task.rawFile.mimeType,
        pages: prepared.ir.pages.map((page) => ({
          page: page.page,
          width: page.width,
          height: page.height,
          warnings: page.warnings
        })),
        evidenceUnits: prepared.sourceUnits.map((unit) => this.sourceUnitInput(unit, includeText))
      },
      candidateTemplates: candidates.map((candidate) => ({
        templateVersionId: candidate.versionId,
        displayName: candidate.name,
        recordType: candidate.recordType,
        fields: candidate.fields.slice(0, 64).map((field) => ({
          fieldKey: field.fieldKey,
          fieldType: field.fieldType,
          required: field.required
        })),
        fieldListTruncated: candidate.fields.length > 64
      }))
    };
  }

  private mappingInput(
    task: SuggestionTask,
    candidate: Awaited<ReturnType<OcrAiSuggestionService['loadCandidates']>>[number],
    prepared: PreparedSuggestionState,
    includeText: boolean
  ) {
    return {
      schemaVersion: 'ocr-mapping-input/1.0',
      sourceId: task.id,
      templateVersionId: candidate.versionId,
      evidenceUnits: prepared.sourceUnits.map((unit) => this.sourceUnitInput(unit, includeText)),
      fields: candidate.fields.map((field) => ({
        fieldKey: field.fieldKey,
        displayName: field.fieldName,
        fieldType: field.fieldType,
        required: field.required,
        aliases: field.aliases,
        allowedTransformKeys: [transformKeyForFieldType(field.fieldType)]
      })),
      allowedTransformKeys: [...IMPORT_TRANSFORM_KEYS],
      mappingRules: {
        sourceAssignment: 'Each sourceRef must appear in exactly one of mappings or unmappedSourceRefs.',
        targetAssignment: 'Each targetFieldKey may appear in at most one mapping.',
        transformAssignment: 'Use only the target field allowedTransformKeys.',
        evidenceAssignment: 'Each mapping evidenceRefs must be a non-empty subset of its source evidenceRefs.',
        unresolvedRequiredFields: 'List only required target fields that are not present in mappings.',
        decision: 'NEEDS_FINANCE_REVIEW'
      }
    };
  }

  private sourceUnitInput(unit: OcrSourceUnit, includeText: boolean) {
    return {
      sourceRef: unit.sourceRef,
      sourceLabel: unit.sourceLabel,
      inferredType: unit.fieldType,
      page: unit.page,
      confidence: unit.confidence,
      evidenceRefs: unit.evidenceRefs,
      conflict: unit.conflict,
      evidence: unit.evidence.map((item) => ({
        ref: item.ref,
        page: item.page,
        kind: item.kind,
        bbox: item.bbox,
        confidence: item.confidence,
        text: includeText ? item.text : null
      }))
    };
  }

  private mockMapping(
    task: SuggestionTask,
    candidate: Awaited<ReturnType<OcrAiSuggestionService['loadCandidates']>>[number],
    sourceUnits: OcrSourceUnit[]
  ): MappingSuggestionOutput {
    const used = new Set<string>();
    const mappings: MappingSuggestionOutput['mappings'] = [];
    const unmappedSourceRefs: string[] = [];
    for (const unit of sourceUnits) {
      if (unit.conflict) {
        unmappedSourceRefs.push(unit.sourceRef);
        continue;
      }
      const names = new Set([
        normalizeStructuralText(unit.existingFieldKey),
        normalizeStructuralText(unit.sourceLabel)
      ]);
      const field = candidate.fields.find((item) =>
        !used.has(item.fieldKey)
        && (
          (candidate.id === task.templateId && item.fieldKey === unit.existingFieldKey)
          || names.has(normalizeStructuralText(item.fieldKey))
          || names.has(normalizeStructuralText(item.fieldName))
          || item.aliases.some((alias) => names.has(normalizeStructuralText(alias)))
        ));
      if (!field) {
        unmappedSourceRefs.push(unit.sourceRef);
        continue;
      }
      used.add(field.fieldKey);
      mappings.push({
        sourceRef: unit.sourceRef,
        targetFieldKey: field.fieldKey,
        transformKey: transformKeyForFieldType(field.fieldType),
        confidence: '1.0',
        evidenceRefs: unit.evidenceRefs
      });
    }
    return {
      schemaVersion: 'mapping/1.0',
      templateVersionId: candidate.versionId,
      mappings,
      unmappedSourceRefs,
      unresolvedRequiredFields: candidate.fields
        .filter((field) => field.required && !used.has(field.fieldKey))
        .map((field) => field.fieldKey),
      warnings: ['Mock output is deterministic and cannot approve or commit OCR data.'],
      decision: 'NEEDS_FINANCE_REVIEW'
    };
  }

  private suggestionStateHash(
    task: SuggestionTask,
    candidates: Awaited<ReturnType<OcrAiSuggestionService['loadCandidates']>>
  ) {
    return canonicalJsonSha256({
      schemaVersion: 'ocr-ai-suggestion-state/1.0',
      task: {
        id: task.id,
        projectId: task.projectId,
        templateId: task.templateId,
        templateVersion: task.templateVersion,
        status: task.status,
        version: task.version,
        reviewRevision: task.reviewRevision,
        validationRevision: task.validationRevision,
        validationSnapshotHash: task.validationSnapshotHash,
        sourceSha256: task.sourceSha256,
        irSchemaVersion: task.irSchemaVersion,
        irHash: task.irHash,
        coordinateVersion: task.coordinateVersion,
        preprocessingVersion: task.preprocessingVersion,
        fieldCandidates: task.fieldCandidates
      },
      projectStatus: task.project.status,
      rawFile: task.rawFile,
      candidateSetHash: canonicalJsonSha256(candidates.map((candidate) => candidate.hashInput))
    });
  }

  private sourceVector(task: SuggestionTask) {
    return {
      kind: 'ocr' as const,
      sourceId: task.id,
      sourceSha256: task.sourceSha256!,
      irHash: task.irHash!,
      irSchemaVersion: task.irSchemaVersion!,
      processorVersion: `${task.preprocessingVersion}@${task.coordinateVersion}`
    };
  }

  private inputAudit(
    task: SuggestionTask,
    candidateCount: number,
    prepared: PreparedSuggestionState,
    purpose: string,
    input: unknown
  ) {
    return {
      purpose,
      sourceId: task.id,
      sourceHash: task.sourceSha256,
      irHash: task.irHash,
      pageCount: prepared.ir.pages.length,
      sourceUnitCount: prepared.sourceUnits.length,
      evidenceRefCount: prepared.evidenceRefs.size,
      candidateCount,
      inputBytes: Buffer.byteLength(JSON.stringify(input), 'utf8'),
      includedFields: ['page_geometry', 'bounded_evidence_snippets', 'candidate_template_versions'],
      excludes: ['raw_file_binary', 'full_ocr_text', 'credentials', 'other_projects']
    };
  }

  private suggestionBlockReason(task: SuggestionTask) {
    if (task.status !== OcrTaskStatus.pending_confirm) {
      return 'Only recognized OCR tasks awaiting finance review can request AI suggestions';
    }
    if (task.project.status !== ProjectStatus.active) return 'Archived projects cannot request OCR AI suggestions';
    if (
      task.rawFile.isVoided
      || task.rawFile.status === 'failed'
      || task.rawFile.scanStatus !== FileScanStatus.clean
      || task.rawFile.relatedProjectId !== task.projectId
    ) return 'The OCR source file is not safe or no longer belongs to this project';
    if (
      !task.sourceSha256
      || !task.irHash
      || !task.irSchemaVersion
      || !task.coordinateVersion
      || !task.preprocessingVersion
      || task.sourceSha256 !== task.rawFile.sha256
    ) return 'OCR source evidence is incomplete or stale';
    return undefined;
  }

  private manual(reasonCode: string, message: string, classification?: unknown) {
    return {
      status: 'manual_required',
      mode: 'manual',
      reasonCode,
      message,
      classification: classification ?? null,
      mapping: null,
      businessRecordsCreated: 0
    };
  }

  private manualFromExecution(reasonCode: string, execution: unknown, classification?: unknown) {
    return {
      ...this.manual(reasonCode, 'AI suggestion is unavailable; the existing manual OCR review remains available', classification),
      execution
    };
  }

  private templateVersionId(templateId: string, version: number) {
    return `${templateId}:v${version}`;
  }

  private candidateArray(value: Prisma.JsonValue): StoredCandidate[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    ) as unknown as StoredCandidate[];
  }

  private confidence(value: number) {
    const bounded = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    return String(Math.round(bounded * 1_000_000) / 1_000_000);
  }

  private stableRef(value: string) {
    return /^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,255}$/.test(value);
  }

  private withinBudget(value: unknown, maxBytes: number) {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes;
  }

  private safeText(value: string, maxLength: number) {
    return value
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private stringArray(value: Prisma.JsonValue | null): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof item))
      .map((item) => String(item));
  }

  private outputValue(value: Prisma.JsonValue | null) {
    const payload = this.jsonObject(value);
    return payload?.validatedOutput ?? undefined;
  }

  private reviewBasisValue(value: Prisma.JsonValue | null) {
    const reviewBasis = this.jsonObject(this.jsonObject(value)?.reviewBasis);
    return reviewBasis ?? undefined;
  }

  private historyProvenance(value: Prisma.JsonValue) {
    const vector = this.jsonObject(value);
    const provider = this.jsonObject(vector?.provider);
    const prompt = this.jsonObject(vector?.prompt);
    const contracts = this.jsonObject(vector?.contracts);
    if (!provider || !prompt || !contracts) return undefined;
    const providerClass = provider.providerClass;
    const providerName = provider.provider;
    const modelName = provider.modelName;
    const promptKey = prompt.promptKey;
    const inputSchemaVersion = contracts.inputSchemaVersion;
    const outputSchemaVersion = contracts.outputSchemaVersion;
    if (
      typeof providerClass !== 'string'
      || typeof providerName !== 'string'
      || typeof modelName !== 'string'
      || typeof promptKey !== 'string'
      || typeof inputSchemaVersion !== 'string'
      || typeof outputSchemaVersion !== 'string'
    ) return undefined;
    return {
      providerClass,
      provider: providerName,
      modelName,
      modelRevision: typeof provider.modelRevision === 'string' ? provider.modelRevision : null,
      promptKey,
      promptVersion: Number.isInteger(prompt.versionNo) ? Number(prompt.versionNo) : null,
      promptContentSha256: typeof prompt.contentSha256 === 'string' ? prompt.contentSha256 : null,
      inputSchemaVersion,
      outputSchemaVersion
    };
  }

  private jsonObject(value: Prisma.JsonValue | undefined | null) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, Prisma.JsonValue>
      : undefined;
  }
}
