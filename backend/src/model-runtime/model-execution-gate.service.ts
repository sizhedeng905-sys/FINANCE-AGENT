import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';

import { RedisService } from '../infrastructure/redis/redis.service';

type ModelGateStore = 'memory' | 'redis';

interface MemoryWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface GateState {
  active: number;
  limit: number;
  queue: MemoryWaiter[];
}

export interface GateSnapshot {
  active: number;
  queued: number;
  limit: number;
}

interface RedisReservation {
  token: string;
  keys: string[];
  finished: boolean;
}

const REDIS_UNAVAILABLE_MESSAGE = 'Shared model execution gate is unavailable';
const QUEUE_FULL_MESSAGE = '模型任务队列已满，请稍后重试或转人工处理';
const QUEUE_TIMEOUT_MESSAGE = '模型任务排队超时，请稍后重试或转人工处理';
const LEASE_LOST_MESSAGE = '模型执行租约已失效，请稍后重试或转人工处理';

const ENQUEUE_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local executionLeaseMs = tonumber(ARGV[1])
local waiterLeaseMs = tonumber(ARGV[2])
local stateTtlMs = tonumber(ARGV[3])
local maxQueue = tonumber(ARGV[4])
local requestedLimit = tonumber(ARGV[5])
local token = ARGV[6]

local expiredActive = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now)
if #expiredActive > 0 then redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now) end
local expiredWaiters = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
for _, member in ipairs(expiredWaiters) do redis.call('ZREM', KEYS[2], member) end
if #expiredWaiters > 0 then redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now) end
local waiters = redis.call('ZRANGE', KEYS[2], 0, -1)
for _, member in ipairs(waiters) do
  if not redis.call('ZSCORE', KEYS[3], member) then redis.call('ZREM', KEYS[2], member) end
end

local activeCount = redis.call('ZCARD', KEYS[1])
local queueCount = redis.call('ZCARD', KEYS[2])
local storedLimit = tonumber(redis.call('GET', KEYS[5]) or '')
local effectiveLimit = requestedLimit
if activeCount > 0 or queueCount > 0 then
  if storedLimit then effectiveLimit = math.min(storedLimit, requestedLimit) end
end
redis.call('SET', KEYS[5], effectiveLimit, 'PX', stateTtlMs)

if queueCount == 0 and activeCount < effectiveLimit then
  redis.call('ZADD', KEYS[1], now + executionLeaseMs, token)
  redis.call('PEXPIRE', KEYS[1], stateTtlMs)
  return {1, activeCount + 1, 0, effectiveLimit}
end
if queueCount >= maxQueue then return {-1, activeCount, queueCount, effectiveLimit} end

local ticket = redis.call('INCR', KEYS[4])
redis.call('ZADD', KEYS[2], ticket, token)
redis.call('ZADD', KEYS[3], now + waiterLeaseMs, token)
redis.call('PEXPIRE', KEYS[2], stateTtlMs)
redis.call('PEXPIRE', KEYS[3], stateTtlMs)
redis.call('PEXPIRE', KEYS[4], stateTtlMs)
return {0, activeCount, queueCount + 1, effectiveLimit}
`;

const POLL_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local executionLeaseMs = tonumber(ARGV[1])
local waiterLeaseMs = tonumber(ARGV[2])
local stateTtlMs = tonumber(ARGV[3])
local requestedLimit = tonumber(ARGV[4])
local token = ARGV[5]

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local expiredWaiters = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
for _, member in ipairs(expiredWaiters) do redis.call('ZREM', KEYS[2], member) end
if #expiredWaiters > 0 then redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now) end
local waiters = redis.call('ZRANGE', KEYS[2], 0, -1)
for _, member in ipairs(waiters) do
  if not redis.call('ZSCORE', KEYS[3], member) then redis.call('ZREM', KEYS[2], member) end
end

if not redis.call('ZSCORE', KEYS[2], token) then return {-1, 0, 0, 0} end
redis.call('ZADD', KEYS[3], now + waiterLeaseMs, token)

local storedLimit = tonumber(redis.call('GET', KEYS[5]) or requestedLimit)
local effectiveLimit = math.min(storedLimit, requestedLimit)
redis.call('SET', KEYS[5], effectiveLimit, 'PX', stateTtlMs)
local activeCount = redis.call('ZCARD', KEYS[1])
local first = redis.call('ZRANGE', KEYS[2], 0, 0)
if first[1] == token and activeCount < effectiveLimit then
  redis.call('ZREM', KEYS[2], token)
  redis.call('ZREM', KEYS[3], token)
  redis.call('ZADD', KEYS[1], now + executionLeaseMs, token)
  redis.call('PEXPIRE', KEYS[1], stateTtlMs)
  return {1, activeCount + 1, redis.call('ZCARD', KEYS[2]), effectiveLimit}
end

local rank = redis.call('ZRANK', KEYS[2], token)
redis.call('PEXPIRE', KEYS[2], stateTtlMs)
redis.call('PEXPIRE', KEYS[3], stateTtlMs)
return {0, activeCount, rank and rank + 1 or 0, effectiveLimit}
`;

