import {
  HttpException,
  HttpStatus,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';

import { RedisService } from '../infrastructure/redis/redis.service';

type UploadAdmissionStore = 'memory' | 'redis';

interface ActiveUploadState {
  count: number;
  bytes: number;
}

export interface UploadReservation {
  store: UploadAdmissionStore;
  token: string;
  userKey: string;
  contentLength: number;
  finished: boolean;
}

const REDIS_UNAVAILABLE_MESSAGE = 'Shared upload admission is unavailable';

const RESERVE_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local leaseMs = tonumber(ARGV[1])
local rateWindowMs = tonumber(ARGV[2])
local rateMax = tonumber(ARGV[3])
local maxConcurrent = tonumber(ARGV[4])
local maxBytes = tonumber(ARGV[5])
local contentLength = tonumber(ARGV[6])
local token = ARGV[7]

local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now)
for _, member in ipairs(expired) do
  redis.call('HDEL', KEYS[2], member)
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)

local byteMembers = redis.call('HKEYS', KEYS[2])
for _, member in ipairs(byteMembers) do
  if not redis.call('ZSCORE', KEYS[1], member) then
    redis.call('HDEL', KEYS[2], member)
  end
end

redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now - rateWindowMs)
local rateCount = redis.call('ZCARD', KEYS[3])
if rateCount >= rateMax then
  local oldest = redis.call('ZRANGE', KEYS[3], 0, 0, 'WITHSCORES')
  local retryAfter = rateWindowMs
  if oldest[2] then
    retryAfter = math.max(1, tonumber(oldest[2]) + rateWindowMs - now)
  end
  return {0, 1, retryAfter}
end

redis.call('ZADD', KEYS[3], now, token)
redis.call('PEXPIRE', KEYS[3], rateWindowMs + 1000)

local activeMembers = redis.call('ZRANGE', KEYS[1], 0, -1)
local activeCount = 0
local activeBytes = 0
for _, member in ipairs(activeMembers) do
  local memberBytes = tonumber(redis.call('HGET', KEYS[2], member) or '')
  if not memberBytes or memberBytes <= 0 then
    return {0, 4, leaseMs}
  end
  activeCount = activeCount + 1
  activeBytes = activeBytes + memberBytes
end

if activeCount >= maxConcurrent then
  return {0, 2, leaseMs}
end
if activeBytes + contentLength > maxBytes then
  return {0, 3, leaseMs}
end

redis.call('ZADD', KEYS[1], now + leaseMs, token)
redis.call('HSET', KEYS[2], token, contentLength)
redis.call('PEXPIRE', KEYS[1], leaseMs + 1000)
redis.call('PEXPIRE', KEYS[2], leaseMs + 1000)
return {1, activeCount + 1, activeBytes + contentLength}
`;

const RENEW_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local leaseMs = tonumber(ARGV[1])
local token = ARGV[2]
local expiresAt = tonumber(redis.call('ZSCORE', KEYS[1], token) or '')
local contentLength = tonumber(redis.call('HGET', KEYS[2], token) or '')

if not expiresAt or expiresAt <= now or not contentLength or contentLength <= 0 then
  redis.call('ZREM', KEYS[1], token)
  redis.call('HDEL', KEYS[2], token)
  return 0
end

redis.call('ZADD', KEYS[1], now + leaseMs, token)
redis.call('PEXPIRE', KEYS[1], leaseMs + 1000)
redis.call('PEXPIRE', KEYS[2], leaseMs + 1000)
return 1
`;

const RELEASE_SCRIPT = `
local token = ARGV[1]
redis.call('ZREM', KEYS[1], token)
redis.call('HDEL', KEYS[2], token)
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2])
end
return 1
`;

const ACTIVE_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now)
for _, member in ipairs(expired) do
  redis.call('HDEL', KEYS[2], member)
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)

