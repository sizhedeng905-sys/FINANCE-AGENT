import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertConfigurationImageReferences,
  assertMigrationCompatibility,
  assertReleaseBundle,
  canonicalJson,
  IMAGE_LOCK_SCHEMA,
  readSealedJson,
  RELEASE_MANIFEST_SCHEMA,
  RELEASE_PLAN_SCHEMA,
  resolveInside,
  sha256,
  SUPPLY_CHAIN_INDEX_SCHEMA,
  verifyImageLock,
  writeSealedDocument,
  writeSealedJson
} from './image-integrity-lib.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = join(stagingRoot, '.release');
const releasesRoot = join(releaseRoot, 'releases');
const [targetManifestArgument, option, backupId] = process.argv.slice(2);
if (!targetManifestArgument || process.argv.slice(2).length > 3 || (option && option !== '--restore-data')) {
  throw new Error('Usage: rollback.mjs <release-manifest.json> [--restore-data <backupId>]');
}
const manifestPath = resolveInside(releasesRoot, resolve(stagingRoot, targetManifestArgument), 'Rollback manifest');
const { document: manifest, fileSha256: manifestFileSha256 } = await readSealedJson(
  manifestPath,
  RELEASE_MANIFEST_SCHEMA
);
const imageLockPath = resolveInside(releasesRoot, resolve(stagingRoot, manifest.imageLock?.path), 'Image lock');
const { document: imageLock, fileSha256: imageLockFileSha256 } = await readSealedJson(
  imageLockPath,
  IMAGE_LOCK_SCHEMA
);
assertReleaseBundle({ manifest, lock: imageLock, lockFileSha256: imageLockFileSha256 });
verifyImageLock(imageLock, { verifyRequestedReferences: true });
assertManifestImages(manifest, imageLock);
const supplyChainPath = resolveInside(releasesRoot, resolve(stagingRoot, manifest.supplyChain?.path), 'Supply-chain index');
const { document: supplyChain, fileSha256: supplyChainFileSha256 } = await readSealedJson(
  supplyChainPath,
  SUPPLY_CHAIN_INDEX_SCHEMA
);
if (supplyChainFileSha256 !== manifest.supplyChain.fileSha256
  || supplyChain.integrity.contentSha256 !== manifest.supplyChain.contentSha256
  || supplyChain.imageLock.fileSha256 !== imageLockFileSha256) {
  throw new Error('Release supply-chain evidence does not match the manifest or image lock');
}
if (imageLock.metadata?.identityPolicy === 'signed_registry' && supplyChain.signatures?.status !== 'passed') {
  throw new Error('Signed registry release lacks verified image signatures and provenance');
}
const releasePlanPath = await verifyFileReference(manifest.releasePlan, 'Pre-deployment release plan');
const { document: releasePlan, fileSha256: releasePlanFileSha256 } = await readSealedJson(
  releasePlanPath,
  RELEASE_PLAN_SCHEMA
);
if (releasePlanFileSha256 !== manifest.releasePlan.fileSha256
  || releasePlan.integrity.contentSha256 !== manifest.releasePlan.contentSha256) {
  throw new Error('Pre-deployment release plan does not match the final manifest');
}
assertReleaseBundle({
  manifest: releasePlan,
  lock: imageLock,
  lockFileSha256: imageLockFileSha256,
  expectedSchema: RELEASE_PLAN_SCHEMA
});
assertReleasePlanMatchesManifest(releasePlan, manifest);
await assertCurrentConfiguration(manifest, imageLock);
await verifyFileReference(manifest.modelRouteSnapshot, 'Model route snapshot');
if (manifest.previousModelRouteSnapshot) {
  await verifyFileReference(manifest.previousModelRouteSnapshot, 'Previous model route snapshot');
}

const environment = { ...process.env, ...imageLock.environmentBindings };
const compose = ['compose', '--env-file', '.env', '-f', 'compose.yaml'];
const backupExecOptions = [
  ...compose, 'exec', '-T', '--user', '999:999',
  '-e', 'HOME=/tmp/backup-home', '-e', 'MC_CONFIG_DIR=/tmp/backup-home/.mc'
];
if (!option) assertMigrationCompatibility(manifest.migrations, readAppliedMigrations(environment));

