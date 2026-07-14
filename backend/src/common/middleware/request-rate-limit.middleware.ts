import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';

import { getErrorCode } from '../constants/error-codes';
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
  private requestsSinceCleanup = 0;

  constructor(config: ConfigService) {
    this.windowMs = config.get<number>('requestRateLimit.windowMs') ?? 60000;
    this.maxRequests = config.get<number>('requestRateLimit.max') ?? 600;
  }

  use(request: RequestWithId, response: Response, next: NextFunction) {
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= this.windowMs) {
      bucket = { startedAt: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    const resetSeconds = Math.max(1, Math.ceil((bucket.startedAt + this.windowMs - now) / 1000));
    response.setHeader('RateLimit-Limit', this.maxRequests);
    response.setHeader('RateLimit-Remaining', Math.max(0, this.maxRequests - bucket.count));
    response.setHeader('RateLimit-Reset', resetSeconds);

    this.requestsSinceCleanup += 1;
    if (this.requestsSinceCleanup >= 1000) {
      this.requestsSinceCleanup = 0;
      for (const [bucketKey, candidate] of this.buckets) {
        if (now - candidate.startedAt >= this.windowMs) this.buckets.delete(bucketKey);
      }
    }

    if (bucket.count > this.maxRequests) {
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
