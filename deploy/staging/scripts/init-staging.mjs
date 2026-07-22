import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseEnvironmentSource, resolveDeploymentEnvironment } from './deployment-environment.mjs';
import { synchronizeManagedEnvironment } from './managed-environment.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const secretsRoot = join(stagingRoot, '.secrets');
const tlsRoot = join(stagingRoot, '.runtime', 'tls');

await mkdir(secretsRoot, { recursive: true, mode: 0o700 });
await mkdir(tlsRoot, { recursive: true, mode: 0o700 });

const environmentPath = join(stagingRoot, '.env');
const environmentTemplatePath = join(stagingRoot, '.env.example');
let environmentCreated = false;
let environmentManagedKeysUpdated = [];
if (!existsSync(environmentPath)) {
  await copyFile(environmentTemplatePath, environmentPath);
  environmentCreated = true;
} else {
  const synchronized = synchronizeManagedEnvironment(
    await readFile(environmentPath, 'utf8'),
    await readFile(environmentTemplatePath, 'utf8'),
  );
  environmentManagedKeysUpdated = synchronized.updatedKeys;
  if (environmentManagedKeysUpdated.length > 0) {
    await writeFile(environmentPath, synchronized.content, { encoding: 'utf8' });
  }
}
const settings = resolveDeploymentEnvironment({
  ...parseEnvironmentSource(await readFile(environmentPath, 'utf8'), 'staging environment'),
  ...process.env,
});

const hex = (bytes = 48) => randomBytes(bytes).toString('hex');
const secrets = {
  postgres_superuser_password: hex(),
  migration_password: hex(),
  runtime_password: hex(),
  backup_password: hex(),
  restore_password: hex(),
  jwt_secret: hex(64),
  redis_password: hex(),
  minio_root_user: `staging-root-${hex(6)}`,
  minio_root_password: hex(48),
  s3_access_key_id: `finance-runtime-${hex(6)}`,
  s3_secret_access_key: hex(48),
  metrics_token: hex(48),
  grafana_admin_password: hex(32),
  staging_seed_password: hex(32)
};

let secretFilesCreated = 0;
for (const [name, proposed] of Object.entries(secrets)) {
  const path = join(secretsRoot, name);
  if (!existsSync(path)) {
    await writeFile(path, `${proposed}\n`, { mode: 0o600, flag: 'wx' });
    secretFilesCreated += 1;
  }
}

const readSecret = async (name) => (await readFile(join(secretsRoot, name), 'utf8')).trim();
const migrationPassword = await readSecret('migration_password');
const runtimePassword = await readSecret('runtime_password');
const backupPassword = await readSecret('backup_password');
const restorePassword = await readSecret('restore_password');
const redisPassword = await readSecret('redis_password');
const query = 'sslmode=verify-full&sslrootcert=%2Frun%2Ftls%2Fca.crt';
secretFilesCreated += Number(await writeIfMissing(
  join(secretsRoot, 'migration_database_url'),
  `postgresql://finance_migrator:${migrationPassword}@postgres:5432/finance_agent_staging?${query}\n`
));
secretFilesCreated += Number(await writeIfMissing(
  join(secretsRoot, 'runtime_database_url'),
  `postgresql://finance_runtime:${runtimePassword}@postgres:5432/finance_agent_staging?${query}\n`
));
secretFilesCreated += Number(await writeIfMissing(
  join(secretsRoot, 'backup_database_url'),
  `postgresql://finance_backup:${backupPassword}@postgres:5432/finance_agent_staging?${query}\n`
));
secretFilesCreated += Number(await writeIfMissing(
  join(secretsRoot, 'restore_database_url'),
  `postgresql://finance_restore:${restorePassword}@postgres:5432/postgres?${query}\n`
));
secretFilesCreated += Number(await writeIfMissing(
  join(secretsRoot, 'redis_url'),
  `redis://:${redisPassword}@redis:6379/0\n`,
));

const tlsFiles = ['ca.crt', 'ca.key', 'gateway.crt', 'gateway.key', 'postgres.crt', 'postgres.key'];
const tlsFilesBefore = new Set(tlsFiles.filter((name) => existsSync(join(tlsRoot, name))));
if (settings.certificateMode === 'local_ca') {
  ensureCertificates(settings);
} else {
  for (const name of ['ca.crt', 'gateway.crt', 'gateway.key', 'postgres.crt', 'postgres.key']) {
    if (!existsSync(join(tlsRoot, name))) {
      throw new Error(`Provided certificate mode requires an operator-provisioned .runtime/tls/${name}`);
    }
  }
}
const tlsFilesCreated = tlsFiles.filter((name) => !tlsFilesBefore.has(name) && existsSync(join(tlsRoot, name))).length;

