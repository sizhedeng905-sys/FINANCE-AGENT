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
import { MappingInputDto } from './dto/save-mappings.dto';
import { QueryAiReviewDecisionsDto } from './dto/query-ai-review-decisions.dto';
import { isRegisteredImportTransformKey } from './import-transform-registry';

type ReviewTask = Pick<ImportTask, 'id' | 'templateId' | 'templateVersion' | 'reviewRevision'>;
type ReviewColumn = Pick<ImportColumn, 'id' | 'sourceColumnId' | 'columnIndex'>;

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
      return { count: 0, reviewRevision: task.reviewRevision + 1, decisionCounts: {} };
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
      `${mapping.aiReview!.outputHash}:${mapping.aiReview!.versionVectorHash}`
    )));
    if (
      submittedHashes.size !== 1
      || !submittedHashes.has(`${latest.outputHash}:${latest.versionVectorHash}`)
    ) {
      throw new ConflictException('AI 映射输出哈希或版本向量已变化');
    }

    const output = this.validatedOutput(latest.outputPayload);
    if (canonicalJsonSha256(output) !== latest.outputHash) {
      throw new ConflictException('AI 映射输出内容与持久化哈希不一致');
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
      if (
        review.decision === 'accept'
        && (finalIgnored || mapping.targetFieldId !== suggestedField.id)
      ) {
        throw new BadRequestException('采纳决定的最终字段必须与 AI 建议一致');
      }
      if (review.decision === 'ignore' && !finalIgnored) {
        throw new BadRequestException('忽略决定必须把当前来源列明确标记为忽略');
      }
      if (
        review.decision === 'edit'
        && (finalIgnored || mapping.targetFieldId === suggestedField.id)
      ) {
        throw new BadRequestException('人工编辑决定必须产生与 AI 建议不同的最终映射');
      }
      return {
        importTaskId: task.id,
        importColumnId: column.id,
        aiTaskId,
        outputHash: latest.outputHash!,
        versionVectorHash: latest.versionVectorHash!,
        sourceRef: review.sourceRef,
        templateVersionId: expectedTemplateVersionId,
        suggestedTargetFieldId: suggestedField.id,
        suggestedTargetFieldKey: suggestion.targetFieldKey,
        suggestedTransformKey: suggestion.transformKey,
        suggestedConfidence: suggestion.confidence,
        evidenceRefs: suggestion.evidenceRefs,
        finalTargetFieldId: finalIgnored ? null : mapping.targetFieldId ?? null,
        finalIgnored,
        decision: review.decision as ImportAiReviewDecisionType,
        reason: review.reason,
        reviewRevision: nextReviewRevision,
        actorId: actor.id
      };
    });

    await tx.importAiReviewDecision.createMany({ data: decisions });
    const decisionCounts = decisions.reduce<Record<string, number>>((counts, item) => {
      counts[item.decision] = (counts[item.decision] ?? 0) + 1;
      return counts;
    }, {});
    return {
      count: decisions.length,
      aiTaskId,
      outputHash: latest.outputHash,
      versionVectorHash: latest.versionVectorHash,
      reviewRevision: nextReviewRevision,
      decisionCounts
    };
  }

  async findMany(taskId: string, query: QueryAiReviewDecisionsDto) {
    if (!await this.prisma.importTask.count({ where: { id: taskId } })) {
      throw new NotFoundException('导入任务不存在');
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = {
      importTaskId: taskId,
      ...(query.reviewRevision ? { reviewRevision: query.reviewRevision } : {})
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.importAiReviewDecision.findMany({
        where,
        include: { actor: { select: { id: true, username: true, name: true } } },
        orderBy: [{ reviewRevision: 'desc' }, { sourceRef: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.importAiReviewDecision.count({ where })
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        importTaskId: item.importTaskId,
        importColumnId: item.importColumnId,
        aiTaskId: item.aiTaskId,
        outputHash: item.outputHash,
        versionVectorHash: item.versionVectorHash,
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
      total
    };
  }

  private validatedOutput(payload: Prisma.JsonValue | null) {
    const container = this.object(payload);
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
