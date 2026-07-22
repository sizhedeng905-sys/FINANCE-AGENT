import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';

import { RedisService } from '../infrastructure/redis/redis.service';

@Injectable()
export class WorkerRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerRuntimeService.name);
  private readonly processRole: string;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTtlMs: number;
  private readonly instanceId: string;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService
  ) {
    this.processRole = config.get<string>('processRole') ?? 'all';
    this.heartbeatIntervalMs = config.get<number>('worker.heartbeatIntervalMs') ?? 5_000;
    this.heartbeatTtlMs = config.get<number>('worker.heartbeatTtlMs') ?? 20_000;
    this.instanceId = process.env.WORKER_INSTANCE_ID || hostname();
  }

  async onModuleInit() {
    if (this.processRole !== 'worker') return;
    await this.writeHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.writeHeartbeat().catch((error) => {
        this.logger.error(`Worker heartbeat failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
    this.logger.log(JSON.stringify({
      type: 'worker_started',
      instanceId: this.instanceId,
      processRole: this.processRole,
      pid: process.pid
    }));
  }

  onModuleDestroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  private writeHeartbeat() {
    return this.redis.writeWorkerHeartbeat({
      instanceId: this.instanceId,
      processRole: this.processRole,
      pid: process.pid,
      ttlMs: this.heartbeatTtlMs
    }, this.heartbeatTtlMs);
  }
}
