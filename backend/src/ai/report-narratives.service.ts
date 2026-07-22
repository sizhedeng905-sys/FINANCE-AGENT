import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ReportNarrativeReviewCommand,
  ReportNarrativeReviewStage,
  ReportNarrativeStatus,
  UserRole,
  UserStatus
} from '@prisma/client';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import {
  CanonicalReportSnapshot,
  REPORT_QUERY_VERSION,
  REPORT_SNAPSHOT_SCHEMA_VERSION
} from '../reports/report-snapshot.contract';
import { ReportSnapshotsService } from '../reports/report-snapshots.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  REPORT_NARRATIVE_SCHEMA,
  ReportNarrativeOutput
} from './ai-suggestion.schemas';
import { AiSuggestionValidatorService } from './ai-suggestion-validator.service';
import { AiStructuredSuggestionService } from './ai-structured-suggestion.service';
import { ReportNarrativeGroundingService } from './report-narrative-grounding.service';
import { QueryReportNarrativesDto } from './dto/query-report-narratives.dto';
import { ReviewReportNarrativeDto } from './dto/review-report-narrative.dto';
import {
  deriveReportNarrativeReviewState,
  reportNarrativeTransition
} from './report-narrative-review-state';

export const REPORT_NARRATIVE_VALIDATION_VERSION = 'report-claim-validator/2.0';
export const REPORT_NARRATIVE_AUTHORIZATION_VERSION = 'boss-report-authz/1.0';
export const REPORT_NARRATIVE_TRANSFORM_VERSION = 'report-narrative-transform/1.0';
const REPORT_NARRATIVE_TEMPLATE_VERSION = 'report-snapshot-narrative:v2';
const REPORT_NARRATIVE_TEMPLATE_HASH = canonicalJsonSha256({
  templateVersion: REPORT_NARRATIVE_TEMPLATE_VERSION,
  facts: ['period', 'scope', 'dataPolicy', 'metrics', 'warnings', 'serverClaimCatalog'],
  decision: 'NEEDS_FINANCE_REVIEW'
});

const storedNarrativeInclude = {
  snapshot: { select: { snapshotHash: true } },
  claims: { orderBy: { claimId: 'asc' as const } },
  reviews: { orderBy: { reviewVersion: 'asc' as const } }
} satisfies Prisma.ReportNarrativeInclude;

type StoredNarrative = Prisma.ReportNarrativeGetPayload<{ include: typeof storedNarrativeInclude }>;

