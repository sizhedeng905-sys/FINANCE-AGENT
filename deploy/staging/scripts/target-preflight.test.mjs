import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blockedTargetPreflight,
  renderTargetPreflightMarkdown,
  runTargetPreflight,
  TargetPreflightError,
} from './target-preflight.mjs';

const now = () => new Date('2026-07-22T00:00:00.000Z');
const settings = {
  appDomain: 'finance-staging.corp.internal',
  objectDomain: 'finance-objects.corp.internal',
  webPort: 443,
  objectPort: 9443,
  registryPrefix: 'registry.corp.internal/finance/agent',
};
const environment = {
  STAGING_TARGET_POSTGRES_HOST: 'postgres.corp.internal',
  STAGING_TARGET_POSTGRES_PORT: '5432',
  STAGING_TARGET_POSTGRES_SERVER_NAME: 'postgres.corp.internal',
  STAGING_TARGET_REDIS_HOST: 'redis.corp.internal',
  STAGING_TARGET_REDIS_PORT: '6379',
  STAGING_TARGET_S3_HEALTH_URL: 'https://objects.corp.internal/minio/health/ready',
  STAGING_TARGET_CLAMAV_HOST: 'clamav.corp.internal',
  STAGING_TARGET_CLAMAV_PORT: '3310',
  STAGING_TARGET_BACKUP_DESTINATION_ID: 'offsite-backup-cn1',
  STAGING_TARGET_BACKUP_HEALTH_URL: 'https://backup.corp.internal/health',
  STAGING_TARGET_ALERT_ROUTE_ID: 'finance-alert-route-cn1',
  STAGING_TARGET_ALERT_HEALTH_URL: 'https://alerts.corp.internal/-/ready',
};
const targetProfile = { schemaVersion: 'staging-target-profile/1.0', status: 'passed' };

