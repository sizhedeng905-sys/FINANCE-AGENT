import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface AttemptWindow {
  count: number;
  startedAt: number;
  blockedUntil?: number;
}

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

@Injectable()
export class LoginRateLimitService {
  private readonly attempts = new Map<string, AttemptWindow>();

  assertAllowed(username: string, ip?: string) {
    const key = this.key(username, ip);
    const now = Date.now();
    const attempt = this.attempts.get(key);
    if (!attempt) return;

    if (attempt.blockedUntil && attempt.blockedUntil > now) {
      throw new HttpException('登录尝试过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (now - attempt.startedAt >= WINDOW_MS) {
      this.attempts.delete(key);
    }
  }

  recordFailure(username: string, ip?: string) {
    const key = this.key(username, ip);
    const now = Date.now();
    const current = this.attempts.get(key);
    const attempt = !current || now - current.startedAt >= WINDOW_MS
      ? { count: 0, startedAt: now }
      : current;
    attempt.count += 1;
    if (attempt.count >= MAX_FAILURES) attempt.blockedUntil = now + BLOCK_MS;
    this.attempts.set(key, attempt);
  }

  reset(username: string, ip?: string) {
    this.attempts.delete(this.key(username, ip));
  }

  private key(username: string, ip?: string) {
    return `${ip ?? 'unknown'}:${username.trim().toLowerCase()}`;
  }
}
