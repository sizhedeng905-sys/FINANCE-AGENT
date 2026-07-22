import 'reflect-metadata';

import { ModelDeploymentStatus, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { resolveModelDeployment } from './model-deployment-config';

const prisma = new PrismaClient();

interface Snapshot {
  schemaVersion: 1;
  createdAt: string;
  deployments: Array<{
    deploymentKey: string;
    configHash: string;
    isEnabled: boolean;
    routes: Array<{ taskType: string; isEnabled: boolean }>;
  }>;
}

async function main() {
  const [action = 'export', path] = process.argv.slice(2);
  if (action === 'export') {
    process.stdout.write(JSON.stringify(await exportSnapshot(), null, 2) + '\n');
    return;
  }
  if (action !== 'restore' || !path) {
    throw new Error('Usage: model-route-state export | restore <snapshot.json>');
  }
  if (process.env.NODE_ENV === 'production' && process.env.MODEL_ROUTE_ALLOW_PRODUCTION !== 'true') {
    throw new Error('Production model route restore requires MODEL_ROUTE_ALLOW_PRODUCTION=true');
  }
  const raw = path === '-' ? await readStandardInput() : await readFile(path, 'utf8');
  const snapshot = parseSnapshot(raw);
  const expectedHash = createHash('sha256').update(raw).digest('hex');
  if (process.env.MODEL_ROUTE_RESTORE_SHA256 !== expectedHash) {
    throw new Error('MODEL_ROUTE_RESTORE_SHA256 does not match the supplied snapshot');
  }
  await restoreSnapshot(snapshot, expectedHash);
  process.stdout.write(JSON.stringify({ status: 'restored', snapshotSha256: expectedHash }) + '\n');
}

async function exportSnapshot(): Promise<Snapshot> {
  const deployments = await prisma.modelDeployment.findMany({
    include: { routes: { orderBy: { taskType: 'asc' } } },
    orderBy: { deploymentKey: 'asc' }
  });
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    deployments: deployments.map((deployment) => ({
      deploymentKey: deployment.deploymentKey,
      configHash: resolveModelDeployment(deployment).configHash,
      isEnabled: deployment.isEnabled,
      routes: deployment.routes.map((route) => ({ taskType: route.taskType, isEnabled: route.isEnabled }))
    }))
  };
}

async function restoreSnapshot(snapshot: Snapshot, snapshotSha256: string) {
  await prisma.$transaction(async (tx) => {
    const currentDeployments = await tx.modelDeployment.findMany({ include: { routes: true } });
    const expectedByKey = new Map(snapshot.deployments.map((deployment) => [deployment.deploymentKey, deployment]));
    for (const expected of snapshot.deployments) {
      const current = currentDeployments.find((deployment) => deployment.deploymentKey === expected.deploymentKey);
      if (!current) throw new Error(`Model deployment is missing: ${expected.deploymentKey}`);
      if (resolveModelDeployment(current).configHash !== expected.configHash) {
        throw new Error(`Model deployment configuration changed: ${expected.deploymentKey}`);
      }
      const expectedRoutes = new Map(expected.routes.map((route) => [route.taskType, route.isEnabled]));
      for (const route of expected.routes) {
        if (!current.routes.some((candidate) => candidate.taskType === route.taskType)) {
          throw new Error(`Model route is missing: ${expected.deploymentKey}/${route.taskType}`);
        }
      }
      if (!expected.isEnabled && expected.routes.some((route) => route.isEnabled)) {
        throw new Error(`Disabled model deployment has an enabled route: ${expected.deploymentKey}`);
      }
    }

    for (const current of currentDeployments) {
      const expected = expectedByKey.get(current.deploymentKey);
      await tx.modelDeployment.update({
        where: { id: current.id },
        data: {
          isEnabled: expected?.isEnabled ?? false,
          status: expected?.isEnabled ? ModelDeploymentStatus.unknown : ModelDeploymentStatus.disabled,
          lastError: null
        }
      });
      const expectedRoutes = new Map(expected?.routes.map((route) => [route.taskType, route.isEnabled]) ?? []);
      for (const route of current.routes) {
        await tx.taskModelRoute.update({
          where: { id: route.id },
          data: { isEnabled: expectedRoutes.get(route.taskType) ?? false }
        });
      }
    }
    await tx.auditLog.create({
      data: {
        action: 'model_routes.rollback',
        resourceType: 'model_runtime',
        metadata: { snapshotSha256, deploymentCount: snapshot.deployments.length }
      }
    });
  });
}

function parseSnapshot(raw: string): Snapshot {
  const value = JSON.parse(raw) as Snapshot;
  if (value.schemaVersion !== 1 || !Array.isArray(value.deployments) || value.deployments.length > 100) {
    throw new Error('Invalid model route snapshot');
  }
  const deploymentKeys = new Set<string>();
  let routeCount = 0;
  for (const deployment of value.deployments) {
    if (!/^[A-Za-z0-9._-]{2,128}$/.test(deployment.deploymentKey) || !/^[a-f0-9]{64}$/.test(deployment.configHash)) {
      throw new Error('Invalid model deployment snapshot entry');
    }
    if (deploymentKeys.has(deployment.deploymentKey)) throw new Error('Duplicate model deployment snapshot entry');
    deploymentKeys.add(deployment.deploymentKey);
    if (typeof deployment.isEnabled !== 'boolean' || !Array.isArray(deployment.routes)) {
      throw new Error('Invalid model deployment state');
    }
    const taskTypes = new Set<string>();
    for (const route of deployment.routes) {
      if (!/^[A-Za-z0-9._:-]{2,128}$/.test(route.taskType) || typeof route.isEnabled !== 'boolean') {
        throw new Error('Invalid model route snapshot entry');
      }
      if (taskTypes.has(route.taskType)) throw new Error('Duplicate model route snapshot entry');
      taskTypes.add(route.taskType);
      routeCount += 1;
      if (routeCount > 1_000) throw new Error('Model route snapshot contains too many routes');
    }
  }
  return value;
}

async function readStandardInput() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  if (chunks.reduce((sum, chunk) => sum + chunk.length, 0) > 1024 * 1024) {
    throw new Error('Model route snapshot exceeds 1 MiB');
  }
  return Buffer.concat(chunks).toString('utf8');
}

void main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Model route state command failed'}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