await writeFile(join(stagingRoot, '.runtime', 'initialization.json'), JSON.stringify({
  schemaVersion: 1,
  initializedAt: new Date().toISOString(),
  deploymentProfile: settings.profile,
  certificateMode: settings.certificateMode,
  generatedFiles: [
    ...Object.keys(secrets).map((name) => `.secrets/${name}`),
    '.secrets/migration_database_url',
    '.secrets/runtime_database_url',
    '.secrets/backup_database_url',
    '.secrets/restore_database_url',
    '.secrets/redis_url',
    '.runtime/tls/ca.crt',
    '.runtime/tls/gateway.crt',
    '.runtime/tls/postgres.crt'
  ]
}, null, 2) + '\n', { mode: 0o600 });

process.stdout.write(JSON.stringify({
  status: 'ok',
  stagingRoot,
  environmentCreated,
  environmentManagedKeysUpdated,
  secretsCreated: secretFilesCreated > 0,
  secretFilesCreated,
  tlsCreated: tlsFilesCreated > 0,
  tlsFilesCreated,
  next: `Resolve ${settings.appDomain} and ${settings.objectDomain} to ${settings.gatewayProbeAddress}, then run verify-config.mjs.`
}, null, 2) + '\n');

async function writeIfMissing(path, value) {
  if (existsSync(path)) return false;
  await writeFile(path, value, { mode: 0o600, flag: 'wx' });
  return true;
}

function ensureCertificates(deployment) {
  const caKey = join(tlsRoot, 'ca.key');
  const caCert = join(tlsRoot, 'ca.crt');
  const opensslConfig = join(tlsRoot, 'openssl.cnf');
  if (!existsSync(opensslConfig)) {
    writeRuntimeFile(opensslConfig, [
      'openssl_conf = openssl_init',
      '[openssl_init]',
      'providers = provider_sect',
      '[provider_sect]',
      'default = default_sect',
      '[default_sect]',
      'activate = 1',
      '[req]',
      'distinguished_name = req_distinguished_name',
      '[req_distinguished_name]',
      ''
    ].join('\n'));
  }
  if (!existsSync(caKey) || !existsSync(caCert)) {
    runOpenSsl([
      'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '365',
      '-subj', '/CN=FINANCE-AGENT Staging CA',
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
      '-keyout', caKey, '-out', caCert
    ]);
  }
  if (!existsSync(join(tlsRoot, 'gateway.crt')) || !existsSync(join(tlsRoot, 'gateway.key'))) {
    const probeName = isIP(deployment.gatewayProbeAddress) > 0
      ? `IP:${deployment.gatewayProbeAddress}`
      : `DNS:${deployment.gatewayProbeAddress}`;
    createLeaf('gateway', `/CN=${deployment.appDomain}`, [...new Set([
      `DNS:${deployment.appDomain}`,
      `DNS:${deployment.objectDomain}`,
      'DNS:localhost',
      'IP:127.0.0.1',
      probeName,
    ])], caKey, caCert);
  }
  if (!existsSync(join(tlsRoot, 'postgres.crt')) || !existsSync(join(tlsRoot, 'postgres.key'))) {
    createLeaf('postgres', '/CN=postgres', ['DNS:postgres'], caKey, caCert);
  }
}

function createLeaf(name, subject, names, caKey, caCert) {
  const key = join(tlsRoot, `${name}.key`);
  const csr = join(tlsRoot, `${name}.csr`);
  const cert = join(tlsRoot, `${name}.crt`);
  const extension = join(tlsRoot, `${name}.ext`);
  const extensionBody = [
    `subjectAltName=${names.join(',')}`,
    'extendedKeyUsage=serverAuth',
    'keyUsage=digitalSignature,keyEncipherment'
  ].join('\n');
  writeRuntimeFile(extension, `${extensionBody}\n`);
  runOpenSsl(['req', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-subj', subject, '-keyout', key, '-out', csr]);
  runOpenSsl([
    'x509', '-req', '-sha256', '-days', '90', '-in', csr, '-CA', caCert, '-CAkey', caKey,
    '-CAcreateserial', '-extfile', extension, '-out', cert
  ]);
}

function writeRuntimeFile(path, value) {
  writeFileSync(path, value, { mode: 0o600 });
}

function runOpenSsl(args) {
  const result = spawnSync('openssl', args, {
    cwd: tlsRoot,
    env: { ...process.env, OPENSSL_CONF: join(tlsRoot, 'openssl.cnf') },
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error(`OpenSSL failed: ${String(result.stderr).trim()}`);
}
