import {
  Controller,
  Get,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { AiTaskStatus, ImportTaskStatus, OcrTaskStatus, RetentionRunStatus } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { Request, Response } from 'express';

import { StorageCapacityService } from '../files/storage-capacity.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import { ModelExecutionGateService } from '../model-runtime/model-execution-gate.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from './metrics.service';
import { TraceExporterService } from './trace-exporter.service';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  private readonly token: string;
  private readonly processRole: string;

  constructor(
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storageCapacity: StorageCapacityService,
    private readonly modelGate: ModelExecutionGateService,
    private readonly traceExporter: TraceExporterService,
    config: ConfigService
  ) {
    this.token = config.get<string>('metrics.token') ?? '';
    this.processRole = config.get<string>('processRole') ?? 'all';
  }

  @Get()
  async read(@Req() request: Request, @Res() response: Response) {
    this.assertAuthorized(request.headers.authorization);
    const [importParse, importConfirm, ocr, ai, retention, storedFiles, storageCapacity, heartbeat] = await Promise.all([
      this.prisma.importTask.count({ where: { status: ImportTaskStatus.parsing, executionMode: 'background' } }),
      this.prisma.importTask.count({ where: { status: ImportTaskStatus.confirming } }),
      this.prisma.ocrTask.count({ where: { status: { in: [OcrTaskStatus.queued, OcrTaskStatus.processing] } } }),
      this.prisma.aiTask.count({ where: { status: { in: [AiTaskStatus.queued, AiTaskStatus.running] } } }),
      this.prisma.retentionRun.count({
        where: { status: { in: [RetentionRunStatus.queued, RetentionRunStatus.running] } }
      }),
      this.prisma.rawFile.aggregate({ where: { isVoided: false }, _sum: { fileSize: true } }),
      this.storageCapacity.read(),
      this.redis.readWorkerHeartbeat()
    ]);
    const heartbeatAgeSeconds = heartbeat
      ? Math.max(0, Date.now() - Date.parse(heartbeat.timestamp)) / 1_000
      : undefined;
    const body = this.metrics.render({
      queueDepths: {
        import_parse: importParse,
        import_confirm: importConfirm,
        ocr,
        ai,
        retention
      },
      storedFileBytes: storedFiles._sum.fileSize ?? 0n,
      storageCapacity,
      workerHeartbeatAgeSeconds: heartbeatAgeSeconds,
      workerHeartbeatHealthy: this.processRole === 'all' || Boolean(heartbeat),
      modelRuntimeHealthy: this.modelGate.readiness().status === 'ok',
      trace: this.traceExporter.snapshot()
    });
    response.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).send(body);
  }

  private assertAuthorized(header: string | undefined) {
    if (!this.token) throw new ServiceUnavailableException('Metrics endpoint is not configured');
    const candidate = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const expectedBuffer = Buffer.from(this.token);
    const candidateBuffer = Buffer.from(candidate);
    if (candidateBuffer.length !== expectedBuffer.length || !timingSafeEqual(candidateBuffer, expectedBuffer)) {
      throw new UnauthorizedException('Invalid metrics credential');
    }
  }
}
