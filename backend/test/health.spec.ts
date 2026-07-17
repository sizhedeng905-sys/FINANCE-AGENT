import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';

import { HealthController } from '../src/health/health.controller';

function createController(overrides: Record<string, any> = {}) {
  const prisma: any = overrides.prisma ?? {
    $queryRaw: jest.fn(async () => [{ '?column?': 1 }]),
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    importTask: { count: jest.fn(async () => 1) },
    ocrTask: { count: jest.fn(async () => 2) },
    aiTask: { count: jest.fn(async () => 3) }
  };
  const storage: any = overrides.storage ?? { availableBytes: jest.fn(async () => 2n * 1024n * 1024n * 1024n) };
  const fileSecurity: any = overrides.fileSecurity ?? { readiness: jest.fn(async () => ({ status: 'not_required', mode: 'basic' })) };
  const modelRuntime: any = overrides.modelRuntime ?? {
    health: jest.fn(async () => ({
      status: 'ok',
      deployments: [{
        key: 'mock', model: 'mock-model', modelVersion: '1', enabled: true,
        healthy: true, status: 'healthy', capabilities: ['boss_chat']
      }]
    }))
  };
  const gate: any = overrides.gate ?? { readiness: jest.fn(() => ({ status: 'ok', maxQueue: 20, queues: {} })) };
  const redis: any = overrides.redis ?? {
    ping: jest.fn(async () => ({ status: 'not_required' })),
    readWorkerHeartbeat: jest.fn(async () => undefined)
  };
  const config = {
    get: jest.fn((key: string) => key === 'fileQuotas.minimumFreeMb' ? 1024 : key === 'processRole' ? 'all' : undefined)
  } as unknown as ConfigService;
  return new HealthController(prisma, storage, fileSecurity, modelRuntime, gate, redis, config);
}

describe('health readiness', () => {
  it('keeps liveness process-only and reports every required readiness dependency', async () => {
    const controller = createController();
    expect(controller.live()).toEqual({ status: 'ok' });
    await expect(controller.ready()).resolves.toMatchObject({
      status: 'ok',
      database: 'ok',
      checks: {
        database: { status: 'ok' },
        storage: { status: 'ok' },
        antivirus: { status: 'not_required' },
        queues: { status: 'ok', pending: { imports: 1, ocr: 2, ai: 3 } },
        models: { status: 'ok', enabled: [expect.objectContaining({ key: 'mock', healthy: true })] },
        redis: { status: 'not_required' }
      }
    });
  });

  it('returns not-ready details without exposing dependency exception messages', async () => {
    const controller = createController({
      storage: { availableBytes: jest.fn(async () => { throw new Error('C:\\sensitive\\upload-root'); }) },
      modelRuntime: { health: jest.fn(async () => ({ status: 'degraded', deployments: [] })) },
      gate: { readiness: jest.fn(() => ({ status: 'saturated', maxQueue: 1, queues: { model: { active: 1, queued: 1 } } })) }
    });

    try {
      await controller.ready();
      throw new Error('Expected readiness to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        message: 'Service is not ready',
        data: {
          status: 'not_ready',
          checks: {
            storage: { status: 'unavailable' },
            queues: { status: 'saturated' },
            models: { status: 'unhealthy' }
          }
        }
      });
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain('sensitive');
    }
  });

  it('requires a current shared worker heartbeat for an API process', async () => {
    const redis = {
      ping: jest.fn(async () => ({ status: 'ok', latencyMs: 1 })),
      readWorkerHeartbeat: jest.fn(async () => undefined)
    };
    const controller = createController({ redis });
    (controller as any).processRole = 'api';
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports worker readiness without exposing host or process metadata', async () => {
    const redis = {
      ping: jest.fn(async () => ({ status: 'ok', latencyMs: 1 })),
      readWorkerHeartbeat: jest.fn(async () => ({
        instanceId: 'internal-worker-host',
        processRole: 'worker',
        pid: 1234,
        timestamp: new Date().toISOString(),
        ttlMs: 15_000
      }))
    };
    const controller = createController({ redis });
    (controller as any).processRole = 'api';

    const response = await controller.ready();

    expect(response.checks.redis).toEqual({
      status: 'ok',
      latencyMs: 1,
      worker: { status: 'ok' }
    });
    expect(JSON.stringify(response)).not.toContain('internal-worker-host');
    expect(JSON.stringify(response)).not.toContain('1234');
  });
});
