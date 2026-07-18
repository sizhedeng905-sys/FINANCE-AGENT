import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeLogEvidence } from './runtime-log-policy.mjs';

test('accepts structured logs without query strings or credential values', () => {
  const logs = [
    '{"method":"GET","path":"/api/health","status":200,"requestId":"req-1"}',
    '{"level":"info","message":"request complete","traceId":"abc123"}',
  ].join('\n');
  const evidence = createRuntimeLogEvidence(logs, ['not-present-secret-value']);
  assert.equal(evidence.status, 'passed');
  assert.deepEqual(evidence.findingCategories, []);
});

test('rejects exact secrets without copying them into evidence', () => {
  const secret = 'synthetic-secret-value-1234567890';
  const evidence = createRuntimeLogEvidence(`startup value=${secret}`, [secret]);
  assert.equal(evidence.status, 'failed');
  assert.ok(evidence.findingCategories.includes('exact_secret_value'));
  assert.equal(JSON.stringify(evidence).includes(secret), false);
});

test('rejects bearer, JWT, credential URL, signed query, and cookie leakage', () => {
  const attackLogs = [
    'Authorization: Bearer synthetic-token-value-1234567890',
    'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456',
    'postgresql://runtime:password-value@postgres:5432/finance',
    '/file?X-Amz-Signature=1234567890abcdef&x=1',
    'Set-Cookie: finance_refresh=1234567890abcdef; HttpOnly',
  ].join('\n');
  const evidence = createRuntimeLogEvidence(attackLogs);
  assert.equal(evidence.status, 'failed');
  for (const category of [
    'bearer_token',
    'jwt',
    'credential_url',
    'sensitive_query',
    'cookie_header',
  ]) {
    assert.ok(evidence.findingCategories.includes(category), category);
  }
});
