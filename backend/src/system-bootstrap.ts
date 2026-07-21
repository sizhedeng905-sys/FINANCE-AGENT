import 'reflect-metadata';

import { PrismaClient } from '@prisma/client';
import { loadEnvFile } from 'node:process';

import { bootstrapSystemRegistry } from './model-runtime/system-registry-bootstrap';
import { resolveSystemRegistryConfiguration } from './model-runtime/system-registry-manifest';

loadOptionalEnvironment();
assertDatabaseUrl();

const prisma = new PrismaClient();

void main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'System registry bootstrap failed'}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

async function main() {
  const configuration = resolveSystemRegistryConfiguration(process.env);
  const result = await bootstrapSystemRegistry(prisma, configuration.manifest);
  process.stdout.write(`${JSON.stringify({ status: result.changed ? 'changed' : 'unchanged', ...result })}\n`);
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