const RENEW_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local executionLeaseMs = tonumber(ARGV[1])
local stateTtlMs = tonumber(ARGV[2])
local token = ARGV[3]
local expiresAt = tonumber(redis.call('ZSCORE', KEYS[1], token) or '')
if not expiresAt or expiresAt <= now then
  redis.call('ZREM', KEYS[1], token)
  return 0
end
redis.call('ZADD', KEYS[1], now + executionLeaseMs, token)
redis.call('PEXPIRE', KEYS[1], stateTtlMs)
redis.call('PEXPIRE', KEYS[5], stateTtlMs)
return 1
`;

const RELEASE_SCRIPT = `
local token = ARGV[1]
local stateTtlMs = tonumber(ARGV[2])
redis.call('ZREM', KEYS[1], token)
if redis.call('ZCARD', KEYS[1]) == 0 and redis.call('ZCARD', KEYS[2]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5])
else
  for index = 1, 5 do redis.call('PEXPIRE', KEYS[index], stateTtlMs) end
end
return 1
`;

const CANCEL_SCRIPT = `
local token = ARGV[1]
local stateTtlMs = tonumber(ARGV[2])
redis.call('ZREM', KEYS[2], token)
redis.call('ZREM', KEYS[3], token)
if redis.call('ZCARD', KEYS[1]) == 0 and redis.call('ZCARD', KEYS[2]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5])
else
  for index = 1, 5 do redis.call('PEXPIRE', KEYS[index], stateTtlMs) end
end
return 1
`;

const SNAPSHOT_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local expiredWaiters = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
for _, member in ipairs(expiredWaiters) do redis.call('ZREM', KEYS[2], member) end
if #expiredWaiters > 0 then redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now) end
local waiters = redis.call('ZRANGE', KEYS[2], 0, -1)
for _, member in ipairs(waiters) do
  if not redis.call('ZSCORE', KEYS[3], member) then redis.call('ZREM', KEYS[2], member) end
end
return {
  redis.call('ZCARD', KEYS[1]),
  redis.call('ZCARD', KEYS[2]),
  tonumber(redis.call('GET', KEYS[5]) or '0')
}
`;

@Injectable()
export class ModelExecutionGateService {
  private readonly store: ModelGateStore;
  private readonly states = new Map<string, GateState>();
  private readonly knownRedisKeys = new Set<string>();
  private readonly maxQueue: number;
  private readonly queueWaitTimeoutMs: number;
  private readonly executionLeaseMs: number;
  private readonly waiterLeaseMs: number;
  private readonly queuePollMs: number;
  private readonly stateTtlMs: number;

  constructor(config: ConfigService, private readonly redis: RedisService) {
    const store = config.get<string>('modelRuntime.gateStore') ?? 'memory';
    if (store !== 'memory' && store !== 'redis') throw new Error(`Unsupported model execution gate store: ${store}`);
    this.store = store;
    this.maxQueue = config.get<number>('modelRuntime.maxQueue') ?? 20;
    this.queueWaitTimeoutMs = config.get<number>('modelRuntime.queueWaitTimeoutMs') ?? 60_000;
    this.executionLeaseMs = config.get<number>('modelRuntime.executionLeaseMs') ?? 30_000;
    this.waiterLeaseMs = config.get<number>('modelRuntime.waiterLeaseMs') ?? 5_000;
    this.queuePollMs = config.get<number>('modelRuntime.queuePollMs') ?? 100;
    this.stateTtlMs = Math.max(this.queueWaitTimeoutMs, this.executionLeaseMs, this.waiterLeaseMs) + 10_000;
  }