test('produces a 17-check anonymized pass report from a read-only adapter', async () => {
  const result = await runTargetPreflight({
    settings,
    environment,
    targetProfile,
    adapter: passingAdapter(),
    now,
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(result.summary, { passed: 17, failed: 0, blockedExternal: 0, total: 17 });
  assert.equal(new Set(result.checks.map((check) => check.id)).size, 17);
  const serialized = JSON.stringify(result);
  for (const sensitiveTopology of [
    settings.appDomain,
    environment.STAGING_TARGET_POSTGRES_HOST,
    environment.STAGING_TARGET_S3_HEALTH_URL,
    environment.STAGING_TARGET_BACKUP_DESTINATION_ID,
    environment.STAGING_TARGET_ALERT_ROUTE_ID,
  ]) {
    assert.equal(serialized.includes(sensitiveTopology), false);
  }
  assert.match(result.configurationSha256, /^[a-f0-9]{64}$/);
});

test('returns blocked_external without running probes when required target configuration is absent', async () => {
  let calls = 0;
  const adapter = new Proxy({}, { get: () => () => { calls += 1; } });
  const incomplete = { ...environment };
  delete incomplete.STAGING_TARGET_POSTGRES_HOST;

  const result = await runTargetPreflight({ settings, environment: incomplete, targetProfile, adapter, now });

  assert.equal(result.status, 'blocked_external');
  assert.equal(result.checks[0].code, 'MISSING_STAGING_TARGET_POSTGRES_HOST');
  assert.equal(calls, 0);
});

test('accepts exact CPU, memory, disk, and TLS validity boundaries', async () => {
  const adapter = passingAdapter();
  adapter.hostResources = async () => ({
    platform: 'linux',
    architecture: 'x64',
    cpuCount: 4,
    totalMemoryBytes: 12 * 2 ** 30,
    availableDiskBytes: 48 * 2 ** 30,
  });
  adapter.tls = async () => ({
    authorized: true,
    protocol: 'TLSv1.3',
    validTo: '2026-08-05T00:00:00.000Z',
    fingerprint: 'boundary-fingerprint',
  });

  const result = await runTargetPreflight({ settings, environment, targetProfile, adapter, now });

  assert.equal(result.status, 'passed');
  assert.equal(result.checks.find((check) => check.id === 'tls_application').evidence.validDaysRemaining, 14);
});

test('fails resource and expiring TLS boundaries without exposing probe errors', async () => {
  const adapter = passingAdapter();
  adapter.hostResources = async () => ({
    platform: 'linux', architecture: 'x64', cpuCount: 3, totalMemoryBytes: 16 * 2 ** 30, availableDiskBytes: 80 * 2 ** 30,
  });
  adapter.tls = async () => ({
    authorized: true,
    protocol: 'TLSv1.3',
    validTo: '2026-07-25T00:00:00.000Z',
    fingerprint: 'private-certificate-fingerprint',
  });

  const result = await runTargetPreflight({ settings, environment, targetProfile, adapter, now });

  assert.equal(result.status, 'failed');
  assert.equal(result.checks.find((check) => check.id === 'host_resources').code, 'TARGET_CPU_BELOW_MINIMUM');
  assert.equal(result.checks.filter((check) => check.code === 'TARGET_TLS_EXPIRING_SOON').length, 2);
  assert.equal(JSON.stringify(result).includes('private-certificate-fingerprint'), false);
});

test('rejects credentialed health URLs and sanitizes unexpected adapter failures', async () => {
  const invalid = await runTargetPreflight({
    settings,
    environment: { ...environment, STAGING_TARGET_S3_HEALTH_URL: 'https://user:secret@objects.corp.internal/health' },
    targetProfile,
    adapter: passingAdapter(),
    now,
  });
  assert.equal(invalid.status, 'failed');
  assert.equal(invalid.checks[0].code, 'INVALID_STAGING_TARGET_S3_HEALTH_URL');
  assert.equal(JSON.stringify(invalid).includes('secret'), false);

  const adapter = passingAdapter();
  adapter.registry = async () => { throw new Error('token=must-not-leak'); };
  const failed = await runTargetPreflight({ settings, environment, targetProfile, adapter, now });
  const registry = failed.checks.find((check) => check.id === 'registry_v2');
  assert.equal(registry.code, 'TARGET_PROBE_FAILED');
  assert.equal(JSON.stringify(failed).includes('must-not-leak'), false);
});

test('renders anonymous Markdown and stable blocked target-profile evidence', () => {
  const result = blockedTargetPreflight('TARGET_PROFILE_REQUIRED', now());
  const markdown = renderTargetPreflightMarkdown(result);

  assert.equal(result.status, 'blocked_external');
  assert.match(markdown, /TARGET_PROFILE_REQUIRED/);
  assert.match(markdown, /does not authorize deployment/);
  assert.equal(markdown.includes('finance-staging.corp.internal'), false);
});

function passingAdapter() {
  return {
    hostResources: async () => ({
      platform: 'linux', architecture: 'x64', cpuCount: 8, totalMemoryBytes: 32 * 2 ** 30, availableDiskBytes: 100 * 2 ** 30,
    }),
    dockerVersion: async () => '28.3.2',
    composeVersion: async () => '2.39.1',
    clockStatus: async () => ({ synchronized: true, sourceClass: 'systemd-timesync' }),
    dns: async (hostname) => [{ family: 4, address: hostname.startsWith('finance') ? '192.0.2.10' : '192.0.2.20' }],
    tcp: async () => ({ connected: true }),
    tls: async () => ({
      authorized: true,
      protocol: 'TLSv1.3',
      validTo: '2026-10-22T00:00:00.000Z',
      fingerprint: 'synthetic-fingerprint',
    }),
    registry: async () => ({ statusCode: 401 }),
    postgresTls: async () => ({ tls: true, protocol: 'TLSv1.3' }),
    redisPing: async () => ({ authenticated: true, pong: true }),
    http: async () => ({ statusCode: 200 }),
    clamavPing: async () => ({ pong: true }),
  };
}
