import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';

import { RedisService } from '../../src/infrastructure/redis/redis.service';
import { ModelExecutionGateService } from '../../src/model-runtime/model-execution-gate.service';

const redisUrl = process.env.TEST_REDIS_URL;
if (!redisUrl && process.env.REQUIRE_REDIS_INTEGRATION === 'true') {
  throw new Error('TEST_REDIS_URL is required when REQUIRE_REDIS_INTEGRATION=true');
}

interface GateOptions {
  maxQueue?: number;
  queueWaitTimeoutMs?: number;
  executionLeaseMs?: number;
  waiterLeaseMs?: number;
  queuePollMs?: number;
}

function config(prefix: string, options: GateOptions = {}) {
  const values: Record<string, unknown> = {
    'redis.url': redisUrl,
    'redis.required': true,
    'redis.keyPrefix': prefix,
    'redis.connectTimeoutMs': 2_000,
    'modelRuntime.gateStore': 'redis',
    'modelRuntime.maxQueue': options.maxQueue ?? 200,
    'modelRuntime.queueWaitTimeoutMs': options.queueWaitTimeoutMs ?? 10_000,
    'modelRuntime.executionLeaseMs': options.executionLeaseMs ?? 1_000,
    'modelRuntime.waiterLeaseMs': options.waiterLeaseMs ?? 1_000,
    'modelRuntime.queuePollMs': options.queuePollMs ?? 25
  };
  return { get: (key: string) => values[key] } as ConfigService;
}

async function redisGate(prefix: string, options: GateOptions = {}) {
  const settings = config(prefix, options);
  const redis = new RedisService(settings);
  await redis.onModuleInit();
  return { redis, gate: new ModelExecutionGateService(settings, redis) };
}

function prefix() {
  return `fa-model-gate-it-${randomUUID().slice(0, 8)}`;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for shared gate state');
}

