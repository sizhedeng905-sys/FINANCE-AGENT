import { ModelDeploymentStatus, PrismaClient } from '@prisma/client';
import { loadEnvFile } from 'node:process';

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
      console.log(`${deployment.deploymentKey}\t${deployment.isEnabled ? 'enabled' : 'disabled'}\t${deployment.provider}\t${deployment.modelName}`);
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

async function checkDeployment(deployment: {
  provider: string;
  endpoint: string | null;
  secretRef: string | null;
  timeoutMs: number;
}) {
  if (deployment.provider === 'mock') return { latencyMs: 0 };
  if (!deployment.endpoint) throw new Error('Cannot enable a deployment without an endpoint.');
  const secret = deployment.secretRef ? process.env[deployment.secretRef] : undefined;
  if (deployment.secretRef && !secret) {
    throw new Error(`Cannot enable deployment: environment variable ${deployment.secretRef} is missing.`);
  }
  const url = deployment.provider === 'local_paddle'
    ? `${deployment.endpoint.replace(/\/+$/, '')}/health`
    : `${deployment.endpoint.replace(/\/+$/, '')}/models`;
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
      signal: AbortSignal.timeout(Math.min(deployment.timeoutMs, 10000))
    });
  } catch (error) {
    throw new Error(`Cannot enable deployment because health check failed: ${error instanceof Error ? error.message : error}`);
  }
  if (!response.ok) throw new Error(`Cannot enable deployment because health check returned HTTP ${response.status}.`);
  return { latencyMs: Date.now() - startedAt };
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
