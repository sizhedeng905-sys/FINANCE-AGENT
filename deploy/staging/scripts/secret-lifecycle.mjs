import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

export const SECRET_POLICY_SCHEMA = 'staging-secret-policy/1.0';
export const SECRET_INVENTORY_SCHEMA = 'staging-secret-inventory/1.0';
export const SECRET_ROTATION_SCHEMA = 'staging-secret-rotation/1.0';

const allowedCategories = new Set([
  'alert_endpoint_credential',
  'application_signing',
  'cache_credential',
  'database_credential',
  'derived_connection',
  'monitoring_credential',
  'object_admin_credential',
  'object_runtime_credential',
  'synthetic_demo_credential',
]);
const allowedModes = new Set([
  'coordinated_provider_and_consumers',
  'local_synthetic_only',
  'restart_consumers',
  'session_invalidating_restart',
]);
const allowedReasonCodes = new Set([
  'CONSUMER_RELOAD_FAILED',
  'HEALTHCHECK_FAILED',
  'OPERATOR_ABORTED',
  'PROVIDER_UPDATE_FAILED',
  'VERIFICATION_FAILED',
]);
const transitionTable = Object.freeze({
  PLANNED: { precheck: 'PRECHECKED', cancel: 'CANCELLED' },
  PRECHECKED: { stage: 'NEW_VERSION_STAGED', cancel: 'CANCELLED', fail: 'ROLLBACK_REQUIRED' },
  NEW_VERSION_STAGED: { activate_provider: 'PROVIDER_UPDATED', fail: 'ROLLBACK_REQUIRED' },
  PROVIDER_UPDATED: { reload_consumers: 'CONSUMERS_RELOADED', fail: 'ROLLBACK_REQUIRED' },
  CONSUMERS_RELOADED: { verify: 'VERIFIED', fail: 'ROLLBACK_REQUIRED' },
  VERIFIED: { revoke_old: 'OLD_VERSION_REVOKED', fail: 'ROLLBACK_REQUIRED' },
  ROLLBACK_REQUIRED: { rollback: 'ROLLED_BACK' },
  OLD_VERSION_REVOKED: { complete: 'COMPLETED', fail: 'FORWARD_FIX_REQUIRED' },
  FORWARD_FIX_REQUIRED: { forward_fix: 'FORWARD_FIX_APPLIED' },
  FORWARD_FIX_APPLIED: { verify: 'COMPLETED', fail: 'FORWARD_FIX_REQUIRED' },
});

export class SecretLifecycleError extends Error {
  constructor(code, status = 'failed') {
    super(code);
    this.name = 'SecretLifecycleError';
    this.code = code;
    this.status = status;
  }
}

