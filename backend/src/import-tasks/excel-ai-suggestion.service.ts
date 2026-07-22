import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FileScanStatus,
  ImportTaskStatus,
  MappingProfileStatus,
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
import { PrismaService } from '../prisma/prisma.service';
import {
  EXCEL_AI_MAX_CANDIDATE_TEMPLATES,
  EXCEL_AI_REVIEW_STATE_SCHEMA_VERSION,
  ExcelAiCandidate,
  ExcelAiCandidateTemplate,
  ExcelAiReviewTask,
  excelAiCandidateTemplateInclude,
  excelAiReviewStateHash,
  excelAiReviewTaskInclude,
  toExcelAiCandidate
} from './excel-ai-review-basis';
import {
  IMPORT_TRANSFORM_KEYS,
  IMPORT_TRANSFORM_REGISTRY_VERSION,
  transformKeyForFieldType
} from './import-transform-registry';
import {
  buildMappingProfileSnapshotHash,
  MAPPING_PROFILE_POLICY_VERSION,
  normalizeStructuralText
} from './mapping-profile-fingerprint';

export const EXCEL_AI_VALIDATION_RULE_VERSION = 'excel-ai-mapping-validation/1.0';
export const EXCEL_AI_AUTHORIZATION_POLICY_VERSION = 'finance-import-ai-authz/1.0';

const CLASSIFICATION_INPUT_MAX_BYTES = 20_000;
const MAPPING_INPUT_MAX_BYTES = 28_000;
const MAX_TEMPLATE_FIELDS = 128;
const MAX_SOURCE_COLUMNS = 256;

const candidateTemplateInclude = excelAiCandidateTemplateInclude;
const taskInclude = excelAiReviewTaskInclude;
type SuggestionTask = ExcelAiReviewTask;
type CandidateTemplate = ExcelAiCandidateTemplate;

