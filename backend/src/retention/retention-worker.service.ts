import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'node:os';

import { RetentionService } from './retention.service';

@Injectable()
export class RetentionWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly mode: string;
  private readonly processRole: string;
  private readonly pollIntervalMs: number;
  private readonly instanceId: string;
  private timer?: NodeJS.Timeout;
  private inFlight = false;

  constructor(private readonly retention: RetentionService, config: ConfigService) {
    this.mode = config.get<string>('dataRetention.mode') ?? 'disabled';
    this.processRole = config.get<string>('processRole') ?? 'all';
    this.pollIntervalMs = config.get<number>('worker.pollIntervalMs') ?? 5_000;
    this.instanceId = process.env.WORKER_INSTANCE_ID || `${hostname()}:${process.pid}`;
  }

  onModuleInit() {
    if (this.mode !== 'dry-run' || !['worker', 'all'].includes(this.processRole)) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      for (let index = 0; index < 10; index += 1) {
        const processed = await this.retention.processNext(this.instanceId);
        if (!processed) break;
      }
    } finally {
      this.inFlight = false;
    }
  }
}
