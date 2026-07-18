import { createHash, X509Certificate } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredSecrets = [
  'postgres_superuser_password', 'migration_password', 'runtime_password', 'backup_password', 'restore_password',
  'migration_database_url', 'runtime_database_url', 'backup_database_url', 'restore_database_url', 'jwt_secret',
  'redis_password', 'redis_url', 'minio_root_user', 'minio_root_password',
  's3_access_key_id', 's3_secret_access_key', 'metrics_token', 'grafana_admin_password',
  'staging_seed_password'
];
const requiredTls = ['ca.crt', 'gateway.crt', 'gateway.key', 'postgres.crt', 'postgres.key'];
const expectedCustomImages = {
  'backend-api': 'finance-agent/backend:',
  worker: 'finance-agent/backend:',
  migrate: 'finance-agent/backend:',
  frontend: 'finance-agent/frontend:',
  backup: 'finance-agent/staging-backup:',
  'minio-init': 'finance-agent/staging-backup:',
  postgres: 'finance-agent/staging-postgres:',
  minio: 'finance-agent/staging-minio:',
  prometheus: 'finance-agent/staging-prometheus:',
  alertmanager: 'finance-agent/staging-alertmanager:',
  'node-exporter': 'finance-agent/staging-node-exporter:',
  alloy: 'finance-agent/staging-alloy:',
  tempo: 'finance-agent/staging-tempo:'
};
const digestPinnedRuntimeServices = ['redis', 'clamav', 'gateway', 'loki', 'grafana'];

for (const name of requiredSecrets) assertFile(join(stagingRoot, '.secrets', name), 8);
for (const name of requiredTls) assertFile(join(stagingRoot, '.runtime', 'tls', name), 64);

run('openssl', ['verify', '-CAfile', '.runtime/tls/ca.crt', '.runtime/tls/gateway.crt']);
run('openssl', ['verify', '-CAfile', '.runtime/tls/ca.crt', '.runtime/tls/postgres.crt']);
run('openssl', ['x509', '-checkend', '604800', '-noout', '-in', '.runtime/tls/gateway.crt']);
run('openssl', ['x509', '-checkend', '604800', '-noout', '-in', '.runtime/tls/postgres.crt']);
const gatewayCertificate = new X509Certificate(await readFile(join(stagingRoot, '.runtime', 'tls', 'gateway.crt')));
const postgresCertificate = new X509Certificate(await readFile(join(stagingRoot, '.runtime', 'tls', 'postgres.crt')));
const certificateMetrics = join(stagingRoot, '.runtime', 'metrics');
await mkdir(certificateMetrics, { recursive: true, mode: 0o700 });
await writeFile(join(certificateMetrics, 'finance_agent_tls.prom'), [
  '# HELP finance_agent_tls_certificate_not_after_timestamp_seconds TLS certificate expiry by fixed service.',
  '# TYPE finance_agent_tls_certificate_not_after_timestamp_seconds gauge',
  `finance_agent_tls_certificate_not_after_timestamp_seconds{service="gateway"} ${certificateExpiry(gatewayCertificate)}`,
  `finance_agent_tls_certificate_not_after_timestamp_seconds{service="postgres"} ${certificateExpiry(postgresCertificate)}`,
  ''
].join('\n'), { mode: 0o600 });

