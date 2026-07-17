import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { spawnSync } from 'node:child_process';

const backendRoot = resolve(import.meta.dirname, '..');
const envFile = resolve(backendRoot, process.env.TEST_ENV_FILE || '.env.test');

if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for integration tests.');
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
if (!databaseName.endsWith('_test')) {
  throw new Error(`Integration tests refuse to use non-test database "${databaseName}".`);
}

const testUploadRoot = resolve(backendRoot, 'test-uploads');
const uploadRoot = resolve(backendRoot, process.env.INTEGRATION_UPLOAD_DIR || 'test-uploads/integration');
const uploadRootRelative = relative(testUploadRoot, uploadRoot);
if (!uploadRootRelative || uploadRootRelative.startsWith('..') || isAbsolute(uploadRootRelative)) {
  throw new Error('Integration upload root must be a dedicated child of backend/test-uploads.');
}

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  UPLOAD_DIR: uploadRoot,
  SEED_ALLOW_NONSTANDARD_DATABASE: 'false',
  SEED_DEMO_CONFIRMATION: `reset-demo-users:${databaseName}`,
  CORS_ORIGINS: process.env.CORS_ORIGINS || 'http://127.0.0.1:4173,http://127.0.0.1:4174',
  REQUEST_RATE_LIMIT_MAX: process.env.REQUEST_RATE_LIMIT_MAX || '5000'
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    env,
    stdio: 'inherit',
    shell: false
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, [resolve(backendRoot, 'node_modules/prisma/build/index.js'), 'generate']);
run(process.execPath, [resolve(backendRoot, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy']);
run(process.execPath, [resolve(backendRoot, 'node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts']);
run(process.execPath, [
  resolve(backendRoot, 'node_modules/jest/bin/jest.js'),
  '--config',
  'test/jest.integration.json',
  '--runInBand',
  ...process.argv.slice(2)
]);