const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('shared Redis model execution gate', () => {
  it('enforces one global concurrency budget across two instances without exposing the gate key', async () => {
    const keyPrefix = prefix();
    const first = await redisGate(keyPrefix);
    const second = await redisGate(keyPrefix);
    const gateKey = 'ai:private-deployment-config-hash';
    let active = 0;
    let peak = 0;
    try {
      const work = Array.from({ length: 100 }, (_, index) => (
        index % 2 === 0 ? first.gate : second.gate
      ).run(gateKey, 2, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return index;
      }));

      await waitFor(async () => Object.values(await first.gate.snapshot()).some((state) => state.queued > 0));
      expect(Object.keys(await first.gate.snapshot()).join('\n')).not.toContain(gateKey);
      const inspector = createClient({ url: redisUrl! });
      await inspector.connect();
      try {
        const keys = await inspector.keys(`${keyPrefix}:model:*`);
        expect(keys).not.toHaveLength(0);
        expect(keys.join('\n')).not.toContain(gateKey);
      } finally {
        await inspector.quit();
      }
      const results = await Promise.all(work);

      expect(results).toEqual(Array.from({ length: 100 }, (_, index) => index));
      expect(peak).toBe(2);
      expect(Object.values(await first.gate.snapshot())).toContainEqual(expect.objectContaining({ active: 0, queued: 0 }));

    } finally {
      await Promise.all([first.redis.onModuleDestroy(), second.redis.onModuleDestroy()]);
    }
  });

  it('preserves FIFO order across instances', async () => {
    const keyPrefix = prefix();
    const first = await redisGate(keyPrefix);
    const second = await redisGate(keyPrefix);
    const blocker = deferred();
    const started = deferred();
    const order: string[] = [];
    try {
      const active = first.gate.run('ocr:fifo', 1, async () => {
        order.push('active');
        started.resolve();
        await blocker.promise;
      });
      await started.promise;
      const firstWaiter = first.gate.run('ocr:fifo', 1, async () => {
        order.push('first-waiter');
      });
      await waitFor(async () => Object.values(await first.gate.snapshot()).some((state) => state.queued === 1));
      const secondWaiter = second.gate.run('ocr:fifo', 1, async () => {
        order.push('second-waiter');
      });
      await waitFor(async () => Object.values(await first.gate.snapshot()).some((state) => state.queued === 2));

      blocker.resolve();
      await Promise.all([active, firstWaiter, secondWaiter]);
      expect(order).toEqual(['active', 'first-waiter', 'second-waiter']);
    } finally {
      await Promise.all([first.redis.onModuleDestroy(), second.redis.onModuleDestroy()]);
    }
  });

  it('bounds the shared queue and expires a waiter at the configured deadline', async () => {
    const keyPrefix = prefix();
    const options = { maxQueue: 1, queueWaitTimeoutMs: 1_000 };
    const first = await redisGate(keyPrefix, options);
    const second = await redisGate(keyPrefix, options);
    const blocker = deferred();
    const started = deferred();
    try {
      const active = first.gate.run('ai:bounded', 1, async () => {
        started.resolve();
        await blocker.promise;
      });
      await started.promise;
      const waiter = second.gate.run('ai:bounded', 1, async () => 'too-late');
      await waitFor(async () => Object.values(await first.gate.snapshot()).some((state) => state.queued === 1));
      await expect(first.gate.run('ai:bounded', 1, async () => 'overflow'))
        .rejects.toThrow('队列已满');
      await expect(waiter).rejects.toThrow('排队超时');
      blocker.resolve();
      await active;
    } finally {
      await Promise.all([first.redis.onModuleDestroy(), second.redis.onModuleDestroy()]);
    }
  });

  it('renews a long execution lease and releases the permit after provider failure', async () => {
    const keyPrefix = prefix();
    const first = await redisGate(keyPrefix);
    const second = await redisGate(keyPrefix);
    let active = 0;
    let peak = 0;
    try {
      const long = first.gate.run('ocr:renew', 1, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1_600));
        active -= 1;
        return 'long';
      });
      const queued = second.gate.run('ocr:renew', 1, async () => {
        active += 1;
        peak = Math.max(peak, active);
        active -= 1;
        return 'queued';
      });
      await expect(Promise.all([long, queued])).resolves.toEqual(['long', 'queued']);
      expect(peak).toBe(1);

      await expect(first.gate.run('ocr:renew', 1, async () => {
        throw new Error('provider failed');
      })).rejects.toThrow('provider failed');
      await expect(second.gate.run('ocr:renew', 1, async () => 'recovered')).resolves.toBe('recovered');
    } finally {
      await Promise.all([first.redis.onModuleDestroy(), second.redis.onModuleDestroy()]);
    }
  });

  it('recovers an active permit after an instance crashes', async () => {
    const keyPrefix = prefix();
    const crashed = await redisGate(keyPrefix);
    const survivor = await redisGate(keyPrefix);
    const started = deferred();
    try {
      const abandoned = crashed.gate.run('ai:crash', 1, async (signal) => new Promise<void>((_resolve, reject) => {
        started.resolve();
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
      const abandonedOutcome = abandoned.then(() => undefined, (error) => error);
      await started.promise;
      await crashed.redis.onModuleDestroy();

      const startedAt = Date.now();
      await expect(survivor.gate.run('ai:crash', 1, async () => 'recovered')).resolves.toBe('recovered');
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(650);
      expect(await abandonedOutcome).toBeInstanceOf(ServiceUnavailableException);
    } finally {
      await Promise.all([crashed.redis.onModuleDestroy(), survivor.redis.onModuleDestroy()]);
    }
  });

  it('fails closed when the shared store is disconnected', async () => {
    const instance = await redisGate(prefix());
    await instance.redis.onModuleDestroy();
    await expect(instance.gate.run('ai:offline', 1, async () => 'unsafe'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
