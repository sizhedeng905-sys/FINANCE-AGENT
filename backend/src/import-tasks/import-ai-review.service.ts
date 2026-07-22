import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import {
  AiTaskStatus,
  ImportAiReviewDecisionType,
  ImportColumn,
  ImportTask,
  Prisma
} from '@prisma/client';

import { CurrentUser } from '../common/types/current-user';
import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import { PrismaService } from '../prisma/prisma.service';
import { buildAiReviewBasis } from '../ai/ai-review-basis';
import { MappingInputDto } from './dto/save-mappings.dto';
import { QueryAiReviewDecisionsDto } from './dto/query-ai-review-decisions.dto';
import {
  EXCEL_AI_MAX_CANDIDATE_TEMPLATES,
  EXCEL_AI_REVIEW_STATE_SCHEMA_VERSION,
  excelAiCandidateTemplateInclude,
  excelAiReviewStateHash,
  excelAiReviewTaskInclude,
  toExcelAiCandidate
} from './excel-ai-review-basis';
import { isRegisteredImportTransformKey } from './import-transform-registry';

type ReviewTask = Pick<ImportTask, 'id' | 'templateId' | 'templateVersion' | 'reviewRevision'>;
type ReviewColumn = Pick<ImportColumn, 'id' | 'sourceColumnId' | 'columnIndex'>;
type ReviewReader = Prisma.TransactionClient | PrismaService;

export const EXCEL_AI_REVIEW_DIGEST_SCHEMA_VERSION = 'excel-ai-review-digest/1.0';

interface VerifiedMappingSuggestion {
  sourceRef: string;
  targetFieldKey: string;
  transformKey: string;
  confidence: string | null;
  evidenceRefs: string[];
}

