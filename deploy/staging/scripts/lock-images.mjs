import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createImageLock,
  IMAGE_LOCK_SCHEMA,
  sha256,
  writeSealedDocument
} from './image-integrity-lib.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(stagingRoot, '../..');
const releaseRoot = join(stagingRoot, '.release');
const arguments_ = process.argv.slice(2);
const outputArgument = optionValue(arguments_, '--output');
const expectedGitSha = optionValue(arguments_, '--expected-git-sha', false);
const scope = optionValue(arguments_, '--scope', false) ?? 'all';
const allowedScopes = new Set(['staging', 'all']);
if (!allowedScopes.has(scope)) throw new Error('--scope must be staging or all');
const outputPath = outputArgument ? resolve(stagingRoot, outputArgument) : join(releaseRoot, 'images.lock.json');
const fileEnvironment = await readEnvironmentFile(join(stagingRoot, '.env'));
const environment = { ...fileEnvironment, ...process.env };
const stagingCompose = renderCompose({
  cwd: stagingRoot,
  file: 'compose.yaml',
  environment
});
const modelComposeRoot = join(repositoryRoot, 'deploy', 'model-services');
const modelCompose = scope === 'all'
  ? renderCompose({
      cwd: modelComposeRoot,
      file: 'compose.yaml',
      environment: {
        MODEL_ROOT: '/models-not-mounted-during-image-lock',
        LOCAL_MODEL_API_KEY: 'synthetic-image-lock-key',
        ...environment
      },
      profiles: ['vl', 'embedding']
    })
  : null;
const identityPolicy = stagingCompose.services?.backup?.environment?.IMAGE_IDENTITY_POLICY ?? '';
const sourceEnvironmentId = stagingCompose.services?.backup?.environment?.BACKUP_SOURCE_ENVIRONMENT_ID ?? '';
if (!['local_identity', 'signed_registry'].includes(identityPolicy)) {
  throw new Error('IMAGE_IDENTITY_POLICY must be local_identity or signed_registry');
}
if (identityPolicy === 'local_identity' && !sourceEnvironmentId.endsWith('-local')) {
  throw new Error('local_identity is allowed only when BACKUP_SOURCE_ENVIRONMENT_ID ends with -local');
}

const targets = [
  ...collectTargets(stagingCompose, 'staging'),
  ...(modelCompose ? collectTargets(modelCompose, 'model-services') : [])
];
const environmentBindings = collectEnvironmentBindings(stagingCompose);
const lock = createImageLock({
  targets,
  environmentBindings,
  metadata: {
    identityPolicy,
    imageScope: scope,
    sourceEnvironmentId,
    gitSha: expectedGitSha || null,
    configSchemaVersion: 'staging-compose/2.0',
    stagingComposeSha256: sha256(await readFile(join(stagingRoot, 'compose.yaml'))),
    modelComposeSha256: sha256(await readFile(join(modelComposeRoot, 'compose.yaml')))
  }
});

if (expectedGitSha) verifyApplicationRevisionLabels(lock, expectedGitSha);
if (identityPolicy === 'signed_registry') {
  const unlocked = lock.entries.filter((entry) => !entry.repoDigest);
  if (unlocked.length > 0) throw new Error(`signed_registry requires registry digests for ${unlocked.length} image(s)`);
}

await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
const written = await writeSealedDocument(outputPath, lock, IMAGE_LOCK_SCHEMA);
process.stdout.write(JSON.stringify({
  status: 'passed',
  schemaVersion: lock.schemaVersion,
  outputPath,
  fileSha256: written.fileSha256,
  contentSha256: lock.integrity.contentSha256,
  imageCount: lock.entries.length,
  imageScope: scope,
  identityPolicy
}, null, 2) + '\n');

