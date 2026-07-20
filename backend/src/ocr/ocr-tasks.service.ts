import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BusinessRecordStatus,
  FieldDefinition,
  FieldType,
  OcrAttemptStatus,
  OcrTaskStatus,
  Prisma,
  ProjectStatus,
  RawFile,
  RecordSourceType,
  SemanticType
} from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { acquireProjectWriteLock } from '../common/database/project-write-lock';
import { CurrentUser, RequestContext } from '../common/types/current-user';
import { canonicalJsonSha256 } from '../common/utils/canonical-json';
import { toBusinessRecord } from '../data-center/data-center.presenter';
import { FilesService } from '../files/files.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { LedgerEventsService } from '../ledger-events/ledger-events.service';
import { ModelExecutionGateService } from '../model-runtime/model-execution-gate.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecordPolicyService } from '../record-policy/record-policy.service';
import { ConfirmOcrTaskDto } from './dto/confirm-ocr-task.dto';
import { CorrectOcrTaskDto } from './dto/correct-ocr-task.dto';
import { CreateOcrTaskDto } from './dto/create-ocr-task.dto';
import { CreateOcrUploadDto } from './dto/create-ocr-upload.dto';
import { QueryOcrTasksDto } from './dto/query-ocr-tasks.dto';
import { RevalidateOcrTaskDto } from './dto/revalidate-ocr-task.dto';
import { DocumentPreprocessorService, OcrPageSelection } from './document-preprocessor.service';
import {
  normalizeOcrIr,
  OCR_IR_COORDINATE_VERSION,
  OCR_IR_SCHEMA_VERSION,
  OCR_PREPROCESSING_VERSION
} from './ocr-ir';
import { OcrProviderRegistry, ResolvedOcrProvider } from './ocr-provider.registry';
import {
  MockOcrScenario,
  OcrFieldCandidate,
  OcrProviderExecutionConfig,
  OcrProviderResult,
  OcrTemplateField
} from './ocr-provider';
import { ocrTaskDetailInclude, OcrTaskDetail, toOcrTask } from './ocr.presenter';
import { CanonicalOcrFieldCandidate } from './ocr.types';

type PrismaWriter = Prisma.TransactionClient | PrismaService;
type TemplateFieldWithField = OcrTaskDetail['template']['templateFields'][number];
type PreparedOcrTask = {
  resolvedProvider: ResolvedOcrProvider;
  pageSelection: OcrPageSelection;
  pages: Awaited<ReturnType<DocumentPreprocessorService['inspect']>>;
};
type OcrValidationIssue = {
  code: string;
  fieldId: string | null;
  message: string;
  evidenceRefs: string[];
};
const MAX_OCR_RESULT_BYTES = 2 * 1024 * 1024;
export const OCR_DETERMINISTIC_VALIDATION_RULE_VERSION = 'ocr-deterministic-validation/1.0';