run('docker', [...backupExecOptions, 'backup', '/opt/staging/run-backup.sh'], environment);
if (option === '--restore-data') {
  if (!/^[0-9]{8}T[0-9]{6}Z$/.test(backupId ?? '')) throw new Error('A valid backupId is required');
  const authorizationPath = process.env.RESTORE_AUTHORIZATION_FILE
    ? resolve(process.env.RESTORE_AUTHORIZATION_FILE)
    : '';
  if (!authorizationPath || !existsSync(authorizationPath)) {
    throw new Error('RESTORE_AUTHORIZATION_FILE must reference the target-specific H13/H14 authorization JSON');
  }
  run('docker', [...compose, 'stop', 'backend-api', 'worker'], environment);
  run('docker', [...compose, 'exec', '-T', 'postgres', '/bin/bash', '/opt/staging/provision-restore-role.sh'], environment);
  run('docker', [
    ...compose, 'run', '--rm', '--no-deps', '--pull', 'never',
    '-e', `CONFIRM_DATABASE_RESTORE=finance_agent_staging/${backupId}`,
    '-e', `CONFIRM_APPLICATION_QUIESCED=finance_agent_staging/${backupId}`,
    '-e', 'ALLOW_STAGING_RESTORE=true',
    '-e', 'RESTORE_AUTHORIZATION_FILE=/run/restore-authorization.json',
    '-v', `${authorizationPath}:/run/restore-authorization.json:ro`,
    '--entrypoint', '/usr/sbin/runuser',
    'backup', '-u', 'postgres', '--', '/opt/staging/restore-backup.sh', backupId
  ], environment);
  run('docker', [...compose, 'run', '--rm', '--pull', 'never', 'migrate'], environment);
  assertMigrationCompatibility(manifest.migrations, readAppliedMigrations(environment));
}

run('docker', [
  ...compose, 'up', '-d', '--no-build', '--pull', 'never', '--force-recreate',
  '--wait', '--wait-timeout', '1200'
], environment);
verifyRunningImages(imageLock, environment);
assertMigrationCompatibility(manifest.migrations, readAppliedMigrations(environment));
await restoreModelRoutes(manifest.modelRouteSnapshot, environment, compose);
run('node', ['scripts/smoke-test.mjs'], environment);

