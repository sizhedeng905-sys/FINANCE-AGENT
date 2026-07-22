import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertConfigurationImageReferences,
  assertMigrationCompatibility,
  assertReleaseBundle,
  buildMigrationLedger,
  IMAGE_LOCK_SCHEMA,
  readSealedJson,
  RELEASE_MANIFEST_SCHEMA,
  RELEASE_PLAN_SCHEMA,
  sha256,
  SUPPLY_CHAIN_INDEX_SCHEMA,
  verifyImageLock,
  writeSealedDocument,
  writeSealedJson
} from './image-integrity-lib.mjs';
import { parseEnvironmentSource, resolveDeploymentEnvironment } from './deployment-environment.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(stagingRoot, '../..');
const gitStatus = capture('git', ['status', '--porcelain', '--untracked-files=no'], repoRoot).trim();
if (gitStatus) throw new Error('Release requires a clean tracked Git worktree');
const gitSha = capture('git', ['rev-parse', 'HEAD'], repoRoot).trim();
const shortSha = gitSha.slice(0, 12);
const fileEnvironment = parseEnvironmentSource(
  await readFile(join(stagingRoot, '.env'), 'utf8'),
  'staging environment',
);
const settings = resolveDeploymentEnvironment({ ...fileEnvironment, ...process.env });
const releaseId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${shortSha}`;
const releaseRoot = join(stagingRoot, '.release');
const releasesRoot = join(releaseRoot, 'releases');
const releaseEvidenceRoot = join(releasesRoot, `${releaseId}.supply-chain`);
const imageLockPath = join(releasesRoot, `${releaseId}.images.lock.json`);
await mkdir(releasesRoot, { recursive: true, mode: 0o700 });
const runtimeEnv = {
  ...fileEnvironment,
  ...process.env,
  BUILD_GIT_SHA: gitSha,
  BACKEND_IMAGE: `${settings.registryPrefix}/backend:${shortSha}`,
  FRONTEND_IMAGE: `${settings.registryPrefix}/frontend:${shortSha}`,
  BACKUP_IMAGE: `${settings.registryPrefix}/staging-backup:${shortSha}`,
  POSTGRES_IMAGE: `${settings.registryPrefix}/staging-postgres:${shortSha}`,
  MINIO_IMAGE: `${settings.registryPrefix}/staging-minio:${shortSha}`,
  PROMETHEUS_IMAGE: `${settings.registryPrefix}/staging-prometheus:${shortSha}`,
  ALERTMANAGER_IMAGE: `${settings.registryPrefix}/staging-alertmanager:${shortSha}`,
  NODE_EXPORTER_IMAGE: `${settings.registryPrefix}/staging-node-exporter:${shortSha}`,
  ALLOY_IMAGE: `${settings.registryPrefix}/staging-alloy:${shortSha}`,
  TEMPO_IMAGE: `${settings.registryPrefix}/staging-tempo:${shortSha}`
};
const composePrefix = ['compose', '--env-file', '.env', '-f', 'compose.yaml'];
const runtimePullServices = ['redis', 'clamav', 'gateway', 'grafana', 'loki'];
const backupExecOptions = [
  ...composePrefix, 'exec', '-T', '--user', '999:999',
  '-e', 'HOME=/tmp/backup-home', '-e', 'MC_CONFIG_DIR=/tmp/backup-home/.mc'
];

run('node', ['scripts/verify-config.mjs'], runtimeEnv);
await mkdir(releaseEvidenceRoot, { recursive: true, mode: 0o700 });
const configEvidencePath = join(releaseEvidenceRoot, 'config-verification.json');
await copyFile(join(stagingRoot, '.evidence', 'config-verification.json'), configEvidencePath);

let previousModelRouteSnapshot;
if (runningServices(runtimeEnv).includes('backend-api')) {
  previousModelRouteSnapshot = join(releasesRoot, `${releaseId}.pre-deploy-model-routes.json`);
  await writeFile(previousModelRouteSnapshot, exportModelRoutes(runtimeEnv), { mode: 0o600 });
}
if (runningServices(runtimeEnv).includes('backup')) {
  run('docker', [...backupExecOptions, 'backup', '/opt/staging/run-backup.sh'], runtimeEnv);
}

run('docker', [...composePrefix, 'pull', '--policy', 'missing', ...runtimePullServices], runtimeEnv);
run('docker', [
  ...composePrefix, 'build', '--provenance=mode=max',
  'backend-api', 'frontend', 'postgres', 'backup', 'minio', 'prometheus',
  'alertmanager', 'node-exporter', 'alloy', 'tempo'
], runtimeEnv);
const buildCompletedAt = new Date().toISOString();
run('node', [
  'scripts/lock-images.mjs', '--output', imageLockPath, '--expected-git-sha', gitSha, '--scope', 'staging'
], runtimeEnv);
const { document: imageLock, fileSha256: imageLockFileSha256 } = await readSealedJson(imageLockPath, IMAGE_LOCK_SCHEMA);
verifyImageLock(imageLock);
assertConfigurationImageReferences(JSON.parse(await readFile(configEvidencePath, 'utf8')), imageLock);
const lockedEnv = { ...runtimeEnv, ...imageLock.environmentBindings };

run('node', [
  'scripts/scan-image-lock.mjs', '--lock', imageLockPath, '--output', releaseEvidenceRoot
], lockedEnv);
const supplyChainPath = join(releaseEvidenceRoot, 'supply-chain-index.json');
const { document: supplyChain, fileSha256: supplyChainFileSha256 } = await readSealedJson(
  supplyChainPath,
  SUPPLY_CHAIN_INDEX_SCHEMA
);
if (supplyChain.imageLock.fileSha256 !== imageLockFileSha256) {
  throw new Error('Supply-chain evidence does not match the release image lock');
}

const migrationLedger = await buildMigrationLedger(join(repoRoot, 'backend', 'prisma'));
const configDescriptor = {
  schemaVersion: 'staging-compose/2.0',
  composeSha256: sha256(await readFile(join(stagingRoot, 'compose.yaml'))),
  environmentExampleSha256: sha256(await readFile(join(stagingRoot, '.env.example'))),
  verificationEvidence: await fileReference(configEvidencePath)
};
const imageLockDescriptor = {
  path: releaseRelativePath(imageLockPath),
  fileSha256: imageLockFileSha256,
  contentSha256: imageLock.integrity.contentSha256
};
const imagesDescriptor = {
  backend: manifestImage(imageLock, 'BACKEND_IMAGE'),
  frontend: manifestImage(imageLock, 'FRONTEND_IMAGE'),
  worker: manifestImage(imageLock, 'BACKEND_IMAGE'),
  backup: manifestImage(imageLock, 'BACKUP_IMAGE'),
  postgres: manifestImage(imageLock, 'POSTGRES_IMAGE'),
  minio: manifestImage(imageLock, 'MINIO_IMAGE'),
  prometheus: manifestImage(imageLock, 'PROMETHEUS_IMAGE'),
  alertmanager: manifestImage(imageLock, 'ALERTMANAGER_IMAGE'),
  nodeExporter: manifestImage(imageLock, 'NODE_EXPORTER_IMAGE'),
  alloy: manifestImage(imageLock, 'ALLOY_IMAGE'),
  tempo: manifestImage(imageLock, 'TEMPO_IMAGE')
};
const supplyChainDescriptor = {
  path: releaseRelativePath(supplyChainPath),
  fileSha256: supplyChainFileSha256,
  contentSha256: supplyChain.integrity.contentSha256,
  signatureStatus: supplyChain.signatures.status,
  registryAuthorization: supplyChain.registryAuthorization
};
const releasePlanPath = join(releasesRoot, `${releaseId}.plan.json`);
await writeSealedJson(releasePlanPath, {
  schemaVersion: RELEASE_PLAN_SCHEMA,
  releaseId,
  createdAt: new Date().toISOString(),
  buildCompletedAt,
  gitSha,
  config: configDescriptor,
  migrations: migrationLedger,
  imageLock: imageLockDescriptor,
  images: imagesDescriptor,
  supplyChain: supplyChainDescriptor,
  gates: {
    config: 'passed',
    imageIdentity: 'passed',
    sbom: 'passed',
    vulnerabilityScan: 'passed',
    migrationLedgerRecorded: 'passed'
  }
});
const { document: releasePlan, fileSha256: releasePlanFileSha256 } = await readSealedJson(
  releasePlanPath,
  RELEASE_PLAN_SCHEMA
);
assertReleaseBundle({
  manifest: releasePlan,
  lock: imageLock,
  lockFileSha256: imageLockFileSha256,
  expectedSchema: RELEASE_PLAN_SCHEMA
});

const postDeployBackupNotBeforeEpoch = Math.floor(Date.now() / 1000);
run('docker', [
  ...composePrefix, 'up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '1200'
], lockedEnv);
run('docker', [...composePrefix, 'exec', '-T', 'postgres', '/bin/bash', '/opt/staging/provision-restore-role.sh'], lockedEnv);
verifyRunningImages(imageLock, lockedEnv);
assertMigrationCompatibility(migrationLedger, readAppliedMigrations(lockedEnv));
run('node', ['scripts/smoke-test.mjs'], lockedEnv);
run('node', ['scripts/browser-smoke.mjs'], lockedEnv);
run('docker', [
  ...backupExecOptions,
  '-e', `BACKUP_REQUIRED_AFTER_EPOCH=${postDeployBackupNotBeforeEpoch}`,
  'backup', '/opt/staging/run-backup.sh'
], lockedEnv);
run('docker', [...backupExecOptions, 'backup', '/opt/staging/restore-drill.sh'], lockedEnv);
const modelRouteSnapshot = join(releasesRoot, `${releaseId}.model-routes.json`);
await writeFile(modelRouteSnapshot, exportModelRoutes(lockedEnv), { mode: 0o600 });

const manifestPayload = {
  schemaVersion: RELEASE_MANIFEST_SCHEMA,
  releaseId,
  createdAt: new Date().toISOString(),
  buildCompletedAt,
  gitSha,
  releasePlan: {
    ...(await fileReference(releasePlanPath)),
    fileSha256: releasePlanFileSha256,
    contentSha256: releasePlan.integrity.contentSha256
  },
  config: configDescriptor,
  migrations: migrationLedger,
  imageLock: imageLockDescriptor,
  images: imagesDescriptor,
  supplyChain: supplyChainDescriptor,
  modelRouteSnapshot: await fileReference(modelRouteSnapshot),
  previousModelRouteSnapshot: previousModelRouteSnapshot
    ? await fileReference(previousModelRouteSnapshot)
    : null,
  gates: {
    config: 'passed',
    imageIdentity: 'passed',
    sbom: 'passed',
    vulnerabilityScan: 'passed',
    migrationCompatibility: 'passed',
    smoke: 'passed',
    restoreDrill: 'passed'
  }
};
const manifestPath = join(releasesRoot, `${releaseId}.json`);
const manifest = await writeSealedJson(manifestPath, manifestPayload);
assertReleaseBundle({
  manifest: manifest.document,
  lock: imageLock,
  lockFileSha256: imageLockFileSha256
});
await writeSealedDocument(join(releaseRoot, 'current.json'), manifest.document, RELEASE_MANIFEST_SCHEMA);
await writeSealedDocument(join(releaseRoot, 'images.lock.json'), imageLock, IMAGE_LOCK_SCHEMA);
await writeFile(join(releaseRoot, 'runtime.env'), [
  ...Object.entries(imageLock.environmentBindings).map(([name, reference]) => `${name}=${reference}`),
  ''
].join('\n'), { mode: 0o600 });
process.stdout.write(JSON.stringify({
  status: 'released',
  releaseId,
  manifestPath,
  manifestSha256: manifest.fileSha256,
  imageLockSha256: imageLockFileSha256
}, null, 2) + '\n');

function manifestImage(lock, variable) {
  const immutableReference = lock.environmentBindings[variable];
  const entry = lock.entries.find((candidate) => candidate.immutableReference === immutableReference);
  if (!entry) throw new Error(`Image lock lacks ${variable}`);
  return {
    requestedReference: entry.requestedReference,
    immutableReference,
    imageId: entry.imageId,
    repoDigest: entry.repoDigest
  };
}

function verifyRunningImages(lock, environment) {
  const expectedByService = new Map();
  for (const entry of lock.entries) {
    for (const use of entry.uses) {
      if (use.scope === 'staging' && use.kind === 'service') expectedByService.set(use.name, entry.imageId);
    }
  }
  for (const [service, expectedImageId] of expectedByService) {
    const containerId = capture('docker', [...composePrefix, 'ps', '-a', '-q', service], stagingRoot, environment).trim();
    if (!containerId) throw new Error(`Release service has no container: ${service}`);
    const actualImageId = capture('docker', ['container', 'inspect', containerId, '--format', '{{.Image}}'], stagingRoot).trim();
    if (actualImageId !== expectedImageId) throw new Error(`Running image identity mismatch for ${service}`);
  }
}

function readAppliedMigrations(environment) {
  const output = capture('docker', [
    ...composePrefix, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'finance_agent_staging',
    '--tuples-only', '--no-align', '--field-separator', '|', '--set', 'ON_ERROR_STOP=1',
    '--command', "SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;"
  ], stagingRoot, environment);
  return parseMigrationOutput(output);
}

function parseMigrationOutput(output) {
  return output.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, checksum, ...extra] = line.split('|');
    if (extra.length > 0 || !name || !checksum) throw new Error('Database returned an invalid migration ledger');
    return { name, checksum };
  });
}

function runningServices(environment) {
  const result = spawnSync('docker', [...composePrefix, 'ps', '--status', 'running', '--services'], {
    cwd: stagingRoot,
    env: environment,
    encoding: 'utf8'
  });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
}

function exportModelRoutes(environment) {
  return capture('docker', [
    ...composePrefix, 'exec', '-T', 'backend-api',
    '/usr/local/bin/backend-entrypoint', 'node', 'dist/model-runtime/model-route-state.js', 'export'
  ], stagingRoot, environment);
}

async function fileReference(path) {
  const content = await readFile(path);
  return { path: releaseRelativePath(path), bytes: content.byteLength, sha256: sha256(content) };
}

function releaseRelativePath(path) {
  return path.slice(stagingRoot.length + 1).replace(/\\/g, '/');
}

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { cwd: stagingRoot, env: environment, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function capture(command, args, cwd = stagingRoot, environment = process.env) {
  const result = spawnSync(command, args, { cwd, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  return result.stdout;
}
