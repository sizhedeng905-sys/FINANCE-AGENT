import { ModelDeploymentStatus, PrismaClient } from '@prisma/client';
import { loadEnvFile } from 'node:process';

import { resolveModelDeployment } from '../src/model-runtime/model-deployment-config';
import { probeModelDeployment } from '../src/model-runtime/model-health-probe';

try {
  loadEnvFile('.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const prisma = new PrismaClient();

async function main() {
  const [action = 'list', deploymentKey] = process.argv.slice(2);
  if (action === 'list') {
    const deployments = await prisma.modelDeployment.findMany({
      include: { routes: true },
      orderBy: { deploymentKey: 'asc' }
    });
    for (const deployment of deployments) {
      const resolved = resolveModelDeployment(deployment);
      console.log(`${resolved.key}\t${resolved.isEnabled ? 'enabled' : 'disabled'}\t${resolved.provider}\t${resolved.modelName}\t${resolved.modelVersion ?? 'missing-version'}\t${resolved.configHash}`);
    }
    return;
  }
  if (!['enable', 'disable'].includes(action) || !deploymentKey) {
    throw new Error('Usage: npm run model:routes -- list|enable|disable [deploymentKey]');
  }
  if (process.env.NODE_ENV === 'production' && process.env.MODEL_ROUTE_ALLOW_PRODUCTION !== 'true') {
    throw new Error('Production model route changes require MODEL_ROUTE_ALLOW_PRODUCTION=true.');
  }
  const deployment = await prisma.modelDeployment.findUnique({ where: { deploymentKey } });
  if (!deployment) throw new Error(`Unknown deploymentKey: ${deploymentKey}`);
  const enabled = action === 'enable';
  const health = enabled ? await checkDeployment(deployment) : undefined;
  await prisma.$transaction([
    prisma.modelDeployment.update({
      where: { id: deployment.id },
      data: {
        isEnabled: enabled,
        status: enabled ? ModelDeploymentStatus.healthy : ModelDeploymentStatus.disabled,
        lastHealthAt: health ? new Date() : undefined,
        lastHealthLatencyMs: health?.latencyMs,
        lastError: null
      }
    }),
    prisma.taskModelRoute.updateMany({
      where: { deploymentId: deployment.id },
      data: { isEnabled: enabled }
    })
  ]);
  console.log(`${deploymentKey} is now ${enabled ? 'enabled' : 'disabled'}.`);
}

async function checkDeployment(deployment: Parameters<typeof resolveModelDeployment>[0]) {
  const resolved = resolveModelDeployment(deployment);
  const secret = resolved.secretRef ? process.env[resolved.secretRef] : undefined;
  try {
    return await probeModelDeployment(resolved, secret);
  } catch (error) {
    throw new Error(`Cannot enable deployment because the authenticated identity probe failed: ${error instanceof Error ? error.message : error}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