export function validateSecretPolicy(policy, compose) {
  assertExactKeys(policy, ['freshness', 'policyStatus', 'rotationSets', 'schemaVersion', 'secrets']);
  if (policy.schemaVersion !== SECRET_POLICY_SCHEMA) fail('SECRET_POLICY_SCHEMA_INVALID');
  if (policy.policyStatus !== 'engineering_default_pending_h14') fail('SECRET_POLICY_STATUS_INVALID');
  validateFreshness(policy.freshness);
  if (!Array.isArray(policy.secrets) || policy.secrets.length === 0) fail('SECRET_POLICY_SECRETS_REQUIRED');
  if (!Array.isArray(policy.rotationSets) || policy.rotationSets.length === 0) fail('SECRET_POLICY_ROTATION_SETS_REQUIRED');

  const secrets = new Map();
  for (const secret of policy.secrets) {
    assertExactKeys(
      secret,
      ['category', 'consumers', 'maxAgeDays', 'name', 'rotationSet', 'warningDays'],
      ['category', 'consumers', 'name', 'rotationSet'],
    );
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(String(secret.name ?? ''))) fail('SECRET_POLICY_NAME_INVALID');
    if (secrets.has(secret.name)) fail('SECRET_POLICY_NAME_DUPLICATE');
    if (!allowedCategories.has(secret.category)) fail('SECRET_POLICY_CATEGORY_INVALID');
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(String(secret.rotationSet ?? ''))) fail('SECRET_POLICY_ROTATION_SET_INVALID');
    const consumers = sortedUniqueStrings(secret.consumers, 'SECRET_POLICY_CONSUMERS_INVALID');
    const maxAgeDays = secret.maxAgeDays ?? policy.freshness.maxAgeDays;
    const warningDays = secret.warningDays ?? policy.freshness.warningDays;
    validateAge(maxAgeDays, warningDays);
    secrets.set(secret.name, Object.freeze({ ...secret, consumers, maxAgeDays, warningDays }));
  }

  const rotationSets = new Map();
  const memberships = new Map();
  for (const rotationSet of policy.rotationSets) {
    assertExactKeys(rotationSet, ['consumerOrder', 'id', 'impactCode', 'members', 'mode']);
    if (!/^[a-z][a-z0-9-]{2,63}$/.test(String(rotationSet.id ?? ''))) fail('SECRET_ROTATION_SET_ID_INVALID');
    if (rotationSets.has(rotationSet.id)) fail('SECRET_ROTATION_SET_ID_DUPLICATE');
    if (!allowedModes.has(rotationSet.mode)) fail('SECRET_ROTATION_MODE_INVALID');
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(String(rotationSet.impactCode ?? ''))) fail('SECRET_ROTATION_IMPACT_CODE_INVALID');
    const members = sortedUniqueStrings(rotationSet.members, 'SECRET_ROTATION_MEMBERS_INVALID');
    const consumerOrder = uniqueStringsInOrder(rotationSet.consumerOrder, 'SECRET_ROTATION_CONSUMER_ORDER_INVALID');
    const expectedConsumers = new Set();
    for (const member of members) {
      const secret = secrets.get(member);
      if (!secret || secret.rotationSet !== rotationSet.id || memberships.has(member)) {
        fail('SECRET_ROTATION_MEMBERSHIP_INVALID');
      }
      memberships.set(member, rotationSet.id);
      secret.consumers.forEach((consumer) => expectedConsumers.add(consumer));
    }
    if (!sameStringSet(consumerOrder, [...expectedConsumers])) fail('SECRET_ROTATION_CONSUMER_ORDER_INCOMPLETE');
    rotationSets.set(rotationSet.id, Object.freeze({ ...rotationSet, members, consumerOrder }));
  }
  if (memberships.size !== secrets.size) fail('SECRET_ROTATION_MEMBERSHIP_INCOMPLETE');

  if (compose !== undefined) validateComposeBindings(compose, secrets);
  return Object.freeze({
    policySha256: sha256(canonicalJson(policy)),
    freshness: Object.freeze({ ...policy.freshness }),
    secrets,
    rotationSets,
  });
}

export async function collectSecretFileMetadata(secretRoot, names, inspect = lstat) {
  const metadata = new Map();
  for (const name of names) {
    try {
      const item = await inspect(join(secretRoot, name));
      metadata.set(name, {
        exists: true,
        kind: item.isSymbolicLink() ? 'symlink' : item.isFile() ? 'file' : 'other',
        size: item.size,
        mtimeMs: item.mtimeMs,
        mode: item.mode,
        nlink: item.nlink,
      });
    } catch {
      metadata.set(name, { exists: false });
    }
  }
  return metadata;
}

export function buildSecretInventory({
  policy,
  compose,
  fileMetadata,
  profile,
  now = new Date(),
  platform = process.platform,
}) {
  if (!['local_demo', 'target'].includes(profile)) fail('SECRET_INVENTORY_PROFILE_INVALID');
  const validated = validateSecretPolicy(policy, compose);
  if (!(fileMetadata instanceof Map)) fail('SECRET_INVENTORY_METADATA_INVALID');
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) fail('SECRET_INVENTORY_TIME_INVALID');
  const entries = [];
  const counts = { fresh: 0, due_soon: 0, stale: 0, missing: 0, invalid: 0 };
  for (const secret of [...validated.secrets.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    const metadata = fileMetadata.get(secret.name);
    const freshnessStatus = classifyMetadata(metadata, secret, validated.freshness, nowMs, platform);
    counts[freshnessStatus] += 1;
    const ageDays = metadata?.exists && Number.isFinite(metadata.mtimeMs)
      ? Math.max(0, Math.floor((nowMs - metadata.mtimeMs) / 86_400_000))
      : null;
    entries.push(Object.freeze({
      name: secret.name,
      category: secret.category,
      rotationSet: secret.rotationSet,
      consumers: secret.consumers,
      maxAgeDays: secret.maxAgeDays,
      warningDays: secret.warningDays,
      ageDays,
      freshnessStatus,
    }));
  }
  const status = counts.invalid > 0 || counts.stale > 0
    ? 'failed'
    : counts.missing > 0
      ? profile === 'target' ? 'blocked_external' : 'failed'
      : counts.due_soon > 0 ? 'warning' : 'passed';
  const facts = {
    schemaVersion: SECRET_INVENTORY_SCHEMA,
    profile,
    policySha256: validated.policySha256,
    freshnessBasis: 'file_mtime_engineering_signal_not_provider_rotation_proof',
    secretCount: entries.length,
    counts,
    entries,
  };
  return Object.freeze({
    ...facts,
    status,
    generatedAt: new Date(nowMs).toISOString(),
    inventorySha256: sha256(canonicalJson(facts)),
  });
}

