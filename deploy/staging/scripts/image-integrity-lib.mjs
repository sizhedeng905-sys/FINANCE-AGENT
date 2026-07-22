import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const IMAGE_LOCK_SCHEMA = 'staging-image-lock/2.0';
export const RELEASE_PLAN_SCHEMA = 'staging-release-plan/1.0';
export const RELEASE_MANIFEST_SCHEMA = 'staging-release/2.0';
export const SUPPLY_CHAIN_INDEX_SCHEMA = 'staging-supply-chain/1.0';
export const CANONICALIZATION_VERSION = 'json-c14n-v1';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export function sealDocument(payload) {
  if (!isPlainObject(payload) || 'integrity' in payload) {
    throw new Error('Only an object without an integrity property can be sealed');
  }
  return {
    ...payload,
    integrity: {
      canonicalizationVersion: CANONICALIZATION_VERSION,
      contentSha256: sha256(canonicalJson(payload))
    }
  };
}

export function verifySealedDocument(document, expectedSchema) {
  if (!isPlainObject(document) || document.schemaVersion !== expectedSchema) {
    throw new Error(`Invalid document schema; expected ${expectedSchema}`);
  }
  const integrity = document.integrity;
  if (!isPlainObject(integrity)
    || integrity.canonicalizationVersion !== CANONICALIZATION_VERSION
    || !HEX_SHA256_PATTERN.test(String(integrity.contentSha256 ?? ''))) {
    throw new Error('Document integrity metadata is invalid');
  }
  const { integrity: _ignored, ...payload } = document;
  const actual = sha256(canonicalJson(payload));
  if (actual !== integrity.contentSha256) throw new Error('Document content hash mismatch');
  return document;
}

export async function writeSealedJson(path, payload) {
  const document = sealDocument(payload);
  return writeSealedDocument(path, document);
}

export async function writeSealedDocument(path, document, expectedSchema = document?.schemaVersion) {
  verifySealedDocument(document, expectedSchema);
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  await writeFile(path, serialized, { mode: 0o600 });
  await writeFile(`${path}.sha256`, `${sha256(serialized)}  ${pathFileName(path)}\n`, { mode: 0o600 });
  return { document, fileSha256: sha256(serialized), serialized };
}

export async function readSealedJson(path, expectedSchema) {
  const serialized = await readFile(path, 'utf8');
  const sidecar = (await readFile(`${path}.sha256`, 'utf8')).trim();
  const [expectedFileHash, sidecarName, ...extra] = sidecar.split(/\s+/);
  if (!HEX_SHA256_PATTERN.test(expectedFileHash ?? '')
    || sidecarName !== pathFileName(path)
    || extra.length > 0) {
    throw new Error(`Invalid SHA-256 sidecar for ${pathFileName(path)}`);
  }
  const actualFileHash = sha256(serialized);
  if (actualFileHash !== expectedFileHash) throw new Error(`File SHA-256 mismatch for ${pathFileName(path)}`);
  const document = JSON.parse(serialized);
  verifySealedDocument(document, expectedSchema);
  return { document, fileSha256: actualFileHash, serialized };
}

export function assertSafeImageReference(reference) {
  if (typeof reference !== 'string' || !reference || reference.trim() !== reference || /\s/.test(reference)) {
    throw new Error('Image reference must be a non-empty value without whitespace');
  }
  if (/(^|[/:])latest(?:@|$)/i.test(reference)) throw new Error(`Mutable latest image is forbidden: ${reference}`);
  if (reference.includes('@') && !/@sha256:[a-f0-9]{64}$/.test(reference)) {
    throw new Error(`Image digest reference is invalid: ${reference}`);
  }
  return reference;
}

export function imageRepository(reference) {
  const withoutDigest = reference.split('@', 1)[0];
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  return lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
}

