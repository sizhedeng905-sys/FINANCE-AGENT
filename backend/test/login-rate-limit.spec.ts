import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { AuthService } from '../src/auth/auth.service';
import { LoginRateLimitService, LoginReservation } from '../src/auth/login-rate-limit.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';

function config(values: Record<string, unknown> = {}) {
  return { get: (key: string) => values[key] } as ConfigService;
}

function memoryLimiter(values: Record<string, unknown> = {}) {
  return new LoginRateLimitService(
    config({ 'loginRateLimit.store': 'memory', ...values }),
    {} as RedisService
  );
}

describe('LoginRateLimitService', () => {
  it('atomically admits only the configured number of concurrent attempts in memory mode', async () => {
    const limiter = memoryLimiter();
    const admitted: LoginReservation[] = [];
    let rejected = 0;

    for (let index = 0; index < 100; index += 1) {
      try {
        admitted.push(await limiter.reserve('finance', '192.0.2.10'));
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        rejected += 1;
      }
    }

    expect(admitted).toHaveLength(5);
    expect(rejected).toBe(95);
    await Promise.all(admitted.map((reservation) => limiter.release(reservation)));
    expect(limiter.snapshot().globalInFlight).toBe(0);
    await expect(limiter.reserve('finance', '192.0.2.10')).resolves.toMatchObject({ store: 'memory' });
  });

  it('removes expired buckets during bounded periodic cleanup', async () => {
    const now = { value: Date.UTC(2026, 6, 14, 8) };
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now.value);
    try {
      const limiter = memoryLimiter();
      for (let index = 0; index < 100; index += 1) {
        const reservation = await limiter.reserve(`old-user-${index}`, `198.51.100.${index}`);
        await limiter.success(reservation);
      }
      expect(limiter.snapshot().buckets).toBe(300);

      now.value += 31 * 60 * 1000;
      for (let index = 0; index < 256; index += 1) {
        const reservation = await limiter.reserve(`new-user-${index}`, `203.0.113.${index}`);
        await limiter.success(reservation);
      }
      expect(limiter.snapshot().buckets).toBeLessThanOrEqual(768);
    } finally {
      clock.mockRestore();
    }
  });

  it('hashes login identities in Redis keys and completes a reservation only once', async () => {
    const evalAtomic = jest.fn()
      .mockResolvedValueOnce([1, 30_000])
      .mockResolvedValueOnce(1);
    const limiter = new LoginRateLimitService(
      config({ 'loginRateLimit.store': 'redis' }),
      { evalAtomic } as unknown as RedisService
    );

    const reservation = await limiter.reserve('Finance.User', '192.0.2.44');
    const reserveKeys = evalAtomic.mock.calls[0][1] as string[];
    expect(reserveKeys.join('|')).not.toContain('finance.user');
    expect(reserveKeys.join('|')).not.toContain('192.0.2.44');
    expect(reserveKeys).toHaveLength(7);

    await limiter.failure(reservation);
    await limiter.failure(reservation);
    expect(evalAtomic).toHaveBeenCalledTimes(2);
    expect(evalAtomic.mock.calls[1][1]).toContain(`login:{auth}:completed:${reservation.token}`);
  });

  it('fails closed when the configured shared store is unavailable', async () => {
    const limiter = new LoginRateLimitService(
      config({ 'loginRateLimit.store': 'redis' }),
      {
        evalAtomic: jest.fn().mockRejectedValue(new ServiceUnavailableException('Redis unavailable'))
      } as unknown as RedisService
    );

    await expect(limiter.reserve('finance', '192.0.2.10')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not sign a JWT when shared protection fails after credentials are verified', async () => {
    const reservation: LoginReservation = {
      store: 'redis',
      token: 'attempt-token',
      keys: [],
      finished: false
    };
    const limiter = {
      reserve: jest.fn(async () => reservation),
      success: jest.fn(async () => {
        throw new ServiceUnavailableException('Redis unavailable');
      })
    };
    const jwt = { signAsync: jest.fn() };
    const auditLogs = { writeAuthentication: jest.fn(async () => undefined) };
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'finance_1',
          username: 'finance',
          name: 'Finance',
          role: 'finance',
          department: 'Finance',
          phone: null,
          status: UserStatus.active,
          tokenVersion: 1,
          passwordHash: await bcrypt.hash('correct-password', 4)
        }))
      }
    };
    const service = new AuthService(
      prisma as any,
      jwt as any,
      config({}),
      auditLogs as any,
      limiter as any,
      {} as any
    );

    await expect(service.login(
      { username: 'finance', password: 'correct-password' },
      { ip: '192.0.2.20' }
    )).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
    expect(auditLogs.writeAuthentication).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ success: false, failureReason: 'rate_limit_store_unavailable' }),
      expect.anything()
    );
  });
});