export function assertSecretInventoryGate(inventory) {
  if (inventory?.status === 'passed' || inventory?.status === 'warning') return inventory;
  if (inventory?.status === 'blocked_external') {
    throw new SecretLifecycleError('SECRET_INVENTORY_EXTERNAL_INPUT_REQUIRED', 'blocked_external');
  }
  throw new SecretLifecycleError('SECRET_INVENTORY_GATE_FAILED');
}

export function createRotationSession({ policy, rotationSetId, generationId, now = new Date() }) {
  const validated = validateSecretPolicy(policy);
  const rotationSet = validated.rotationSets.get(rotationSetId);
  if (!rotationSet) fail('SECRET_ROTATION_SET_UNKNOWN');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(String(generationId ?? ''))) {
    fail('SECRET_ROTATION_GENERATION_INVALID');
  }
  return Object.freeze({
    schemaVersion: SECRET_ROTATION_SCHEMA,
    policySha256: validated.policySha256,
    rotationSetId,
    generationIdSha256: sha256(generationId),
    mode: rotationSet.mode,
    members: rotationSet.members,
    consumerOrder: rotationSet.consumerOrder,
    impactCode: rotationSet.impactCode,
    rollbackBoundary: 'before_revoke_old',
    state: 'PLANNED',
    version: 0,
    createdAt: isoDate(now, 'SECRET_ROTATION_TIME_INVALID'),
    events: Object.freeze([]),
  });
}

export function applyRotationCommand(session, { command, expectedVersion, idempotencyKey, reasonCode, now = new Date() }) {
  if (session?.schemaVersion !== SECRET_ROTATION_SCHEMA || !Array.isArray(session.events)) {
    fail('SECRET_ROTATION_SESSION_INVALID');
  }
  if (!/^[a-z][a-z_]{2,31}$/.test(String(command ?? ''))) fail('SECRET_ROTATION_COMMAND_INVALID');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) fail('SECRET_ROTATION_EXPECTED_VERSION_INVALID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(String(idempotencyKey ?? ''))) {
    fail('SECRET_ROTATION_IDEMPOTENCY_KEY_INVALID');
  }
  const keySha256 = sha256(idempotencyKey);
  const replay = session.events.find((event) => event.idempotencyKeySha256 === keySha256);
  if (replay) {
    if (replay.command !== command || replay.versionBefore !== expectedVersion || replay.reasonCode !== (reasonCode ?? null)) {
      fail('SECRET_ROTATION_IDEMPOTENCY_CONFLICT');
    }
    return session;
  }
  if (expectedVersion !== session.version) fail('SECRET_ROTATION_VERSION_CONFLICT');
  const nextState = transitionTable[session.state]?.[command];
  if (!nextState) fail('SECRET_ROTATION_TRANSITION_INVALID');
  if (command === 'fail') {
    if (!allowedReasonCodes.has(reasonCode)) fail('SECRET_ROTATION_REASON_CODE_REQUIRED');
  } else if (reasonCode !== undefined) {
    fail('SECRET_ROTATION_REASON_CODE_FORBIDDEN');
  }
  const event = Object.freeze({
    sequence: session.version + 1,
    command,
    stateBefore: session.state,
    stateAfter: nextState,
    versionBefore: session.version,
    versionAfter: session.version + 1,
    idempotencyKeySha256: keySha256,
    reasonCode: reasonCode ?? null,
    occurredAt: isoDate(now, 'SECRET_ROTATION_TIME_INVALID'),
  });
  return Object.freeze({
    ...session,
    state: nextState,
    version: session.version + 1,
    events: Object.freeze([...session.events, event]),
  });
}

