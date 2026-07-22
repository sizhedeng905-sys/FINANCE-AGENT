import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  applyRotationCommand,
  assertSecretInventoryGate,
  buildSecretInventory,
  collectSecretFileMetadata,
  createRotationSession,
  SecretLifecycleError,
  validateSecretPolicy,
} from './secret-lifecycle.mjs';

const policy = JSON.parse(await readFile(new URL('../secret-policy.json', import.meta.url), 'utf8'));
const compose = composeFixture(policy);
const now = new Date('2026-07-22T00:00:00.000Z');

test('validates the complete value-free policy against Compose bindings', () => {
  const validated = validateSecretPolicy(policy, compose);
  assert.equal(validated.secrets.size, 20);
  assert.equal(validated.rotationSets.size, 13);
  assert.match(validated.policySha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(policy).includes('secret-value'), false);
});

test('builds a stable fresh inventory without paths, values, sizes, or mtimes', () => {
  const inventory = buildSecretInventory({
    policy,
    compose,
    fileMetadata: freshMetadata(policy),
    profile: 'local_demo',
    now,
    platform: 'linux',
  });
  assert.equal(inventory.status, 'passed');
  assert.deepEqual(inventory.counts, { fresh: 20, due_soon: 0, stale: 0, missing: 0, invalid: 0 });
  assert.match(inventory.inventorySha256, /^[a-f0-9]{64}$/);
  const serialized = JSON.stringify(inventory);
  for (const forbidden of ['C:\\', '/private/', 'mtimeMs', 'size', 'mode', 'secret-value']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('classifies due, stale, missing, future, symlink, mode, and hard-link boundaries', () => {
  const name = 'jwt_secret';
  const cases = [
    [{ mtimeMs: now.getTime() - 77 * 86_400_000 }, 'due_soon', 'warning'],
    [{ mtimeMs: now.getTime() - 91 * 86_400_000 }, 'stale', 'failed'],
    [{ exists: false }, 'missing', 'failed'],
    [{ mtimeMs: now.getTime() + 301_000 }, 'invalid', 'failed'],
    [{ kind: 'symlink' }, 'invalid', 'failed'],
    [{ mode: 0o100640 }, 'invalid', 'failed'],
    [{ nlink: 2 }, 'invalid', 'failed'],
    [{ size: 7 }, 'invalid', 'failed'],
    [{ size: 65_537 }, 'invalid', 'failed'],
  ];
  for (const [override, expectedFreshness, expectedStatus] of cases) {
    const metadata = freshMetadata(policy);
    metadata.set(name, { ...metadata.get(name), ...override });
    const inventory = buildSecretInventory({ policy, compose, fileMetadata: metadata, profile: 'local_demo', now, platform: 'linux' });
    assert.equal(inventory.entries.find((entry) => entry.name === name).freshnessStatus, expectedFreshness);
    assert.equal(inventory.status, expectedStatus);
  }

  const targetMetadata = freshMetadata(policy);
  targetMetadata.set(name, { exists: false });
  const target = buildSecretInventory({ policy, compose, fileMetadata: targetMetadata, profile: 'target', now, platform: 'linux' });
  assert.equal(target.status, 'blocked_external');
  assert.throws(() => assertSecretInventoryGate(target), hasCode('SECRET_INVENTORY_EXTERNAL_INPUT_REQUIRED', 'blocked_external'));
});

test('treats Unix permission metadata as non-applicable on Windows only', () => {
  const metadata = freshMetadata(policy);
  metadata.set('jwt_secret', { ...metadata.get('jwt_secret'), mode: 0o100666, nlink: 3 });
  const inventory = buildSecretInventory({ policy, compose, fileMetadata: metadata, profile: 'local_demo', now, platform: 'win32' });
  assert.equal(inventory.status, 'passed');
});

test('collects only lstat metadata and treats inspection failures as missing', async () => {
  const calls = [];
  const metadata = await collectSecretFileMetadata('/fixed-secret-root', ['alpha_secret', 'beta_secret'], async (path) => {
    calls.push(path);
    if (path.endsWith('beta_secret')) throw new Error('synthetic path detail');
    return {
      isSymbolicLink: () => false,
      isFile: () => true,
      size: 32,
      mtimeMs: now.getTime(),
      mode: 0o100600,
      nlink: 1,
    };
  });
  assert.equal(calls.length, 2);
  assert.equal(metadata.get('alpha_secret').kind, 'file');
  assert.deepEqual(metadata.get('beta_secret'), { exists: false });
  assert.equal(Object.values(metadata.get('alpha_secret')).includes('secret-value'), false);
});

test('rejects policy drift, unknown properties, duplicate membership, and consumer drift', () => {
  const mutations = [
    (candidate) => { candidate.unexpected = true; },
    (candidate) => { candidate.secrets.push({ ...candidate.secrets[0] }); },
    (candidate) => { candidate.rotationSets[0].members.push('jwt_secret'); },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(policy);
    mutate(candidate);
    assert.throws(() => validateSecretPolicy(candidate, compose), (error) => error instanceof SecretLifecycleError);
  }
  const changedCompose = structuredClone(compose);
  changedCompose.services.worker.secrets = changedCompose.services.worker.secrets.filter((binding) => binding.source !== 'jwt_secret');
  assert.throws(() => validateSecretPolicy(policy, changedCompose), hasCode('SECRET_POLICY_CONSUMER_MISMATCH'));
});

test('executes the synthetic rotation state machine in order and replays idempotently', () => {
  let session = createRotationSession({ policy, rotationSetId: 'postgres-runtime', generationId: 'synthetic-generation-002', now });
  const commands = ['precheck', 'stage', 'activate_provider', 'reload_consumers', 'verify', 'revoke_old', 'complete'];
  for (const command of commands) {
    session = applyRotationCommand(session, {
      command,
      expectedVersion: session.version,
      idempotencyKey: `rotation-${command}-0001`,
      now,
    });
  }
  assert.equal(session.state, 'COMPLETED');
  assert.equal(session.version, 7);
  const replayed = applyRotationCommand(session, {
    command: 'precheck',
    expectedVersion: 0,
    idempotencyKey: 'rotation-precheck-0001',
    now,
  });
  assert.strictEqual(replayed, session);
  assert.equal(JSON.stringify(session).includes('synthetic-generation-002'), false);
});

test('enforces optimistic versioning, command order, and idempotency payload identity', () => {
  const session = createRotationSession({ policy, rotationSetId: 'jwt-signing', generationId: 'synthetic-generation-003', now });
  assert.throws(
    () => applyRotationCommand(session, { command: 'stage', expectedVersion: 0, idempotencyKey: 'rotation-stage-0001', now }),
    hasCode('SECRET_ROTATION_TRANSITION_INVALID'),
  );
  const prechecked = applyRotationCommand(session, {
    command: 'precheck', expectedVersion: 0, idempotencyKey: 'rotation-precheck-0002', now,
  });
  assert.throws(
    () => applyRotationCommand(prechecked, { command: 'stage', expectedVersion: 0, idempotencyKey: 'rotation-stage-0002', now }),
    hasCode('SECRET_ROTATION_VERSION_CONFLICT'),
  );
  assert.throws(
    () => applyRotationCommand(prechecked, { command: 'stage', expectedVersion: 0, idempotencyKey: 'rotation-precheck-0002', now }),
    hasCode('SECRET_ROTATION_IDEMPOTENCY_CONFLICT'),
  );
});

test('allows rollback only before revocation and requires forward fix after revocation', () => {
  let rollback = createRotationSession({ policy, rotationSetId: 'redis-runtime', generationId: 'synthetic-generation-004', now });
  for (const command of ['precheck', 'stage', 'activate_provider']) {
    rollback = applyRotationCommand(rollback, {
      command, expectedVersion: rollback.version, idempotencyKey: `rollback-${command}-0001`, now,
    });
  }
  rollback = applyRotationCommand(rollback, {
    command: 'fail', expectedVersion: rollback.version, idempotencyKey: 'rollback-fail-0001', reasonCode: 'HEALTHCHECK_FAILED', now,
  });
  rollback = applyRotationCommand(rollback, {
    command: 'rollback', expectedVersion: rollback.version, idempotencyKey: 'rollback-apply-0001', now,
  });
  assert.equal(rollback.state, 'ROLLED_BACK');

  let forward = createRotationSession({ policy, rotationSetId: 's3-runtime', generationId: 'synthetic-generation-005', now });
  for (const command of ['precheck', 'stage', 'activate_provider', 'reload_consumers', 'verify', 'revoke_old']) {
    forward = applyRotationCommand(forward, {
      command, expectedVersion: forward.version, idempotencyKey: `forward-${command}-0001`, now,
    });
  }
  forward = applyRotationCommand(forward, {
    command: 'fail', expectedVersion: forward.version, idempotencyKey: 'forward-fail-0001', reasonCode: 'VERIFICATION_FAILED', now,
  });
  assert.equal(forward.state, 'FORWARD_FIX_REQUIRED');
  assert.throws(
    () => applyRotationCommand(forward, { command: 'rollback', expectedVersion: forward.version, idempotencyKey: 'forward-rollback-0001', now }),
    hasCode('SECRET_ROTATION_TRANSITION_INVALID'),
  );
  forward = applyRotationCommand(forward, {
    command: 'forward_fix', expectedVersion: forward.version, idempotencyKey: 'forward-apply-0001', now,
  });
  forward = applyRotationCommand(forward, {
    command: 'verify', expectedVersion: forward.version, idempotencyKey: 'forward-verify-fix-0001', now,
  });
  assert.equal(forward.state, 'COMPLETED');
});

function composeFixture(secretPolicy) {
  const services = {};
  const secrets = {};
  for (const secret of secretPolicy.secrets) {
    secrets[secret.name] = { file: `/fixture/.secrets/${secret.name}` };
    for (const consumer of secret.consumers) {
      services[consumer] ??= { secrets: [] };
      services[consumer].secrets.push({ source: secret.name, target: secret.name });
    }
  }
  return { services, secrets };
}

function freshMetadata(secretPolicy) {
  return new Map(secretPolicy.secrets.map((secret) => [secret.name, {
    exists: true,
    kind: 'file',
    size: 64,
    mtimeMs: now.getTime() - 10 * 86_400_000,
    mode: 0o100600,
    nlink: 1,
  }]));
}

function hasCode(code, status = 'failed') {
  return (error) => error instanceof SecretLifecycleError && error.code === code && error.status === status;
}
