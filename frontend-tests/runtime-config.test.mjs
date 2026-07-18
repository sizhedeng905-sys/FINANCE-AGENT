import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/config/runtime-config.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'runtime-config.ts',
}).outputText;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const validEnvironment = {
  VITE_APP_DATA_MODE: 'api',
  VITE_API_BASE_URL: '/api',
  VITE_API_TIMEOUT_MS: '15000',
};

test('accepts and normalizes explicit API runtime configuration', () => {
  assert.deepEqual(runtime.readRuntimeConfig(validEnvironment), {
    dataMode: 'api',
    apiBaseUrl: '/api',
    apiTimeoutMs: 15000,
  });
  assert.equal(runtime.readRuntimeConfig({ ...validEnvironment, VITE_API_BASE_URL: '/api/' }).apiBaseUrl, '/api');
  assert.equal(
    runtime.readRuntimeConfig({ ...validEnvironment, VITE_API_BASE_URL: 'https://finance.example/base/' }).apiBaseUrl,
    'https://finance.example/base',
  );
});

test('requires an explicit data mode and API base URL', () => {
  assert.throws(() => runtime.readRuntimeConfig({ ...validEnvironment, VITE_APP_DATA_MODE: '' }), /VITE_APP_DATA_MODE/);
  assert.throws(() => runtime.readRuntimeConfig({ ...validEnvironment, VITE_APP_DATA_MODE: undefined }), /VITE_APP_DATA_MODE/);
  assert.throws(() => runtime.readRuntimeConfig({ ...validEnvironment, VITE_API_BASE_URL: '' }), /VITE_API_BASE_URL/);
  assert.throws(() => runtime.readRuntimeConfig({ ...validEnvironment, VITE_API_BASE_URL: undefined }), /VITE_API_BASE_URL/);
  assert.throws(() => runtime.readRuntimeConfig({ ...validEnvironment, VITE_APP_DATA_MODE: 'automatic' }), /VITE_APP_DATA_MODE/);
});

test('rejects ambiguous or unsafe API base URLs', () => {
  for (const value of [
    '//evil.example/api',
    String.raw`\api`,
    String.raw`https:\\evil.example\api`,
    'javascript:alert(1)',
    'data:text/plain,api',
    'file:///tmp/api',
    '/api\nnext',
    '/api?token=secret',
    '/api#fragment',
  ]) {
    assert.throws(
      () => runtime.readRuntimeConfig({ ...validEnvironment, VITE_API_BASE_URL: value }),
      /VITE_API_BASE_URL/,
      value,
    );
  }
});

test('joins API paths without changing origin or path boundaries', () => {
  assert.equal(runtime.buildApiUrl('/api', '/records?page=2&pageSize=20'), '/api/records?page=2&pageSize=20');
  assert.equal(runtime.buildApiUrl('/', '/api/health'), '/api/health');
  assert.equal(runtime.buildApiUrl('https://finance.example/base/', '/records'), 'https://finance.example/base/records');
  for (const path of ['records', '//evil.example/records', String.raw`/records\next`, '/records#fragment', '/records//next']) {
    assert.throws(() => runtime.buildApiUrl('/api', path), /API 请求路径/, path);
  }
});