@Injectable()
export class ImportAiReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async verifyAndPersist(
    tx: Prisma.TransactionClient,
    task: ReviewTask,
    columns: ReviewColumn[],
    mappings: MappingInputDto[],
    targetFields: Array<{ id: string; fieldKey: string }>,
    actor: CurrentUser
  ) {
    const reviewedMappings = mappings.filter((mapping) => mapping.aiReview);
    if (reviewedMappings.length === 0) {
      return {
        count: 0,
        reviewRevision: task.reviewRevision + 1,
        decisionCounts: this.decisionCounts(0, [])
      };
    }

    const aiTaskIds = new Set(reviewedMappings.map((mapping) => mapping.aiReview!.aiTaskId));
    if (aiTaskIds.size !== 1) {
      throw new ConflictException('同一次映射保存不能混用多个 AI 输出');
    }
    const aiTaskId = [...aiTaskIds][0]!;
    const latest = await tx.aiTask.findFirst({
      where: {
        resourceType: 'import_task',
        resourceId: task.id,
        taskType: 'excel_column_mapping'
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    if (!latest || latest.id !== aiTaskId || latest.status !== AiTaskStatus.succeeded) {
      throw new ConflictException('AI 映射输出已过期或不是当前任务的最新成功结果');
    }
    if (!latest.outputHash || !latest.versionVectorHash) {
      throw new ConflictException('AI 映射输出缺少可验证哈希');
    }
    if (await tx.importAiReviewDecision.count({ where: { aiTaskId } })) {
      throw new ConflictException('该 AI 映射输出已经完成过人工审核，不能重复使用');
    }

    const submittedHashes = new Set(reviewedMappings.map((mapping) => (
      [
        mapping.aiReview!.outputHash,
        mapping.aiReview!.versionVectorHash,
        mapping.aiReview!.reviewStateHash,
        mapping.aiReview!.reviewBasisHash
      ].join(':')
    )));
    if (submittedHashes.size !== 1) {
      throw new ConflictException('AI 映射输出的审核基线不一致');
    }

    const versionVector = this.object(latest.versionVector);
    if (
      !versionVector
      || canonicalJsonSha256(versionVector) !== latest.versionVectorHash
      || versionVector.inputSha256 !== latest.inputHash
    ) {
      throw new ConflictException('AI 映射版本向量内容与持久化哈希不一致');
    }

    const outputContainer = this.outputContainer(latest.outputPayload);
    const output = this.validatedOutput(outputContainer);
    if (canonicalJsonSha256(output) !== latest.outputHash) {
      throw new ConflictException('AI 映射输出内容与持久化哈希不一致');
    }
    const currentReviewStateHash = await this.currentReviewStateHash(tx, task.id);
    const expectedReviewBasis = buildAiReviewBasis({
      taskType: latest.taskType,
      resourceType: latest.resourceType!,
      resourceId: latest.resourceId!,
      aiTaskId: latest.id,
      reviewState: {
        schemaVersion: EXCEL_AI_REVIEW_STATE_SCHEMA_VERSION,
        stateHash: currentReviewStateHash
      },
      inputHash: latest.inputHash,
      outputHash: latest.outputHash,
      versionVectorHash: latest.versionVectorHash
    });
    const persistedReviewBasis = this.object(outputContainer.reviewBasis);
    if (
      versionVector.reviewStateSha256 !== currentReviewStateHash
      || !persistedReviewBasis
      || canonicalJsonSha256(persistedReviewBasis) !== canonicalJsonSha256(expectedReviewBasis)
      || !submittedHashes.has([
        latest.outputHash,
        latest.versionVectorHash,
        currentReviewStateHash,
        expectedReviewBasis.basisHash
      ].join(':'))
    ) {
      throw new ConflictException('AI 映射输出生成后的审核基线已变化，请重新生成建议');
    }
    const expectedTemplateVersionId = `${task.templateId}:v${task.templateVersion}`;
    if (
      output.schemaVersion !== 'mapping/1.0'
      || output.decision !== 'NEEDS_FINANCE_REVIEW'
      || output.templateVersionId !== expectedTemplateVersionId
    ) {
      throw new ConflictException('AI 映射输出与任务冻结模板不一致');
    }

    const suggestions = this.mappingSuggestions(output.mappings);
    const suggestionBySourceRef = new Map(suggestions.map((suggestion) => [suggestion.sourceRef, suggestion]));
    if (suggestionBySourceRef.size !== suggestions.length) {
      throw new ConflictException('AI 映射输出包含重复来源引用');
    }
    const submittedSourceRefs = reviewedMappings.map((mapping) => mapping.aiReview!.sourceRef);
    const submittedSourceRefSet = new Set(submittedSourceRefs);
    const missingSourceRefs = suggestions
      .map((suggestion) => suggestion.sourceRef)
      .filter((sourceRef) => !submittedSourceRefSet.has(sourceRef));
    const unexpectedSourceRefs = [...submittedSourceRefSet]
      .filter((sourceRef) => !suggestionBySourceRef.has(sourceRef));
    if (
      submittedSourceRefSet.size !== submittedSourceRefs.length
      || reviewedMappings.length !== suggestions.length
      || missingSourceRefs.length > 0
      || unexpectedSourceRefs.length > 0
    ) {
      throw new BadRequestException({
        message: 'AI 映射审核必须一次完整处理全部建议来源',
        data: {
          reason: 'AI_REVIEW_BATCH_INCOMPLETE',
          total: suggestions.length,
          submitted: reviewedMappings.length,
          missing: missingSourceRefs.length,
          unexpected: unexpectedSourceRefs.length,
          duplicate: submittedSourceRefs.length - submittedSourceRefSet.size
        }
      });
    }
    const columnById = new Map(columns.map((column) => [column.id, column]));
    const fieldByKey = new Map(targetFields.map((field) => [field.fieldKey, field]));
    const nextReviewRevision = task.reviewRevision + 1;
    const decisions = reviewedMappings.map((mapping) => {
      const review = mapping.aiReview!;
      const column = columnById.get(mapping.columnId);
      const sourceRef = column ? this.sourceRef(column) : undefined;
      if (!column || sourceRef !== review.sourceRef) {
        throw new BadRequestException('AI 审核来源引用与当前导入列不一致');
      }
      const suggestion = suggestionBySourceRef.get(review.sourceRef);
      if (!suggestion || !suggestion.evidenceRefs.includes(review.sourceRef)) {
        throw new ConflictException('AI 审核来源不在已验证的映射输出中');
      }
      if (!isRegisteredImportTransformKey(suggestion.transformKey)) {
        throw new ConflictException('AI 映射输出引用了未注册的转换规则');
      }
      const suggestedField = fieldByKey.get(suggestion.targetFieldKey);
      if (!suggestedField) {
        throw new ConflictException('AI 建议字段不属于任务冻结模板');
      }
      const finalIgnored = mapping.ignore === true;
      const finalTargetFieldId = finalIgnored ? null : mapping.targetFieldId ?? null;
      if (
        review.decision === 'accept'
        && (finalIgnored || finalTargetFieldId !== suggestedField.id)
      ) {
        throw new BadRequestException('采纳决定的最终字段必须与 AI 建议一致');
      }
      if (review.decision === 'ignore' && (!finalIgnored || finalTargetFieldId !== null)) {
        throw new BadRequestException('忽略决定必须把当前来源列明确标记为忽略');
      }
      if (
        (review.decision === 'edit' || review.decision === 'reject')
        && (finalIgnored || finalTargetFieldId === null || finalTargetFieldId === suggestedField.id)
      ) {
        throw new BadRequestException('人工编辑或拒绝决定必须产生与 AI 建议不同的最终映射');
      }
      return {
        importTaskId: task.id,
        importColumnId: column.id,
        aiTaskId,
        outputHash: latest.outputHash!,
        versionVectorHash: latest.versionVectorHash!,
        reviewStateHash: currentReviewStateHash,
        reviewBasisHash: expectedReviewBasis.basisHash,
        sourceRef: review.sourceRef,
        templateVersionId: expectedTemplateVersionId,
        suggestedTargetFieldId: suggestedField.id,
        suggestedTargetFieldKey: suggestion.targetFieldKey,
        suggestedTransformKey: suggestion.transformKey,
        suggestedConfidence: suggestion.confidence,
        evidenceRefs: suggestion.evidenceRefs,
        finalTargetFieldId,
        finalIgnored,
        decision: review.decision as ImportAiReviewDecisionType,
        reason: review.reason,
        reviewRevision: nextReviewRevision,
        actorId: actor.id
      };
    });

    await tx.importAiReviewDecision.createMany({ data: decisions });
    const decisionCounts = this.decisionCounts(suggestions.length, decisions.map((item) => item.decision));
    return {
      count: decisions.length,
      aiTaskId,
      outputHash: latest.outputHash,
      versionVectorHash: latest.versionVectorHash,
      reviewStateHash: currentReviewStateHash,
      reviewBasisHash: expectedReviewBasis.basisHash,
      reviewRevision: nextReviewRevision,
      decisionCounts
    };
  }

  async findMany(taskId: string, query: QueryAiReviewDecisionsDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      importTaskId: taskId,
      ...(query.reviewRevision ? { reviewRevision: query.reviewRevision } : {})
    };
    const { items, total, grouped, digest } = await this.prisma.$transaction(async (tx) => {
      const task = await tx.importTask.findUnique({
        where: { id: taskId },
        select: { reviewRevision: true }
      });
      if (!task) throw new NotFoundException('导入任务不存在');
      const [items, total, grouped, digest] = await Promise.all([
        tx.importAiReviewDecision.findMany({
          where,
          include: { actor: { select: { id: true, username: true, name: true } } },
          orderBy: [{ reviewRevision: 'desc' }, { sourceRef: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize
        }),
        tx.importAiReviewDecision.count({ where }),
        tx.importAiReviewDecision.groupBy({
          by: ['decision'],
          where,
          orderBy: { decision: 'asc' },
          _count: { _all: true }
        }),
        this.canonicalDigest(tx, taskId, task.reviewRevision)
      ]);
      return { items, total, grouped, digest };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return {
      items: items.map((item) => ({
        id: item.id,
        importTaskId: item.importTaskId,
        importColumnId: item.importColumnId,
        aiTaskId: item.aiTaskId,
        outputHash: item.outputHash,
        versionVectorHash: item.versionVectorHash,
        reviewStateHash: item.reviewStateHash,
        reviewBasisHash: item.reviewBasisHash,
        sourceRef: item.sourceRef,
        templateVersionId: item.templateVersionId,
        suggested: {
          targetFieldId: item.suggestedTargetFieldId,
          targetFieldKey: item.suggestedTargetFieldKey,
          transformKey: item.suggestedTransformKey,
          confidence: item.suggestedConfidence,
          evidenceRefs: item.evidenceRefs
        },
        final: { targetFieldId: item.finalTargetFieldId, ignored: item.finalIgnored },
        decision: item.decision,
        reason: item.reason,
        reviewRevision: item.reviewRevision,
        actor: item.actor,
        createdAt: item.createdAt.toISOString()
      })),
      page,
      pageSize,
      total,
      summary: this.decisionCountsFromGroups(total, grouped),
      digest
    };
  }

  async canonicalDigest(reader: ReviewReader, taskId: string, taskReviewRevision: number) {
    const decisions = await reader.importAiReviewDecision.findMany({
      where: { importTaskId: taskId },
      include: { aiTask: true },
      orderBy: [
        { reviewRevision: 'asc' },
        { sourceRef: 'asc' },
        { id: 'asc' }
      ]
    });
    const batchByTaskId = new Map<string, ReturnType<ImportAiReviewService['aiBatchFact']>>();
    const decisionFacts = decisions.map((item) => {
      const batch = this.aiBatchFact(item);
      const existing = batchByTaskId.get(item.aiTaskId);
      if (existing && canonicalJsonSha256(existing) !== canonicalJsonSha256(batch)) {
        throw this.provenanceConflict('同一 AI 任务的审核 provenance 不一致');
      }
      batchByTaskId.set(item.aiTaskId, batch);
      return {
        id: item.id,
        importColumnId: item.importColumnId,
        aiTaskId: item.aiTaskId,
        outputHash: item.outputHash,
        versionVectorHash: item.versionVectorHash,
        reviewStateHash: item.reviewStateHash,
        reviewBasisHash: item.reviewBasisHash,
        sourceRef: item.sourceRef,
        templateVersionId: item.templateVersionId,
        suggested: {
          targetFieldId: item.suggestedTargetFieldId,
          targetFieldKey: item.suggestedTargetFieldKey,
          transformKey: item.suggestedTransformKey,
          confidence: item.suggestedConfidence,
          evidenceRefs: this.strictStringArray(item.evidenceRefs, 'AI 审核证据引用无效')
        },
        final: {
          targetFieldId: item.finalTargetFieldId,
          ignored: item.finalIgnored
        },
        decision: item.decision,
        reason: item.reason,
        reviewRevision: item.reviewRevision,
        actorId: item.actorId,
        reviewedAt: item.createdAt.toISOString()
      };
    });
    const batches = [...batchByTaskId.values()].sort((left, right) => (
      left.aiTaskId.localeCompare(right.aiTaskId)
    ));
    const summary = this.decisionCounts(decisionFacts.length, decisions.map((item) => item.decision));
    const core = {
      schemaVersion: EXCEL_AI_REVIEW_DIGEST_SCHEMA_VERSION,
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

  private decisionCounts(total: number, decisions: ImportAiReviewDecisionType[]) {
    const counts = {
      total,
      accept: 0,
      edit: 0,
      reject: 0,
      ignore: 0,
      pending: total - decisions.length
    };
    for (const decision of decisions) counts[decision] += 1;
    return counts;
  }

  private decisionCountsFromGroups(
    total: number,
    groups: Array<{ decision: ImportAiReviewDecisionType; _count: { _all: number } }>
  ) {
    const counts = this.decisionCounts(total, []);
    for (const group of groups) {
      counts[group.decision] = group._count._all;
      counts.pending -= group._count._all;
    }
    return counts;
  }

  private aiBatchFact(item: Prisma.ImportAiReviewDecisionGetPayload<{ include: { aiTask: true } }>) {
    const task = item.aiTask;
    if (
      task.status !== AiTaskStatus.succeeded
      || task.outputHash !== item.outputHash
      || task.versionVectorHash !== item.versionVectorHash
    ) {
      throw this.provenanceConflict('AI 审核引用的任务状态或哈希已变化');
    }
    const versionVector = this.object(task.versionVector);
    if (!versionVector || canonicalJsonSha256(versionVector) !== item.versionVectorHash) {
      throw this.provenanceConflict('AI 审核版本向量与持久化哈希不一致');
    }
    const outputContainer = this.outputContainer(task.outputPayload);
    const output = this.validatedOutput(outputContainer);
    if (canonicalJsonSha256(output) !== item.outputHash) {
      throw this.provenanceConflict('AI 审核输出与持久化哈希不一致');
    }
    const reviewBasis = this.object(outputContainer.reviewBasis);
    const persistedBasisHash = reviewBasis?.basisHash;
    const reviewBasisCore = reviewBasis
      ? Object.fromEntries(Object.entries(reviewBasis).filter(([key]) => key !== 'basisHash'))
      : undefined;
    if (
      item.reviewBasisHash
      && (
        !reviewBasisCore
        || persistedBasisHash !== item.reviewBasisHash
        || canonicalJsonSha256(reviewBasisCore) !== item.reviewBasisHash
      )
    ) {
      throw this.provenanceConflict('AI 审核基线与持久化哈希不一致');
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
      || typeof prompt.promptKey !== 'string'
      || !Number.isInteger(prompt.versionNo)
      || typeof contracts.inputSchemaVersion !== 'string'
      || typeof contracts.outputSchemaVersion !== 'string'
    ) {
      throw this.provenanceConflict('AI 审核版本向量缺少 Provider、Prompt 或 Schema 事实');
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
        ? this.strictStringArray(output.warnings, 'AI 审核输出 warning 集合无效')
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

  private provenanceConflict(message: string) {
    return new ConflictException({
      message,
      data: { reason: 'IMPORT_AI_REVIEW_PROVENANCE_INVALID' }
    });
  }

  private async currentReviewStateHash(tx: Prisma.TransactionClient, taskId: string) {
    const task = await tx.importTask.findUnique({
      where: { id: taskId },
      include: excelAiReviewTaskInclude
    });
    if (!task) throw new NotFoundException('导入任务不存在');
    const links = await tx.projectTemplate.findMany({
      where: { projectId: task.projectId, isActive: true },
      include: { template: { include: excelAiCandidateTemplateInclude } },
      orderBy: [{ template: { name: 'asc' } }, { templateId: 'asc' }],
      take: EXCEL_AI_MAX_CANDIDATE_TEMPLATES + 1
    });
    return excelAiReviewStateHash(task, links.map(({ template }) => toExcelAiCandidate(template)));
  }

  private outputContainer(payload: Prisma.JsonValue | null) {
    const container = this.object(payload);
    if (!container) throw new ConflictException('AI 映射输出缺少持久化结果');
    return container;
  }

  private validatedOutput(container: Record<string, Prisma.JsonValue>) {
    const output = this.object(container?.validatedOutput);
    if (!output) throw new ConflictException('AI 映射输出缺少已验证结果');
    return output;
  }

  private mappingSuggestions(value: Prisma.JsonValue | undefined): VerifiedMappingSuggestion[] {
    if (!Array.isArray(value) || value.length > 200) {
      throw new ConflictException('AI 映射输出的来源列集合无效');
    }
    return value.map((entry) => {
      const item = this.object(entry);
      const evidenceRefs = Array.isArray(item?.evidenceRefs)
        ? item.evidenceRefs.filter((ref): ref is string => typeof ref === 'string')
        : [];
      if (
        typeof item?.sourceRef !== 'string'
        || item.sourceRef.length === 0
        || item.sourceRef.length > 200
        || typeof item.targetFieldKey !== 'string'
        || item.targetFieldKey.length === 0
        || item.targetFieldKey.length > 200
        || typeof item.transformKey !== 'string'
        || item.transformKey.length === 0
        || item.transformKey.length > 100
        || evidenceRefs.length === 0
        || evidenceRefs.length > 32
        || evidenceRefs.some((ref) => ref.length === 0 || ref.length > 200)
        || evidenceRefs.length !== (Array.isArray(item.evidenceRefs) ? item.evidenceRefs.length : -1)
      ) {
        throw new ConflictException('AI 映射输出的字段结构无效');
      }
      return {
        sourceRef: item.sourceRef,
        targetFieldKey: item.targetFieldKey,
        transformKey: item.transformKey,
        confidence: typeof item.confidence === 'string' ? item.confidence : null,
        evidenceRefs
      };
    });
  }

  private sourceRef(column: ReviewColumn) {
    return column.sourceColumnId ?? `column:${column.columnIndex}`;
  }

  private object(value: Prisma.JsonValue | undefined | null): Record<string, Prisma.JsonValue> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, Prisma.JsonValue>
      : undefined;
  }
}
