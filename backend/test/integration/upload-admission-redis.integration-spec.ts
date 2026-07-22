import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

import { UploadAdmissionService, UploadReservation } from '../../src/files/upload-admission.service';
import { RedisService } from '../../src/infrastructure/redis/redis.service';

const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl && process.env.REQUIRE_REDIS_INTEGRATION === 'true') {
  throw new Error('TEST_REDIS_URL is required when REQUIRE_REDIS_INTEGRATION=true');
}

interface AdmissionOptions {
  maxConcurrent?: number;
  maxInFlightMb?: number;
  rateMax?: number;
  leaseMs?: number;
}

function config(prefix: string, options: AdmissionOptions = {}) {
  const values: Record<string, unknown> = {
    'redis.url': redisUrl,
    'redis.required': true,
    'redis.keyPrefix': prefix,
    'redis.connectTimeoutMs': 2_000,
    'uploadAdmission.store': 'redis',
    'uploadAdmission.maxConcurrentPerUser': options.maxConcurrent ?? 3,
    'uploadAdmission.maxInFlightMbPerUser': options.maxInFlightMb ?? 1,
    'uploadAdmission.rateWindowMs': 5_000,
    'uploadAdmission.rateMaxPerUser': options.rateMax ?? 200,
    'uploadAdmission.leaseMs': options.leaseMs ?? 1_000
  };
  return { get: (key: string) => values[key] } as ConfigService;
}

async function redisAdmission(prefix: string, options: AdmissionOptions = {}) {
  const settings = config(prefix, options);
  const redis = new RedisService(settings);
  await redis.onModuleInit();
  return { redis, admission: new UploadAdmissionService(settings, redis) };
}

function prefix() {
  return `fa-upload-it-${randomUUID().slice(0, 8)}`;
}

const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('shared Redis upload admission', () => {
  it('enforces concurrent count and in-flight bytes atomically across two instances', async () => {
    const keyPrefix = prefix();
    const first = await redisAdmission(keyPrefix);
    const second = await redisAdmission(keyPrefix);
    const reservations: UploadReservation[] = [];
    let rejected = 0;
    try {
      await Promise.all(Array.from({ length: 100 }, async (_, index) => {
        try {
          reservations.push(await (index % 2 === 0 ? first.admission : second.admission)
            .reserve('finance-shared', 400_000));
        } catch (error) {
          expect(error).toBeInstanceOf(HttpException);
          expect((error as HttpException).getStatus()).toBe(429);
          rejected += 1;
        }
      }));

      expect(reservations).toHaveLength(2);
      expect(rejected).toBe(98);
      await expect(first.admission.activeFor('finance-shared')).resolves.toEqual({ count: 2, bytes: 800_000 });
      const inspector = createClient({ url: redisUrl! });
      await inspector.connect();
      try {
        const keys = await inspector.keys(`${keyPrefix}:upload:*`);
        expect(keys).not.toHaveLength(0);
        expect(keys.join('\n')).not.toContain('finance-shared');
      } finally {
        await inspector.quit();
      }
      await Promise.all(reservations.map((reservation) => second.admission.release(reservation)));
      await second.admission.release(reservations[0]);
      await expect(first.admission.activeFor('finance-shared')).resolves.toEqual({ count: 0, bytes: 0 });
    } finally {
      await Promise.all([first.redis.onModuleDestroy(), second.redis.onModuleDestroy()]);
    }
  });

  it('retains the shared request-rate window when an application instance restarts', async () => {
    const keyPrefix = prefix();
    const first = await redisAdmission(keyPrefix, { maxConcurrent: 10, rateMax: 3 });
    const second = await redisAdmission(keyPrefix, { maxConcurrent: 10, rateMax: 3 });
    let replacement: Awaited<ReturnType<typeof redisAdmission>> | undefined;
    try {
      for (let index = 0; index < 3; index += 1) {
        const instance = index % 2 === 0 ? first.admission : second.admission;
        const reservation = await instance.reserve('finance-rate', 1_024);
        await instance.release(reservation);
      }

      await first.redis.onModuleDestroy();
      replacement = await redisAdmission(keyPrefix, { maxConcurrent: 10, rateMax: 3 });
      await expect(replacement.admission.reserve('finance-rate', 1_024)).rejects.toMatchObject({ status: 429 });
    } finally {
      await Promise.all([
        second.redis.onModuleDestroy(),
        replacement?.redis.onModuleDestroy() ?? Promise.resolve()
      ]);
    }
  });

  it('renews live uploads and recovers abandoned reservations after lease expiry', async () => {
    const keyPrefix = prefix();
    const crashed = await redisAdmission(keyPrefix, { maxConcurrent: 1, leaseMs: 1_000 });
    const survivor = await redisAdmission(keyPrefix, { maxConcurrent: 1, leaseMs: 1_000 });
    try {
      const live = await crashed.admission.reserve('finance-lease', 400_000);
      await new Promise((resolve) => setTimeout(resolve, 700));
      await survivor.admission.renew(live);
      await new Promise((resolve) => setTimeout(resolve, 700));
      await expect(crashed.admission.reserve('finance-lease', 400_000)).rejects.toMatchObject({ status: 429 });

      await crashed.redis.onModuleDestroy();
      await new Promise((resolve) => setTimeout(resolve, 1_150));
      const recovered = await survivor.admission.reserve('finance-lease', 400_000);
      await survivor.admission.release(recovered);
    } finally {
      await Promise.all([crashed.redis.onModuleDestroy(), survivor.redis.onModuleDestroy()]);
    }
  });

  it('fails closed after the shared store connection is lost', async () => {
    const instance = await redisAdmission(prefix());
    await instance.redis.onModuleDestroy();
    await expect(instance.admission.reserve('finance-disconnected', 1_024))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