  async run<T>(key: string, maxConcurrency: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const limit = this.assertLimit(maxConcurrency);
    if (this.store === 'memory') return this.runMemory(key, limit, operation);
    return this.runRedis(key, limit, operation);
  }

  async snapshot(): Promise<Record<string, GateSnapshot>> {
    if (this.store === 'memory') {
      return Object.fromEntries([...this.states].map(([key, state]) => [this.displayKey(key), {
        active: state.active,
        queued: state.queue.length,
        limit: state.limit
      }]));
    }

    const entries = await Promise.all([...this.knownRedisKeys].sort().map(async (key) => {
      const result = await this.redis.evalAtomic(
        SNAPSHOT_SCRIPT,
        this.redisKeys(key),
        [],
        REDIS_UNAVAILABLE_MESSAGE
      );
      return [this.displayKey(key), this.parseSnapshot(result)] as const;
    }));
    return Object.fromEntries(entries);
  }

  async readiness() {
    const queues = await this.snapshot();
    const saturated = Object.values(queues).some((state) => state.queued >= this.maxQueue);
    return {
      status: saturated ? 'saturated' : 'ok',
      store: this.store,
      maxQueue: this.maxQueue,
      queues
    };
  }

  private async runMemory<T>(key: string, limit: number, operation: (signal: AbortSignal) => Promise<T>) {
    await this.acquireMemory(key, limit);
    const controller = new AbortController();
    try {
      return await operation(controller.signal);
    } finally {
      this.releaseMemory(key);
    }
  }

  private async runRedis<T>(key: string, limit: number, operation: (signal: AbortSignal) => Promise<T>) {
    const reservation = await this.acquireRedis(key, limit);
    const controller = new AbortController();
    let renewing = false;
    let rejectLease!: (error: Error) => void;
    const leaseFailure = new Promise<never>((_resolve, reject) => {
      rejectLease = reject;
    });
    const timer = setInterval(() => {
      if (renewing || reservation.finished) return;
      renewing = true;
      void this.renewRedis(reservation)
        .catch((error) => {
          const failure = error instanceof Error ? error : new ServiceUnavailableException(LEASE_LOST_MESSAGE);
          controller.abort(failure);
          rejectLease(failure);
        })
        .finally(() => {
          renewing = false;
        });
    }, Math.max(250, Math.floor(this.executionLeaseMs / 3)));
    timer.unref();

    try {
      return await Promise.race([operation(controller.signal), leaseFailure]);
    } finally {
      clearInterval(timer);
      await this.releaseRedis(reservation);
    }
  }

  private async acquireRedis(key: string, limit: number): Promise<RedisReservation> {
    this.knownRedisKeys.add(key);
    const token = randomUUID();
    const keys = this.redisKeys(key);
    const result = await this.redis.evalAtomic(
      ENQUEUE_SCRIPT,
      keys,
      [
        this.executionLeaseMs,
        this.waiterLeaseMs,
        this.stateTtlMs,
        this.maxQueue,
        limit,
        token
      ],
      REDIS_UNAVAILABLE_MESSAGE
    );
    const status = this.parseStatus(result);
    if (status === 1) return { token, keys, finished: false };
    if (status === -1) throw new ServiceUnavailableException(QUEUE_FULL_MESSAGE);

    const deadline = Date.now() + this.queueWaitTimeoutMs;
    try {
      while (Date.now() < deadline) {
        await this.delay(Math.min(this.queuePollMs, Math.max(1, deadline - Date.now())));
        const pollResult = await this.redis.evalAtomic(
          POLL_SCRIPT,
          keys,
          [this.executionLeaseMs, this.waiterLeaseMs, this.stateTtlMs, limit, token],
          REDIS_UNAVAILABLE_MESSAGE
        );
        const pollStatus = this.parseStatus(pollResult);
        if (pollStatus === 1) return { token, keys, finished: false };
        if (pollStatus === -1) throw new ServiceUnavailableException(LEASE_LOST_MESSAGE);
      }
      throw new ServiceUnavailableException(QUEUE_TIMEOUT_MESSAGE);
    } catch (error) {
      await this.cancelRedis(keys, token);
      throw error;
    }
  }