export function inspectLocalImage(reference) {
  assertSafeImageReference(reference);
  const result = spawnSync('docker', ['image', 'inspect', reference], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 30_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Image is unavailable locally: ${reference}: ${String(result.stderr).trim()}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error(`Unexpected docker inspect result for ${reference}`);
  return parsed[0];
}

export function createImageLock({ targets, environmentBindings = {}, metadata = {}, inspectImage = inspectLocalImage }) {
  if (!Array.isArray(targets) || targets.length === 0) throw new Error('At least one image target is required');
  const grouped = new Map();
  for (const target of targets) {
    const reference = assertSafeImageReference(target.requestedReference);
    const uses = Array.isArray(target.uses) ? target.uses : [];
    if (uses.length === 0) throw new Error(`Image target has no usage: ${reference}`);
    const current = grouped.get(reference) ?? { requestedReference: reference, uses: [] };
    current.uses.push(...uses.map(normalizeUse));
    grouped.set(reference, current);
  }

  const entries = [...grouped.values()].map((target) => {
    const inspected = inspectImage(target.requestedReference);
    const imageId = String(inspected.Id ?? '').toLowerCase();
    if (!SHA256_PATTERN.test(imageId)) throw new Error(`Image has no strong local image ID: ${target.requestedReference}`);
    const repository = imageRepository(target.requestedReference);
    const repoDigests = Array.isArray(inspected.RepoDigests)
      ? inspected.RepoDigests.filter((item) => typeof item === 'string' && item.startsWith(`${repository}@sha256:`)).sort()
      : [];
    const requestedDigest = target.requestedReference.includes('@') ? target.requestedReference : null;
    if (requestedDigest && !repoDigests.includes(requestedDigest) && imageId !== requestedDigest.slice(requestedDigest.indexOf('@') + 1)) {
      throw new Error(`Resolved image does not match requested digest: ${target.requestedReference}`);
    }
    const repoDigest = requestedDigest ?? repoDigests[0] ?? null;
    const immutableReference = repoDigest ?? imageId;
    const labels = selectProvenanceLabels(inspected.Config?.Labels);
    return {
      requestedReference: target.requestedReference,
      immutableReference,
      imageId,
      repoDigest,
      identitySource: repoDigest ? 'registry_digest' : 'local_image_id',
      os: String(inspected.Os ?? 'unknown'),
      architecture: String(inspected.Architecture ?? 'unknown'),
      created: typeof inspected.Created === 'string' ? inspected.Created : null,
      provenanceLabels: labels,
      uses: uniqueUses(target.uses)
    };
  }).sort((left, right) => left.requestedReference.localeCompare(right.requestedReference));

  const bindingResult = {};
  for (const [name, reference] of Object.entries(environmentBindings).sort(([left], [right]) => left.localeCompare(right))) {
    if (!/^[A-Z][A-Z0-9_]*_IMAGE$/.test(name)) throw new Error(`Invalid image environment binding: ${name}`);
    const entry = entries.find((candidate) => candidate.requestedReference === reference);
    if (!entry) throw new Error(`Environment binding ${name} does not match a locked image: ${reference}`);
    bindingResult[name] = entry.immutableReference;
  }

  return sealDocument({
    schemaVersion: IMAGE_LOCK_SCHEMA,
    createdAt: new Date().toISOString(),
    metadata,
    entries,
    environmentBindings: bindingResult
  });
}

export function verifyImageLock(lock, { inspectImage = inspectLocalImage, verifyRequestedReferences = true } = {}) {
  verifySealedDocument(lock, IMAGE_LOCK_SCHEMA);
  if (!Array.isArray(lock.entries) || lock.entries.length === 0 || !isPlainObject(lock.environmentBindings)) {
    throw new Error('Image lock entries or environment bindings are invalid');
  }
  const requested = new Set();
  const immutable = new Set();
  for (const entry of lock.entries) {
    assertSafeImageReference(entry.requestedReference);
    assertSafeImageReference(entry.immutableReference);
    if (!SHA256_PATTERN.test(String(entry.imageId ?? ''))) throw new Error('Locked image ID is invalid');
    if (requested.has(entry.requestedReference)) throw new Error(`Duplicate requested image: ${entry.requestedReference}`);
    requested.add(entry.requestedReference);
    immutable.add(entry.immutableReference);

    const immutableImage = inspectImage(entry.immutableReference);
    if (String(immutableImage.Id ?? '').toLowerCase() !== entry.imageId) {
      throw new Error(`Immutable image identity mismatch: ${entry.requestedReference}`);
    }
    if (verifyRequestedReferences) {
      const requestedImage = inspectImage(entry.requestedReference);
      if (String(requestedImage.Id ?? '').toLowerCase() !== entry.imageId) {
        throw new Error(`Mutable image tag drift detected: ${entry.requestedReference}`);
      }
    }
  }
  for (const [name, reference] of Object.entries(lock.environmentBindings)) {
    if (!/^[A-Z][A-Z0-9_]*_IMAGE$/.test(name) || !immutable.has(reference)) {
      throw new Error(`Image lock environment binding is invalid: ${name}`);
    }
  }
  return lock;
}

export function assertReleaseBundle({
  manifest,
  lock,
  lockFileSha256,
  expectedSchema = RELEASE_MANIFEST_SCHEMA
}) {
  verifySealedDocument(manifest, expectedSchema);
  verifySealedDocument(lock, IMAGE_LOCK_SCHEMA);
  if (!isPlainObject(manifest.imageLock)
    || manifest.imageLock.fileSha256 !== lockFileSha256
    || manifest.imageLock.contentSha256 !== lock.integrity.contentSha256) {
    throw new Error('Release manifest does not match its image lock');
  }
  return true;
}

export function assertConfigurationImageReferences(evidence, lock) {
  verifySealedDocument(lock, IMAGE_LOCK_SCHEMA);
  if (!isPlainObject(evidence)
    || evidence.status !== 'passed'
    || !isPlainObject(evidence.imageReferences)) {
    throw new Error('Configuration verification evidence is invalid');
  }
  if (evidence.checks?.imageIdentityPolicy !== lock.metadata?.identityPolicy) {
    throw new Error('Configuration image identity policy does not match the image lock');
  }

  const expected = {};
  for (const entry of lock.entries) {
    for (const use of entry.uses) {
      if (use.scope !== 'staging' || use.kind !== 'service') continue;
      if (expected[use.name] && expected[use.name] !== entry.requestedReference) {
        throw new Error(`Staging service has conflicting locked images: ${use.name}`);
      }
      expected[use.name] = entry.requestedReference;
    }
  }
  if (canonicalJson(evidence.imageReferences) !== canonicalJson(expected)) {
    throw new Error('Configuration image references do not match the image lock');
  }
  return true;
}

export async function buildMigrationLedger(prismaRoot) {
  const migrationsRoot = resolve(prismaRoot, 'migrations');
  const entries = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (entries.length === 0) throw new Error('No Prisma migrations were found');
  const migrations = [];
  for (const name of entries) {
    if (!/^[0-9]{14}_[a-z0-9_]+$/.test(name)) throw new Error(`Invalid Prisma migration name: ${name}`);
    const sql = await readFile(resolve(migrationsRoot, name, 'migration.sql'));
    migrations.push({ name, checksum: sha256(sql) });
  }
  return {
    count: migrations.length,
    latest: migrations.at(-1).name,
    ledgerSha256: sha256(canonicalJson(migrations)),
    migrations
  };
}

export function assertMigrationCompatibility(target, applied) {
  if (!isPlainObject(target) || !Array.isArray(target.migrations) || !Array.isArray(applied)) {
    throw new Error('Migration compatibility input is invalid');
  }
  const expected = target.migrations.map(normalizeMigration);
  const observed = applied.map(normalizeMigration);
  if (expected.length !== observed.length) {
    throw new Error(`Database migration set is not exactly compatible: expected ${expected.length}, observed ${observed.length}`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].name !== observed[index].name || expected[index].checksum !== observed[index].checksum) {
      throw new Error(`Database migration mismatch at position ${index + 1}`);
    }
  }
  return true;
}

