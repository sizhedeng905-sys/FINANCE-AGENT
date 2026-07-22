import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

const root = resolve(import.meta.dirname);
const backendRoot = resolve(root, 'backend');
const testEnv = resolve(backendRoot, process.env.TEST_ENV_FILE || '.env.test');
const modelEnv = resolve(root, 'deploy/model-services/.env');
if (existsSync(testEnv)) loadEnvFile(testEnv);
if (existsSync(modelEnv)) loadEnvFile(modelEnv);

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required.');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
if (!databaseName.endsWith('_test')) {
  throw new Error(`Real OCR E2E refuses to use non-test database "${databaseName}".`);
}
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required.');
const ocrApiKey = process.env.OCR_API_KEY || process.env.LOCAL_MODEL_API_KEY;
if (!ocrApiKey) throw new Error('OCR_API_KEY or LOCAL_MODEL_API_KEY is required.');

const apiUrl = 'http://127.0.0.1:3102';
const frontendUrl = 'http://127.0.0.1:4175';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'ocr-real-provider.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 900_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: frontendUrl,
    ...devices['Desktop Chrome'],
    ...(process.env.CI ? {} : { channel: 'msedge' }),
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: [
    {
      command: 'npm run start:e2e --prefix backend',
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL: databaseUrl,
        JWT_SECRET: jwtSecret,
        PORT: '3102',
        CORS_ORIGINS: frontendUrl,
        REQUEST_RATE_LIMIT_MAX: '5000',
        UPLOAD_DIR: process.env.E2E_UPLOAD_DIR || 'test-uploads/e2e',
        OCR_PROVIDER: 'local_paddle',
        OCR_BASE_URL: process.env.OCR_BASE_URL || 'http://127.0.0.1:8868',
        OCR_API_KEY: ocrApiKey,
        OCR_MODEL: process.env.OCR_MODEL || 'PaddlePaddle/PaddleOCR-VL',
        OCR_MODEL_VERSION: process.env.OCR_MODEL_VERSION || 'local',
        OCR_TIMEOUT_MS: process.env.OCR_TIMEOUT_MS || '300000',
        OCR_MAX_CONCURRENCY: '1'
      },
      url: `${apiUrl}/api/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',
      cwd: root,
      env: {
        ...process.env,
        VITE_APP_DATA_MODE: 'api',
        VITE_API_BASE_URL: `${apiUrl}/api`,
        VITE_API_TIMEOUT_MS: '15000'
      },
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