  private async renewRedis(reservation: RedisReservation) {
    const result = await this.redis.evalAtomic(
      RENEW_SCRIPT,
      reservation.keys,
      [this.executionLeaseMs, this.stateTtlMs, reservation.token],
      REDIS_UNAVAILABLE_MESSAGE
    );
    if (Number(result) !== 1) throw new ServiceUnavailableException(LEASE_LOST_MESSAGE);
  }

  private async releaseRedis(reservation: RedisReservation) {
    if (reservation.finished) return;
    const result = await this.redis.evalAtomic(
      RELEASE_SCRIPT,
      reservation.keys,
      [reservation.token, this.stateTtlMs],
      REDIS_UNAVAILABLE_MESSAGE
    );
    if (Number(result) !== 1) throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
    reservation.finished = true;
  }

  private async cancelRedis(keys: string[], token: string) {
    try {
      await this.redis.evalAtomic(
        CANCEL_SCRIPT,
        keys,
        [token, this.stateTtlMs],
        REDIS_UNAVAILABLE_MESSAGE
      );
    } catch {
      // The waiter lease is the fail-safe when Redis is temporarily unavailable.
    }
  }

  private async acquireMemory(key: string, limit: number) {
    const state = this.state(key, limit);
    if (state.active === 0 && state.queue.length === 0) state.limit = limit;
    else state.limit = Math.min(state.limit, limit);
    if (state.queue.length === 0 && state.active < state.limit) {
      state.active += 1;
      return;
    }
    if (state.queue.length >= this.maxQueue) throw new ServiceUnavailableException(QUEUE_FULL_MESSAGE);

    await new Promise<void>((resolve, reject) => {
      const waiter: MemoryWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = state.queue.indexOf(waiter);
          if (index >= 0) state.queue.splice(index, 1);
          reject(new ServiceUnavailableException(QUEUE_TIMEOUT_MESSAGE));
        }, this.queueWaitTimeoutMs)
      };
      state.queue.push(waiter);
    });
  }

  private releaseMemory(key: string) {
    const state = this.states.get(key);
    if (!state) return;
    state.active = Math.max(0, state.active - 1);
    const waiter = state.queue.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    state.active += 1;
    waiter.resolve();
  }

  private state(key: string, limit: number) {
    let state = this.states.get(key);
    if (!state) {
      state = { active: 0, limit, queue: [] };
      this.states.set(key, state);
    }
    return state;
  }

  private redisKeys(key: string) {
    const digest = createHash('sha256').update(key).digest('hex');
    const scope = `model:{execution}:${digest}`;
    return [
      `${scope}:active`,
      `${scope}:waiters`,
      `${scope}:waiter-leases`,
      `${scope}:sequence`,
      `${scope}:limit`
    ];
  }

  private displayKey(key: string) {
    const prefix = key.match(/^([a-z][a-z0-9_-]{0,15}):/i)?.[1]?.toLowerCase() ?? 'model';
    return `${prefix}:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
  }

  private parseStatus(result: unknown) {
    if (!Array.isArray(result) || result.length !== 4) {
      throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
    }
    const status = Number(result[0]);
    if (![1, 0, -1].includes(status)) throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
    return status;
  }

  private parseSnapshot(result: unknown): GateSnapshot {
    if (!Array.isArray(result) || result.length !== 3) {
      throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
    }
    const [active, queued, limit] = result.map(Number);
    if (
      !Number.isSafeInteger(active) || active < 0
      || !Number.isSafeInteger(queued) || queued < 0
      || !Number.isSafeInteger(limit) || limit < 0
    ) {
      throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
    }
    return { active, queued, limit };
  }

  private assertLimit(maxConcurrency: number) {
    if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32) {
      throw new ServiceUnavailableException('模型并发配置无效');
    }
    return maxConcurrency;
  }

  private delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}