function collectTargets(compose, scope) {
  const targets = [];
  for (const [serviceName, service] of Object.entries(compose.services ?? {})) {
    if (typeof service.image !== 'string') throw new Error(`${scope}/${serviceName} has no image reference`);
    targets.push({
      requestedReference: service.image,
      uses: [{ scope, kind: 'service', name: serviceName }]
    });
    for (const [argumentName, value] of Object.entries(service.build?.args ?? {})) {
      if (!/_IMAGE$/.test(argumentName) || typeof value !== 'string') continue;
      targets.push({
        requestedReference: value,
        uses: [{ scope, kind: 'build_input', name: `${serviceName}:${argumentName}` }]
      });
    }
  }
  return targets;
}

function collectEnvironmentBindings(compose) {
  const serviceBindings = {
    BACKEND_IMAGE: ['backend-api', 'worker', 'migrate'],
    FRONTEND_IMAGE: ['frontend'],
    BACKUP_IMAGE: ['backup', 'minio-init'],
    POSTGRES_IMAGE: ['postgres'],
    REDIS_IMAGE: ['redis'],
    CLAMAV_IMAGE: ['clamav'],
    MINIO_IMAGE: ['minio'],
    NGINX_IMAGE: ['gateway'],
    PROMETHEUS_IMAGE: ['prometheus'],
    ALERTMANAGER_IMAGE: ['alertmanager'],
    NODE_EXPORTER_IMAGE: ['node-exporter'],
    LOKI_IMAGE: ['loki'],
    ALLOY_IMAGE: ['alloy'],
    TEMPO_IMAGE: ['tempo'],
    GRAFANA_IMAGE: ['grafana']
  };
  const bindings = {};
  const coveredServices = new Set();
  for (const [variable, services] of Object.entries(serviceBindings)) {
    const references = new Set(services.map((name) => {
      const image = compose.services?.[name]?.image;
      if (typeof image !== 'string') throw new Error(`Missing Compose service for ${variable}: ${name}`);
      coveredServices.add(name);
      return image;
    }));
    if (references.size !== 1) throw new Error(`${variable} services do not share one image`);
    bindings[variable] = [...references][0];
  }
  const uncovered = Object.keys(compose.services ?? {}).filter((name) => !coveredServices.has(name));
  if (uncovered.length > 0) throw new Error(`Staging services lack immutable environment bindings: ${uncovered.join(', ')}`);
  return bindings;
}

function verifyApplicationRevisionLabels(lock, gitSha) {
  if (!/^[a-f0-9]{40}$/.test(gitSha)) throw new Error('Expected Git SHA must contain 40 lowercase hexadecimal characters');
  const applicationServices = new Set([
    'backend-api', 'worker', 'migrate', 'frontend', 'backup', 'postgres', 'minio',
    'prometheus', 'alertmanager', 'node-exporter', 'alloy', 'tempo'
  ]);
  const applicationEntries = lock.entries.filter((entry) => entry.uses.some(
    (use) => use.scope === 'staging' && use.kind === 'service' && applicationServices.has(use.name)
  ));
  for (const entry of applicationEntries) {
    if (entry.provenanceLabels['org.opencontainers.image.revision'] !== gitSha) {
      throw new Error(`Application image revision label mismatch: ${entry.requestedReference}`);
    }
  }
}

function renderCompose({ cwd, file, environment, profiles = [] }) {
  const profileArgs = profiles.flatMap((profile) => ['--profile', profile]);
  const result = spawnSync('docker', ['compose', ...profileArgs, '-f', file, 'config', '--format', 'json'], {
    cwd,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 60_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Unable to render ${cwd}/${file}: ${String(result.stderr).trim()}`);
  return JSON.parse(result.stdout);
}

async function readEnvironmentFile(path) {
  const values = {};
  for (const rawLine of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error(`Invalid staging environment line: ${rawLine}`);
    const name = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Invalid staging environment key: ${name}`);
    values[name] = line.slice(separator + 1);
  }
  return values;
}

function optionValue(arguments_, name, required = true) {
  const index = arguments_.indexOf(name);
  if (index < 0) return null;
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) {
    if (required) throw new Error(`${name} requires a value`);
    throw new Error(`${name} requires a value`);
  }
  return value;
}
