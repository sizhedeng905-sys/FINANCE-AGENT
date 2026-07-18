import assert from 'node:assert/strict';
import test from 'node:test';

import { synchronizeManagedEnvironment } from './managed-environment.mjs';

const template = [
  'BACKEND_IMAGE=finance-agent/backend:current',
  'POSTGRES_IMAGE=finance-agent/staging-postgres:current',
  'NODE_IMAGE=node:24@sha256:current',
  'STAGING_WEB_PORT=8443',
  '',
].join('\n');
const managed = ['BACKEND_IMAGE', 'POSTGRES_IMAGE', 'NODE_IMAGE'];

test('updates repository-managed defaults while preserving operator settings and unknown keys', () => {
  const existing = [
    '# local operator settings',
    'BACKEND_IMAGE=finance-agent/backend:old',
    'POSTGRES_IMAGE=postgres:17',
    'STAGING_WEB_PORT=10443',
    'OPERATOR_NOTE=keep-me',
    '',
  ].join('\n');

  const result = synchronizeManagedEnvironment(existing, template, managed);

  assert.match(result.content, /BACKEND_IMAGE=finance-agent\/backend:current/);
  assert.match(result.content, /POSTGRES_IMAGE=finance-agent\/staging-postgres:current/);
  assert.match(result.content, /NODE_IMAGE=node:24@sha256:current/);
  assert.match(result.content, /STAGING_WEB_PORT=10443/);
  assert.match(result.content, /OPERATOR_NOTE=keep-me/);
  assert.deepEqual(result.updatedKeys, managed.slice().sort());
});

test('is idempotent after managed defaults are synchronized', () => {
  const first = synchronizeManagedEnvironment('BACKEND_IMAGE=old\nPOSTGRES_IMAGE=old\n', template, managed);
  const second = synchronizeManagedEnvironment(first.content, template, managed);

  assert.equal(second.content, first.content);
  assert.deepEqual(second.updatedKeys, []);
});

test('rejects duplicate keys and incomplete managed templates', () => {
  assert.throws(
    () => synchronizeManagedEnvironment('BACKEND_IMAGE=one\nBACKEND_IMAGE=two\n', template, managed),
    /Duplicate existing environment key/,
  );
  assert.throws(
    () => synchronizeManagedEnvironment('BACKEND_IMAGE=one\n', 'BACKEND_IMAGE=current\n', managed),
    /Managed environment key is missing from the template: POSTGRES_IMAGE/,
  );
});
