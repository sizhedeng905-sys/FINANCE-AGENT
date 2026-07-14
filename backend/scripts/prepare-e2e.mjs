import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const backendRoot = resolve(import.meta.dirname, '..');
const envFile = resolve(backendRoot, process.env.TEST_ENV_FILE || '.env.test');

if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for E2E tests.');
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
if (!databaseName.endsWith('_test')) {
  throw new Error(`E2E preparation refuses to use non-test database "${databaseName}".`);
}

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
  SEED_ALLOW_NONSTANDARD_DATABASE: 'false',
  SEED_DEMO_CONFIRMATION: `reset-demo-users:${databaseName}`,
  UPLOAD_DIR: process.env.E2E_UPLOAD_DIR || 'test-uploads/e2e'
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    env,
    stdio: 'inherit',
    shell: false
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [resolve(backendRoot, 'node_modules/prisma/build/index.js'), 'generate']);
run(process.execPath, [resolve(backendRoot, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy']);
run(process.execPath, [resolve(backendRoot, 'scripts/cleanup-e2e.mjs')]);
run(process.execPath, [resolve(backendRoot, 'node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts']);
run(process.execPath, [resolve(backendRoot, 'scripts/generate-e2e-excel.mjs')]);

console.log(`E2E database "${databaseName}" is migrated, cleaned, and seeded.`);