const composeResult = run('docker', ['compose', '--env-file', '.env', '-f', 'compose.yaml', 'config', '--format', 'json']);
const compose = JSON.parse(composeResult.stdout);
const services = compose.services ?? {};
const sourceEnvironmentId = services.backup?.environment?.BACKUP_SOURCE_ENVIRONMENT_ID ?? '';
const imageIdentityPolicy = services.backup?.environment?.IMAGE_IDENTITY_POLICY ?? '';
const backupEnvironment = services.backup?.environment ?? {};
const backupTmpfs = services.backup?.tmpfs ?? [];
if (!['local_identity', 'signed_registry'].includes(imageIdentityPolicy)) {
  throw new Error('IMAGE_IDENTITY_POLICY must be local_identity or signed_registry');
}
if (imageIdentityPolicy === 'local_identity' && !sourceEnvironmentId.endsWith('-local')) {
  throw new Error('local_identity requires BACKUP_SOURCE_ENVIRONMENT_ID ending with -local');
}
if (
  backupEnvironment.HOME !== '/tmp/backup-home'
  || backupEnvironment.MC_CONFIG_DIR !== '/tmp/backup-home/.mc'
  || !backupTmpfs.includes('/tmp:size=32m,mode=1770,uid=999,gid=999')
) {
  throw new Error('Backup client credentials must use the UID 999 private tmpfs home');
}
for (const [name, service] of Object.entries(services)) {
  const image = service.image;
  if (typeof image !== 'string' || !/[:@]/.test(image) || /(^|:)latest(?:@|$)/i.test(image)) {
    throw new Error(`Service ${name} does not use a fixed image reference`);
  }
  if (name !== 'gateway' && Array.isArray(service.ports) && service.ports.length > 0) {
    throw new Error(`Only gateway may publish host ports, but ${name} publishes ports`);
  }
}
for (const [name, prefix] of Object.entries(expectedCustomImages)) {
  if (!String(services[name]?.image ?? '').startsWith(prefix)) {
    throw new Error(`Service ${name} must use the repository-built ${prefix} image`);
  }
}
for (const name of digestPinnedRuntimeServices) {
  assertDigestReference(services[name]?.image, `Service ${name}`);
}
for (const [name, service] of Object.entries(services)) {
  for (const [argument, value] of Object.entries(service.build?.args ?? {})) {
    if (argument.endsWith('_IMAGE')) assertDigestReference(value, `${name} build argument ${argument}`);
  }
}
for (const name of ['backend-api', 'worker']) {
  const service = services[name];
  if (!service?.read_only || !service.cap_drop?.includes('ALL')) {
    throw new Error(`${name} must be read-only and drop all Linux capabilities`);
  }
}
for (const name of ['postgres', 'redis', 'clamav', 'minio']) {
  if (services[name]?.ports?.length) throw new Error(`${name} must remain private`);
}
if (services.frontend?.build?.args?.VITE_APP_DATA_MODE !== 'api' || services.frontend?.build?.args?.VITE_API_BASE_URL !== '/api') {
  throw new Error('Staging frontend build must explicitly use API mode and the same-origin /api base');
}
const postgresCommand = String(services.postgres?.command ?? '');
if (!postgresCommand.includes('ssl=on')) {
  throw new Error('PostgreSQL TLS is not enabled in the rendered Compose config');
}
if (!postgresCommand.includes('listen_addresses=*')) {
  throw new Error('PostgreSQL must listen on the private Compose network');
}
const postgresHealthcheck = JSON.stringify(services.postgres?.healthcheck?.test ?? []);
for (const requirement of [
  'sslmode=verify-full',
  '/run/secrets/migration_password',
  'user=finance_migrator',
]) {
  if (!postgresHealthcheck.includes(requirement)) {
    throw new Error(`PostgreSQL healthcheck is missing remote TLS requirement: ${requirement}`);
  }
}

const tracked = run('git', ['ls-files', '--', 'deploy/staging/.secrets', 'deploy/staging/.runtime'], { cwd: resolve(stagingRoot, '../..') });
if (tracked.stdout.trim()) throw new Error('Generated staging secrets or TLS material are tracked by Git');

const imageReferences = Object.fromEntries(
  Object.entries(services).map(([name, service]) => [name, service.image]).sort(([left], [right]) => left.localeCompare(right))
);
const evidence = {
  status: 'passed',
  checkedAt: new Date().toISOString(),
  composeSha256: sha256(await readFile(join(stagingRoot, 'compose.yaml'))),
  serviceCount: Object.keys(services).length,
  imageReferences,
  checks: {
    secretsPresent: requiredSecrets.length,
    certificatesVerified: true,
    fixedImageTags: true,
    immutableThirdPartyImages: true,
    expectedRepositoryBuiltImages: true,
    onlyTlsGatewayPublished: true,
    databaseTlsEnabled: true,
    backupClientConfigEphemeral: true,
    hardenedApplicationContainers: true,
    frontendApiModeExplicit: true,
    imageIdentityPolicy,
    generatedMaterialUntracked: true
  }
};
const evidenceRoot = join(stagingRoot, '.evidence');
await mkdir(evidenceRoot, { recursive: true });
await writeFile(join(evidenceRoot, 'config-verification.json'), JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');

function assertFile(path, minimumBytes) {
  if (!existsSync(path)) throw new Error(`Required generated file is missing: ${path}`);
  if (statSync(path).size < minimumBytes) throw new Error(`Generated file is empty: ${path}`);
}

function assertDigestReference(reference, label) {
  if (typeof reference !== 'string' || !/@sha256:[a-f0-9]{64}$/i.test(reference)) {
    throw new Error(`${label} must use an immutable sha256 image reference`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? stagingRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  }
  return result;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function certificateExpiry(certificate) {
  const epochSeconds = Math.floor(Date.parse(certificate.validTo) / 1_000);
  if (!Number.isSafeInteger(epochSeconds) || epochSeconds <= Math.floor(Date.now() / 1_000)) {
    throw new Error('Generated TLS certificate expiry is invalid');
  }
  return epochSeconds;
}