local byteMembers = redis.call('HKEYS', KEYS[2])
for _, member in ipairs(byteMembers) do
  if not redis.call('ZSCORE', KEYS[1], member) then
    redis.call('HDEL', KEYS[2], member)
  end
end

local activeMembers = redis.call('ZRANGE', KEYS[1], 0, -1)
local activeBytes = 0
for _, member in ipairs(activeMembers) do
  local memberBytes = tonumber(redis.call('HGET', KEYS[2], member) or '')
  if not memberBytes or memberBytes <= 0 then
    return {-1, -1}
  end
  activeBytes = activeBytes + memberBytes
end
return {#activeMembers, activeBytes}
`;

@Injectable()
export class UploadAdmissionService {
  private readonly store: UploadAdmissionStore;
  private readonly maxConcurrentPerUser: number;
  private readonly maxInFlightBytesPerUser: number;
  private readonly rateWindowMs: number;
  private readonly rateMaxPerUser: number;
  private readonly leaseMs: number;
  private readonly active = new Map<string, ActiveUploadState>();
  private readonly attempts = new Map<string, number[]>();
  private lastSweepAt = 0;

  constructor(config: ConfigService, private readonly redis: RedisService) {
    const store = config.get<string>('uploadAdmission.store') ?? 'memory';
    if (store !== 'memory' && store !== 'redis') throw new Error(`Unsupported upload admission store: ${store}`);
    this.store = store;
    this.maxConcurrentPerUser = config.get<number>('uploadAdmission.maxConcurrentPerUser') ?? 5;
    this.maxInFlightBytesPerUser = (config.get<number>('uploadAdmission.maxInFlightMbPerUser') ?? 260) * 1024 * 1024;
    this.rateWindowMs = config.get<number>('uploadAdmission.rateWindowMs') ?? 60_000;
    this.rateMaxPerUser = config.get<number>('uploadAdmission.rateMaxPerUser') ?? 60;
    this.leaseMs = config.get<number>('uploadAdmission.leaseMs') ?? 30_000;
  }

  async reserve(userId: string, contentLength: number): Promise<UploadReservation> {
    this.assertContentLength(contentLength);
    if (this.store === 'redis') return this.reserveRedis(userId, contentLength);
    return this.reserveMemory(userId, contentLength);
  }

  async renew(reservation: UploadReservation) {
    if (reservation.finished || reservation.store === 'memory') return;
    const result = await this.redis.evalAtomic(
      RENEW_SCRIPT,
      this.redisKeys(reservation.userKey).slice(0, 2),
      [this.leaseMs, reservation.token],
      REDIS_UNAVAILABLE_MESSAGE
    );
    if (Number(result) !== 1) throw new ServiceUnavailableException('Upload admission lease expired');
  }

  async release(reservation: UploadReservation) {
    if (reservation.finished) return;
    if (reservation.store === 'redis') {
      const result = await this.redis.evalAtomic(
        RELEASE_SCRIPT,
        this.redisKeys(reservation.userKey).slice(0, 2),
        [reservation.token],
        REDIS_UNAVAILABLE_MESSAGE
      );
      if (Number(result) !== 1) throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
      reservation.finished = true;
      return;
    }

    reservation.finished = true;
    const current = this.active.get(reservation.userKey);
    if (!current) return;
    current.count = Math.max(0, current.count - 1);
    current.bytes = Math.max(0, current.bytes - reservation.contentLength);
    if (current.count === 0) this.active.delete(reservation.userKey);
    else this.active.set(reservation.userKey, current);
  }

  async activeFor(userId: string): Promise<ActiveUploadState> {
    const userKey = this.normalizeUserKey(userId);
    if (this.store === 'memory') return { ...(this.active.get(userKey) ?? { count: 0, bytes: 0 }) };
    const result = await this.redis.evalAtomic(
      ACTIVE_SCRIPT,
      this.redisKeys(userKey).slice(0, 2),
      [],
      REDIS_UNAVAILABLE_MESSAGE
    );
    if (!Array.isArray(result) || result.length !== 2) {
      throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
    }
    const count = Number(result[0]);
    const bytes = Number(result[1]);
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
    }
    return { count, bytes };
  }

  renewalIntervalMs(reservation: UploadReservation) {
    return reservation.store === 'redis' ? Math.max(250, Math.floor(this.leaseMs / 3)) : undefined;
  }

  private async reserveRedis(userId: string, contentLength: number): Promise<UploadReservation> {
    const userKey = this.normalizeUserKey(userId);
    const token = randomUUID();
    const result = await this.redis.evalAtomic(
      RESERVE_SCRIPT,
      this.redisKeys(userKey),
      [
        this.leaseMs,
        this.rateWindowMs,
        this.rateMaxPerUser,
        this.maxConcurrentPerUser,
        this.maxInFlightBytesPerUser,
        contentLength,
        token
      ],
      REDIS_UNAVAILABLE_MESSAGE
    );
    if (!Array.isArray(result) || result.length !== 3) {
      throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
    }
    const accepted = Number(result[0]);
    const reason = Number(result[1]);
    if (accepted === 0) this.rejectRedis(reason);
    if (accepted !== 1) throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
    return { store: 'redis', token, userKey, contentLength, finished: false };
  }

  private reserveMemory(userId: string, contentLength: number): UploadReservation {
    const userKey = this.normalizeUserKey(userId);
    const now = Date.now();
    this.sweepAttempts(now);
    const recent = (this.attempts.get(userKey) ?? []).filter((timestamp) => timestamp > now - this.rateWindowMs);
    if (recent.length >= this.rateMaxPerUser) this.rejectRate();
    recent.push(now);
    this.attempts.set(userKey, recent);

    const state = this.active.get(userKey) ?? { count: 0, bytes: 0 };
    if (state.count >= this.maxConcurrentPerUser || state.bytes + contentLength > this.maxInFlightBytesPerUser) {
      this.rejectConcurrent();
    }
    state.count += 1;
    state.bytes += contentLength;
    this.active.set(userKey, state);
    return { store: 'memory', token: randomUUID(), userKey, contentLength, finished: false };
  }

  private assertContentLength(contentLength: number) {
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
      throw new HttpException('A valid Content-Length header is required for uploads', HttpStatus.LENGTH_REQUIRED);
    }
    if (contentLength > this.maxInFlightBytesPerUser) {
      throw new PayloadTooLargeException('Upload exceeds the per-user in-flight byte limit');
    }
  }

  private redisKeys(userKey: string) {
    const digest = createHash('sha256').update(userKey).digest('hex');
    const scope = `{admission:${digest}}`;
    return [
      `upload:${scope}:active`,
      `upload:${scope}:bytes`,
      `upload:${scope}:attempts`
    ];
  }

  private normalizeUserKey(userId: string) {
    const normalized = userId.trim().toLowerCase();
    if (!normalized) throw new ServiceUnavailableException('Upload admission identity is unavailable');
    return normalized;
  }

  private rejectRedis(reason: number): never {
    if (reason === 1) this.rejectRate();
    if (reason === 2 || reason === 3) this.rejectConcurrent();
    throw new ServiceUnavailableException(REDIS_UNAVAILABLE_MESSAGE);
  }

  private rejectRate(): never {
    throw new HttpException('Upload rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
  }

  private rejectConcurrent(): never {
    throw new HttpException('Concurrent upload limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
  }

  private sweepAttempts(now: number) {
    if (now - this.lastSweepAt < this.rateWindowMs) return;
    this.lastSweepAt = now;
    for (const [userId, timestamps] of this.attempts) {
      const recent = timestamps.filter((timestamp) => timestamp > now - this.rateWindowMs);
      if (recent.length === 0) this.attempts.delete(userId);
      else this.attempts.set(userId, recent);
    }
  }
}
