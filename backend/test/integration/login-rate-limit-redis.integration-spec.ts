import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { LoginRateLimitService, LoginReservation } from '../../src/auth/login-rate-limit.service';
import { RedisService } from '../../src/infrastructure/redis/redis.service';

const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl && process.env.REQUIRE_REDIS_INTEGRATION === 'true') {
  throw new Error('TEST_REDIS_URL is required when REQUIRE_REDIS_INTEGRATION=true');
}

function config(prefix: string, leaseMs = 1_000) {
  const values: Record<string, unknown> = {
    'redis.url': redisUrl,
    'redis.required': true,
    'redis.keyPrefix': prefix,
    'redis.connectTimeoutMs': 2_000,
    'loginRateLimit.store': 'redis',
    'loginRateLimit.windowMs': 5_000,
    'loginRateLimit.blockMs': 5_000,
    'loginRateLimit.leaseMs': leaseMs
  };
  return { get: (key: string) => values[key] } as ConfigService;
}

async function redisLimiter(prefix: string, leaseMs = 1_000) {
  const settings = config(prefix, leaseMs);
  const redis = new RedisService(settings);
  await redis.onModuleInit();
  return { redis, limiter: new LoginRateLimitService(settings, redis) };
}

function prefix() {
  return `fa-login-it-${randomUUID().slice(0, 8)}`;
}

const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('shared Redis login rate limiting', () => {
  it('admits the combination limit atomically across two instances', async () => {
    const keyPrefix = prefix();
    const first = await redisLimiter(keyPrefix);
    const second = await redisLimiter(keyPrefix);
    const reservations: LoginReservation[] = [];
    let rejected = 0;
    try {
      await Promise.all(Array.from({ length: 100 }, async (_, index) => {
        try {
          reservations.push(await (index % 2 === 0 ? first.limiter : second.limiter)
            .reserve('finance', '192.0.2.10'));
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(429);
          rejected += 1;
        }
      }));

      expect(reservations).toHaveLength(5);
      expect(rejected).toBe(95);
      await Promise.all(reservations.map((reservation, index) =>
        (index % 2 === 0 ? first.limiter : second.limiter).release(reservation)
      ));
    } finally {
      await Promise.all([first.redis.onModuleDestroy(), second.redis.onModuleDestroy()]);
    }
  });

  it('retains failure state when an application instance restarts', async () => {
    const keyPrefix = prefix();
    const first = await redisLimiter(keyPrefix);
    const second = await redisLimiter(keyPrefix);
    let replacement: Awaited<ReturnType<typeof redisLimiter>> | undefined;
    try {
      for (let index = 0; index < 4; index += 1) {
        const reservation = await (index % 2 === 0 ? first.limiter : second.limiter)
          .reserve('finance', '192.0.2.11');
        await (index % 2 === 0 ? first.limiter : second.limiter).failure(reservation);
      }

      await first.redis.onModuleDestroy();
      replacement = await redisLimiter(keyPrefix);
      const finalFailure = await replacement.limiter.reserve('finance', '192.0.2.11');
      await replacement.limiter.failure(finalFailure);

      await expect(second.limiter.reserve('finance', '192.0.2.11')).rejects.toMatchObject({ status: 429 });
    } finally {
      await Promise.all([
        second.redis.onModuleDestroy(),
        replacement?.redis.onModuleDestroy() ?? Promise.resolve()
      ]);
    }
  });

  it('recovers abandoned reservations after their lease expires', async () => {
    const keyPrefix = prefix();
    const crashed = await redisLimiter(keyPrefix);
    const survivor = await redisLimiter(keyPrefix);
    try {
      await Promise.all(Array.from({ length: 5 }, () => crashed.limiter.reserve('finance', '192.0.2.12')));
      await crashed.redis.onModuleDestroy();
      await new Promise((resolve) => setTimeout(resolve, 1_150));

      const recovered = await survivor.limiter.reserve('finance', '192.0.2.12');
      await survivor.limiter.release(recovered);
    } finally {
      await survivor.redis.onModuleDestroy();
    }
  });

  it('fails closed after the shared store connection is lost', async () => {
    const instance = await redisLimiter(prefix());
    await instance.redis.onModuleDestroy();
    await expect(instance.limiter.reserve('finance', '192.0.2.13'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
