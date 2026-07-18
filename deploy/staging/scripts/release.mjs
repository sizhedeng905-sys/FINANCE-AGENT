import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(stagingRoot, '../..');
const gitStatus = capture('git', ['status', '--porcelain', '--untracked-files=no'], repoRoot).trim();
if (gitStatus) throw new Error('Release requires a clean tracked Git worktree');
const gitSha = capture('git', ['rev-parse', 'HEAD'], repoRoot).trim();
const shortSha = gitSha.slice(0, 12);
const releaseId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${shortSha}`;
const releaseRoot = join(stagingRoot, '.release');
const releasesRoot = join(releaseRoot, 'releases');
await mkdir(releasesRoot, { recursive: true });

run('node', ['scripts/verify-config.mjs']);
const runtimeEnv = {
  ...process.env,
  BACKEND_IMAGE: `finance-agent/backend:${shortSha}`,
  FRONTEND_IMAGE: `finance-agent/frontend:${shortSha}`,
  BACKUP_IMAGE: `finance-agent/staging-backup:${shortSha}`
};
const composePrefix = ['compose', '--env-file', '.env', '-f', 'compose.yaml'];

let previousModelRouteSnapshot;
if (runningServices(runtimeEnv).includes('backend-api')) {
  previousModelRouteSnapshot = join(releasesRoot, `${releaseId}.pre-deploy-model-routes.json`);
  await writeFile(previousModelRouteSnapshot, exportModelRoutes(runtimeEnv));
}
if (runningServices(runtimeEnv).includes('backup')) {
  run('docker', [...composePrefix, 'exec', '-T', 'backup', '/opt/staging/run-backup.sh'], runtimeEnv);
}

run('docker', [...composePrefix, 'build', 'backend-api', 'frontend', 'backup'], runtimeEnv);
run('docker', [...composePrefix, 'up', '-d', '--wait', '--wait-timeout', '1200'], runtimeEnv);
run('docker', [...composePrefix, 'exec', '-T', 'postgres', '/bin/bash', '/opt/staging/provision-restore-role.sh'], runtimeEnv);
run('node', ['scripts/lock-images.mjs'], runtimeEnv);
run('node', ['scripts/smoke-test.mjs'], runtimeEnv);
run('node', ['scripts/browser-smoke.mjs'], runtimeEnv);
run('docker', [...composePrefix, 'exec', '-T', 'backup', '/opt/staging/restore-drill.sh'], runtimeEnv);
const modelRouteSnapshot = join(releasesRoot, `${releaseId}.model-routes.json`);
await writeFile(modelRouteSnapshot, exportModelRoutes(runtimeEnv));

const images = {};
for (const [name, image] of Object.entries({
  backend: runtimeEnv.BACKEND_IMAGE,
  frontend: runtimeEnv.FRONTEND_IMAGE,
  backup: runtimeEnv.BACKUP_IMAGE
})) {
  images[name] = {
    reference: image,
    imageId: capture('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], stagingRoot).trim()
  };
}
const manifest = {
  schemaVersion: 1,
  releaseId,
  createdAt: new Date().toISOString(),
  gitSha,
  images,
  migrationSchemaSha256: sha256(await readFile(join(repoRoot, 'backend', 'prisma', 'schema.prisma'))),
  modelRouteSnapshot: releaseRelativePath(modelRouteSnapshot),
  previousModelRouteSnapshot: previousModelRouteSnapshot
    ? releaseRelativePath(previousModelRouteSnapshot)
    : null,
  gates: {
    config: 'passed',
    smoke: 'passed',
    restoreDrill: 'passed'
  }
};
const manifestPath = join(releasesRoot, `${releaseId}.json`);
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await copyFile(manifestPath, join(releaseRoot, 'current.json'));
await writeFile(join(releaseRoot, 'runtime.env'), [
  `BACKEND_IMAGE=${runtimeEnv.BACKEND_IMAGE}`,
  `FRONTEND_IMAGE=${runtimeEnv.FRONTEND_IMAGE}`,
  `BACKUP_IMAGE=${runtimeEnv.BACKUP_IMAGE}`,
  ''
].join('\n'));
process.stdout.write(JSON.stringify({ status: 'released', releaseId, manifestPath }, null, 2) + '\n');

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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
