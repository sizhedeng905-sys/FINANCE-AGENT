import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [targetManifestPath, option, backupId] = process.argv.slice(2);
if (!targetManifestPath || process.argv.slice(2).length > 3 || (option && option !== '--restore-data')) {
  throw new Error('Usage: rollback.mjs <release-manifest.json> [--restore-data <backupId>]');
}
const releasesRoot = join(stagingRoot, '.release', 'releases');
const manifestPath = resolve(stagingRoot, targetManifestPath);
assertInsideReleases(manifestPath, 'Rollback manifest');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !manifest.images?.backend?.reference || !manifest.images?.frontend?.reference) {
  throw new Error('Invalid release manifest');
}
const environment = {
  ...process.env,
  BACKEND_IMAGE: manifest.images.backend.reference,
  FRONTEND_IMAGE: manifest.images.frontend.reference,
  BACKUP_IMAGE: manifest.images.backup?.reference ?? process.env.BACKUP_IMAGE
};
const compose = ['compose', '--env-file', '.env', '-f', 'compose.yaml'];

run('docker', [...compose, 'exec', '-T', 'backup', '/opt/staging/run-backup.sh'], environment);
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
    ...compose, 'run', '--rm', '--no-deps',
    '-e', `CONFIRM_DATABASE_RESTORE=finance_agent_staging/${backupId}`,
    '-e', `CONFIRM_APPLICATION_QUIESCED=finance_agent_staging/${backupId}`,
    '-e', 'ALLOW_STAGING_RESTORE=true',
    '-e', 'RESTORE_AUTHORIZATION_FILE=/run/restore-authorization.json',
    '-v', `${authorizationPath}:/run/restore-authorization.json:ro`,
    '--entrypoint', '/usr/local/bin/gosu',
    'backup', 'postgres', '/opt/staging/restore-backup.sh', backupId
  ], environment);
  run('docker', [...compose, 'run', '--rm', 'migrate'], environment);
}

run('docker', [...compose, 'up', '-d', '--no-build', 'frontend', 'backend-api', 'worker', 'gateway'], environment);
if (manifest.modelRouteSnapshot) await restoreModelRoutes(manifest.modelRouteSnapshot, environment, compose);
run('node', ['scripts/smoke-test.mjs'], environment);
process.stdout.write(JSON.stringify({ status: 'rolled_back', releaseId: manifest.releaseId, dataRestored: option === '--restore-data' }) + '\n');

async function restoreModelRoutes(relativePath, environment, compose) {
  const path = resolve(stagingRoot, relativePath);
  assertInsideReleases(path, 'Model route snapshot');
  const snapshot = await readFile(path, 'utf8');
  const hash = createHash('sha256').update(snapshot).digest('hex');
  const result = spawnSync('docker', [
    ...compose, 'exec', '-T',
    '-e', 'MODEL_ROUTE_ALLOW_PRODUCTION=true',
    '-e', `MODEL_ROUTE_RESTORE_SHA256=${hash}`,
    'backend-api', '/usr/local/bin/backend-entrypoint',
    'node', 'dist/model-runtime/model-route-state.js', 'restore', '-'
  ], { cwd: stagingRoot, env: environment, input: snapshot, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.status !== 0) throw new Error('Model route rollback failed');
}

function assertInsideReleases(path, label) {
  const candidate = relative(releasesRoot, path);
  if (!candidate || candidate === '..' || candidate.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(candidate)) {
    throw new Error(`${label} must be inside deploy/staging/.release/releases`);
  }
}

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { cwd: stagingRoot, env: environment, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}
