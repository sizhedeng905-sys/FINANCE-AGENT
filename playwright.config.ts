import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const root = resolve(import.meta.dirname);
const backendRoot = resolve(root, 'backend');
const envFile = resolve(backendRoot, process.env.TEST_ENV_FILE || '.env.test');

if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL or DATABASE_URL is required for Playwright E2E tests.');
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
if (!databaseName.endsWith('_test')) {
  throw new Error(`Playwright refuses to use non-test database "${databaseName}".`);
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET is required for Playwright E2E tests.');
}

const apiUrl = 'http://127.0.0.1:3101';
const apiFrontendUrl = 'http://127.0.0.1:4173';
const mockFrontendUrl = 'http://127.0.0.1:4174';
const serverEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
  JWT_SECRET: jwtSecret,
  PORT: '3101',
  SEED_ALLOW_NONSTANDARD_DATABASE: 'false',
  CORS_ORIGINS: process.env.CORS_ORIGINS || `${apiFrontendUrl},${mockFrontendUrl}`,
  REQUEST_RATE_LIMIT_MAX: process.env.REQUEST_RATE_LIMIT_MAX || '5000',
  UPLOAD_DIR: process.env.E2E_UPLOAD_DIR || 'test-uploads/e2e',
  MAX_FILE_SIZE_MB: process.env.MAX_FILE_SIZE_MB || '5',
  AI_PROVIDER: 'mock',
  AI_MODEL: 'mock-structured-v1',
  AI_TIMEOUT_MS: '5000'
};

export default defineConfig({
  testDir: './e2e',
  testIgnore: 'ocr-real-provider.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: apiFrontendUrl,
    ...devices['Desktop Chrome'],
    ...(process.env.CI ? {} : { channel: 'msedge' }),
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: [
    {
      command: 'npm run start:e2e --prefix backend',
      cwd: root,
      env: serverEnvironment,
      url: `${apiUrl}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
      cwd: root,
      env: {
        ...process.env,
        VITE_APP_DATA_MODE: 'api',
        VITE_API_BASE_URL: `${apiUrl}/api`,
        VITE_API_TIMEOUT_MS: '15000'
      },
      url: apiFrontendUrl,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
      cwd: root,
      env: {
        ...process.env,
        VITE_APP_DATA_MODE: 'mock',
        VITE_API_BASE_URL: `${apiUrl}/api`,
        VITE_API_TIMEOUT_MS: '15000'
      },
      url: mockFrontendUrl,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