export function resolveInside(root, candidate, label) {
  const absoluteRoot = resolve(root);
  const absolute = resolve(absoluteRoot, candidate);
  const child = relative(absoluteRoot, absolute);
  if (!child || child === '..' || child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(child)) {
    throw new Error(`${label} must be inside ${absoluteRoot}`);
  }
  return absolute;
}

function normalizeUse(value) {
  if (!isPlainObject(value)
    || typeof value.scope !== 'string'
    || typeof value.kind !== 'string'
    || typeof value.name !== 'string') {
    throw new Error('Image usage must include scope, kind, and name');
  }
  return { scope: value.scope, kind: value.kind, name: value.name };
}

function uniqueUses(uses) {
  const values = new Map();
  for (const use of uses.map(normalizeUse)) values.set(`${use.scope}\u0000${use.kind}\u0000${use.name}`, use);
  return [...values.values()].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function normalizeMigration(value) {
  if (!isPlainObject(value)
    || !/^[0-9]{14}_[a-z0-9_]+$/.test(String(value.name ?? ''))
    || !HEX_SHA256_PATTERN.test(String(value.checksum ?? ''))) {
    throw new Error('Migration ledger entry is invalid');
  }
  return { name: value.name, checksum: value.checksum };
}

function selectProvenanceLabels(labels) {
  if (!isPlainObject(labels)) return {};
  const allowed = [
    'org.opencontainers.image.base.digest',
    'org.opencontainers.image.created',
    'org.opencontainers.image.revision',
    'org.opencontainers.image.source',
    'org.opencontainers.image.version',
    'io.finance-agent.minio-mc.source-revision',
    'io.finance-agent.minio-mc.source-sha256',
    'io.finance-agent.minio-mc.source-version'
  ];
  return Object.fromEntries(allowed.filter((name) => typeof labels[name] === 'string').map((name) => [name, labels[name]]));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function pathFileName(path) {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}
