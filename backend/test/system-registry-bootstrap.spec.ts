import { PrismaClient } from '@prisma/client';

import { bootstrapSystemRegistry } from '../src/model-runtime/system-registry-bootstrap';
import { resolveSystemRegistryConfiguration } from '../src/model-runtime/system-registry-manifest';

const manifest = resolveSystemRegistryConfiguration({
  NODE_ENV: 'test',
  AI_SYSTEM_REGISTRY_PROFILE: 'mock-safe-v1'
}).manifest;

const expectedResult = {
  profile: 'mock-safe-v1',
  manifestSha256: manifest.manifestSha256,
  changed: false,
  promptsCreated: 0,
  promptsActivated: 0,
  promptsDeactivated: 0,
  deploymentsCreated: 0,
  routesCreated: 0,
  promptCount: 11,
  deploymentCount: 1,
  routeCount: 7,
  enabledDeploymentCount: 1,
  enabledRouteCount: 7
};

describe('system registry bootstrap retry boundary', () => {
  it.each(['P2002', 'P2034'])('retries the transient bootstrap conflict %s', async (code) => {
    const transaction = jest.fn()
      .mockRejectedValueOnce({ code })
      .mockResolvedValueOnce(expectedResult);
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    await expect(bootstrapSystemRegistry(prisma, manifest)).resolves.toEqual(expectedResult);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unrelated database failure', async () => {
    const error = new Error('database permission denied');
    const transaction = jest.fn().mockRejectedValue(error);
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    await expect(bootstrapSystemRegistry(prisma, manifest)).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('fails after the bounded conflict retry budget is exhausted', async () => {
    const error = { code: 'P2034' };
    const transaction = jest.fn().mockRejectedValue(error);
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    await expect(bootstrapSystemRegistry(prisma, manifest)).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(3);
  });
});
