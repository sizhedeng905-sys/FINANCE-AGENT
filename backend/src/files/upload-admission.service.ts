import { HttpException, HttpStatus, Injectable, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ActiveUploadState {
  count: number;
  bytes: number;
}

@Injectable()
export class UploadAdmissionService {
  private readonly maxConcurrentPerUser: number;
  private readonly maxInFlightBytesPerUser: number;
  private readonly rateWindowMs: number;
  private readonly rateMaxPerUser: number;
  private readonly active = new Map<string, ActiveUploadState>();
  private readonly attempts = new Map<string, number[]>();
  private lastSweepAt = 0;

  constructor(config: ConfigService) {
    this.maxConcurrentPerUser = config.get<number>('uploadAdmission.maxConcurrentPerUser') ?? 5;
    this.maxInFlightBytesPerUser = (config.get<number>('uploadAdmission.maxInFlightMbPerUser') ?? 260) * 1024 * 1024;
    this.rateWindowMs = config.get<number>('uploadAdmission.rateWindowMs') ?? 60_000;
    this.rateMaxPerUser = config.get<number>('uploadAdmission.rateMaxPerUser') ?? 60;
  }

  reserve(userId: string, contentLength: number) {
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
      throw new HttpException('A valid Content-Length header is required for uploads', HttpStatus.LENGTH_REQUIRED);
    }
    if (contentLength > this.maxInFlightBytesPerUser) {
      throw new PayloadTooLargeException('Upload exceeds the per-user in-flight byte limit');
    }

    const now = Date.now();
    this.sweepAttempts(now);
    const recent = (this.attempts.get(userId) ?? []).filter((timestamp) => timestamp > now - this.rateWindowMs);
    if (recent.length >= this.rateMaxPerUser) throw new HttpException('Upload rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.attempts.set(userId, recent);

    const state = this.active.get(userId) ?? { count: 0, bytes: 0 };
    if (state.count >= this.maxConcurrentPerUser || state.bytes + contentLength > this.maxInFlightBytesPerUser) {
      throw new HttpException('Concurrent upload limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    state.count += 1;
    state.bytes += contentLength;
    this.active.set(userId, state);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.active.get(userId);
      if (!current) return;
      current.count = Math.max(0, current.count - 1);
      current.bytes = Math.max(0, current.bytes - contentLength);
      if (current.count === 0) this.active.delete(userId);
      else this.active.set(userId, current);
    };
  }

  activeFor(userId: string) {
    return { ...(this.active.get(userId) ?? { count: 0, bytes: 0 }) };
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
