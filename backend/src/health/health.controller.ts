import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AiTaskStatus, ImportTaskStatus, OcrTaskStatus } from '@prisma/client';

import { FileSecurityService } from '../files/file-security.service';
import { FILE_STORAGE, FileStorage } from '../files/file-storage';
import { ModelExecutionGateService } from '../model-runtime/model-execution-gate.service';
import { ModelRuntimeService } from '../model-runtime/model-runtime.service';
import { PrismaService } from '../prisma/prisma.service';

interface ReadinessCheck {
  status: string;
  [key: string]: unknown;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly minimumFreeBytes: bigint;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly fileSecurity: FileSecurityService,
    private readonly modelRuntime: ModelRuntimeService,
    private readonly executionGate: ModelExecutionGateService,
    config: ConfigService
  ) {
    this.minimumFreeBytes = BigInt(config.get<number>('fileQuotas.minimumFreeMb') ?? 1024) * 1024n * 1024n;
  }

  @Get()
  @ApiOkResponse({
    schema: {
      example: {
        code: 0,
        message: 'success',
        data: { status: 'ok' }
      }
    }
  })
  check() {
    return { status: 'ok' };
  }

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const [database, storage, antivirus, queues, models] = await Promise.all([
      this.capture(() => this.databaseReadiness()),
      this.capture(() => this.storageReadiness()),
      this.capture(() => this.fileSecurity.readiness()),
      this.capture(() => this.queueReadiness()),
      this.capture(() => this.modelReadiness())
    ]);
    const checks = { database, storage, antivirus, queues, models };
    const ready = Object.values(checks).every((check) => ['ok', 'not_required'].includes(check.status));
    if (!ready) {
      throw new ServiceUnavailableException({
        message: 'Service is not ready',
        data: { status: 'not_ready', checks }
      });
    }
    return { status: 'ok', database: 'ok', checks };
  }

  private async databaseReadiness(): Promise<ReadinessCheck> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  }

  private async storageReadiness(): Promise<ReadinessCheck> {
    const availableBytes = await this.storage.availableBytes();
    if (availableBytes < this.minimumFreeBytes) {
      return {
        status: 'insufficient_space',
        availableBytes: availableBytes.toString(),
        minimumFreeBytes: this.minimumFreeBytes.toString()
      };
    }
    return {
      status: 'ok',
      availableBytes: availableBytes.toString(),
      minimumFreeBytes: this.minimumFreeBytes.toString()
    };
  }

  private async queueReadiness(): Promise<ReadinessCheck> {
    const [imports, ocr, ai] = await this.prisma.$transaction([
      this.prisma.importTask.count({
        where: { status: { in: [ImportTaskStatus.parsing, ImportTaskStatus.confirming] } }
      }),
      this.prisma.ocrTask.count({
        where: { status: { in: [OcrTaskStatus.queued, OcrTaskStatus.processing] } }
      }),
      this.prisma.aiTask.count({
        where: { status: { in: [AiTaskStatus.queued, AiTaskStatus.running] } }
      })
    ]);
    const runtime = this.executionGate.readiness();
    return {
      status: runtime.status === 'ok' ? 'ok' : 'saturated',
      pending: { imports, ocr, ai },
      runtime
    };
  }

  private async modelReadiness(): Promise<ReadinessCheck> {
    const health = await this.modelRuntime.health();
    return {
      status: health.status === 'ok' ? 'ok' : 'unhealthy',
      enabled: health.deployments
        .filter((deployment) => deployment.enabled)
        .map((deployment) => ({
          key: deployment.key,
          model: deployment.model,
          modelVersion: deployment.modelVersion,
          capabilities: 'capabilities' in deployment ? deployment.capabilities : undefined,
          status: deployment.status,
          healthy: deployment.healthy
        }))
    };
  }

  private async capture(operation: () => Promise<ReadinessCheck>): Promise<ReadinessCheck> {
    try {
      return await operation();
    } catch {
      return { status: 'unavailable' };
    }
  }
}
