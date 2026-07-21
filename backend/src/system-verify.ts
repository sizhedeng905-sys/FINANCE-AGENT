import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';
import { loadEnvFile } from 'node:process';

import { verifySystemRegistry } from './model-runtime/system-registry-bootstrap';
import { resolveSystemRegistryConfiguration } from './model-runtime/system-registry-manifest';
import { runSystemRegistryMockSmoke } from './model-runtime/system-registry-smoke';

loadOptionalEnvironment();
assertDatabaseUrl();

const prisma = new PrismaClient();

void main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'System registry verification failed'}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

async function main() {
  const configuration = resolveSystemRegistryConfiguration(process.env);
  const result = await verifySystemRegistry(prisma, configuration.manifest);
  const mockSmoke = process.argv.includes('--mock-smoke')
    ? await runSystemRegistryMockSmoke(prisma)
    : undefined;
  process.stdout.write(`${JSON.stringify({ status: 'verified', ...result, mockSmoke })}\n`);
}

function assertDatabaseUrl() {
  if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
  }
}

function loadOptionalEnvironment() {
  try {
    loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