@Injectable()
export class OcrTasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OcrTasksService.name);
  private readonly lowConfidenceThreshold: number;
  private readonly maxRetries: number;
  private readonly processingLeaseMs: number;
  private readonly recoveryIntervalMs: number;
  private readonly processRole: string;
  private readonly backgroundJobs = new Map<string, Promise<void>>();
  private stopping = false;
  private leaseReaper?: NodeJS.Timeout;
  private recoveryJob?: Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly preprocessor: DocumentPreprocessorService,
    private readonly providers: OcrProviderRegistry,
    private readonly auditLogs: AuditLogsService,
    private readonly ledgerEvents: LedgerEventsService,
    private readonly recordPolicy: RecordPolicyService,
    private readonly idempotency: IdempotencyService,
    private readonly executionGate: ModelExecutionGateService,
    config: ConfigService
  ) {
    this.lowConfidenceThreshold = config.get<number>('ocr.lowConfidenceThreshold') ?? 0.8;
    this.maxRetries = config.get<number>('ocr.maxRetries') ?? 2;
    const providerTimeoutMs = config.get<number>('ocr.timeoutMs') ?? 30_000;
    this.processingLeaseMs = Math.max(
      5_000,
      config.get<number>('ocr.processingLeaseMs') ?? providerTimeoutMs * 2 + 30_000
    );
    this.recoveryIntervalMs = Math.max(
      1_000,
      config.get<number>('worker.pollIntervalMs') ?? config.get<number>('ocr.recoveryIntervalMs') ?? 5_000
    );
    this.processRole = config.get<string>('processRole') ?? 'all';
  }

  onModuleInit() {
    if (!this.canRunBackgroundJobs()) return;
    this.scheduleRecovery();
    this.leaseReaper = setInterval(() => this.scheduleRecovery(), this.recoveryIntervalMs);
    this.leaseReaper.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.leaseReaper) clearInterval(this.leaseReaper);
    if (this.recoveryJob) await this.recoveryJob;
    await Promise.allSettled(this.backgroundJobs.values());
  }

  private scheduleRecovery() {
    if (this.stopping || this.recoveryJob) return;
    const active = this.recoverRunnableTasks().finally(() => {
      if (this.recoveryJob === active) this.recoveryJob = undefined;
    });
    this.recoveryJob = active;
  }

  private async recoverRunnableTasks() {
    await this.recoverExpiredTasks();
    await this.recoverQueuedTasks();
  }

  async recoverExpiredTasks() {
    let recovered = 0;
    try {
      const expired = await this.prisma.ocrTask.findMany({
        where: { status: OcrTaskStatus.processing, leaseUntil: { lt: new Date() } },
        select: { id: true },
        orderBy: { leaseUntil: 'asc' },
        take: 100
      });
      for (const task of expired) {
        await this.prisma.$transaction(async (tx) => {
          await this.lockTask(tx, task.id);
          const current = await tx.ocrTask.findUnique({ where: { id: task.id } });
          if (
            current?.status === OcrTaskStatus.processing &&
            current.leaseUntil &&
            current.leaseUntil.getTime() < Date.now()
          ) {
            await tx.ocrAttempt.updateMany({
              where: { ocrTaskId: task.id, status: OcrAttemptStatus.processing },
              data: {
                status: OcrAttemptStatus.failed,
                completedAt: new Date(),
                errorMessage: 'OCR 处理租约已过期'
              }
            });
            const exhausted = current.attemptCount >= this.maxRetries + 1;
            await tx.ocrTask.update({
              where: { id: task.id },
              data: {
                status: exhausted ? OcrTaskStatus.failed : OcrTaskStatus.queued,
                queuedAt: exhausted ? null : new Date(),
                errorMessage: exhausted ? 'OCR 处理恢复次数已达上限' : null,
                leaseToken: null,
                leaseUntil: null,
                version: { increment: 1 }
              }
            });
            if (!exhausted) recovered += 1;
          }
        });
      }
    } catch (error) {
      this.logger.warn(`OCR lease reaper failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    return recovered;
  }

  async recoverQueuedTasks() {
    try {
      const queued = await this.prisma.ocrTask.findMany({
        where: { status: OcrTaskStatus.queued },
        select: { id: true },
        orderBy: [{ queuedAt: 'asc' }, { createdAt: 'asc' }],
        take: 100
      });
      for (const task of queued) this.scheduleTask(task.id);
      return queued.length;
    } catch (error) {
      this.logger.warn(`OCR queue recovery failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return 0;
    }
  }

  async create(
    dto: CreateOcrTaskDto,
    actor: CurrentUser,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    const rawFile = await this.prisma.rawFile.findUnique({ where: { id: dto.rawFileId } });
    if (!rawFile || rawFile.isVoided) throw new NotFoundException('原始文件不存在');
    if (rawFile.relatedProjectId !== dto.projectId) throw new BadRequestException('原始文件与 OCR 项目不一致');
    const scope = this.idempotency.prepare(
      actor.id,
      'POST',
      '/api/ocr-tasks',
      idempotencyKey,
      { ...dto, rawFileSha256: rawFile.sha256 },
      false
    );
    const prepared = await this.prepareTask(dto, actor);
    return this.prisma.$transaction((tx) => this.idempotency.execute(
      tx,
      scope,
      201,
      () => this.createTaskWithinTransaction(
        tx,
        dto,
        rawFile,
        prepared,
        actor,
        context,
        this.idempotency.persistenceKey(scope)
      )
    ));
  }

  async createFromUpload(
    file: Express.Multer.File | undefined,
    dto: CreateOcrUploadDto,
    actor: CurrentUser,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    if (!file) throw new BadRequestException('请选择 OCR 原始文件');

    const rawFile = await this.files.upload(
      file,
      { relatedProjectId: dto.projectId },
      actor,
      context
    );
    const scope = this.idempotency.prepare(
      actor.id,
      'POST',
      '/api/ocr-tasks/upload',
      idempotencyKey,
      {
        ...dto,
        file: {
          name: rawFile.originalFileName,
          size: rawFile.fileSize,
          sha256: rawFile.sha256
        }
      },
      false
    );
    try {
      const prepared = await this.prepareTask({
        rawFileId: rawFile.id,
        projectId: dto.projectId,
        templateId: dto.templateId,
        mockScenario: dto.mockScenario,
        pageStart: dto.pageStart,
        pageEnd: dto.pageEnd
      }, actor);
      const task = await this.prisma.$transaction((tx) => this.idempotency.execute(tx, scope, 201, () =>
        this.createTaskWithinTransaction(tx, {
          rawFileId: rawFile.id,
          projectId: dto.projectId,
          templateId: dto.templateId,
          mockScenario: dto.mockScenario,
          pageStart: dto.pageStart,
          pageEnd: dto.pageEnd
        }, rawFile, prepared, actor, context, this.idempotency.persistenceKey(scope))
      ));
      if (task.rawFileId !== rawFile.id) {
        await this.files.discardFailedUpload(
          rawFile.id,
          actor,
          context,
          'OCR 幂等请求已绑定既有任务，重复上传文件已清理'
        );
      }
      return task;
    } catch (error) {
      await this.files.discardFailedUpload(
        rawFile.id,
        actor,
        context,
        'OCR 任务创建失败，原文件已清理'
      ).catch(() => undefined);
      throw error;
    }
  }

  private async createTaskWithinTransaction(
    tx: Prisma.TransactionClient,
    dto: CreateOcrTaskDto,
    rawFile: Pick<RawFile, 'sha256'>,
    prepared: PreparedOcrTask,
    actor: CurrentUser,
    context: RequestContext,
    persistenceIdempotencyKey?: string
  ) {
    await acquireProjectWriteLock(tx, dto.projectId);
    const template = await this.recordPolicy.getWritableTemplate(tx, dto.projectId, dto.templateId);
    const { resolvedProvider, pageSelection, pages } = prepared;
    const provider = resolvedProvider.provider;
    const snapshot = resolvedProvider.config;
    const executionSnapshot = this.providerExecutionSnapshot(snapshot);
    const providerOptions = this.providerOptions(dto.mockScenario, pageSelection);

    const task = await tx.ocrTask.create({
      data: {
        rawFileId: dto.rawFileId,
        projectId: dto.projectId,
        templateId: dto.templateId,
        templateVersion: template.version,
        templateSnapshot: this.recordPolicy.toSnapshot(template),
        provider: snapshot.provider,
        modelName: snapshot.modelName,
        modelVersion: snapshot.modelVersion,
        endpointSnapshot: snapshot.endpoint,
        providerConfig: this.json(executionSnapshot),
        providerConfigHash: snapshot.configHash,
        providerOptions: providerOptions ? this.json(providerOptions) : undefined,
        sourceSha256: rawFile.sha256,
        pages: this.json(pages),
        pageCount: pages.length,
        uploadedBy: actor.id,
        idempotencyKey: persistenceIdempotencyKey
      }
    });
    await this.auditLogs.write(tx, actor, 'ocr_task.create', 'ocr_task', task.id, this.json({
      rawFileId: task.rawFileId,
      projectId: task.projectId,
      templateId: task.templateId,
      provider: task.provider,
      pageCount: task.pageCount,
      pageRange: pageSelection.pageStart ? pageSelection : null
    }), context);
    await this.ledgerEvents.write(tx, actor, 'ocr_task_created', 'ocr_task', task.id, this.json({
      rawFileId: task.rawFileId,
      sha256: rawFile.sha256,
      provider: task.provider,
      pageRange: pageSelection.pageStart ? pageSelection : null
    }));
    return toOcrTask(await this.findDetailOrThrow(task.id, tx));
  }

  private async prepareTask(dto: CreateOcrTaskDto, actor: CurrentUser): Promise<PreparedOcrTask> {
    const [resolvedProvider, file] = await Promise.all([
      this.providers.resolve(),
      this.files.readForProcessing(dto.rawFileId, actor)
    ]);
    if (dto.mockScenario && resolvedProvider.provider.name !== 'mock') {
      throw new BadRequestException('mockScenario 仅可用于 Mock OCR Provider');
    }
    const pageSelection = this.pageSelectionFromDto(dto);
    const pages = await this.preprocessor.inspect(file.buffer, file.mimeType, pageSelection);
    return { resolvedProvider, pageSelection, pages };
  }

  async findMany(query: QueryOcrTasksDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.OcrTaskWhereInput = { projectId: query.projectId, status: query.status };
    const [items, total] = await Promise.all([
      this.prisma.ocrTask.findMany({
        where,
        include: ocrTaskDetailInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.ocrTask.count({ where })
    ]);
    return { items: items.map(toOcrTask), page, pageSize, total };
  }

  async findOne(id: string) {
    return toOcrTask(await this.findDetailOrThrow(id));
  }

  async run(id: string, actor: CurrentUser, context: RequestContext) {
    const queued = await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await this.findDetailOrThrow(id, tx);
      if (task.status === OcrTaskStatus.pending_confirm || task.status === OcrTaskStatus.confirmed) {
        return toOcrTask(task);
      }
      if (task.status === OcrTaskStatus.cancelled) {
        throw new ConflictException('已取消任务不能识别');
      }
      if (task.status === OcrTaskStatus.failed) {
        throw new ConflictException('失败任务请使用重试接口');
      }
      if (
        task.status === OcrTaskStatus.processing &&
        task.leaseUntil &&
        task.leaseUntil.getTime() > Date.now()
      ) {
        throw new ConflictException('OCR 任务正在识别中');
      }
      if (task.status === OcrTaskStatus.processing) {
        await tx.ocrAttempt.updateMany({
          where: { ocrTaskId: id, status: OcrAttemptStatus.processing },
          data: {
            status: OcrAttemptStatus.failed,
            completedAt: new Date(),
            errorMessage: 'OCR 处理租约过期后重新排队'
          }
        });
      }
      if (task.status !== OcrTaskStatus.queued || !task.runRequestedBy) {
        await tx.ocrTask.update({
          where: { id },
          data: {
            status: OcrTaskStatus.queued,
            queuedAt: task.queuedAt ?? new Date(),
            runRequestedBy: actor.id,
            runRequestId: context.requestId ?? randomUUID(),
            errorMessage: null,
            leaseToken: null,
            leaseUntil: null,
            version: { increment: 1 }
          }
        });
        await this.auditLogs.write(tx, actor, 'ocr_task.queued', 'ocr_task', id, {
          previousStatus: task.status
        }, context);
        await this.ledgerEvents.write(
          tx,
          actor,
          'ocr_task_queued',
          'ocr_task',
          id,
          { previousStatus: task.status },
          `ocr_task:${id}:queued:${task.attemptCount + 1}`
        );
      }
      return toOcrTask(await this.findDetailOrThrow(id, tx));
    });
    this.scheduleTask(id);
    return queued;
  }

  private async executeQueuedTask(
    id: string,
    actor: CurrentUser,
    context: RequestContext,
    executionConfig: OcrProviderExecutionConfig
  ) {
    const executionSnapshot = this.providerExecutionSnapshot(executionConfig);
    const prepared = await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await this.findDetailOrThrow(id, tx);
      if (task.providerConfigHash && task.providerConfigHash !== executionConfig.configHash) {
        throw new ConflictException('OCR task provider configuration snapshot changed');
      }
      const completedStatuses: OcrTaskStatus[] = [OcrTaskStatus.pending_confirm, OcrTaskStatus.confirmed];
      if (completedStatuses.includes(task.status)) {
        return { skipped: true as const, task };
      }
      if (
        task.status === OcrTaskStatus.processing &&
        task.leaseToken &&
        task.leaseUntil &&
        task.leaseUntil.getTime() > Date.now()
      ) {
        throw new ConflictException('OCR 任务正在识别中');
      }
      if (task.status === OcrTaskStatus.failed) throw new ConflictException('失败任务请使用重试接口');
      if (task.status === OcrTaskStatus.cancelled) throw new ConflictException('已取消任务不能识别');

      if (task.status === OcrTaskStatus.processing) {
        await tx.ocrAttempt.updateMany({
          where: { ocrTaskId: id, status: OcrAttemptStatus.processing },
          data: {
            status: OcrAttemptStatus.failed,
            completedAt: new Date(),
            errorMessage: '处理租约已过期，由后续任务回收'
          }
        });
      }

      const attemptNo = task.attemptCount + 1;
      const correlationId = context.requestId || randomUUID();
      const leaseToken = randomUUID();
      const attempt = await tx.ocrAttempt.create({
        data: {
          ocrTaskId: id,
          attemptNo,
          status: OcrAttemptStatus.processing,
          provider: executionConfig.provider,
          modelName: executionConfig.modelName,
          modelVersion: executionConfig.modelVersion,
          endpointSnapshot: executionConfig.endpoint,
          providerConfig: this.json(executionSnapshot),
          providerConfigHash: executionConfig.configHash,
          secretRef: executionConfig.secretRef,
          inputSha256: task.rawFile.sha256,
          correlationId,
          startedAt: new Date()
        }
      });
      await tx.ocrTask.update({
        where: { id },
        data: {
          status: OcrTaskStatus.processing,
          attemptCount: attemptNo,
          provider: task.providerConfig === null ? executionConfig.provider : undefined,
          modelName: task.providerConfig === null ? executionConfig.modelName : undefined,
          modelVersion: task.providerConfig === null ? executionConfig.modelVersion : undefined,
          endpointSnapshot: task.providerConfig === null ? executionConfig.endpoint : undefined,
          providerConfig: task.providerConfig === null ? this.json(executionSnapshot) : undefined,
          providerConfigHash: task.providerConfigHash ?? executionConfig.configHash,
          errorMessage: null,
          leaseToken,
          leaseUntil: new Date(Date.now() + this.processingLeaseMs),
          version: { increment: 1 }
        }
      });
      await this.auditLogs.write(tx, actor, 'ocr_task.run_started', 'ocr_task', id, {
        attemptNo,
        correlationId,
        provider: executionConfig.provider,
        modelName: executionConfig.modelName,
        providerConfigHash: executionConfig.configHash
      }, context);
      return { skipped: false as const, task, attempt, leaseToken };
    });

    if (prepared.skipped) return toOcrTask(prepared.task);

    const startedAt = Date.now();
    const heartbeat = setInterval(() => {
      void this.prisma.ocrTask.updateMany({
        where: {
          id,
          status: OcrTaskStatus.processing,
          leaseToken: prepared.leaseToken
        },
        data: { leaseUntil: new Date(Date.now() + this.processingLeaseMs) }
      }).catch((error) => this.logger.warn(
        `OCR heartbeat failed for ${id}: ${error instanceof Error ? error.message : 'unknown error'}`
      ));
    }, Math.max(1_000, Math.floor(this.processingLeaseMs / 3)));
    heartbeat.unref();
    try {
      const file = await this.files.readForProcessing(prepared.task.rawFileId, actor);
      const document = await this.preprocessor.prepare(
        file.buffer,
        file.mimeType,
        this.pageSelection(prepared.task.providerOptions)
      );
      const pages = document.pages;
      const provider = this.providers.byName(executionConfig.provider);
      const result = await provider.recognize({
        documentId: id,
        rawFileId: prepared.task.rawFileId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sha256: file.sha256,
        buffer: document.buffer,
        pages,
        fields: this.providerFields(prepared.task.template.templateFields),
        attemptNo: prepared.attempt.attemptNo,
        scenario: this.mockScenario(prepared.task.providerOptions)
      }, executionConfig);
      if (result.documentId !== id) throw new BadGatewayException('OCR Provider 返回了错误的 documentId');
      this.assertProviderResultLimits(result);
      const normalizedIr = normalizeOcrIr({
        sourceId: id,
        sourceSha256: file.sha256,
        providerVersion: [
          executionConfig.provider,
          executionConfig.modelName,
          executionConfig.modelVersion ?? 'unknown',
          executionConfig.configHash ?? 'unversioned'
        ].join('/'),
        pages,
        textBlocks: result.textBlocks,
        fieldCandidates: result.fieldCandidates
      });
      const candidates = this.canonicalizeCandidates(
        result.fieldCandidates,
        prepared.task.template.templateFields,
        prepared.task.rawFileId,
        normalizedIr.candidateEvidenceRefs
      );
      const latencyMs = Date.now() - startedAt;
      const extractedFields = this.extractedFields(candidates);
      const fieldConfidence = this.fieldConfidence(candidates);
      const avgConfidence = this.averageConfidence(candidates);

      await this.prisma.$transaction(async (tx) => {
        await this.lockTask(tx, id);
        const current = await tx.ocrTask.findUnique({ where: { id }, select: { status: true, leaseToken: true } });
        if (
          !current ||
          current.status !== OcrTaskStatus.processing ||
          current.leaseToken !== prepared.leaseToken
        ) {
          throw new ConflictException('OCR 处理租约已失效，识别结果未写入');
        }
        const now = new Date();
        await tx.ocrAttempt.update({
          where: { id: prepared.attempt.id },
          data: {
            status: OcrAttemptStatus.succeeded,
            completedAt: now,
            latencyMs,
            pageCount: pages.length,
            rawResult: this.json(result.rawResult),
            rawResultRef: result.rawResultRef,
            errorMessage: null
          }
        });
        await tx.ocrTask.update({
          where: { id },
          data: {
            status: OcrTaskStatus.pending_confirm,
            extractedText: result.extractedText.slice(0, 100000),
            extractedFields: this.json(extractedFields),
            fieldConfidence: this.json(fieldConfidence),
            pages: this.json(pages),
            textBlocks: this.json(normalizedIr.normalizedTextBlocks),
            tables: this.json(result.tables),
            fieldCandidates: this.json(candidates),
            reviewRevision: 0,
            validationRevision: null,
            validationSnapshot: Prisma.DbNull,
            validationSnapshotHash: null,
            validationRuleVersion: null,
            validatedAt: null,
            sourceSha256: file.sha256,
            irSchemaVersion: OCR_IR_SCHEMA_VERSION,
            irHash: normalizedIr.ir.hash,
            coordinateVersion: OCR_IR_COORDINATE_VERSION,
            preprocessingVersion: OCR_PREPROCESSING_VERSION,
            normalizedIr: this.json(normalizedIr.ir),
            rawResult: this.json(result.rawResult),
            rawResultRef: result.rawResultRef,
            pageCount: pages.length,
            avgConfidence: new Prisma.Decimal(avgConfidence),
            latencyMs,
            errorMessage: null,
            leaseToken: null,
            leaseUntil: null,
            version: { increment: 1 }
          }
        });
        await this.auditLogs.write(tx, actor, 'ocr_task.run_succeeded', 'ocr_task', id, {
          attemptNo: prepared.attempt.attemptNo,
          latencyMs,
          pageCount: pages.length,
          irSchemaVersion: OCR_IR_SCHEMA_VERSION,
          irHash: normalizedIr.ir.hash,
          lowConfidenceFields: candidates.filter((candidate) => candidate.lowConfidence).map((candidate) => candidate.fieldId)
        }, context);
        await this.ledgerEvents.write(
          tx,
          actor,
          'ocr_task_recognized',
          'ocr_task',
          id,
          {
            attemptNo: prepared.attempt.attemptNo,
            latencyMs,
            pageCount: pages.length,
            avgConfidence,
            irSchemaVersion: OCR_IR_SCHEMA_VERSION,
            irHash: normalizedIr.ir.hash
          },
          `ocr_task:${id}:attempt:${prepared.attempt.attemptNo}:recognized`
        );
      });
      return toOcrTask(await this.findDetailOrThrow(id));
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = this.safeErrorMessage(error);
      await this.prisma.$transaction(async (tx) => {
        await this.lockTask(tx, id);
        await tx.ocrAttempt.updateMany({
          where: { id: prepared.attempt.id, status: OcrAttemptStatus.processing },
          data: {
            status: OcrAttemptStatus.failed,
            completedAt: new Date(),
            latencyMs,
            errorMessage: message
          }
        });
        const updated = await tx.ocrTask.updateMany({
          where: { id, status: OcrTaskStatus.processing, leaseToken: prepared.leaseToken },
          data: {
            status: OcrTaskStatus.failed,
            latencyMs,
            errorMessage: message,
            leaseToken: null,
            leaseUntil: null,
            version: { increment: 1 }
          }
        });
        if (updated.count === 1) {
          await this.auditLogs.write(tx, actor, 'ocr_task.run_failed', 'ocr_task', id, {
            attemptNo: prepared.attempt.attemptNo,
            latencyMs,
            error: message
          }, context);
          await this.ledgerEvents.write(
            tx,
            actor,
            'ocr_task_failed',
            'ocr_task',
            id,
            { attemptNo: prepared.attempt.attemptNo, error: message },
            `ocr_task:${id}:attempt:${prepared.attempt.attemptNo}:failed`
          );
        }
      });
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException(`OCR 识别失败：${message}`);
    } finally {
      clearInterval(heartbeat);
    }
  }

  async retry(id: string, actor: CurrentUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.ocrTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('资源不存在');
      if (task.status !== OcrTaskStatus.failed) throw new ConflictException('只有失败的 OCR 任务可以重试');
      if (task.retryCount >= this.maxRetries) throw new ConflictException('OCR 重试次数已达上限');
      await tx.ocrTask.update({
        where: { id },
        data: {
          status: OcrTaskStatus.queued,
          queuedAt: new Date(),
          runRequestedBy: actor.id,
          runRequestId: context.requestId ?? randomUUID(),
          retryCount: { increment: 1 },
          errorMessage: null,
          leaseToken: null,
          leaseUntil: null,
          version: { increment: 1 }
        }
      });
      await this.auditLogs.write(tx, actor, 'ocr_task.retry', 'ocr_task', id, {
        retryCount: task.retryCount + 1
      }, context);
      await this.ledgerEvents.write(tx, actor, 'ocr_task_retried', 'ocr_task', id, {
        retryCount: task.retryCount + 1
      });
    });
    return this.run(id, actor, context);
  }

  async correct(id: string, dto: CorrectOcrTaskDto, actor: CurrentUser, context: RequestContext) {
    const uniqueFieldIds = new Set(dto.corrections.map((correction) => correction.fieldId));
    if (uniqueFieldIds.size !== dto.corrections.length) throw new BadRequestException('同一字段不能在一次请求中重复纠错');

    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await this.findDetailOrThrow(id, tx);
      if (task.status !== OcrTaskStatus.pending_confirm) throw new ConflictException('当前 OCR 状态不能人工纠错');
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== task.version) {
        throw new ConflictException('OCR task version changed; refresh before saving corrections');
      }
      if (
        dto.expectedReviewRevision !== undefined
        && dto.expectedReviewRevision !== task.reviewRevision
      ) {
        throw new ConflictException('OCR review revision changed; refresh before saving corrections');
      }
      const candidates = this.candidateArray(task.fieldCandidates);
      const fields = new Map(task.template.templateFields.map((item) => [item.fieldId, item]));
      const evidenceIndex = this.reviewEvidenceIndex(task);
      const nextReviewRevision = task.reviewRevision + 1;

      for (const correction of dto.corrections) {
        const templateField = fields.get(correction.fieldId);
        if (!templateField || !templateField.isVisible || !templateField.field.isActive) {
          throw new BadRequestException('纠错字段不属于当前模板或已停用');
        }
        const index = candidates.findIndex((candidate) => candidate.fieldId === correction.fieldId);
        if (index < 0) throw new BadRequestException('OCR 字段候选不存在');
        const before = candidates[index];
        const normalized = this.normalizeFieldValue(templateField.field, correction.correctedValue, task.rawFileId);
        const reason = correction.reason.trim();
        const previousEvidenceRefs = Array.isArray(before.evidenceRefs) ? before.evidenceRefs : [];
        const evidenceRefs = correction.evidenceRefs
          ? [...correction.evidenceRefs]
          : previousEvidenceRefs.length > 0
            ? [...previousEvidenceRefs]
            : [`raw-file:${task.rawFileId}`];
        for (const evidenceRef of evidenceRefs) {
          if (!evidenceIndex.has(evidenceRef)) {
            throw new BadRequestException(`OCR correction evidence is not part of this source: ${evidenceRef}`);
          }
        }
        candidates[index] = {
          ...before,
          rawValue: correction.correctedValue,
          normalizedValue: normalized,
          confidence: 1,
          evidence: reason,
          evidenceRefs,
          valueSource: 'MANUAL_OVERRIDE',
          reviewRevision: nextReviewRevision,
          evidenceConflict: false,
          alternatives: [],
          missing: false,
          lowConfidence: false,
          corrected: true,
          validationError: undefined
        };
        await tx.ocrCorrection.create({
          data: {
            ocrTaskId: id,
            fieldId: correction.fieldId,
            fieldName: templateField.field.fieldName,
            beforeValue: this.displayValue(before.normalizedValue),
            afterValue: this.displayValue(normalized),
            originalConfidence: new Prisma.Decimal(before.confidence),
            reason,
            reviewRevision: nextReviewRevision,
            overrideType: 'MANUAL_OVERRIDE',
            evidenceRefs: this.json(evidenceRefs),
            correctedBy: actor.id
          }
        });
      }

      await tx.ocrTask.update({
        where: { id },
        data: {
          fieldCandidates: this.json(candidates),
          extractedFields: this.json(this.extractedFields(candidates)),
          fieldConfidence: this.json(this.fieldConfidence(candidates)),
          avgConfidence: new Prisma.Decimal(this.averageConfidence(candidates)),
          reviewRevision: nextReviewRevision,
          validationRevision: null,
          validationSnapshot: Prisma.DbNull,
          validationSnapshotHash: null,
          validationRuleVersion: null,
          validatedAt: null,
          version: { increment: 1 }
        }
      });
      await this.auditLogs.write(tx, actor, 'ocr_task.correct', 'ocr_task', id, {
        fields: dto.corrections.map((correction) => correction.fieldId),
        reviewRevision: nextReviewRevision,
        invalidatedValidationSnapshotHash: task.validationSnapshotHash
      }, context);
      await this.ledgerEvents.write(tx, actor, 'ocr_task_corrected', 'ocr_task', id, {
        fields: dto.corrections.map((correction) => correction.fieldId),
        reviewRevision: nextReviewRevision
      });
    });
    return toOcrTask(await this.findDetailOrThrow(id));
  }

  async revalidate(id: string, dto: RevalidateOcrTaskDto, actor: CurrentUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await this.findDetailOrThrow(id, tx);
      if (task.status !== OcrTaskStatus.pending_confirm) {
        throw new ConflictException('Only OCR tasks awaiting finance review can be revalidated');
      }
      if (dto.expectedVersion !== task.version || dto.expectedReviewRevision !== task.reviewRevision) {
        throw new ConflictException('OCR review payload changed; refresh before revalidation');
      }
      const snapshot = this.buildValidationSnapshot(task, actor.id);
      const validatedAt = new Date();
      await tx.ocrTask.update({
        where: { id },
        data: {
          validationRevision: task.reviewRevision,
          validationSnapshot: this.json(snapshot),
          validationSnapshotHash: snapshot.snapshotHash,
          validationRuleVersion: OCR_DETERMINISTIC_VALIDATION_RULE_VERSION,
          validatedAt,
          version: { increment: 1 }
        }
      });
      await this.auditLogs.write(tx, actor, 'ocr_task.revalidate', 'ocr_task', id, {
        reviewRevision: task.reviewRevision,
        snapshotHash: snapshot.snapshotHash,
        valid: snapshot.valid,
        blockingErrorCount: snapshot.blockingErrors.length,
        warningCount: snapshot.warnings.length
      }, context);
      await this.ledgerEvents.write(tx, actor, 'ocr_task_revalidated', 'ocr_task', id, {
        reviewRevision: task.reviewRevision,
        snapshotHash: snapshot.snapshotHash,
        valid: snapshot.valid
      });
    });
    return toOcrTask(await this.findDetailOrThrow(id));
  }

  async confirm(
    id: string,
    dto: ConfirmOcrTaskDto,
    actor: CurrentUser,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    const scope = this.idempotency.prepare(
      actor.id,
      'POST',
      '/api/ocr-tasks/:id/confirm',
      idempotencyKey,
      { ocrTaskId: id, ...dto }
    );
    return this.prisma.$transaction((tx) => this.idempotency.execute(tx, scope, 201, async () => {
      await this.lockTask(tx, id);
      const task = await this.findDetailOrThrow(id, tx);
      if (task.status === OcrTaskStatus.confirmed && task.generatedRecordId) {
        return {
          task: toOcrTask(task),
          record: toBusinessRecord(await this.findRecordOrThrow(task.generatedRecordId, tx)),
          alreadyConfirmed: true
        };
      }
      if (task.status !== OcrTaskStatus.pending_confirm) throw new ConflictException('OCR 结果尚未进入人工确认状态');
      const actualAttempt = task.attempts.find((attempt) => attempt.status === OcrAttemptStatus.succeeded);
      if (!actualAttempt) throw new ConflictException('OCR 结果缺少可追溯的成功 attempt');

      await acquireProjectWriteLock(tx, task.projectId);

      const candidates = this.candidateArray(task.fieldCandidates);
      const unresolved = candidates.filter((candidate) => candidate.lowConfidence || candidate.missing || candidate.validationError);
      if (unresolved.length > 0 && dto.acknowledgeLowConfidence !== true) {
        throw new ConflictException('存在低置信度、缺失或格式异常字段，必须人工确认或纠错');
      }
      const values = this.validateCandidates(candidates, task.template.templateFields, task.rawFileId);
      const template = await this.recordPolicy.getWritableTemplate(
        tx,
        task.projectId,
        task.templateId,
        task.template.recordType
      );
      if (template.version !== task.templateVersion) {
        throw new ConflictException('OCR 任务引用的模板版本已变化，请重新创建任务');
      }
      const policyValues = values.map((value) => ({ fieldId: value.field.id, value: value.value }));
      const canonical = this.recordPolicy.resolveCanonicalValues(
        template,
        policyValues,
        { requireValues: true }
      );

      const now = new Date();
      const record = await tx.businessRecord.create({
        data: {
          projectId: task.projectId,
          templateId: task.templateId,
          templateVersion: task.templateVersion,
          templateSnapshot: this.recordPolicy.toSnapshot(template),
          sourceSnapshot: this.recordPolicy.toSourceSnapshot(RecordSourceType.ocr, task.id, {
            ocrTaskId: task.id,
            ocrAttemptId: actualAttempt.id,
            rawFileId: task.rawFileId,
            rawFileSha256: task.rawFile.sha256,
            provider: actualAttempt.provider,
            modelName: actualAttempt.modelName,
            modelVersion: actualAttempt.modelVersion ?? 'unknown',
            endpoint: actualAttempt.endpointSnapshot ?? 'local-inprocess',
            providerConfigHash: actualAttempt.providerConfigHash ?? 'unknown',
            secretRef: actualAttempt.secretRef ?? 'none',
            attemptNo: actualAttempt.attemptNo,
            pageCount: task.pageCount
          }),
          confirmationSnapshot: this.recordPolicy.toConfirmationSnapshot(template, canonical, policyValues, {
            projectId: task.projectId,
            sourceType: RecordSourceType.ocr,
            sourceId: task.id,
            confirmedAt: now,
            confirmedBy: actor.username,
            attachments: [task.rawFileId]
          }),
          recordType: task.template.recordType,
          accountingDirection: canonical.accountingDirection,
          dataLayer: template.dataLayer,
          recordDate: canonical.recordDate,
          amount: canonical.amount,
          category: canonical.category,
          subCategory: task.template.name,
          description: `${task.rawFile.originalFileName} OCR 人工确认记录`,
          sourceType: RecordSourceType.ocr,
          sourceId: task.id,
          status: BusinessRecordStatus.confirmed,
          attachments: [task.rawFileId],
          createdBy: actor.username,
          confirmedBy: actor.username,
          confirmedAt: now,
          values: {
            create: values.map(({ field, value }) => this.buildRecordValue(field, value))
          }
        },
        include: {
          project: true,
          template: true,
          values: { include: { field: true }, orderBy: { createdAt: 'asc' } }
        }
      });
      await tx.ocrTask.update({
        where: { id },
        data: {
          status: OcrTaskStatus.confirmed,
          confirmedBy: actor.id,
          confirmedAt: now,
          generatedRecordId: record.id,
          errorMessage: null
        }
      });
      await this.auditLogs.write(tx, actor, 'ocr_task.confirm', 'ocr_task', id, {
        generatedRecordId: record.id,
        acknowledgedFields: unresolved.map((candidate) => candidate.fieldId)
      }, context);
      await this.auditLogs.write(tx, actor, 'business_record.create_from_ocr', 'business_record', record.id, {
        ocrTaskId: id,
        rawFileId: task.rawFileId
      }, context);
      await this.ledgerEvents.write(tx, actor, 'ocr_task_confirmed', 'ocr_task', id, {
        generatedRecordId: record.id,
        rawFileId: task.rawFileId
      });
      await this.ledgerEvents.write(tx, actor, 'business_record_created', 'business_record', record.id, {
        sourceType: RecordSourceType.ocr,
        ocrTaskId: id,
        rawFileId: task.rawFileId,
        accountingDirection: canonical.accountingDirection,
        amount: canonical.amount.toFixed(2)
      }, `ocr_task:${id}:business_record_created`);
      return {
        task: toOcrTask(await this.findDetailOrThrow(id, tx)),
        record: toBusinessRecord(record),
        alreadyConfirmed: false
      };
    }));
  }

  async cancel(id: string, actor: CurrentUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await tx.ocrTask.findUnique({ where: { id } });
      if (!task) throw new NotFoundException('资源不存在');
      if (task.status === OcrTaskStatus.confirmed) throw new ConflictException('已确认 OCR 任务不能取消');
      if (task.status === OcrTaskStatus.cancelled) return;
      if (task.status === OcrTaskStatus.processing) {
        await tx.ocrAttempt.updateMany({
          where: { ocrTaskId: id, status: OcrAttemptStatus.processing },
          data: {
            status: OcrAttemptStatus.failed,
            completedAt: new Date(),
            errorMessage: '用户取消'
          }
        });
      }
      await tx.ocrTask.update({
        where: { id },
        data: {
          status: OcrTaskStatus.cancelled,
          errorMessage: '用户取消',
          leaseToken: null,
          leaseUntil: null,
          version: { increment: 1 }
        }
      });
      await this.auditLogs.write(tx, actor, 'ocr_task.cancel', 'ocr_task', id, {}, context);
      await this.ledgerEvents.write(tx, actor, 'ocr_task_cancelled', 'ocr_task', id, {});
    });
    return toOcrTask(await this.findDetailOrThrow(id));
  }

  private scheduleTask(id: string) {
    if (!this.canRunBackgroundJobs()) return;
    if (this.stopping || this.backgroundJobs.has(id)) return;
    const job = (async () => {
      const frozen = await this.prisma.ocrTask.findUnique({
        where: { id },
        select: { providerConfig: true, providerConfigHash: true }
      });
      if (!frozen) return;
      const resolution = frozen.providerConfig === null
        ? await this.providers.resolve()
        : this.providers.fromSnapshot(frozen.providerConfig, frozen.providerConfigHash);
      const gateKey = `ocr:${resolution.config.configHash ?? resolution.config.provider}`;
      await this.executionGate.run(gateKey, resolution.config.maxConcurrency, async () => {
        if (this.stopping) return;
        const request = await this.backgroundRequest(id);
        if (!request) return;
        await this.executeQueuedTask(id, request.actor, request.context, resolution.config);
      });
    })().catch((error) => {
      this.logger.warn(`OCR background task ${id} deferred: ${this.safeErrorMessage(error)}`);
    }).finally(() => {
      this.backgroundJobs.delete(id);
    });
    this.backgroundJobs.set(id, job);
  }

  private canRunBackgroundJobs() {
    return this.processRole === 'worker' || this.processRole === 'all';
  }

  private async backgroundRequest(id: string) {
    const task = await this.prisma.ocrTask.findUnique({
      where: { id },
      select: { status: true, runRequestedBy: true, runRequestId: true, uploadedBy: true }
    });
    if (!task || task.status !== OcrTaskStatus.queued) return undefined;
    const user = await this.prisma.user.findUnique({
      where: { id: task.runRequestedBy ?? task.uploadedBy }
    }) ?? await this.prisma.user.findUnique({ where: { id: task.uploadedBy } });
    if (!user) throw new Error('OCR queue actor no longer exists');
    return {
      actor: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        department: user.department ?? '',
        phone: user.phone ?? '',
        status: user.status,
        tokenVersion: user.tokenVersion
      } satisfies CurrentUser,
      context: { requestId: task.runRequestId ?? `ocr-background-${id}` } satisfies RequestContext
    };
  }

  private providerFields(templateFields: TemplateFieldWithField[]): OcrTemplateField[] {
    return templateFields.map((item) => ({
      id: item.field.id,
      fieldKey: item.field.fieldKey,
      fieldName: item.field.fieldName,
      fieldType: item.field.fieldType,
      semanticType: item.field.semanticType,
      aliases: this.aliases(item.field.aliases),
      isRequired: item.isRequired,
      isVisible: item.isVisible
    }));
  }

  private assertProviderResultLimits(result: OcrProviderResult) {
    if (result.extractedText.length > 100_000) throw new BadGatewayException('OCR 文本超过安全上限');
    if (result.pages.length > 200) throw new BadGatewayException('OCR 页数超过安全上限');
    if (result.textBlocks.length > 5_000) throw new BadGatewayException('OCR 文本块超过安全上限');
    if (result.tables.length > 100) throw new BadGatewayException('OCR 表格数量超过安全上限');
    if (result.fieldCandidates.length > 500) throw new BadGatewayException('OCR 字段候选超过安全上限');
    let serialized: string;
    try {
      serialized = JSON.stringify(result);
    } catch {
      throw new BadGatewayException('OCR Provider 返回结果无法序列化');
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_OCR_RESULT_BYTES) {
      throw new BadGatewayException('OCR Provider 返回结果超过安全上限');
    }
  }

  private canonicalizeCandidates(
    providerCandidates: OcrFieldCandidate[],
    templateFields: TemplateFieldWithField[],
    rawFileId: string,
    candidateEvidenceRefs: string[][] = []
  ): CanonicalOcrFieldCandidate[] {
    const activeFields = templateFields.filter((item) => item.isVisible && item.field.isActive);
    const matched = new Map<string, Array<{ candidate: OcrFieldCandidate; index: number }>>();
    for (const [index, candidate] of providerCandidates.entries()) {
      const templateField = this.matchCandidate(candidate, activeFields);
      if (!templateField) throw new BadGatewayException(`OCR Provider 返回未映射字段：${candidate.sourceLabel || '未命名字段'}`);
      const values = matched.get(templateField.fieldId) ?? [];
      values.push({ candidate, index });
      matched.set(templateField.fieldId, values);
    }

    return activeFields.map((templateField) => {
      const matches = (matched.get(templateField.fieldId) ?? [])
        .sort((left, right) => Number(right.candidate.confidence) - Number(left.candidate.confidence));
      const match = matches[0];
      const candidate = match?.candidate;
      if (!candidate && templateField.field.fieldType === FieldType.file) {
        return {
          fieldId: templateField.fieldId,
          fieldKey: templateField.field.fieldKey,
          fieldName: templateField.field.fieldName,
          fieldType: templateField.field.fieldType,
          semanticType: templateField.field.semanticType,
          isRequired: templateField.isRequired,
          sourceLabel: 'OCR 原始文件',
          rawValue: [rawFileId],
          normalizedValue: [rawFileId],
          page: 1,
          confidence: 1,
          evidence: '系统绑定当前 OCR 原始文件；人工确认前不会入账',
          evidenceRefs: [`raw-file:${rawFileId}`],
          valueSource: 'SYSTEM_FILE_BINDING' as const,
          reviewRevision: 0,
          evidenceConflict: false,
          alternatives: [],
          missing: false,
          lowConfidence: false,
          corrected: false
        };
      }
      if (!candidate) {
        return {
          fieldId: templateField.fieldId,
          fieldKey: templateField.field.fieldKey,
          fieldName: templateField.field.fieldName,
          fieldType: templateField.field.fieldType,
          semanticType: templateField.field.semanticType,
          isRequired: templateField.isRequired,
          sourceLabel: templateField.field.fieldName,
          rawValue: null,
          normalizedValue: null,
          page: 1,
          confidence: 0,
          evidence: 'OCR 未识别该模板字段',
          evidenceRefs: [],
          valueSource: 'OCR_PROVIDER' as const,
          reviewRevision: 0,
          evidenceConflict: false,
          alternatives: [],
          missing: true,
          lowConfidence: true,
          corrected: false,
          validationError: templateField.isRequired ? '必填字段未识别' : undefined
        };
      }

      const confidence = Math.max(0, Math.min(1, Number(candidate.confidence) || 0));
      let normalizedValue = candidate.normalizedValue;
      let validationError: string | undefined;
      try {
        normalizedValue = this.normalizeFieldValue(templateField.field, candidate.normalizedValue, rawFileId);
      } catch (error) {
        validationError = this.safeErrorMessage(error);
      }
      const alternatives = matches.slice(1, 21).map((alternative) => ({
        page: alternative.candidate.page,
        rawValue: alternative.candidate.rawValue ?? null,
        normalizedValue: alternative.candidate.normalizedValue ?? null,
        confidence: Math.max(0, Math.min(1, Number(alternative.candidate.confidence) || 0)),
        evidenceRefs: candidateEvidenceRefs[alternative.index] ?? [],
        boundingBox: alternative.candidate.boundingBox
      }));
      const evidenceConflict = matches.length > 1 && new Set(
        matches.map((item) => this.displayValue(item.candidate.normalizedValue))
      ).size > 1;
      if (evidenceConflict) validationError = '多个 OCR 候选值冲突，必须由财务选择证据并修正';
      const missing = this.isEmpty(candidate.normalizedValue);
      return {
        fieldId: templateField.fieldId,
        fieldKey: templateField.field.fieldKey,
        fieldName: templateField.field.fieldName,
        fieldType: templateField.field.fieldType,
        semanticType: templateField.field.semanticType,
        isRequired: templateField.isRequired,
        sourceLabel: String(candidate.sourceLabel || templateField.field.fieldName).slice(0, 128),
        rawValue: candidate.rawValue ?? null,
        normalizedValue: normalizedValue ?? null,
        page: Number.isInteger(candidate.page) && candidate.page > 0 ? candidate.page : 1,
        boundingBox: candidate.boundingBox,
        confidence,
        evidence: String(candidate.evidence || '').slice(0, 1000),
        evidenceRefs: match ? candidateEvidenceRefs[match.index] ?? [] : [],
        valueSource: 'OCR_PROVIDER' as const,
        reviewRevision: 0,
        evidenceConflict,
        alternatives,
        missing,
        lowConfidence: missing || confidence < this.lowConfidenceThreshold || Boolean(validationError),
        corrected: false,
        validationError
      };
    });
  }

  private matchCandidate(candidate: OcrFieldCandidate, fields: TemplateFieldWithField[]) {
    if (candidate.targetFieldId) {
      const field = fields.find((item) => item.fieldId === candidate.targetFieldId);
      if (field) return field;
    }
    const key = candidate.targetFieldKey?.normalize('NFKC').trim().toLowerCase();
    if (key) {
      const field = fields.find((item) => item.field.fieldKey.toLowerCase() === key);
      if (field) return field;
    }
    const source = this.normalizeName(candidate.sourceLabel);
    return fields.find((item) => [item.field.fieldName, ...this.aliases(item.field.aliases)]
      .some((name) => this.normalizeName(name) === source));
  }

  private buildValidationSnapshot(task: OcrTaskDetail, validatedBy: string) {
    const candidates = this.candidateArray(task.fieldCandidates);
    const evidenceIndex = this.reviewEvidenceIndex(task);
    const activeFields = task.template.templateFields.filter((item) => item.isVisible && item.field.isActive);
    const activeFieldIds = new Set(activeFields.map((item) => item.fieldId));
    const candidateByField = new Map<string, CanonicalOcrFieldCandidate>();
    const blockingErrors: OcrValidationIssue[] = [];
    const warnings: OcrValidationIssue[] = [];

    for (const candidate of candidates) {
      if (candidateByField.has(candidate.fieldId)) {
        blockingErrors.push({
          code: 'DUPLICATE_FIELD_CANDIDATE',
          fieldId: candidate.fieldId,
          message: 'The OCR review payload contains duplicate field candidates',
          evidenceRefs: Array.isArray(candidate.evidenceRefs) ? candidate.evidenceRefs : []
        });
        continue;
      }
      candidateByField.set(candidate.fieldId, candidate);
      if (!activeFieldIds.has(candidate.fieldId)) {
        blockingErrors.push({
          code: 'FIELD_OUTSIDE_FROZEN_TEMPLATE',
          fieldId: candidate.fieldId,
          message: 'The OCR review payload references a field outside the active frozen template',
          evidenceRefs: Array.isArray(candidate.evidenceRefs) ? candidate.evidenceRefs : []
        });
      }
    }

    const validatedValues: Array<{
      fieldId: string;
      fieldKey: string;
      value: string | string[];
      valueSource: string;
      evidenceRefs: string[];
    }> = [];
    for (const templateField of activeFields) {
      const candidate = candidateByField.get(templateField.fieldId);
      if (!candidate || this.isEmpty(candidate.normalizedValue)) {
        if (templateField.isRequired) {
          blockingErrors.push({
            code: 'REQUIRED_FIELD_MISSING',
            fieldId: templateField.fieldId,
            message: `${templateField.field.fieldName}: required value is missing`,
            evidenceRefs: []
          });
        }
        continue;
      }

      const evidenceRefs = Array.isArray(candidate.evidenceRefs) ? [...candidate.evidenceRefs] : [];
      if (new Set(evidenceRefs).size !== evidenceRefs.length) {
        blockingErrors.push({
          code: 'DUPLICATE_EVIDENCE_REF',
          fieldId: candidate.fieldId,
          message: `${candidate.fieldName}: duplicate evidence references are not allowed`,
          evidenceRefs
        });
      }
      if (evidenceRefs.length === 0) {
        blockingErrors.push({
          code: 'EVIDENCE_MISSING',
          fieldId: candidate.fieldId,
          message: `${candidate.fieldName}: every non-empty value requires source evidence`,
          evidenceRefs: []
        });
      }
      const evidencePages = new Set<number>();
      for (const evidenceRef of evidenceRefs) {
        const source = evidenceIndex.get(evidenceRef);
        if (!source) {
          blockingErrors.push({
            code: 'EVIDENCE_REF_INVALID',
            fieldId: candidate.fieldId,
            message: `${candidate.fieldName}: evidence does not belong to this OCR source`,
            evidenceRefs: [evidenceRef]
          });
        } else if (source.page !== null) {
          evidencePages.add(source.page);
        }
      }
      if (candidate.evidenceConflict || evidencePages.size > 1) {
        blockingErrors.push({
          code: 'CROSS_PAGE_EVIDENCE_CONFLICT',
          fieldId: candidate.fieldId,
          message: `${candidate.fieldName}: conflicting evidence must be reduced to the finance-selected source`,
          evidenceRefs
        });
      }
      if (candidate.validationError) {
        blockingErrors.push({
          code: 'FIELD_VALIDATION_ERROR',
          fieldId: candidate.fieldId,
          message: `${candidate.fieldName}: ${candidate.validationError}`,
          evidenceRefs
        });
      }
      if (candidate.lowConfidence) {
        warnings.push({
          code: 'LOW_OCR_CONFIDENCE',
          fieldId: candidate.fieldId,
          message: `${candidate.fieldName}: OCR confidence requires explicit finance review`,
          evidenceRefs
        });
      }

      try {
        const value = this.normalizeFieldValue(templateField.field, candidate.normalizedValue, task.rawFileId);
        validatedValues.push({
          fieldId: templateField.fieldId,
          fieldKey: templateField.field.fieldKey,
          value,
          valueSource: candidate.valueSource ?? 'OCR_PROVIDER',
          evidenceRefs
        });
      } catch (error) {
        blockingErrors.push({
          code: 'FIELD_TYPE_INVALID',
          fieldId: candidate.fieldId,
          message: `${candidate.fieldName}: ${this.safeErrorMessage(error)}`,
          evidenceRefs
        });
      }
    }

    const core = {
      schemaVersion: 'ocr-validation/1.0',
      taskId: task.id,
      projectId: task.projectId,
      sourceSha256: task.sourceSha256,
      irSchemaVersion: task.irSchemaVersion,
      irHash: task.irHash,
      templateId: task.templateId,
      templateVersion: task.templateVersion,
      templateContentHash: canonicalJsonSha256(activeFields.map((item) => ({
        fieldId: item.fieldId,
        fieldKey: item.field.fieldKey,
        fieldType: item.field.fieldType,
        required: item.isRequired
      }))),
      reviewRevision: task.reviewRevision,
      candidatePayloadHash: canonicalJsonSha256(candidates),
      validationRuleVersion: OCR_DETERMINISTIC_VALIDATION_RULE_VERSION,
      validatedBy,
      blockingErrors,
      warnings,
      validatedValues,
      valid: blockingErrors.length === 0
    };
    return { ...core, snapshotHash: canonicalJsonSha256(core) };
  }

  private reviewEvidenceIndex(task: OcrTaskDetail) {
    if (!task.normalizedIr || typeof task.normalizedIr !== 'object' || Array.isArray(task.normalizedIr)) {
      throw new ConflictException('OCR evidence IR is missing');
    }
    const ir = task.normalizedIr as Record<string, Prisma.JsonValue>;
    const pages = Array.isArray(ir.pages) ? ir.pages : undefined;
    const core = {
      schemaVersion: ir.schemaVersion,
      sourceSha256: ir.sourceSha256,
      providerVersion: ir.providerVersion,
      coordinateVersion: ir.coordinateVersion,
      pages: ir.pages
    };
    if (
      !pages
      || ir.sourceId !== task.id
      || ir.sourceSha256 !== task.sourceSha256
      || ir.hash !== task.irHash
      || canonicalJsonSha256(core) !== task.irHash
      || task.sourceSha256 !== task.rawFile.sha256
    ) throw new ConflictException('OCR evidence IR is stale or fails its content hash');

    const index = new Map<string, { page: number | null }>();
    const add = (ref: unknown, page: number | null) => {
      if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/#@-]{0,255}$/.test(ref)) {
        throw new ConflictException('OCR evidence IR contains an invalid reference');
      }
      if (index.has(ref)) throw new ConflictException('OCR evidence IR contains duplicate references');
      index.set(ref, { page });
    };
    add(`raw-file:${task.rawFileId}`, null);
    for (const rawPage of pages) {
      if (!rawPage || typeof rawPage !== 'object' || Array.isArray(rawPage)) {
        throw new ConflictException('OCR evidence IR contains an invalid page');
      }
      const page = rawPage as Record<string, Prisma.JsonValue>;
      if (!Number.isInteger(page.page) || Number(page.page) < 1) {
        throw new ConflictException('OCR evidence IR contains an invalid page number');
      }
      const pageNumber = Number(page.page);
      const blocks = Array.isArray(page.blocks) ? page.blocks : [];
      for (const rawBlock of blocks) {
        if (!rawBlock || typeof rawBlock !== 'object' || Array.isArray(rawBlock)) {
          throw new ConflictException('OCR evidence IR contains an invalid block');
        }
        const block = rawBlock as Record<string, Prisma.JsonValue>;
        add(block.blockId, pageNumber);
        const tokens = Array.isArray(block.tokens) ? block.tokens : [];
        for (const rawToken of tokens) {
          if (!rawToken || typeof rawToken !== 'object' || Array.isArray(rawToken)) {
            throw new ConflictException('OCR evidence IR contains an invalid token');
          }
          add((rawToken as Record<string, Prisma.JsonValue>).tokenId, pageNumber);
        }
      }
      const candidates = Array.isArray(page.candidateEvidence) ? page.candidateEvidence : [];
      for (const rawCandidate of candidates) {
        if (!rawCandidate || typeof rawCandidate !== 'object' || Array.isArray(rawCandidate)) {
          throw new ConflictException('OCR evidence IR contains invalid candidate evidence');
        }
        add((rawCandidate as Record<string, Prisma.JsonValue>).evidenceId, pageNumber);
      }
    }
    return index;
  }

  private validateCandidates(
    candidates: CanonicalOcrFieldCandidate[],
    templateFields: TemplateFieldWithField[],
    rawFileId: string
  ) {
    const byField = new Map(candidates.map((candidate) => [candidate.fieldId, candidate]));
    const values: Array<{ field: FieldDefinition; value: string | string[] }> = [];
    const errors: string[] = [];
    for (const templateField of templateFields.filter((item) => item.isVisible && item.field.isActive)) {
      const candidate = byField.get(templateField.fieldId);
      if (!candidate || this.isEmpty(candidate.normalizedValue)) {
        if (templateField.isRequired) errors.push(`${templateField.field.fieldName}：必填字段缺失`);
        continue;
      }
      if (candidate.validationError) {
        errors.push(`${templateField.field.fieldName}：${candidate.validationError}`);
        continue;
      }
      try {
        values.push({
          field: templateField.field,
          value: this.normalizeFieldValue(templateField.field, candidate.normalizedValue, rawFileId)
        });
      } catch (error) {
        errors.push(`${templateField.field.fieldName}：${this.safeErrorMessage(error)}`);
      }
    }
    if (errors.length > 0) throw new BadRequestException(errors.join('；'));
    return values;
  }

  private normalizeFieldValue(field: FieldDefinition, raw: unknown, rawFileId: string): string | string[] {
    if (this.isEmpty(raw)) throw new BadRequestException('值不能为空');
    if (field.fieldType === FieldType.number || field.fieldType === FieldType.money) {
      if (typeof raw !== 'string') throw new BadRequestException('精度敏感数字必须使用字符串传输并人工纠错');
      const text = raw.trim().replace(/,/g, '');
      if (!/^-?(?:\d+|\d*\.\d+)$/.test(text)) throw new BadRequestException('数字格式错误');
      const decimal = new Prisma.Decimal(text);
      if (field.fieldType === FieldType.money && decimal.decimalPlaces() > 2) throw new BadRequestException('金额最多保留两位小数');
      if (decimal.abs().greaterThan('99999999999999.99')) throw new BadRequestException('数字超出允许范围');
      return decimal.toString();
    }
    if (field.fieldType === FieldType.date) {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new BadRequestException('日期格式必须为 YYYY-MM-DD');
      const date = new Date(`${raw}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) throw new BadRequestException('日期无效');
      return raw;
    }
    if (field.fieldType === FieldType.file) {
      if (!Array.isArray(raw) || raw.length !== 1 || raw[0] !== rawFileId) throw new BadRequestException('附件字段必须引用当前 OCR 原文件');
      return [rawFileId];
    }
    if (typeof raw !== 'string') throw new BadRequestException('文本字段必须是字符串');
    const value = raw.trim();
    const maxLength = field.fieldType === FieldType.textarea ? 5000 : 1000;
    if (!value || value.length > maxLength) throw new BadRequestException(`文本长度必须为 1-${maxLength}`);
    return value;
  }

  private buildRecordValue(field: FieldDefinition, value: string | string[]) {
    const base = { fieldId: field.id, fieldName: field.fieldName };
    if (field.fieldType === FieldType.number || field.fieldType === FieldType.money) {
      return { ...base, valueNumber: new Prisma.Decimal(value as string) };
    }
    if (field.fieldType === FieldType.date) {
      return { ...base, valueDate: new Date(`${value as string}T00:00:00.000Z`) };
    }
    if (field.fieldType === FieldType.file) return { ...base, valueJson: value as string[] };
    return { ...base, valueText: value as string };
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

  private aliases(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }

  private candidateArray(value: Prisma.JsonValue): CanonicalOcrFieldCandidate[] {
    return Array.isArray(value) ? value as unknown as CanonicalOcrFieldCandidate[] : [];
  }

  private mockScenario(value: Prisma.JsonValue | null): MockOcrScenario | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const scenario = (value as Record<string, Prisma.JsonValue>).mockScenario;
    return typeof scenario === 'string' ? scenario as MockOcrScenario : undefined;
  }

  private providerOptions(scenario: MockOcrScenario | undefined, selection: OcrPageSelection) {
    if (!scenario && selection.pageStart === undefined) return undefined;
    return {
      ...(scenario ? { mockScenario: scenario } : {}),
      ...(selection.pageStart === undefined ? {} : {
        pageRange: { pageStart: selection.pageStart, pageEnd: selection.pageEnd }
      })
    };
  }

  private pageSelectionFromDto(dto: { pageStart?: number; pageEnd?: number }): OcrPageSelection {
    return { pageStart: dto.pageStart, pageEnd: dto.pageEnd };
  }

  private pageSelection(value: Prisma.JsonValue | null): OcrPageSelection {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const range = (value as Record<string, Prisma.JsonValue>).pageRange;
    if (!range || typeof range !== 'object' || Array.isArray(range)) return {};
    const pageStart = (range as Record<string, Prisma.JsonValue>).pageStart;
    const pageEnd = (range as Record<string, Prisma.JsonValue>).pageEnd;
    return {
      pageStart: typeof pageStart === 'number' ? pageStart : undefined,
      pageEnd: typeof pageEnd === 'number' ? pageEnd : undefined
    };
  }

  private normalizeName(value: string) {
    return value.normalize('NFKC').trim().toLowerCase().replace(/[\s_\-—/\\()（）\[\]【】:：,.，。]+/g, '');
  }

  private isEmpty(value: unknown) {
    return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  }

  private displayValue(value: unknown) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  private safeErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return message.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]').slice(0, 500);
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private providerExecutionSnapshot(config: OcrProviderExecutionConfig) {
    return {
      ...config.configSummary,
      provider: config.provider,
      modelName: config.modelName,
      modelVersion: config.modelVersion ?? null,
      endpoint: config.endpoint ?? null,
      ...(config.secretRef ? { secretRef: config.secretRef } : {}),
      timeoutMs: config.timeoutMs,
      maxConcurrency: config.maxConcurrency,
      configSummary: config.configSummary,
      configHash: config.configHash ?? null
    };
  }

  private async lockTask(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT id FROM ocr_tasks WHERE id = ${id} FOR UPDATE`;
  }

  private async findDetailOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const task = await prisma.ocrTask.findUnique({ where: { id }, include: ocrTaskDetailInclude });
    if (!task) throw new NotFoundException('资源不存在');
    return task;
  }

  private async findRecordOrThrow(id: string, prisma: PrismaWriter = this.prisma) {
    const record = await prisma.businessRecord.findUnique({
      where: { id },
      include: {
        project: true,
        template: true,
        values: { include: { field: true }, orderBy: { createdAt: 'asc' } }
      }
    });
    if (!record) throw new NotFoundException('资源不存在');
    return record;
  }

}
