import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';

import { RedisService } from '../infrastructure/redis/redis.service';

type LoginRateLimitStore = 'memory' | 'redis';

interface AttemptBucket {
  failures: number;
  inFlight: number;
  startedAt: number;
  lastSeenAt: number;
  blockedUntil?: number;
  maxFailures: number;
}

export interface LoginReservation {
  store: LoginRateLimitStore;
  token: string;
  keys: string[];
  finished: boolean;
}

const MAX_BUCKETS = 20_000;
const MAX_GLOBAL_IN_FLIGHT = 50;
const COMBO_LIMIT = 5;
const USER_LIMIT = 10;
const IP_LIMIT = 30;
const REDIS_UNAVAILABLE_MESSAGE = 'Shared login protection is unavailable';

const RESERVE_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local leaseMs = tonumber(ARGV[1])
local leaseExpiry = now + leaseMs
local token = ARGV[2]
local globalLimit = tonumber(ARGV[3])
local limits = {tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])}

for index = 1, 4 do
  redis.call('ZREMRANGEBYSCORE', KEYS[index], '-inf', now)
end

if redis.call('ZCARD', KEYS[1]) >= globalLimit then
  return {0, leaseMs}
end

for index = 1, 3 do
  local active = redis.call('ZCARD', KEYS[index + 1])
  local failures = tonumber(redis.call('GET', KEYS[index + 4]) or '0')
  if failures + active >= limits[index] then
    local retryAfter = redis.call('PTTL', KEYS[index + 4])
    if retryAfter < 1 then retryAfter = leaseMs end
    return {0, retryAfter}
  end
end

for index = 1, 4 do
  redis.call('ZADD', KEYS[index], leaseExpiry, token)
  redis.call('PEXPIRE', KEYS[index], leaseMs + 1000)
end

return {1, leaseMs}
`;

const FINISH_SCRIPT = `
local token = ARGV[1]
local outcome = ARGV[2]
local windowMs = tonumber(ARGV[3])
local blockMs = tonumber(ARGV[4])
local limits = {tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[7])}
local markerTtlMs = tonumber(ARGV[8])

local firstCompletion = redis.call('SET', KEYS[8], '1', 'PX', markerTtlMs, 'NX')
if not firstCompletion then return 0 end

for index = 1, 4 do
  redis.call('ZREM', KEYS[index], token)
end

if outcome == 'success' then
  redis.call('DEL', KEYS[5], KEYS[6])
elseif outcome == 'failure' then
  for index = 1, 3 do
    local failureKey = KEYS[index + 4]
    local count = redis.call('INCR', failureKey)
    if count == 1 or redis.call('PTTL', failureKey) < 0 then
      redis.call('PEXPIRE', failureKey, windowMs)
    end
    if count >= limits[index] then
      redis.call('PEXPIRE', failureKey, blockMs)
    end
  end
end