const rollbackId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${manifest.releaseId}`;
const rollbackRoot = join(releaseRoot, 'rollbacks');
await mkdir(rollbackRoot, { recursive: true, mode: 0o700 });
const rollbackEvidence = await writeSealedJson(join(rollbackRoot, `${rollbackId}.json`), {
  schemaVersion: 'staging-rollback/1.0',
  rollbackId,
  completedAt: new Date().toISOString(),
  targetReleaseId: manifest.releaseId,
  targetManifestSha256: manifestFileSha256,
  imageLockSha256: imageLockFileSha256,
  migrationLedgerSha256: manifest.migrations.ledgerSha256,
  dataRestored: option === '--restore-data',
  gates: {
    manifestIntegrity: 'passed',
    imageTagBinding: 'passed',
    immutableImageIdentity: 'passed',
    supplyChainEvidence: 'passed',
    migrationCompatibility: 'passed',
    runningContainerIdentity: 'passed',
    smoke: 'passed'
  }
});
await writeSealedDocument(join(releaseRoot, 'current.json'), manifest, RELEASE_MANIFEST_SCHEMA);
await writeSealedDocument(join(releaseRoot, 'images.lock.json'), imageLock, IMAGE_LOCK_SCHEMA);
await writeFile(join(releaseRoot, 'runtime.env'), [
  ...Object.entries(imageLock.environmentBindings).map(([name, reference]) => `${name}=${reference}`),
  ''
].join('\n'), { mode: 0o600 });
process.stdout.write(JSON.stringify({
  status: 'rolled_back',
  releaseId: manifest.releaseId,
  dataRestored: option === '--restore-data',
  evidenceSha256: rollbackEvidence.fileSha256
}) + '\n');

function assertManifestImages(release, lock) {
  const variables = {
    backend: 'BACKEND_IMAGE',
    frontend: 'FRONTEND_IMAGE',
    worker: 'BACKEND_IMAGE',
    backup: 'BACKUP_IMAGE',
    postgres: 'POSTGRES_IMAGE',
    minio: 'MINIO_IMAGE',
    prometheus: 'PROMETHEUS_IMAGE',
    alertmanager: 'ALERTMANAGER_IMAGE',
    nodeExporter: 'NODE_EXPORTER_IMAGE',
    alloy: 'ALLOY_IMAGE',
    tempo: 'TEMPO_IMAGE'
  };
  for (const [name, variable] of Object.entries(variables)) {
    const expected = lock.environmentBindings[variable];
    const image = release.images?.[name];
    if (!image || image.immutableReference !== expected) throw new Error(`Release ${name} image does not match its lock`);
    const entry = lock.entries.find((candidate) => candidate.immutableReference === expected);
    if (!entry || image.imageId !== entry.imageId || image.requestedReference !== entry.requestedReference) {
      throw new Error(`Release ${name} image identity is invalid`);
    }
  }
}

function assertReleasePlanMatchesManifest(plan, release) {
  for (const property of ['config', 'migrations', 'imageLock', 'images', 'supplyChain']) {
    if (canonicalJson(plan[property]) !== canonicalJson(release[property])) {
      throw new Error(`Final release manifest changed the planned ${property}`);
    }
  }
  for (const property of ['releaseId', 'gitSha', 'buildCompletedAt']) {
    if (plan[property] !== release[property]) throw new Error(`Final release manifest changed planned ${property}`);
  }
}

async function assertCurrentConfiguration(release, lock) {
  const config = release.config;
  const shaPattern = /^[a-f0-9]{64}$/;
  if (config?.schemaVersion !== 'staging-compose/2.0'
    || !shaPattern.test(String(config.composeSha256 ?? ''))
    || !shaPattern.test(String(config.environmentExampleSha256 ?? ''))) {
    throw new Error('Release configuration descriptor is invalid');
  }
  const composeContent = await readFile(join(stagingRoot, 'compose.yaml'));
  const environmentExample = await readFile(join(stagingRoot, '.env.example'));
  if (sha256(composeContent) !== config.composeSha256
    || sha256(environmentExample) !== config.environmentExampleSha256) {
    throw new Error('Current deployment configuration does not match the target release');
  }
  const evidencePath = await verifyFileReference(config.verificationEvidence, 'Configuration verification evidence');
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  if (evidence.composeSha256 !== config.composeSha256) {
    throw new Error('Configuration verification evidence is inconsistent with the release');
  }
  assertConfigurationImageReferences(evidence, lock);
}

function readAppliedMigrations(environment) {
  const output = capture('docker', [
    ...compose, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'finance_agent_staging',
    '--tuples-only', '--no-align', '--field-separator', '|', '--set', 'ON_ERROR_STOP=1',
    '--command', "SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;"
  ], environment);
  return output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, checksum, ...extra] = line.split('|');
    if (extra.length > 0 || !name || !checksum) throw new Error('Database returned an invalid migration ledger');
    return { name, checksum };
  });
}

function verifyRunningImages(lock, environment) {
  const services = [...new Set(lock.entries.flatMap((entry) => entry.uses
    .filter((use) => use.scope === 'staging' && use.kind === 'service')
    .map((use) => use.name)))].sort();
  for (const service of services) {
    const entry = lock.entries.find((candidate) => candidate.uses.some(
      (use) => use.scope === 'staging' && use.kind === 'service' && use.name === service
    ));
    if (!entry) throw new Error(`Image lock lacks service ${service}`);
    const containerId = capture('docker', [...compose, 'ps', '-a', '-q', service], environment).trim();
    if (!containerId) throw new Error(`Rollback service has no container: ${service}`);
    const imageId = capture('docker', ['container', 'inspect', containerId, '--format', '{{.Image}}'], environment).trim();
    if (imageId !== entry.imageId) throw new Error(`Rollback started an unexpected image for ${service}`);
  }
}

async function verifyFileReference(reference, label) {
  if (!reference || typeof reference.path !== 'string' || !Number.isSafeInteger(reference.bytes)) {
    throw new Error(`${label} reference is invalid`);
  }
  const path = resolveInside(releasesRoot, resolve(stagingRoot, reference.path), label);
  const content = await readFile(path);
  if (content.byteLength !== reference.bytes || sha256(content) !== reference.sha256) {
    throw new Error(`${label} content mismatch`);
  }
  return path;
}

async function restoreModelRoutes(reference, environment, compose) {
  const path = await verifyFileReference(reference, 'Model route snapshot');
  const snapshot = await readFile(path, 'utf8');
  const result = spawnSync('docker', [
    ...compose, 'exec', '-T',
    '-e', 'MODEL_ROUTE_ALLOW_PRODUCTION=true',
    '-e', `MODEL_ROUTE_RESTORE_SHA256=${reference.sha256}`,
    'backend-api', '/usr/local/bin/backend-entrypoint',
    'node', 'dist/model-runtime/model-route-state.js', 'restore', '-'
  ], { cwd: stagingRoot, env: environment, input: snapshot, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error('Model route rollback failed');
}

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { cwd: stagingRoot, env: environment, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function capture(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: stagingRoot,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  return result.stdout;
}
