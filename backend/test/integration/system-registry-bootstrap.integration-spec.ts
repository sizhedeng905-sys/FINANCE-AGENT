import { Prisma, PrismaClient } from '@prisma/client';

import {
  applySystemRegistry,
  verifySystemRegistry
} from '../../src/model-runtime/system-registry-bootstrap';
import { resolveSystemRegistryConfiguration } from '../../src/model-runtime/system-registry-manifest';

jest.setTimeout(60_000);

const ROLLBACK = Symbol('ROLLBACK');
const prisma = new PrismaClient();
const manifest = resolveSystemRegistryConfiguration({
  NODE_ENV: 'test',
  AI_SYSTEM_REGISTRY_PROFILE: 'development-local-v1'
}).manifest;

describe('system registry PostgreSQL bootstrap', () => {
  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required');
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
    if (!databaseName.endsWith('_test')) {
      throw new Error(`Refusing to run integration tests against non-test database "${databaseName}".`);
    }
    await prisma.$connect();
  });

  afterAll(() => prisma.$disconnect());

  it('creates only system registry rows and is a zero-write no-op on the second run', async () => {
    await withRollback(async (tx) => {
      await clearRegistry(tx);
      const businessCountsBefore = await businessCounts(tx);

      const first = await applySystemRegistry(tx, manifest);
      expect(first).toMatchObject({
        changed: true,
        promptsCreated: 11,
        deploymentsCreated: 5,
        routesCreated: 17,
        promptCount: 11,
        deploymentCount: 5,
        routeCount: 17
      });
      expect(await tx.auditLog.count({ where: { action: 'system_registry.bootstrap' } })).toBe(1);

      const second = await applySystemRegistry(tx, manifest);
      expect(second).toMatchObject({
        changed: false,
        promptsCreated: 0,
        promptsActivated: 0,
        promptsDeactivated: 0,
        deploymentsCreated: 0,
        routesCreated: 0
      });
      expect(await tx.auditLog.count({ where: { action: 'system_registry.bootstrap' } })).toBe(1);
      expect(await businessCounts(tx)).toEqual(businessCountsBefore);
      await expect(verifySystemRegistry(tx, manifest)).resolves.toMatchObject({
        profile: 'development-local-v1',
        promptCount: 11,
        deploymentCount: 5,
        routeCount: 17
      });
    });
  });

  it('fails closed when an immutable prompt version is changed', async () => {
    await withRollback(async (tx) => {
      await clearRegistry(tx);
      await applySystemRegistry(tx, manifest);
      await tx.aiPromptVersion.update({
        where: { promptKey_versionNo: { promptKey: 'finance_core_guard', versionNo: 1 } },
        data: { systemPrompt: 'tampered' }
      });

      await expect(applySystemRegistry(tx, manifest)).rejects.toThrow(
        'System prompt configuration drift: finance_core_guard:v1'
      );
    });
  });

  it('fails closed on deployment and route drift without repairing it silently', async () => {
    await withRollback(async (tx) => {
      await clearRegistry(tx);
      await applySystemRegistry(tx, manifest);
      await tx.modelDeployment.update({
        where: { deploymentKey: 'mock-text' },
        data: { timeoutMs: 9_999 }
      });
      await expect(applySystemRegistry(tx, manifest)).rejects.toThrow(
        'Model deployment configuration drift: mock-text'
      );
    });

    await withRollback(async (tx) => {
      await clearRegistry(tx);
      await applySystemRegistry(tx, manifest);
      const deployment = await tx.modelDeployment.findUniqueOrThrow({ where: { deploymentKey: 'mock-text' } });
      await tx.taskModelRoute.update({
        where: {
          taskType_deploymentId: {
            taskType: 'boss_chat',
            deploymentId: deployment.id
          }
        },
        data: { priority: 99 }
      });
      await expect(verifySystemRegistry(tx, manifest)).rejects.toThrow(
        'Model route configuration drift: boss_chat/mock-text'
      );
    });
  });

  it('rejects an unknown enabled deployment while retaining disabled historical rows', async () => {
    await withRollback(async (tx) => {
      await clearRegistry(tx);
      await applySystemRegistry(tx, manifest);
      await tx.modelDeployment.create({
        data: {
          deploymentKey: 'historical-disabled',
          provider: 'mock',
          modelName: 'historical',
          modelVersion: '1',
          taskTypes: ['historical_task'],
          isLocal: true,
          isEnabled: false,
          status: 'disabled'
        }
      });
      await expect(verifySystemRegistry(tx, manifest)).resolves.toBeDefined();
      await tx.modelDeployment.update({
        where: { deploymentKey: 'historical-disabled' },
        data: { isEnabled: true, status: 'unknown' }
      });
      await expect(verifySystemRegistry(tx, manifest)).rejects.toThrow(
        'Unexpected enabled model deployment: historical-disabled'
      );
    });
  });

  it('requires the referenced environment secret before an external deployment can be enabled', async () => {
    await withRollback(async (tx) => {
      await clearRegistry(tx);
      await applySystemRegistry(tx, manifest);
      await tx.modelDeployment.update({
        where: { deploymentKey: 'qwen3-14b-awq' },
        data: { isEnabled: true, status: 'unknown' }
      });
      await expect(verifySystemRegistry(tx, manifest, {})).rejects.toThrow(
        'Enabled model deployment secret environment variable is missing: qwen3-14b-awq'
      );
    });
  });
});

async function withRollback(callback: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(async (tx) => {
      await callback(tx);
      throw ROLLBACK;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

async function clearRegistry(tx: Prisma.TransactionClient) {
  await tx.aiPromptVersion.deleteMany();
  await tx.modelDeployment.deleteMany();
  await tx.auditLog.deleteMany({ where: { action: 'system_registry.bootstrap' } });
}

async function businessCounts(tx: Prisma.TransactionClient) {
  const [users, projects, templates, records, workOrders, rawFiles] = await Promise.all([
    tx.user.count(),
    tx.project.count(),
    tx.template.count(),
    tx.businessRecord.count(),
    tx.workOrder.count(),
    tx.rawFile.count()
  ]);
  return { users, projects, templates, records, workOrders, rawFiles };
}
