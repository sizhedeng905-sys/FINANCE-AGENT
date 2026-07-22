import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';

import { getErrorCode } from '../constants/error-codes';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { RequestWithId } from './request-id.middleware';

interface RateBucket {
  startedAt: number;
  count: number;
}

@Injectable()
export class RequestRateLimitMiddleware implements NestMiddleware {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly store: string;
  private requestsSinceCleanup = 0;

  constructor(config: ConfigService, private readonly redis: RedisService) {
    this.windowMs = config.get<number>('requestRateLimit.windowMs') ?? 60000;
    this.maxRequests = config.get<number>('requestRateLimit.max') ?? 600;
    this.store = config.get<string>('requestRateLimit.store') ?? 'memory';
  }

  async use(request: RequestWithId, response: Response, next: NextFunction) {
    try {
      const key = request.ip || request.socket.remoteAddress || 'unknown';
      const redisBucket = this.store === 'redis'
        ? await this.redis.fixedWindowRateLimit(key, this.windowMs)
        : undefined;
      const result = redisBucket ?? this.incrementMemoryBucket(key);
      this.respondOrContinue(request, response, next, result.count, result.ttlMs);
    } catch (error) {
      next(error);
    }
  }

  private incrementMemoryBucket(key: string) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= this.windowMs) {
      bucket = { startedAt: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    this.requestsSinceCleanup += 1;
    if (this.requestsSinceCleanup >= 1000) {
      this.requestsSinceCleanup = 0;
      for (const [bucketKey, candidate] of this.buckets) {
        if (now - candidate.startedAt >= this.windowMs) this.buckets.delete(bucketKey);
      }
    }

    return { count: bucket.count, ttlMs: Math.max(1, bucket.startedAt + this.windowMs - now) };
  }

  private respondOrContinue(
    request: RequestWithId,
    response: Response,
    next: NextFunction,
    count: number,
    ttlMs: number
  ) {
    const resetSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
    response.setHeader('RateLimit-Limit', this.maxRequests);
    response.setHeader('RateLimit-Remaining', Math.max(0, this.maxRequests - count));
    response.setHeader('RateLimit-Reset', resetSeconds);
    if (count > this.maxRequests) {
      response.setHeader('Retry-After', resetSeconds);
      response.status(429).json({
        code: getErrorCode(429),
        message: '请求过于频繁，请稍后重试',
        data: { requestId: request.requestId, retryAfterSeconds: resetSeconds }
      });
      return;
    }
    next();
  }
}
