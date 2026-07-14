import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface AttemptBucket {
  failures: number;
  inFlight: number;
  startedAt: number;
  lastSeenAt: number;
  blockedUntil?: number;
  maxFailures: number;
}

export interface LoginReservation {
  keys: string[];
  finished: boolean;
}

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_BUCKETS = 20_000;
const MAX_GLOBAL_IN_FLIGHT = 50;

@Injectable()
export class LoginRateLimitService {
  private readonly buckets = new Map<string, AttemptBucket>();
  private globalInFlight = 0;
  private operationCount = 0;

  reserve(username: string, ip?: string): LoginReservation {
    const now = Date.now();
    this.maybeCleanup(now);
    if (this.globalInFlight >= MAX_GLOBAL_IN_FLIGHT) this.reject();

    const normalizedUser = username.trim().toLowerCase();
    const normalizedIp = (ip || 'unknown').trim().toLowerCase();
    const definitions: Array<[string, number]> = [
      [`combo:${normalizedIp}:${normalizedUser}`, 5],
      [`user:${normalizedUser}`, 10],
      [`ip:${normalizedIp}`, 30]
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
    return { keys: buckets.map(([key]) => key), finished: false };
  }

  failure(reservation: LoginReservation) {
    this.finish(reservation, false);
  }

  success(reservation: LoginReservation) {
    this.finish(reservation, true);
  }

  release(reservation: LoginReservation) {
    if (reservation.finished) return;
    reservation.finished = true;
    for (const key of reservation.keys) {
      const bucket = this.buckets.get(key);
      if (bucket) bucket.inFlight = Math.max(0, bucket.inFlight - 1);
    }
    this.globalInFlight = Math.max(0, this.globalInFlight - 1);
  }

  snapshot() {
    return { buckets: this.buckets.size, globalInFlight: this.globalInFlight };
  }

  private finish(reservation: LoginReservation, succeeded: boolean) {
    if (reservation.finished) return;
    const now = Date.now();
    reservation.finished = true;
    for (const key of reservation.keys) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      bucket.inFlight = Math.max(0, bucket.inFlight - 1);
      bucket.lastSeenAt = now;
      if (succeeded) {
        if (key.startsWith('combo:') || key.startsWith('user:')) {
          bucket.failures = 0;
          bucket.blockedUntil = undefined;
          bucket.startedAt = now;
        }
      } else {
        bucket.failures += 1;
        if (bucket.failures >= bucket.maxFailures) bucket.blockedUntil = now + BLOCK_MS;
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
    if (now - bucket.startedAt >= WINDOW_MS && bucket.inFlight === 0) {
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
        now - bucket.lastSeenAt >= WINDOW_MS + BLOCK_MS &&
        (!bucket.blockedUntil || bucket.blockedUntil <= now)
      ) {
        this.buckets.delete(key);
      }
    }
  }

  private reject(): never {
    throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
  }
}