function validateFreshness(freshness) {
  assertExactKeys(freshness, ['futureSkewSeconds', 'maxAgeDays', 'maxBytes', 'minBytes', 'warningDays']);
  validateAge(freshness.maxAgeDays, freshness.warningDays);
  for (const [value, minimum, maximum, code] of [
    [freshness.futureSkewSeconds, 0, 86_400, 'SECRET_POLICY_FUTURE_SKEW_INVALID'],
    [freshness.minBytes, 1, 65_536, 'SECRET_POLICY_MIN_BYTES_INVALID'],
    [freshness.maxBytes, freshness.minBytes, 1_048_576, 'SECRET_POLICY_MAX_BYTES_INVALID'],
  ]) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) fail(code);
  }
}

function validateAge(maxAgeDays, warningDays) {
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 3650) fail('SECRET_POLICY_MAX_AGE_INVALID');
  if (!Number.isInteger(warningDays) || warningDays < 0 || warningDays >= maxAgeDays) fail('SECRET_POLICY_WARNING_AGE_INVALID');
}

function validateComposeBindings(compose, secrets) {
  if (!compose?.services || !compose?.secrets) fail('SECRET_POLICY_COMPOSE_INVALID');
  const composeFileSecrets = new Set();
  for (const [name, definition] of Object.entries(compose.secrets)) {
    const file = String(definition?.file ?? '').replace(/\\/g, '/');
    if (file.endsWith(`/.secrets/${name}`) || file === `.secrets/${name}` || file === `./.secrets/${name}`) {
      composeFileSecrets.add(name);
    }
  }
  if (!sameStringSet([...secrets.keys()], [...composeFileSecrets])) fail('SECRET_POLICY_COMPOSE_SET_MISMATCH');
  const actualConsumers = new Map([...secrets.keys()].map((name) => [name, []]));
  for (const [serviceName, service] of Object.entries(compose.services)) {
    for (const binding of service?.secrets ?? []) {
      const source = typeof binding === 'string' ? binding : binding?.source;
      if (actualConsumers.has(source)) actualConsumers.get(source).push(serviceName);
    }
  }
  for (const [name, secret] of secrets) {
    if (!sameStringSet(secret.consumers, actualConsumers.get(name))) fail('SECRET_POLICY_CONSUMER_MISMATCH');
  }
}

function classifyMetadata(metadata, secret, freshness, nowMs, platform) {
  if (!metadata?.exists) return 'missing';
  if (metadata.kind !== 'file'
    || !Number.isFinite(metadata.size)
    || metadata.size < freshness.minBytes
    || metadata.size > freshness.maxBytes
    || !Number.isFinite(metadata.mtimeMs)
    || metadata.mtimeMs > nowMs + freshness.futureSkewSeconds * 1000) return 'invalid';
  if (platform === 'linux' && ((metadata.mode & 0o077) !== 0 || metadata.nlink !== 1)) return 'invalid';
  const ageDays = (nowMs - metadata.mtimeMs) / 86_400_000;
  if (ageDays > secret.maxAgeDays) return 'stale';
  if (ageDays > secret.maxAgeDays - secret.warningDays) return 'due_soon';
  return 'fresh';
}

function assertExactKeys(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('SECRET_POLICY_SHAPE_INVALID');
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) fail('SECRET_POLICY_UNKNOWN_PROPERTY');
  if (required.some((key) => !Object.hasOwn(value, key))) fail('SECRET_POLICY_REQUIRED_PROPERTY_MISSING');
}

function sortedUniqueStrings(value, code) {
  const strings = uniqueStringsInOrder(value, code);
  return Object.freeze(strings.sort((left, right) => left.localeCompare(right)));
}

function uniqueStringsInOrder(value, code) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) fail(code);
  const strings = value.map((item) => String(item));
  if (strings.some((item) => !/^[a-z][a-z0-9_-]{1,63}$/.test(item)) || new Set(strings).size !== strings.length) fail(code);
  return strings;
}

function sameStringSet(left, right) {
  return [...new Set(left)].sort().join('\0') === [...new Set(right)].sort().join('\0');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function isoDate(value, code) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail(code);
  return date.toISOString();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(code, status = 'failed') {
  throw new SecretLifecycleError(code, status);
}
