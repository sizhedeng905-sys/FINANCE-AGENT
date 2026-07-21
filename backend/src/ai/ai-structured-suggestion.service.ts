import { Injectable } from '@nestjs/common';
import {
  AiCallAttemptStatus,
  AiTaskStatus,
  Prisma
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  AI_POLICY_VERSION,
  AiDataClassification,
  AiFeatureCapability,
  AiFeaturePolicyService,
  AiProviderClass,
  AiScopeModes
} from '../ai-policy/ai-feature-policy.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import {
  AiInvocationVersionVector,
  AiInvocationVersionVectorInput,
  buildAiInvocationVersionVector,
  completeAiInvocationVersionVector
} from '../model-runtime/ai-invocation-version-vector';
import {
  AiPromptRegistryService,
  PreparedAiPromptExecution
} from '../model-runtime/ai-prompt-registry.service';
import {
  modelExecutionSnapshot,
  ResolvedModelDeployment
} from '../model-runtime/model-deployment-config';
import { ModelRuntimeService } from '../model-runtime/model-runtime.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderService } from './ai-provider.service';
import { AiProviderResult } from './ai.types';

const AI_TASK_STALE_MULTIPLIER = 2;
const AI_TASK_MAX_INVOCATIONS = 3;
const AI_TASK_LEASE_GRACE_MS = 30_000;

export interface AiStructuredSuggestionInput<T> {
  capability?: Exclude<AiFeatureCapability, 'assistant'>;
  taskType: string;
  promptKey: string;
  resourceType: string;
  resourceId: string;
  actor: CurrentUser;
  context: RequestContext;
  dataClassification: AiDataClassification;
  scopeModes?: AiScopeModes;
  structuredInput: unknown;
  inputAudit: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  source: AiInvocationVersionVectorInput['source'];
  template: AiInvocationVersionVectorInput['template'];
  transformRegistryVersion: string;
  validationRuleVersion: string;
  mappingProfileVersion: string | null;
  authorizationPolicyVersion: string;
  mockOutput: T;
  validate: (text: string) => T;
}

export type AiStructuredSuggestionResult<T> =
  | { status: 'disabled'; policy: unknown; reasonCode: 'AI_DISABLED' }
  | { status: 'in_progress'; aiTaskId: string; requestKey: string; reused: true }
  | {
      status: 'failed';
      aiTaskId?: string;
      requestKey?: string;
      reasonCode: 'MODEL_ROUTE_UNAVAILABLE' | 'AI_SUGGESTION_FAILED' | 'AI_RETRY_EXHAUSTED';
      message: string;
    }
  | {
      status: 'succeeded';
      aiTaskId: string;
      requestKey: string;
      reused: boolean;
      provider: string;
      providerClass: AiProviderClass;
      model: string;
      promptVersion: string;
      promptExecutionHash: string;
      outputSchemaHash: string;
      output: T;
      outputHash: string;
      versionVectorHash: string;
    };

type PromptBundle = Awaited<ReturnType<AiPromptRegistryService['resolveActive']>>;

interface ClaimedAiTask {
  kind: 'claimed';
  taskId: string;
  attemptId: string;
  attemptNo: number;
  leaseToken: string;
}

interface AttemptCompletionContext<T> {
  input: AiStructuredSuggestionInput<T>;
  claim: ClaimedAiTask;
  requestKey: string;
  correlationId: string;
  vector: AiInvocationVersionVector;
  policySnapshot: ReturnType<AiFeaturePolicyService['snapshot']>;
  promptBundle: PromptBundle;
  promptExecution: PreparedAiPromptExecution;
  deployment: ResolvedModelDeployment;
  providerClass: AiProviderClass;
  latencyMs: number;
}

interface SuccessfulAttemptContext<T> extends AttemptCompletionContext<T> {
  providerResult: AiProviderResult;
  output: T;
  outputHash: string;
  completion: ReturnType<typeof completeAiInvocationVersionVector>;
}

interface FailedAttemptContext<T> extends AttemptCompletionContext<T> {
  errorMessage: string;
}

