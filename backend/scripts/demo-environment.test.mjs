import assert from 'node:assert/strict';
import test from 'node:test';

import {
  amountToCents,
  buildDemoEnvironment,
  buildDemoWebEnvironment,
  DEMO_API_URL,
  DEMO_DATABASE_NAME,
  inspectDemoDatabase,
  mergeDemoEnvironmentSources
} from './demo-environment.mjs';

const validSource = {
  NODE_ENV: 'test',
  TEST_DATABASE_URL: `postgresql://demo:secret@127.0.0.1:5432/${DEMO_DATABASE_NAME}?schema=public`,
  JWT_SECRET: 'test-only-secret-with-at-least-32-characters',
  AI_API_KEY: 'must-be-removed',
  OPENAI_API_KEY: 'must-be-removed',
  OCR_API_KEY: 'must-be-removed',
  REDIS_URL: 'redis://remote.example:6379',
  S3_ACCESS_KEY_ID: 'must-be-removed',
  S3_SECRET_ACCESS_KEY: 'must-be-removed'
};

test('allows only the explicit loopback demo PostgreSQL database', () => {
  assert.deepEqual(inspectDemoDatabase(validSource.TEST_DATABASE_URL, 'test'), {
    databaseName: DEMO_DATABASE_NAME,
    host: 'loopback',
    port: '5432'
  });
  assert.equal(
    inspectDemoDatabase(`postgres://demo:secret@localhost:55432/${DEMO_DATABASE_NAME}`, 'development').port,
    '55432'
  );
});

test('fails closed before touching production, remote, or unexpected databases', () => {
  assert.throws(() => inspectDemoDatabase(validSource.TEST_DATABASE_URL, 'production'), /NODE_ENV=production/);
  assert.throws(() => inspectDemoDatabase('', 'test'), /TEST_DATABASE_URL/);
  assert.throws(
    () => inspectDemoDatabase(`postgresql://demo:secret@db.example/${DEMO_DATABASE_NAME}`, 'test'),
    /loopback/
  );
  assert.throws(
    () => inspectDemoDatabase('postgresql://demo:secret@127.0.0.1/finance_agent', 'test'),
    new RegExp(DEMO_DATABASE_NAME)
  );
  assert.throws(
    () => inspectDemoDatabase(`mysql://demo:secret@127.0.0.1/${DEMO_DATABASE_NAME}`, 'test'),
    /PostgreSQL/
  );
});

test('pins local stores and mock providers while removing external credentials', () => {
  const { database, environment } = buildDemoEnvironment(validSource);
  assert.equal(database.databaseName, DEMO_DATABASE_NAME);
  assert.equal(environment.DATABASE_URL, validSource.TEST_DATABASE_URL);
  assert.equal(environment.NODE_ENV, 'test');
  assert.equal(environment.AI_PROVIDER, 'mock');
  assert.equal(environment.AI_BASE_URL, 'http://127.0.0.1:11434/v1');
  assert.equal(environment.OCR_PROVIDER, 'mock');
  assert.equal(environment.OCR_BASE_URL, 'http://127.0.0.1:8868');
  assert.equal(environment.AI_EXTERNAL_PROVIDER_MODE, 'disabled');
  assert.equal(environment.REDIS_URL, '');
  assert.equal(environment.FILE_STORAGE_DRIVER, 'local');
  for (const key of ['AI_API_KEY', 'OPENAI_API_KEY', 'OCR_API_KEY', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
    assert.equal(environment[key], '', key);
  }
});

test('lets the dedicated test file override stale shell credentials', () => {
  const merged = mergeDemoEnvironmentSources(
    {
      NODE_ENV: 'development',
      TEST_DATABASE_URL: 'postgresql://prod:secret@db.example/finance_agent',
      JWT_SECRET: 'stale-production-secret'
    },
    validSource
  );
  assert.equal(merged.TEST_DATABASE_URL, validSource.TEST_DATABASE_URL);
  assert.equal(merged.JWT_SECRET, validSource.JWT_SECRET);
  assert.equal(merged.NODE_ENV, 'test');
  assert.throws(() => mergeDemoEnvironmentSources({ NODE_ENV: 'production' }, validSource), /NODE_ENV=production/);
});

test('publishes only the fixed API-mode Vite configuration', () => {
  const environment = buildDemoWebEnvironment({
    PATH: 'preserve-me',
    DATABASE_URL: validSource.TEST_DATABASE_URL,
    JWT_SECRET: validSource.JWT_SECRET,
    GITHUB_TOKEN: 'remove-me',
    VITE_APP_DATA_MODE: 'mock',
    VITE_API_BASE_URL: 'https://unexpected.example/api',
    VITE_SECRET: 'remove-me'
  });
  assert.equal(environment.PATH, 'preserve-me');
  assert.equal(environment.VITE_APP_DATA_MODE, 'api');
  assert.equal(environment.VITE_API_BASE_URL, `${DEMO_API_URL}/api`);
  assert.equal(environment.VITE_SECRET, undefined);
  assert.equal(environment.DATABASE_URL, undefined);
  assert.equal(environment.JWT_SECRET, undefined);
  assert.equal(environment.GITHUB_TOKEN, undefined);
});

test('validates exact two-decimal fixture values without floating-point totals', () => {
  assert.equal(amountToCents(1250.25), 125025n);
  assert.equal(amountToCents({ formula: 'SUM(8000,765.43)', result: 8765.43 }), 876543n);
  assert.throws(() => amountToCents(1250.2), /exactly two decimals/);
  assert.throws(() => amountToCents('1e3'), /exactly two decimals/);
});