return 1
`;

@Injectable()
export class LoginRateLimitService {
  private readonly store: LoginRateLimitStore;
  private readonly windowMs: number;
  private readonly blockMs: number;
  private readonly leaseMs: number;
  private readonly buckets = new Map<string, AttemptBucket>();
  private globalInFlight = 0;
  private operationCount = 0;

  constructor(config: ConfigService, private readonly redis: RedisService) {
    const store = config.get<string>('loginRateLimit.store') ?? 'memory';
    if (store !== 'memory' && store !== 'redis') throw new Error(`Unsupported login rate limit store: ${store}`);
    this.store = store;
    this.windowMs = config.get<number>('loginRateLimit.windowMs') ?? 15 * 60 * 1000;
    this.blockMs = config.get<number>('loginRateLimit.blockMs') ?? 15 * 60 * 1000;
    this.leaseMs = config.get<number>('loginRateLimit.leaseMs') ?? 30_000;
  }

  async reserve(username: string, ip?: string): Promise<LoginReservation> {
    if (this.store === 'redis') return this.reserveRedis(username, ip);
    return this.reserveMemory(username, ip);
  }

  async failure(reservation: LoginReservation) {
    await this.finish(reservation, 'failure');
  }

  async success(reservation: LoginReservation) {
    await this.finish(reservation, 'success');
  }

  async release(reservation: LoginReservation) {
    await this.finish(reservation, 'release');
  }

  snapshot() {
    return { store: this.store, buckets: this.buckets.size, globalInFlight: this.globalInFlight };
  }

  private async reserveRedis(username: string, ip?: string): Promise<LoginReservation> {
    const normalizedUser = username.trim().toLowerCase();
    const normalizedIp = (ip || 'unknown').trim().toLowerCase();
    const token = randomUUID();
    const keys = [
      'login:{auth}:active:global',
      `login:{auth}:active:combo:${this.digest(`${normalizedIp}\0${normalizedUser}`)}`,
      `login:{auth}:active:user:${this.digest(normalizedUser)}`,
      `login:{auth}:active:ip:${this.digest(normalizedIp)}`,
      `login:{auth}:failure:combo:${this.digest(`${normalizedIp}\0${normalizedUser}`)}`,
      `login:{auth}:failure:user:${this.digest(normalizedUser)}`,
      `login:{auth}:failure:ip:${this.digest(normalizedIp)}`
    ];
    const result = await this.redis.evalAtomic(
      RESERVE_SCRIPT,
      keys,
      [
        this.leaseMs,
        token,
        MAX_GLOBAL_IN_FLIGHT,
        COMBO_LIMIT,
        USER_LIMIT,
        IP_LIMIT
      ],
      REDIS_UNAVAILABLE_MESSAGE
    );
    if (!Array.isArray(result) || result.length !== 2 || ![0, 1].includes(Number(result[0]))) {
      throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
    }
    if (Number(result[0]) === 0) this.reject();
    return { store: 'redis', token, keys, finished: false };
  }

  private reserveMemory(username: string, ip?: string): LoginReservation {
    const now = Date.now();
    this.maybeCleanup(now);
    if (this.globalInFlight >= MAX_GLOBAL_IN_FLIGHT) this.reject();

    const normalizedUser = username.trim().toLowerCase();
    const normalizedIp = (ip || 'unknown').trim().toLowerCase();
    const definitions: Array<[string, number]> = [
      [`combo:${normalizedIp}:${normalizedUser}`, COMBO_LIMIT],
      [`user:${normalizedUser}`, USER_LIMIT],
      [`ip:${normalizedIp}`, IP_LIMIT]
    ];
    const newBucketCount = definitions.filter(([key]) => !this.buckets.has(key)).length;
    if (this.buckets.size + newBucketCount > MAX_BUCKETS) this.reject();

    const buckets = definitions.map(([key, maxFailures]) => [key, this.bucket(key, maxFailures, now)] as const);
    for (const [, bucket] of buckets) {
      this.refreshWindow(bucket, now);
      if (
        (bucket.blockedUntil !== undefined && bucket.blockedUntil > now) ||
        bucket.failures + bucket.inFlight >= bucket.maxFailures
      ) {
        this.reject();
      }
    }
    for (const [, bucket] of buckets) {
      bucket.inFlight += 1;
      bucket.lastSeenAt = now;
    }
    this.globalInFlight += 1;
    return { store: 'memory', token: randomUUID(), keys: buckets.map(([key]) => key), finished: false };
  }

  private async finish(reservation: LoginReservation, outcome: 'failure' | 'success' | 'release') {
    if (reservation.finished) return;
    if (reservation.store === 'redis') {
      const markerTtlMs = Math.max(this.windowMs + this.blockMs, this.leaseMs * 2);
      const result = await this.redis.evalAtomic(
        FINISH_SCRIPT,
        [...reservation.keys, `login:{auth}:completed:${reservation.token}`],
        [
          reservation.token,
          outcome,
          this.windowMs,
          this.blockMs,
          COMBO_LIMIT,
          USER_LIMIT,
          IP_LIMIT,
          markerTtlMs
        ],
        REDIS_UNAVAILABLE_MESSAGE
      );
      if (![0, 1].includes(Number(result))) throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
      reservation.finished = true;
      return;
    }
    this.finishMemory(reservation, outcome);
  }

  private finishMemory(reservation: LoginReservation, outcome: 'failure' | 'success' | 'release') {
    if (reservation.finished) return;
    const now = Date.now();
    reservation.finished = true;
    for (const key of reservation.keys) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      bucket.inFlight = Math.max(0, bucket.inFlight - 1);
      bucket.lastSeenAt = now;
      if (outcome === 'success') {
        if (key.startsWith('combo:') || key.startsWith('user:')) {
          bucket.failures = 0;
          bucket.blockedUntil = undefined;
          bucket.startedAt = now;
        }
      } else if (outcome === 'failure') {
        bucket.failures += 1;
        if (bucket.failures >= bucket.maxFailures) bucket.blockedUntil = now + this.blockMs;
      }
    }
    this.globalInFlight = Math.max(0, this.globalInFlight - 1);
  }

  private bucket(key: string, maxFailures: number, now: number) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { failures: 0, inFlight: 0, startedAt: now, lastSeenAt: now, maxFailures };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private refreshWindow(bucket: AttemptBucket, now: number) {
    if (bucket.blockedUntil !== undefined && bucket.blockedUntil <= now) bucket.blockedUntil = undefined;
    if (now - bucket.startedAt >= this.windowMs && bucket.inFlight === 0) {
      bucket.failures = 0;
      bucket.startedAt = now;
    }
  }

  private maybeCleanup(now: number) {
    this.operationCount += 1;
    if (this.operationCount % 256 !== 0) return;
    for (const [key, bucket] of this.buckets) {
      if (
        bucket.inFlight === 0 &&
        now - bucket.lastSeenAt >= this.windowMs + this.blockMs &&
        (!bucket.blockedUntil || bucket.blockedUntil <= now)
      ) {
        this.buckets.delete(key);
      }
    }
  }

  private digest(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private reject(): never {
    throw new HttpException('Login attempts exceeded; retry later', HttpStatus.TOO_MANY_REQUESTS);
  }
}