@Injectable()
export class AiStructuredSuggestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: AiProviderService,
    private readonly policy: AiFeaturePolicyService,
    private readonly promptRegistry: AiPromptRegistryService,
    private readonly modelRuntime: ModelRuntimeService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async execute<T>(input: AiStructuredSuggestionInput<T>): Promise<AiStructuredSuggestionResult<T>> {
    const capability = input.capability ?? 'ingestion';
    const policySnapshot = this.policy.snapshot(capability, input.scopeModes);
    if (policySnapshot.effectiveMode !== 'suggest') {
      return { status: 'disabled', policy: policySnapshot, reasonCode: 'AI_DISABLED' };
    }

    const route = await this.modelRuntime.resolve(input.taskType);
    if (!route) {
      return {
        status: 'failed',
        reasonCode: 'MODEL_ROUTE_UNAVAILABLE',
        message: 'AI 模型路由不可用，任务已转人工映射'
      };
    }
    const deployment = route.deployment;
    const providerClass: AiProviderClass = deployment.provider === 'mock'
      ? 'mock'
      : deployment.isLocal ? 'local' : 'external';
    try {
      this.policy.assertCallAllowed({
        capability,
        providerClass,
        dataClassification: input.dataClassification,
        scopeModes: input.scopeModes
      });
    } catch {
      return {
        status: 'failed',
        reasonCode: 'AI_SUGGESTION_FAILED',
        message: 'AI 数据策略不允许本次调用，任务已转人工映射'
      };
    }

    let promptBundle: PromptBundle;
    let promptExecution: PreparedAiPromptExecution;
    try {
      promptBundle = await this.promptRegistry.resolveActive(input.promptKey, providerClass);
      promptExecution = this.promptRegistry.prepareExecution(
        promptBundle,
        input.structuredInput,
        input.outputSchema
      );
    } catch {
      return {
        status: 'failed',
        reasonCode: 'AI_SUGGESTION_FAILED',
        message: 'AI Prompt Registry 不可用，任务已转人工映射'
      };
    }

    const inputHash = promptExecution.provenance.inputJsonSha256;
    const featurePolicySnapshotHash = canonicalJsonSha256(policySnapshot);
    const vector = buildAiInvocationVersionVector({
      source: input.source,
      template: input.template,
      prompt: {
        promptKey: promptBundle.promptVersion.promptKey,
        versionNo: promptBundle.promptVersion.versionNo,
        contentSha256: promptBundle.promptVersion.contentSha256!,
        bundleSha256: promptBundle.bundleSha256,
        executionSha256: promptExecution.executionSha256
      },
      contracts: {
        inputSchemaVersion: promptBundle.promptVersion.inputSchemaVersion!,
        outputSchemaVersion: promptBundle.promptVersion.outputSchemaVersion!,
        outputSchemaSha256: promptExecution.provenance.outputSchemaSha256
      },
      provider: {
        providerClass,
        provider: deployment.provider,
        deploymentId: deployment.id,
        modelConfigId: null,
        modelName: deployment.modelName,
        modelRevision: deployment.modelVersion ?? null,
        configSha256: deployment.configHash
      },
      transformRegistryVersion: input.transformRegistryVersion,
      validationRuleVersion: input.validationRuleVersion,
      mappingProfileVersion: input.mappingProfileVersion,
      redactionPolicyVersion: promptBundle.promptVersion.redactionPolicyVersion!,
      authorizationPolicyVersion: input.authorizationPolicyVersion,
      featurePolicyVersion: AI_POLICY_VERSION,
      featurePolicySnapshotSha256: featurePolicySnapshotHash,
      inputSha256: inputHash
    });
    const requestKey = canonicalJsonSha256({
      taskType: input.taskType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      vectorSha256: vector.vectorSha256
    });
    const correlationId = input.context.requestId || randomUUID();
    const providerTimeoutMs = Math.min(deployment.timeoutMs, promptBundle.timeoutPolicy.timeoutMs);
    const leaseDurationMs = this.leaseDurationMs(providerTimeoutMs, promptBundle.timeoutPolicy.maxAttempts);
    const claim = await this.claimTask({
      input,
      inputHash,
      requestKey,
      correlationId,
      vector,
      policySnapshot,
      promptExecution,
      leaseDurationMs,
      promptVersionId: promptBundle.promptVersion.id,
      endpointSnapshot: this.endpointSnapshot(deployment.endpoint)
    });
    if (claim.kind === 'existing') {
      return this.readExistingResult(
        input,
        claim.task,
        requestKey,
        inputHash,
        vector,
        providerClass,
        deployment,
        promptBundle
      );
    }
    if (claim.kind === 'running') {
      return { status: 'in_progress', aiTaskId: claim.taskId, requestKey, reused: true };
    }
    if (claim.kind === 'cancelled') {
      return {
        status: 'failed',
        aiTaskId: claim.taskId,
        requestKey,
        reasonCode: 'AI_SUGGESTION_FAILED',
        message: 'AI 建议任务已取消，任务已转人工映射'
      };
    }
    if (claim.kind === 'exhausted') {
      return {
        status: 'failed',
        aiTaskId: claim.taskId,
        requestKey,
        reasonCode: 'AI_RETRY_EXHAUSTED',
        message: 'AI 建议重试次数已耗尽，任务已转人工映射'
      };
    }

    const startedAt = Date.now();
    try {
      const providerResult = await this.provider.generate({
        provider: deployment.provider,
        model: deployment.modelName,
        modelVersion: deployment.modelVersion,
        deploymentId: deployment.id,
        deploymentKey: deployment.key,
        baseUrl: deployment.endpoint,
        apiKey: this.modelRuntime.resolveSecret(deployment.secretRef),
        secretRef: deployment.secretRef ?? undefined,
        timeoutMs: providerTimeoutMs,
        maxAttempts: promptBundle.timeoutPolicy.maxAttempts,
        maxConcurrency: deployment.maxConcurrency,
        maxInputCharacters: promptBundle.maxInputBudget ?? undefined,
        configHash: deployment.configHash,
        capability,
        providerClass,
        dataClassification: input.dataClassification,
        scopeModes: input.scopeModes,
        instructions: promptBundle.instructions,
        question: '',
        history: [],
        contexts: [],
        renderedUserPrompt: promptExecution.renderedUserPrompt,
        outputSchema: promptExecution.outputSchema,
        requestIdempotencyKey: requestKey,
        beforeProviderRequest: () => this.authorizeAndRenewClaim({
          input,
          claim,
          requestKey,
          providerClass,
          leaseDurationMs
        }),
        ...(deployment.provider === 'mock'
          ? { mockScenario: 'success' as const, mockOutput: input.mockOutput }
          : {})
      });
      const output = input.validate(providerResult.text);
      const outputHash = canonicalJsonSha256(output);
      const completion = completeAiInvocationVersionVector(vector, outputHash);
      const latencyMs = Date.now() - startedAt;
      const persisted = await this.completeSuccess({
        input,
        claim,
        requestKey,
        correlationId,
        vector,
        policySnapshot,
        promptBundle,
        promptExecution,
        deployment,
        providerClass,
        providerResult,
        output,
        outputHash,
        completion,
        latencyMs
      });
      if (!persisted) {
        return this.readAfterClaimLoss(
          input,
          requestKey,
          inputHash,
          vector,
          providerClass,
          deployment,
          promptBundle
        );
      }
      return {
        status: 'succeeded',
        aiTaskId: claim.taskId,
        requestKey,
        reused: false,
        provider: deployment.provider,
        providerClass,
        model: deployment.modelName,
        promptVersion: `${promptBundle.promptVersion.promptKey}:v${promptBundle.promptVersion.versionNo}`,
        output,
        outputHash,
        versionVectorHash: vector.vectorSha256,
        promptExecutionHash: promptExecution.executionSha256,
        outputSchemaHash: promptExecution.provenance.outputSchemaSha256
      };
    } catch (error) {
      const errorMessage = this.safeError(error);
      const persisted = await this.completeFailure({
        input,
        claim,
        requestKey,
        correlationId,
        vector,
        policySnapshot,
        promptBundle,
        promptExecution,
        deployment,
        providerClass,
        latencyMs: Date.now() - startedAt,
        errorMessage
      });
      if (!persisted) {
        return this.readAfterClaimLoss(
          input,
          requestKey,
          inputHash,
          vector,
          providerClass,
          deployment,
          promptBundle
        );
      }
      return {
        status: 'failed',
        aiTaskId: claim.taskId,
        requestKey,
        reasonCode: 'AI_SUGGESTION_FAILED',
        message: 'AI 建议不可用或未通过严格校验，任务已转人工映射'
      };
    }
  }

  private async claimTask(args: {
    input: AiStructuredSuggestionInput<unknown>;
    inputHash: string;
    requestKey: string;
    correlationId: string;
    vector: ReturnType<typeof buildAiInvocationVersionVector>;
    policySnapshot: unknown;
    promptExecution: PreparedAiPromptExecution;
    leaseDurationMs: number;
    promptVersionId: string;
    endpointSnapshot: string | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${args.requestKey}, 0))`;
      const existing = await tx.aiTask.findUnique({ where: { requestKey: args.requestKey } });
      if (existing?.status === AiTaskStatus.succeeded) return { kind: 'existing' as const, task: existing };
      if (existing?.status === AiTaskStatus.cancelled) {
        return { kind: 'cancelled' as const, taskId: existing.id };
      }
      const now = new Date();
      const legacyStaleBefore = new Date(now.getTime() - args.leaseDurationMs * AI_TASK_STALE_MULTIPLIER);
      const activeLease = existing?.status === AiTaskStatus.running && (
        (existing.leaseToken && existing.leaseUntil && existing.leaseUntil > now)
        || (!existing.leaseToken && !existing.leaseUntil && existing.startedAt && existing.startedAt > legacyStaleBefore)
      );
      if (activeLease) {
        return { kind: 'running' as const, taskId: existing.id };
      }
      if (existing?.status === AiTaskStatus.running) {
        await tx.aiCallAttempt.updateMany({
          where: { aiTaskId: existing.id, status: AiCallAttemptStatus.running },
          data: {
            status: AiCallAttemptStatus.failed,
            errorMessage: 'AI task lease expired before completion',
            completedAt: new Date()
          }
        });
        await this.auditLogs.write(
          tx,
          args.input.actor,
          'ai.structured_suggestion.lease_expired',
          args.input.resourceType,
          args.input.resourceId,
          {
            aiTaskId: existing.id,
            taskType: args.input.taskType,
            previousLeaseUntil: existing.leaseUntil?.toISOString() ?? null
          },
          args.input.context
        );
      }
      const previousAttempts = existing
        ? await tx.aiCallAttempt.count({ where: { aiTaskId: existing.id } })
        : 0;
      if (previousAttempts >= AI_TASK_MAX_INVOCATIONS) {
        await tx.aiTask.update({
          where: { id: existing!.id },
          data: {
            status: AiTaskStatus.failed,
            leaseToken: null,
            leaseUntil: null,
            errorMessage: 'AI suggestion retry budget exhausted',
            completedAt: now
          }
        });
        await this.auditLogs.write(
          tx,
          args.input.actor,
          'ai.structured_suggestion.retry_exhausted',
          args.input.resourceType,
          args.input.resourceId,
          {
            aiTaskId: existing!.id,
            taskType: args.input.taskType,
            attemptCount: previousAttempts
          },
          args.input.context
        );
        return { kind: 'exhausted' as const, taskId: existing!.id };
      }
      const leaseToken = randomUUID();
      const leaseUntil = new Date(now.getTime() + args.leaseDurationMs);
      const inputPayload = this.json({
        schemaVersion: 'ai-task-input-audit/1.0',
        inputHash: args.inputHash,
        inputAudit: args.input.inputAudit,
        policySnapshot: args.policySnapshot,
        promptExecution: args.promptExecution.provenance,
        promptExecutionHash: args.promptExecution.executionSha256
      });
      const task = existing
        ? await tx.aiTask.update({
            where: { id: existing.id },
            data: {
              status: AiTaskStatus.running,
              inputHash: args.inputHash,
              versionVector: this.json(args.vector),
              versionVectorHash: args.vector.vectorSha256,
              leaseToken,
              leaseUntil,
              inputPayload,
              outputPayload: Prisma.DbNull,
              outputHash: null,
              correlationId: args.correlationId,
              errorMessage: null,
              startedAt: now,
              completedAt: null
            }
          })
        : await tx.aiTask.create({
            data: {
              taskType: args.input.taskType,
              resourceType: args.input.resourceType,
              resourceId: args.input.resourceId,
              status: AiTaskStatus.running,
              requestKey: args.requestKey,
              inputHash: args.inputHash,
              versionVector: this.json(args.vector),
              versionVectorHash: args.vector.vectorSha256,
              leaseToken,
              leaseUntil,
              inputPayload,
              correlationId: args.correlationId,
              createdBy: args.input.actor.id,
              startedAt: now
            }
          });
      const attemptNo = previousAttempts + 1;
      const attempt = await tx.aiCallAttempt.create({
        data: {
          aiTaskId: task.id,
          deploymentId: args.vector.provider.deploymentId,
          promptVersionId: args.promptVersionId,
          attemptNo,
          status: AiCallAttemptStatus.running,
          provider: args.vector.provider.provider,
          modelName: args.vector.provider.modelName,
          modelVersion: args.vector.provider.modelRevision,
          endpointSnapshot: args.endpointSnapshot,
          inputHash: args.inputHash,
          retry: attemptNo > 1,
          correlationId: args.correlationId,
          startedAt: now
        }
      });
      return {
        kind: 'claimed' as const,
        taskId: task.id,
        attemptId: attempt.id,
        attemptNo,
        leaseToken
      };
    });
  }

  private async readExistingResult<T>(
    input: AiStructuredSuggestionInput<T>,
    task: {
      id: string;
      inputHash: string;
      versionVector: Prisma.JsonValue | null;
      outputPayload: Prisma.JsonValue | null;
      outputHash: string | null;
      versionVectorHash: string | null;
    },
    requestKey: string,
    expectedInputHash: string,
    expectedVector: AiInvocationVersionVector,
    providerClass: AiProviderClass,
    deployment: { provider: string; modelName: string },
    promptBundle: PromptBundle
  ): Promise<AiStructuredSuggestionResult<T>> {
    const payload = this.object(task.outputPayload);
    if (
      !payload
      || payload.validatedOutput === undefined
      || !task.outputHash
      || task.inputHash !== expectedInputHash
      || task.versionVectorHash !== expectedVector.vectorSha256
      || canonicalJsonSha256(task.versionVector) !== canonicalJsonSha256(expectedVector)
      || payload.outputHash !== task.outputHash
    ) {
      return {
        status: 'failed',
        aiTaskId: task.id,
        requestKey,
        reasonCode: 'AI_SUGGESTION_FAILED',
        message: '已缓存的 AI 建议不完整，任务已转人工映射'
      };
    }
    try {
      const output = input.validate(JSON.stringify(payload.validatedOutput));
      if (canonicalJsonSha256(output) !== task.outputHash) throw new Error('output hash mismatch');
      const completion = this.object(payload.completion as Prisma.JsonValue | null);
      const expectedCompletion = completeAiInvocationVersionVector(expectedVector, task.outputHash);
      if (
        !completion
        || completion.vectorSha256 !== expectedCompletion.vectorSha256
        || completion.outputSha256 !== expectedCompletion.outputSha256
        || completion.completionSha256 !== expectedCompletion.completionSha256
      ) {
        throw new Error('completion hash mismatch');
      }
      return {
        status: 'succeeded',
        aiTaskId: task.id,
        requestKey,
        reused: true,
        provider: deployment.provider,
        providerClass,
        model: deployment.modelName,
        promptVersion: `${promptBundle.promptVersion.promptKey}:v${promptBundle.promptVersion.versionNo}`,
        promptExecutionHash: expectedVector.prompt.executionSha256,
        outputSchemaHash: expectedVector.contracts.outputSchemaSha256,
        output,
        outputHash: task.outputHash,
        versionVectorHash: task.versionVectorHash
      };
    } catch {
      return {
        status: 'failed',
        aiTaskId: task.id,
        requestKey,
        reasonCode: 'AI_SUGGESTION_FAILED',
        message: '已缓存的 AI 建议未通过完整性校验，任务已转人工映射'
      };
    }
  }

  private async readAfterClaimLoss<T>(
    input: AiStructuredSuggestionInput<T>,
    requestKey: string,
    expectedInputHash: string,
    expectedVector: AiInvocationVersionVector,
    providerClass: AiProviderClass,
    deployment: ResolvedModelDeployment,
    promptBundle: PromptBundle
  ): Promise<AiStructuredSuggestionResult<T>> {
    const current = await this.prisma.aiTask.findUnique({ where: { requestKey } });
    if (current?.status === AiTaskStatus.succeeded) {
      return this.readExistingResult(
        input,
        current,
        requestKey,
        expectedInputHash,
        expectedVector,
        providerClass,
        deployment,
        promptBundle
      );
    }
    if (current?.status === AiTaskStatus.running) {
      return { status: 'in_progress', aiTaskId: current.id, requestKey, reused: true };
    }
    return {
      status: 'failed',
      aiTaskId: current?.id,
      requestKey,
      reasonCode: 'AI_SUGGESTION_FAILED',
      message: 'AI 建议执行权已更新，当前结果不可用，任务已转人工映射'
    };
  }

  private async completeSuccess<T>(args: SuccessfulAttemptContext<T>) {
    const responseHash = this.hashSerialized(args.providerResult.raw ?? null);
    const outputPayload = this.json({
      schemaVersion: 'ai-structured-suggestion-result/1.0',
      validatedOutput: args.output,
      outputHash: args.outputHash,
      completion: args.completion,
      providerResponseHash: responseHash,
      mock: args.providerClass === 'mock'
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${args.requestKey}, 0))`;
      if (!await this.ownsClaim(tx, args)) return false;
      const attempt = await tx.aiCallAttempt.updateMany({
        where: { id: args.claim.attemptId, status: AiCallAttemptStatus.running },
        data: {
          promptVersionId: args.promptBundle.promptVersion.id,
          status: AiCallAttemptStatus.succeeded,
          outputPayload,
          latencyMs: args.latencyMs,
          inputTokens: args.providerResult.inputTokens,
          outputTokens: args.providerResult.outputTokens,
          unitCount: 1,
          completedAt: new Date()
        }
      });
      if (attempt.count !== 1) throw new Error('AI suggestion attempt ownership is inconsistent');
      const task = await tx.aiTask.updateMany({
        where: {
          id: args.claim.taskId,
          status: AiTaskStatus.running,
          leaseToken: args.claim.leaseToken
        },
        data: {
          status: AiTaskStatus.succeeded,
          outputPayload,
          outputHash: args.outputHash,
          outputRef: args.input.resourceId,
          completedAt: new Date(),
          errorMessage: null,
          leaseToken: null,
          leaseUntil: null
        }
      });
      if (task.count !== 1) throw new Error('AI suggestion task ownership changed during completion');
      await tx.aiCallLog.create({
        data: this.callLogData(args, true, null, responseHash)
      });
      await this.auditLogs.write(
        tx,
        args.input.actor,
        'ai.structured_suggestion.succeeded',
        args.input.resourceType,
        args.input.resourceId,
        {
          aiTaskId: args.claim.taskId,
          taskType: args.input.taskType,
          provider: args.deployment.provider,
          providerClass: args.providerClass,
          outputHash: args.outputHash,
          versionVectorHash: args.vector.vectorSha256
        },
        args.input.context
      );
      return true;
    });
  }

  private async completeFailure<T>(args: FailedAttemptContext<T>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${args.requestKey}, 0))`;
      if (!await this.ownsClaim(tx, args)) return false;
      const attempt = await tx.aiCallAttempt.updateMany({
        where: { id: args.claim.attemptId, status: AiCallAttemptStatus.running },
        data: {
          promptVersionId: args.promptBundle.promptVersion.id,
          status: AiCallAttemptStatus.failed,
          latencyMs: args.latencyMs,
          errorMessage: args.errorMessage,
          completedAt: new Date()
        }
      });
      if (attempt.count !== 1) throw new Error('AI suggestion attempt ownership is inconsistent');
      const task = await tx.aiTask.updateMany({
        where: {
          id: args.claim.taskId,
          status: AiTaskStatus.running,
          leaseToken: args.claim.leaseToken
        },
        data: {
          status: AiTaskStatus.failed,
          errorMessage: args.errorMessage,
          completedAt: new Date(),
          leaseToken: null,
          leaseUntil: null
        }
      });
      if (task.count !== 1) throw new Error('AI suggestion task ownership changed during completion');
      await tx.aiCallLog.create({
        data: this.callLogData(args, false, args.errorMessage, null)
      });
      await this.auditLogs.write(
        tx,
        args.input.actor,
        'ai.structured_suggestion.failed',
        args.input.resourceType,
        args.input.resourceId,
        {
          aiTaskId: args.claim.taskId,
          taskType: args.input.taskType,
          provider: args.deployment.provider,
          providerClass: args.providerClass,
          versionVectorHash: args.vector.vectorSha256,
          failureCategory: 'PROVIDER_OR_SCHEMA_REJECTED'
        },
        args.input.context
      );
      return true;
    });
  }

  private async ownsClaim<T>(
    tx: Prisma.TransactionClient,
    args: AttemptCompletionContext<T>
  ) {
    const task = await tx.aiTask.findUnique({
      where: { id: args.claim.taskId },
      select: { status: true, leaseToken: true }
    });
    return task?.status === AiTaskStatus.running && task.leaseToken === args.claim.leaseToken;
  }

  private async authorizeAndRenewClaim<T>(args: {
    input: AiStructuredSuggestionInput<T>;
    claim: ClaimedAiTask;
    requestKey: string;
    providerClass: AiProviderClass;
    leaseDurationMs: number;
  }) {
    this.policy.assertCallAllowed({
      capability: args.input.capability ?? 'ingestion',
      providerClass: args.providerClass,
      dataClassification: args.input.dataClassification,
      scopeModes: args.input.scopeModes
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${args.requestKey}, 0))`;
      const renewed = await tx.aiTask.updateMany({
        where: {
          id: args.claim.taskId,
          status: AiTaskStatus.running,
          leaseToken: args.claim.leaseToken
        },
        data: { leaseUntil: new Date(Date.now() + args.leaseDurationMs) }
      });
      if (renewed.count !== 1) throw new Error('AI suggestion execution lease is no longer owned');
    });
  }

  private callLogData<T>(
    args: SuccessfulAttemptContext<T> | FailedAttemptContext<T>,
    success: boolean,
    errorMessage: string | null,
    responseHash: string | null
  ) {
    const providerConfig = {
      ...modelExecutionSnapshot(args.deployment),
      endpoint: this.endpointSnapshot(args.deployment.endpoint)
    };
    const providerResult = 'providerResult' in args ? args.providerResult : undefined;
    const outputHash = 'outputHash' in args ? args.outputHash : null;
    return {
      deploymentId: args.deployment.id,
      promptVersionId: args.promptBundle.promptVersion.id,
      provider: args.deployment.provider,
      modelName: args.deployment.modelName,
      modelVersion: args.deployment.modelVersion,
      providerConfig: this.json(providerConfig),
      providerConfigHash: args.deployment.configHash,
      secretRef: args.deployment.secretRef,
      requestPayload: this.json({
        schemaVersion: 'ai-structured-call-audit/1.0',
        requestKey: args.requestKey,
        inputHash: args.vector.inputSha256,
        inputAudit: args.input.inputAudit,
        versionVector: args.vector,
        policySnapshot: args.policySnapshot,
        promptExecution: args.promptExecution.provenance,
        promptExecutionHash: args.promptExecution.executionSha256
      }),
      responsePayload: this.json({
        schemaVersion: 'ai-structured-call-audit/1.0',
        responseHash,
        outputHash,
        validated: success,
        mock: args.providerClass === 'mock'
      }),
      inputTokens: providerResult?.inputTokens ?? 0,
      outputTokens: providerResult?.outputTokens ?? 0,
      latencyMs: args.latencyMs,
      success,
      errorMessage,
      endpointSnapshot: this.endpointSnapshot(args.deployment.endpoint),
      inputHash: args.vector.inputSha256,
      correlationId: args.correlationId,
      attemptNo: args.claim.attemptNo,
      fallback: !success,
      createdBy: args.input.actor.id
    } satisfies Prisma.AiCallLogUncheckedCreateInput;
  }

  private leaseDurationMs(timeoutMs: number, maxAttempts: number) {
    const attempts = Math.max(1, maxAttempts);
    const duration = timeoutMs * attempts + AI_TASK_LEASE_GRACE_MS;
    if (!Number.isSafeInteger(duration) || duration <= 0) {
      throw new TypeError('AI suggestion lease duration is invalid');
    }
    return duration;
  }

  private endpointSnapshot(value?: string) {
    if (!value) return null;
    try {
      const endpoint = new URL(value);
      if (!['http:', 'https:'].includes(endpoint.protocol)) return null;
      return `${endpoint.origin}${endpoint.pathname}`.replace(/\/+$/, '');
    } catch {
      return null;
    }
  }

  private safeError(error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown AI suggestion failure';
    return message
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
      .replace(/\b1[3-9]\d{9}\b/g, '[REDACTED_PHONE]')
      .replace(/\b\d{17}[\dXx]\b/g, '[REDACTED_ID]')
      .replace(/\b(?:\d[ -]?){16,19}\b/g, '[REDACTED_ACCOUNT]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
      .replace(/([?&](?:token|key|secret|signature|credential|password)\s*=)[^&#\s]*/gi, '$1[REDACTED]')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 1000);
  }

  private hashSerialized(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
  }

  private object(value: Prisma.JsonValue | null) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, Prisma.JsonValue>
      : undefined;
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