@Injectable()
export class ExcelAiSuggestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: AiStructuredSuggestionService,
    private readonly validator: AiSuggestionValidatorService
  ) {}

  async suggest(taskId: string, actor: CurrentUser, context: RequestContext) {
    const task = await this.prisma.importTask.findUnique({ where: { id: taskId }, include: taskInclude });
    if (!task) throw new NotFoundException('导入任务不存在');
    this.assertSuggestible(task);

    if (task.mappingProfileId) {
      const profile = task.mappingProfile;
      const currentCandidate = await this.loadCurrentCandidate(task.projectId, task.templateId);
      if (!profile || !currentCandidate || !this.isReusableProfile(task, currentCandidate)) {
        return this.manual('MAPPING_PROFILE_STALE', '已关联的 Mapping Profile 不再满足精确复用条件，必须重新解析或人工映射');
      }
      const rulesBySource = new Map(
        profile.rules.map((rule) => [rule.sourceColumnId, rule])
      );
      return {
        status: 'profile_reused',
        mode: 'manual_approval_required',
        profile: {
          id: profile.id,
          version: task.mappingProfileVersion,
          snapshotHash: task.mappingProfileSnapshotHash,
          structureFingerprint: task.structureFingerprint
        },
        mappings: task.columns.map((column) => ({
          sourceRef: this.sourceRef(column),
          targetFieldId: column.decision?.targetFieldId ?? null,
          targetFieldKey: column.decision?.targetField?.fieldKey ?? null,
          transformKey: rulesBySource.get(this.sourceRef(column))!.transformKey,
          ignored: column.decision?.ignored ?? false,
          source: 'mapping_profile'
        })),
        aiCalls: 0,
        businessRecordsCreated: 0
      };
    }

    const candidates = await this.loadCandidates(task.projectId);
    if (candidates.length === 0) return this.manual('NO_ENABLED_TEMPLATE', '项目没有可用于分类的启用模板');
    if (candidates.length > EXCEL_AI_MAX_CANDIDATE_TEMPLATES) {
      return this.manual('CANDIDATE_BUDGET_EXCEEDED', '候选模板超过安全上限，必须人工选择模板');
    }
    if (task.columns.length === 0 || task.columns.length > MAX_SOURCE_COLUMNS) {
      return this.manual('COLUMN_BUDGET_EXCEEDED', '来源列数量不在 AI 建议安全范围内');
    }
    if (!task.sourceSha256 || !task.irHash || !task.irSchemaVersion || !task.parserVersion) {
      return this.manual('SOURCE_EVIDENCE_INCOMPLETE', '导入来源证据不完整，必须重新解析或人工映射');
    }

    const currentTemplateVersionId = this.templateVersionId(task.templateId, task.templateVersion);
    const currentCandidate = candidates.find((candidate) => candidate.versionId === currentTemplateVersionId);
    if (!currentCandidate) {
      return this.manual('TASK_TEMPLATE_STALE', '任务冻结的模板版本已不在项目启用白名单中');
    }
    const evidenceRefs = new Set(task.columns.map((column) => this.sourceRef(column)));
    if (evidenceRefs.size !== task.columns.length) {
      return this.manual('DUPLICATE_EVIDENCE_REF', '来源列证据引用不唯一');
    }
    const candidateSetHash = canonicalJsonSha256(candidates.map((candidate) => candidate.hashInput));
    const initialStateHash = this.suggestionStateHash(task, candidates);
    const sourceVector = {
      kind: 'excel' as const,
      sourceId: task.id,
      sourceSha256: task.sourceSha256,
      irHash: task.irHash,
      irSchemaVersion: task.irSchemaVersion,
      processorVersion: task.parserVersion
    };
    const classificationInput = this.classificationInput(task, candidates, true);
    const boundedClassificationInput = this.withinBudget(classificationInput, CLASSIFICATION_INPUT_MAX_BYTES)
      ? classificationInput
      : this.classificationInput(task, candidates, false);
    if (!this.withinBudget(boundedClassificationInput, CLASSIFICATION_INPUT_MAX_BYTES)) {
      return this.manual('CLASSIFICATION_INPUT_BUDGET_EXCEEDED', '分类摘要超过 Prompt 安全预算');
    }
    const classificationMock: ClassificationSuggestionOutput = {
      schemaVersion: 'classification/1.0',
      selectedTemplateVersionId: currentTemplateVersionId,
      candidateTemplateVersionIds: [currentTemplateVersionId],
      confidence: '1.0',
      evidenceRefs: [...evidenceRefs],
      reasonCodes: ['MOCK_CURRENT_TEMPLATE'],
      warnings: ['Mock Provider 只用于开发和自动化测试，分类仍需财务审核。'],
      decision: 'NEEDS_FINANCE_REVIEW'
    };
    const classification = await this.executor.execute({
      taskType: 'excel_template_classification',
      promptKey: 'excel_template_classification',
      resourceType: 'import_task',
      resourceId: task.id,
      actor,
      context,
      dataClassification: 'real',
      structuredInput: boundedClassificationInput,
      inputAudit: this.inputAudit(task, candidates.length, 'classification', boundedClassificationInput),
      outputSchema: CLASSIFICATION_SUGGESTION_SCHEMA as unknown as Record<string, unknown>,
      source: sourceVector,
      template: {
        templateVersionId: currentTemplateVersionId,
        templateContentSha256: currentCandidate.contentHash,
        candidateSetSha256: candidateSetHash
      },
      transformRegistryVersion: IMPORT_TRANSFORM_REGISTRY_VERSION,
      validationRuleVersion: EXCEL_AI_VALIDATION_RULE_VERSION,
      mappingProfileVersion: null,
      authorizationPolicyVersion: EXCEL_AI_AUTHORIZATION_POLICY_VERSION,
      mockOutput: classificationMock,
      validate: (text) => this.validator.classification(text, {
        templateVersionIds: new Set(candidates.map((candidate) => candidate.versionId)),
        evidenceRefs
      })
    });
    if (classification.status !== 'succeeded') {
      return this.manualFromExecution('CLASSIFICATION_UNAVAILABLE', classification);
    }

    const refreshed = await this.loadSuggestionState(task.id);
    if (
      !refreshed
      || this.suggestionBlockReason(refreshed.task)
      || this.suggestionStateHash(refreshed.task, refreshed.candidates) !== initialStateHash
    ) {
      return this.manual(
        'SUGGESTION_INPUT_STALE',
        '分类执行期间导入来源、项目模板或任务状态已变化，必须重新获取建议',
        classification
      );
    }
    const activeTask = refreshed.task;
    const activeCandidates = refreshed.candidates;
    const activeCandidateSetHash = canonicalJsonSha256(
      activeCandidates.map((candidate) => candidate.hashInput)
    );
    const mappingReviewStateHash = this.suggestionStateHash(activeTask, activeCandidates);
    const activeEvidenceRefs = new Set(
      activeTask.columns.map((column) => this.sourceRef(column))
    );
    const activeSourceVector = {
      kind: 'excel' as const,
      sourceId: activeTask.id,
      sourceSha256: activeTask.sourceSha256!,
      irHash: activeTask.irHash!,
      irSchemaVersion: activeTask.irSchemaVersion!,
      processorVersion: activeTask.parserVersion!
    };
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

    const selected = activeCandidates.find(
      (candidate) => candidate.versionId === classification.output.selectedTemplateVersionId
    );
    if (!selected) {
      return this.manual(
        'SUGGESTION_INPUT_STALE',
        '分类选择的模板版本已不在当前项目白名单中，必须重新获取建议',
        classification
      );
    }
    if (selected.fields.length > MAX_TEMPLATE_FIELDS) {
      return this.manual('FIELD_BUDGET_EXCEEDED', '目标模板字段超过 AI 建议安全上限', classification);
    }
    const mappingInput = this.mappingInput(activeTask, selected, true);
    const boundedMappingInput = this.withinBudget(mappingInput, MAPPING_INPUT_MAX_BYTES)
      ? mappingInput
      : this.mappingInput(activeTask, selected, false);
    if (!this.withinBudget(boundedMappingInput, MAPPING_INPUT_MAX_BYTES)) {
      return this.manual('MAPPING_INPUT_BUDGET_EXCEEDED', '映射摘要超过 Prompt 安全预算', classification);
    }
    const mappingMock = this.mockMapping(activeTask, selected);
    const selectedFieldKeys = new Set(selected.fields.map((field) => field.fieldKey));
    const requiredFieldKeys = new Set(
      selected.fields.filter((field) => field.required).map((field) => field.fieldKey)
    );
    const transformKeysByField = new Map(
      selected.fields.map((field) => [
        field.fieldKey,
        new Set([transformKeyForFieldType(field.fieldType)])
      ])
    );
    const mapping = await this.executor.execute({
      taskType: 'excel_column_mapping',
      promptKey: 'excel_column_mapping',
      resourceType: 'import_task',
      resourceId: activeTask.id,
      actor,
      context,
      dataClassification: 'real',
      structuredInput: boundedMappingInput,
      inputAudit: this.inputAudit(activeTask, 1, 'mapping', boundedMappingInput),
      outputSchema: MAPPING_SUGGESTION_SCHEMA as unknown as Record<string, unknown>,
      source: activeSourceVector,
      template: {
        templateVersionId: selected.versionId,
        templateContentSha256: selected.contentHash,
        candidateSetSha256: activeCandidateSetHash
      },
      transformRegistryVersion: IMPORT_TRANSFORM_REGISTRY_VERSION,
      validationRuleVersion: EXCEL_AI_VALIDATION_RULE_VERSION,
      mappingProfileVersion: null,
      authorizationPolicyVersion: EXCEL_AI_AUTHORIZATION_POLICY_VERSION,
      reviewState: {
        schemaVersion: EXCEL_AI_REVIEW_STATE_SCHEMA_VERSION,
        stateHash: mappingReviewStateHash
      },
      mockOutput: mappingMock,
      validate: (text) => this.validator.mapping(text, {
        templateVersionIds: new Set([selected.versionId]),
        evidenceRefs: activeEvidenceRefs,
        sourceRefs: activeEvidenceRefs,
        fieldKeys: selectedFieldKeys,
        requiredFieldKeys,
        transformKeysByField,
        requireSourceEvidence: true
      })
    });
    if (mapping.status !== 'succeeded') {
      return this.manualFromExecution('MAPPING_UNAVAILABLE', mapping, classification);
    }
    const completedState = await this.loadSuggestionState(activeTask.id);
    if (
      !completedState
      || this.suggestionBlockReason(completedState.task)
      || this.suggestionStateHash(completedState.task, completedState.candidates) !== mappingReviewStateHash
    ) {
      return this.manualFromExecution('SUGGESTION_OUTPUT_STALE', mapping, classification);
    }
    const fieldByKey = new Map(selected.fields.map((field) => [field.fieldKey, field]));
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
            targetFieldName: fieldByKey.get(item.targetFieldKey)!.fieldName
          }))
        }
      },
      aiCalls: Number(!classification.reused) + Number(!mapping.reused),
      deterministicApplication: {
        rowCount: activeTask.totalRows,
        performed: false,
        reason: '财务批准映射前不会应用到全量行'
      },
      businessRecordsCreated: 0
    };
  }

  async latest(taskId: string) {
    const exists = await this.prisma.importTask.count({ where: { id: taskId } });
    if (!exists) throw new NotFoundException('导入任务不存在');
    const items = await this.prisma.aiTask.findMany({
      where: {
        resourceType: 'import_task',
        resourceId: taskId,
        taskType: { in: ['excel_template_classification', 'excel_column_mapping'] }
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
        error: item.errorMessage ? 'AI 建议不可用，需人工处理' : undefined,
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

  private async loadCandidates(
    projectId: string,
    db: Pick<Prisma.TransactionClient, 'projectTemplate'> = this.prisma
  ) {
    const links = await db.projectTemplate.findMany({
      where: { projectId, isActive: true },
      include: {
        template: {
          include: candidateTemplateInclude
        }
      },
      orderBy: [{ template: { name: 'asc' } }, { templateId: 'asc' }],
      take: EXCEL_AI_MAX_CANDIDATE_TEMPLATES + 1
    });
    return links.map(({ template }) => this.toCandidate(template));
  }

  private async loadSuggestionState(taskId: string) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.importTask.findUnique({
        where: { id: taskId },
        include: taskInclude
      });
      if (!task) return undefined;
      const candidates = await this.loadCandidates(task.projectId, tx);
      return { task, candidates };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async loadCurrentCandidate(projectId: string, templateId: string) {
    const link = await this.prisma.projectTemplate.findFirst({
      where: { projectId, templateId, isActive: true },
      include: { template: { include: candidateTemplateInclude } }
    });
    return link ? this.toCandidate(link.template) : undefined;
  }

  private toCandidate(template: CandidateTemplate) {
    return toExcelAiCandidate(template);
  }

  private isReusableProfile(
    task: SuggestionTask,
    candidate: Awaited<ReturnType<ExcelAiSuggestionService['loadCurrentCandidate']>>
  ) {
    const profile = task.mappingProfile;
    if (!profile || !candidate || !profile.scopeKey || !profile.approvalSnapshotHash) return false;
    if (
      profile.status !== MappingProfileStatus.active
      || !profile.isActive
      || profile.projectId !== task.projectId
      || profile.templateId !== task.templateId
      || profile.templateVersion !== task.templateVersion
      || candidate.version !== task.templateVersion
      || profile.sourceStructureFingerprint !== task.structureFingerprint
      || profile.fingerprintVersion !== task.fingerprintVersion
      || profile.transformRegistryVersion !== task.transformRegistryVersion
      || profile.policyVersion !== MAPPING_PROFILE_POLICY_VERSION
      || profile.profileVersion !== task.mappingProfileVersion
      || task.mappingProfileSnapshotHash !== profile.approvalSnapshotHash
      || task.columns.length === 0
      || profile.rules.length !== task.columns.length
      || task.columns.some((column) => !column.decision)
    ) return false;

    const expectedSnapshotHash = buildMappingProfileSnapshotHash({
      scopeKey: profile.scopeKey,
      profileVersion: profile.profileVersion,
      rules: profile.rules
    });
    if (expectedSnapshotHash !== profile.approvalSnapshotHash) return false;

    const fieldsById = new Map(candidate.fields.map((field) => [field.id, field]));
    const rulesBySource = new Map(profile.rules.map((rule) => [rule.sourceColumnId, rule]));
    if (rulesBySource.size !== profile.rules.length) return false;
    return task.columns.every((column) => {
      const sourceRef = this.sourceRef(column);
      const rule = rulesBySource.get(sourceRef);
      const decision = column.decision;
      if (
        !rule
        || !decision
        || rule.columnIndex !== column.columnIndex
        || rule.normalizedSourceName !== column.normalizedName
        || rule.sourceInferredType !== column.inferredType
        || rule.ignored !== decision.ignored
        || rule.targetFieldId !== decision.targetFieldId
      ) return false;
      if (rule.ignored) return rule.targetFieldId === null && rule.transformKey === 'IDENTITY_V1';
      const field = rule.targetFieldId ? fieldsById.get(rule.targetFieldId) : undefined;
      return field !== undefined && rule.transformKey === transformKeyForFieldType(field.fieldType);
    });
  }

  private suggestionStateHash(
    task: SuggestionTask,
    candidates: ExcelAiCandidate[]
  ) {
    return excelAiReviewStateHash(task, candidates);
  }

  private classificationInput(task: SuggestionTask, candidates: Awaited<ReturnType<ExcelAiSuggestionService['loadCandidates']>>, samples: boolean) {
    return {
      schemaVersion: 'excel-classification-input/1.0',
      sourceId: task.id,
      workbook: {
        sheets: task.sheets.map((sheet) => ({
          evidenceRef: sheet.stableId ?? `sheet${sheet.sheetIndex}`,
          name: this.safeText(sheet.sheetName, 80),
          index: sheet.sheetIndex,
          selectedHeaderRows: sheet.selectedHeaderRows,
          mergedRanges: sheet.mergedRanges,
          rowCount: sheet.rowCount
        })),
        columns: task.columns.map((column) => this.columnSummary(column, samples))
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

  private mappingInput(task: SuggestionTask, candidate: Awaited<ReturnType<ExcelAiSuggestionService['loadCandidates']>>[number], samples: boolean) {
    return {
      schemaVersion: 'excel-mapping-input/1.0',
      sourceId: task.id,
      templateVersionId: candidate.versionId,
      columns: task.columns.map((column) => this.columnSummary(column, samples)),
      fields: candidate.fields.map((field) => ({
        fieldKey: field.fieldKey,
        displayName: field.fieldName,
        fieldType: field.fieldType,
        required: field.required,
        aliases: field.aliases
      })),
      allowedTransformKeys: [...IMPORT_TRANSFORM_KEYS]
    };
  }

  private mockMapping(task: SuggestionTask, candidate: Awaited<ReturnType<ExcelAiSuggestionService['loadCandidates']>>[number]): MappingSuggestionOutput {
    const used = new Set<string>();
    const mappings: MappingSuggestionOutput['mappings'] = [];
    const unmappedSourceRefs: string[] = [];
    for (const column of task.columns) {
      const sourceRef = this.sourceRef(column);
      const decidedKey = column.decision?.targetField && candidate.id === task.templateId
        ? column.decision.targetField.fieldKey
        : undefined;
      const sourceNames = new Set([
        normalizeStructuralText(column.sourceName),
        normalizeStructuralText(column.normalizedName)
      ]);
      const field = candidate.fields.find((item) =>
        !used.has(item.fieldKey) && (
          item.fieldKey === decidedKey ||
          sourceNames.has(normalizeStructuralText(item.fieldKey)) ||
          sourceNames.has(normalizeStructuralText(item.fieldName)) ||
          item.aliases.some((alias) => sourceNames.has(normalizeStructuralText(alias)))
        ));
      if (!field) {
        unmappedSourceRefs.push(sourceRef);
        continue;
      }
      used.add(field.fieldKey);
      mappings.push({
        sourceRef,
        targetFieldKey: field.fieldKey,
        transformKey: transformKeyForFieldType(field.fieldType),
        confidence: '1.0',
        evidenceRefs: [sourceRef]
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
      warnings: ['Mock Provider 只生成可预测建议，禁止自动批准或入库。'],
      decision: 'NEEDS_FINANCE_REVIEW'
    };
  }

  private columnSummary(column: SuggestionTask['columns'][number], samples: boolean) {
    const statistics = this.object(column.statistics);
    return {
      sourceRef: this.sourceRef(column),
      header: this.safeText(column.sourceName, 128),
      normalizedHeader: this.safeText(column.normalizedName, 128),
      columnIndex: column.columnIndex,
      inferredType: this.safeText(column.inferredType, 64),
      statistics: {
        nonEmpty: this.safeCount(statistics?.nonEmpty),
        empty: this.safeCount(statistics?.empty),
        distinctApprox: this.safeCount(statistics?.distinctApprox)
      },
      samples: samples
        ? this.stringArray(column.sampleValues).slice(0, 2).map((sample) => this.safeText(sample, 80))
        : []
    };
  }

  private inputAudit(task: SuggestionTask, candidateCount: number, purpose: string, input: unknown) {
    return {
      purpose,
      sourceId: task.id,
      sourceHash: task.sourceSha256,
      irHash: task.irHash,
      columnCount: task.columns.length,
      candidateCount,
      inputBytes: Buffer.byteLength(JSON.stringify(input), 'utf8'),
      includedFields: ['workbook_structure', 'bounded_samples', 'candidate_template_versions'],
      excludes: ['raw_file_binary', 'full_rows', 'credentials', 'other_projects']
    };
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
      ...this.manual(reasonCode, 'AI 建议不可用，现有人工映射流程仍可继续', classification),
      execution
    };
  }

  private assertSuggestible(task: SuggestionTask) {
    const reason = this.suggestionBlockReason(task);
    if (reason) throw new ConflictException(reason);
  }

  private suggestionBlockReason(task: SuggestionTask) {
    const allowed: ImportTaskStatus[] = [
      ImportTaskStatus.parsed,
      ImportTaskStatus.mapping,
      ImportTaskStatus.pending_confirm
    ];
    if (!allowed.includes(task.status)) return '仅已解析且未开始确认的任务可以生成 AI 建议';
    if (task.project.status !== ProjectStatus.active) return '项目已归档，不能生成 AI 建议';
    if (task.rawFile.isVoided || task.rawFile.status === 'failed' || task.rawFile.scanStatus !== FileScanStatus.clean) {
      return '来源文件已失效，不能生成 AI 建议';
    }
    return undefined;
  }

  private templateVersionId(templateId: string, version: number) {
    return `${templateId}:v${version}`;
  }

  private sourceRef(column: { sourceColumnId: string | null; columnIndex: number }) {
    return column.sourceColumnId ?? `column:${column.columnIndex}`;
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
      .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
      .map((item) => String(item));
  }

  private object(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, Prisma.JsonValue>
      : undefined;
  }

  private safeCount(value: Prisma.JsonValue | undefined) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  private outputValue(value: Prisma.JsonValue | null) {
    const payload = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, Prisma.JsonValue>
      : undefined;
    return payload?.validatedOutput ?? undefined;
  }

  private reviewBasisValue(value: Prisma.JsonValue | null) {
    const payload = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, Prisma.JsonValue>
      : undefined;
    return payload?.reviewBasis ?? undefined;
  }
}