@Injectable()
export class ReportNarrativesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: ReportSnapshotsService,
    private readonly executor: AiStructuredSuggestionService,
    private readonly validator: AiSuggestionValidatorService,
    private readonly grounding: ReportNarrativeGroundingService,
    private readonly auditLogs: AuditLogsService,
    private readonly config: ConfigService
  ) {}

  async generate(snapshotId: string, actor: CurrentUser, context: RequestContext) {
    const storedSnapshot = await this.snapshots.getStored(snapshotId);
    const snapshot = storedSnapshot.snapshotJson as unknown as CanonicalReportSnapshot;
    if (snapshot.snapshotId !== storedSnapshot.id || snapshot.snapshotHash !== storedSnapshot.snapshotHash) {
      throw new Error('报告快照完整性校验失败');
    }
    const structuredInput = this.providerInput(snapshot);
    const mockOutput = this.mockOutput(snapshot);
    const execution = await this.executor.execute({
      capability: 'report',
      taskType: 'report_narrative',
      promptKey: 'report_narrative',
      resourceType: 'report_snapshot',
      resourceId: snapshot.snapshotId,
      actor,
      context,
      dataClassification: 'real',
      structuredInput,
      inputAudit: {
        schemaVersion: 'report-narrative-input-audit/1.0',
        snapshotId: snapshot.snapshotId,
        snapshotHash: snapshot.snapshotHash,
        sourceDigest: snapshot.sourceDigest,
        warningCount: snapshot.warnings.length,
        inputBytes: Buffer.byteLength(JSON.stringify(structuredInput), 'utf8')
      },
      outputSchema: REPORT_NARRATIVE_SCHEMA as unknown as Record<string, unknown>,
      source: {
        kind: 'report-snapshot',
        sourceId: snapshot.snapshotId,
        sourceSha256: snapshot.snapshotHash,
        irHash: snapshot.snapshotHash,
        irSchemaVersion: REPORT_SNAPSHOT_SCHEMA_VERSION,
        processorVersion: REPORT_QUERY_VERSION
      },
      template: {
        templateVersionId: REPORT_NARRATIVE_TEMPLATE_VERSION,
        templateContentSha256: REPORT_NARRATIVE_TEMPLATE_HASH,
        candidateSetSha256: REPORT_NARRATIVE_TEMPLATE_HASH
      },
      transformRegistryVersion: REPORT_NARRATIVE_TRANSFORM_VERSION,
      validationRuleVersion: REPORT_NARRATIVE_VALIDATION_VERSION,
      mappingProfileVersion: null,
      authorizationPolicyVersion: REPORT_NARRATIVE_AUTHORIZATION_VERSION,
      mockOutput,
      validate: (text) => {
        const output = this.validator.reportNarrative(text, new Set([snapshot.snapshotId]));
        return this.grounding.validate(snapshot, output).output;
      }
    });

    if (execution.status !== 'succeeded') {
      return {
        status: execution.status,
        snapshotId,
        reasonCode: 'reasonCode' in execution ? execution.reasonCode : undefined,
        message: 'message' in execution ? execution.message : '报告 AI 叙述当前不可用，确定性快照仍可正常查看',
        policy: 'policy' in execution ? execution.policy : undefined,
        aiTaskId: 'aiTaskId' in execution ? execution.aiTaskId : undefined
      };
    }

    const grounded = this.grounding.validate(snapshot, execution.output);
    const narrativeHash = canonicalJsonSha256(grounded.output);
    const narrative = await this.prisma.$transaction(async (tx) => {
      const lockKey = `report-narrative:${snapshotId}:${narrativeHash}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const existing = await tx.reportNarrative.findFirst({
        where: {
          OR: [
            { aiTaskId: execution.aiTaskId },
            {
              snapshotId,
              narrativeHash,
              versionVectorHash: execution.versionVectorHash
            }
          ]
        },
        include: storedNarrativeInclude
      });
      if (existing) return existing;
      const created = await tx.reportNarrative.create({
        data: {
          snapshotId,
          aiTaskId: execution.aiTaskId,
          schemaVersion: grounded.output.schemaVersion,
          title: grounded.output.title,
          summary: grounded.output.summary,
          warningPaths: this.json(grounded.output.warningPaths),
          decision: ReportNarrativeStatus.NEEDS_FINANCE_REVIEW,
          narrativeHash,
          narrativeJson: this.json(grounded.output),
          provider: execution.provider,
          modelName: execution.model,
          promptVersion: execution.promptVersion,
          versionVectorHash: execution.versionVectorHash,
          createdBy: actor.id,
          claims: {
            create: grounded.groundedClaims.map((claim) => ({
              claimId: claim.claimId,
              claimType: claim.claimType,
              text: claim.text,
              sourcePath: claim.sourcePath,
              value: claim.value,
              sourceValueHash: claim.sourceValueHash
            }))
          }
        },
        include: storedNarrativeInclude
      });
      await this.auditLogs.write(
        tx,
        actor,
        'report.narrative.generated',
        'report_narrative',
        created.id,
        {
          snapshotId,
          snapshotHash: snapshot.snapshotHash,
          narrativeHash,
          aiTaskId: execution.aiTaskId,
          provider: execution.provider,
          model: execution.model,
          claimCount: grounded.groundedClaims.length,
          decision: grounded.output.decision
        },
        context
      );
      return created;
    });
    return { status: 'needs_finance_review', narrative: this.present(narrative) };
  }

  async findOne(id: string) {
    const narrative = await this.prisma.reportNarrative.findUnique({
      where: { id },
      include: storedNarrativeInclude
    });
    if (!narrative) throw new NotFoundException('报告 AI 叙述不存在');
    return this.present(narrative);
  }

  async findPending(query: QueryReportNarrativesDto, actor: CurrentUser) {
    const stage = this.reviewStage(actor.role);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.ReportNarrativeWhereInput = stage === ReportNarrativeReviewStage.FINANCE
      ? { reviews: { none: {} } }
      : {
          reviews: {
            some: {
              stage: ReportNarrativeReviewStage.FINANCE,
              command: ReportNarrativeReviewCommand.ACCEPT
            },
            none: { stage: ReportNarrativeReviewStage.BOSS }
          }
        };
    const [items, total] = await Promise.all([
      this.prisma.reportNarrative.findMany({
        where,
        include: storedNarrativeInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.reportNarrative.count({ where })
    ]);
    return {
      items: items.map((item) => this.present(item)),
      page,
      pageSize,
      total,
      policy: this.reviewPolicy()
    };
  }

  async review(
    id: string,
    dto: ReviewReportNarrativeDto,
    actor: CurrentUser,
    context: RequestContext
  ) {
    const policy = this.reviewPolicy();
    if (!policy.enabled) {
      throw new ConflictException('报告 AI 叙述复核策略尚未启用');
    }
    return this.prisma.$transaction(async (tx) => {
      const lockKey = `report-narrative-review:${id}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const account = await tx.user.findUnique({
        where: { id: actor.id },
        select: { id: true, username: true, name: true, role: true, status: true }
      });
      if (!account || account.status !== UserStatus.active || account.role !== actor.role) {
        throw new ForbiddenException('当前账号已停用或权限已变化');
      }
      const stage = this.reviewStage(account.role);
      const narrative = await tx.reportNarrative.findUnique({
        where: { id },
        include: storedNarrativeInclude
      });
      if (!narrative) throw new NotFoundException('报告 AI 叙述不存在');
      if (
        narrative.narrativeHash !== dto.expectedNarrativeHash
        || narrative.snapshot.snapshotHash !== dto.expectedSnapshotHash
      ) {
        throw new ConflictException('报告 AI 叙述或快照依据已变化');
      }
      const current = deriveReportNarrativeReviewState(narrative.reviews);
      if (current.version !== dto.expectedReviewVersion) {
        throw new ConflictException('报告 AI 叙述复核版本已变化');
      }
      let transition;
      try {
        transition = reportNarrativeTransition(stage, current.status, dto.command);
      } catch {
        throw new ConflictException('当前角色不能从该状态执行报告叙述复核');
      }
      const review = await tx.reportNarrativeReviewDecision.create({
        data: {
          narrativeId: narrative.id,
          reviewVersion: transition.reviewVersion,
          stage,
          command: dto.command,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          reason: dto.reason,
          actorUserId: account.id,
          actorUsername: account.username,
          actorName: account.name
        }
      });
      await this.auditLogs.write(
        tx,
        actor,
        'report.narrative.reviewed',
        'report_narrative',
        narrative.id,
        {
          snapshotId: narrative.snapshotId,
          snapshotHash: narrative.snapshot.snapshotHash,
          narrativeHash: narrative.narrativeHash,
          reviewVersion: transition.reviewVersion,
          stage,
          command: dto.command,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          reason: dto.reason,
          policyVersion: policy.policyVersion
        },
        context
      );
      return this.present({ ...narrative, reviews: [...narrative.reviews, review] });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000
    });
  }

  private providerInput(snapshot: CanonicalReportSnapshot) {
    return {
      schemaVersion: 'report-narrative-input/1.0',
      snapshotId: snapshot.snapshotId,
      reportType: snapshot.reportType,
      period: snapshot.period,
      scope: snapshot.scope,
      dataPolicy: snapshot.dataPolicy,
      metrics: snapshot.metrics,
      warnings: snapshot.warnings,
      queryVersion: snapshot.queryVersion,
      sourceDigest: snapshot.sourceDigest,
      snapshotHash: snapshot.snapshotHash,
      allowedClaims: this.grounding.claimCatalog(snapshot),
      requiredWarningPaths: snapshot.warnings.map((_warning, index) => `/warnings/${index}`),
      decision: 'NEEDS_FINANCE_REVIEW'
    };
  }

  private mockOutput(snapshot: CanonicalReportSnapshot): ReportNarrativeOutput {
    const catalog = this.grounding.claimCatalog(snapshot);
    const claims = catalog.filter((claim) => (
      ['/metrics/recordCount', '/metrics/income', '/metrics/cost', '/metrics/profit'].includes(claim.sourcePath)
      || claim.claimType === 'WARNING'
    ));
    const summary = claims.find((claim) => claim.sourcePath === '/metrics/recordCount');
    if (!summary) throw new Error('报告 Claim 白名单缺少记录数');
    return {
      schemaVersion: 'report-narrative/1.0',
      snapshotId: snapshot.snapshotId,
      title: snapshot.reportType === 'WEEKLY'
        ? '经营周报'
        : snapshot.reportType === 'MONTHLY' ? '经营月报' : '经营日报',
      summary: summary.text,
      claims,
      warningPaths: snapshot.warnings.map((_warning, index) => `/warnings/${index}`),
      decision: 'NEEDS_FINANCE_REVIEW'
    };
  }

  private present(narrative: StoredNarrative) {
    const reviewState = deriveReportNarrativeReviewState(narrative.reviews);
    return {
      id: narrative.id,
      snapshotId: narrative.snapshotId,
      snapshotHash: narrative.snapshot.snapshotHash,
      schemaVersion: narrative.schemaVersion,
      title: narrative.title,
      summary: narrative.summary,
      warningPaths: narrative.warningPaths,
      decision: narrative.decision,
      narrativeHash: narrative.narrativeHash,
      provider: narrative.provider,
      model: narrative.modelName,
      promptVersion: narrative.promptVersion,
      versionVectorHash: narrative.versionVectorHash,
      aiTaskId: narrative.aiTaskId,
      claims: narrative.claims.map((claim) => ({
        claimId: claim.claimId,
        claimType: claim.claimType,
        text: claim.text,
        sourcePath: claim.sourcePath,
        value: claim.value,
        sourceValueHash: claim.sourceValueHash
      })),
      review: {
        status: reviewState.status,
        version: reviewState.version,
        policy: this.reviewPolicy(),
        history: narrative.reviews.map((review) => ({
          id: review.id,
          reviewVersion: review.reviewVersion,
          stage: review.stage,
          command: review.command,
          fromStatus: review.fromStatus,
          toStatus: review.toStatus,
          reason: review.reason,
          actor: {
            id: review.actorUserId,
            username: review.actorUsername,
            name: review.actorName
          },
          createdAt: review.createdAt.toISOString()
        }))
      },
      createdAt: narrative.createdAt.toISOString()
    };
  }

  private reviewStage(role: UserRole) {
    if (role === UserRole.finance) return ReportNarrativeReviewStage.FINANCE;
    if (role === UserRole.boss) return ReportNarrativeReviewStage.BOSS;
    throw new ForbiddenException('当前角色不能复核报告 AI 叙述');
  }

  private reviewPolicy() {
    const mode = this.config.get<string>('reportNarrativeReview.mode') ?? 'disabled';
    return {
      mode,
      enabled: mode === 'finance_then_boss',
      policyVersion: 'report-narrative-review/1.0-pending-oq03',
      workflow: 'FINANCE_THEN_BOSS'
    };
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
