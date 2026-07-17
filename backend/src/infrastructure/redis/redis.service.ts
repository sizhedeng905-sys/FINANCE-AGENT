import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

interface RateLimitResult {
  count: number;
  ttlMs: number;
}

export interface WorkerHeartbeat {
  instanceId: string;
  processRole: string;
  pid: number;
  timestamp: string;
  ttlMs: number;
}

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly url: string;
  private readonly required: boolean;
  private readonly keyPrefix: string;
  private readonly connectTimeoutMs: number;
  private client?: RedisClientType;

  constructor(config: ConfigService) {
    this.url = config.get<string>('redis.url') ?? '';
    this.required = config.get<boolean>('redis.required') ?? false;
    this.keyPrefix = config.get<string>('redis.keyPrefix') ?? 'finance-agent';
    this.connectTimeoutMs = config.get<number>('redis.connectTimeoutMs') ?? 5_000;
  }

  async onModuleInit() {
    if (!this.url) {
      if (this.required) throw new Error('REDIS_URL is required for this runtime');
      return;
    }

    const client = createClient({
      url: this.url,
      socket: {
        connectTimeout: this.connectTimeoutMs,
        reconnectStrategy: false
      }
    });
    client.on('error', (error) => {
      this.logger.warn(`Redis client error: ${this.safeMessage(error)}`);
    });
    try {
      await client.connect();
      this.client = client as RedisClientType;
    } catch (error) {
      client.destroy();
      if (this.required) throw new Error(`Redis connection failed: ${this.safeMessage(error)}`);
      this.logger.warn(`Redis disabled because connection failed: ${this.safeMessage(error)}`);
    }
  }

  async onModuleDestroy() {
    if (!this.client?.isOpen) return;
    try {
      await this.client.quit();
    } catch {
      this.client.destroy();
    }
  }

  isConfigured() {
    return Boolean(this.url);
  }

  async ping() {
    if (!this.client?.isReady) {
      if (this.required) throw new ServiceUnavailableException('Redis is unavailable');
      return { status: 'not_required' as const };
    }
    const startedAt = Date.now();
    await this.client.ping();
    return { status: 'ok' as const, latencyMs: Date.now() - startedAt };
  }

  async fixedWindowRateLimit(key: string, windowMs: number): Promise<RateLimitResult | undefined> {
    if (!this.client?.isReady) {
      if (this.required) throw new ServiceUnavailableException('Redis rate limiter is unavailable');
      return undefined;
    }
    const result = await this.client.eval(FIXED_WINDOW_SCRIPT, {
      keys: [this.key(`rate:${key}`)],
      arguments: [String(windowMs)]
    });
    if (!Array.isArray(result) || result.length !== 2) {
      throw new ServiceUnavailableException('Redis rate limiter returned an invalid result');
    }
    const count = Number(result[0]);
    const ttlMs = Number(result[1]);
    if (!Number.isFinite(count) || !Number.isFinite(ttlMs)) {
      throw new ServiceUnavailableException('Redis rate limiter returned an invalid result');
    }
    return { count, ttlMs: Math.max(1, ttlMs) };
  }

  async writeWorkerHeartbeat(heartbeat: Omit<WorkerHeartbeat, 'timestamp'>, ttlMs: number) {
    const client = this.requireClient();
    const value: WorkerHeartbeat = { ...heartbeat, timestamp: new Date().toISOString() };
    await client.set(this.key('worker:heartbeat'), JSON.stringify(value), { PX: ttlMs });
  }

  async readWorkerHeartbeat() {
    if (!this.client?.isReady) return undefined;
    const key = this.key('worker:heartbeat');
    const [value, ttlMs] = await Promise.all([this.client.get(key), this.client.pTTL(key)]);
    if (!value || ttlMs <= 0) return undefined;
    try {
      const parsed = JSON.parse(value) as WorkerHeartbeat;
      return { ...parsed, ttlMs };
    } catch {
      return undefined;
    }
  }

  private requireClient() {
    if (!this.client?.isReady) throw new ServiceUnavailableException('Redis is unavailable');
    return this.client;
  }

  private key(suffix: string) {
    return `${this.keyPrefix}:${suffix}`;
  }

  private safeMessage(error: unknown) {
    return error instanceof Error ? error.message.replace(/redis(?:s)?:\/\/[^\s@]+@/gi, 'redis://***@') : 'unknown error';
  }
}
