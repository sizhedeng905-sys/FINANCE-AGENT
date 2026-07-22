import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const TARGET_PREFLIGHT_SCHEMA = 'staging-target-preflight/1.0';

export class TargetPreflightError extends Error {
  constructor(code, status = 'failed') {
    super(code);
    this.name = 'TargetPreflightError';
    this.code = code;
    this.status = status;
  }
}

export async function runTargetPreflight({ settings, environment, targetProfile, adapter, now = () => new Date() }) {
  let config;
  try {
    config = resolvePreflightConfiguration(settings, environment);
  } catch (error) {
    return report({
      now,
      targetProfile,
      checks: [failedCheck('configuration', error)],
      config: null,
    });
  }

  const checks = [];
  const host = await execute('host_resources', async () => {
    const value = await adapter.hostResources();
    requireCondition(value.platform === 'linux', 'TARGET_LINUX_REQUIRED');
    requireCondition(Number.isInteger(value.cpuCount) && value.cpuCount >= config.minCpuCount, 'TARGET_CPU_BELOW_MINIMUM');
    requireCondition(value.totalMemoryBytes >= config.minMemoryBytes, 'TARGET_MEMORY_BELOW_MINIMUM');
    requireCondition(value.availableDiskBytes >= config.minDiskBytes, 'TARGET_DISK_BELOW_MINIMUM');
    return {
      platform: value.platform,
      architecture: safeToken(value.architecture),
      cpuCount: value.cpuCount,
      totalMemoryBytes: value.totalMemoryBytes,
      availableDiskBytes: value.availableDiskBytes,
      minimums: {
        cpuCount: config.minCpuCount,
        memoryBytes: config.minMemoryBytes,
        diskBytes: config.minDiskBytes,
      },
    };
  });
  checks.push(host);
  checks.push(await execute('docker_server', async () => ({ version: safeVersion(await adapter.dockerVersion()) })));
  checks.push(await execute('docker_compose', async () => ({ version: safeVersion(await adapter.composeVersion()) })));
  checks.push(await execute('clock_sync', async () => {
    const value = await adapter.clockStatus();
    requireCondition(value.synchronized === true, 'TARGET_CLOCK_NOT_SYNCHRONIZED');
    return { synchronized: true, sourceClass: safeToken(value.sourceClass ?? 'system') };
  }));

  for (const [id, hostname] of [
    ['dns_application', settings.appDomain],
    ['dns_objects', settings.objectDomain],
  ]) {
    checks.push(await execute(id, async () => {
      const answers = await adapter.dns(hostname);
      requireCondition(Array.isArray(answers) && answers.length > 0, 'TARGET_DNS_NO_ANSWERS');
      const canonicalAnswers = answers.map((entry) => `${entry.family}:${entry.address}`).sort();
      return { answerCount: answers.length, answersSha256: sha256(canonicalAnswers.join('|')) };
    }));
  }

  for (const [id, hostname, port] of [
    ['port_application', settings.appDomain, settings.webPort],
    ['port_objects', settings.objectDomain, settings.objectPort],
  ]) {
    checks.push(await execute(id, async () => {
      const value = await adapter.tcp(hostname, port, config.timeoutMs);
      requireCondition(value.connected === true, 'TARGET_TCP_UNREACHABLE');
      return { connected: true, port };
    }));
  }

  for (const [id, hostname, port] of [
    ['tls_application', settings.appDomain, settings.webPort],
    ['tls_objects', settings.objectDomain, settings.objectPort],
  ]) {
    checks.push(await execute(id, async () => tlsEvidence(
      await adapter.tls(hostname, port, config.timeoutMs),
      config.minimumTlsValidDays,
      now(),
    )));
  }

  checks.push(await execute('registry_v2', async () => {
    const value = await adapter.registry(config.registryHost, config.timeoutMs);
    requireCondition([200, 401].includes(value.statusCode), 'TARGET_REGISTRY_V2_UNAVAILABLE');
    return { statusCode: value.statusCode, registryHostSha256: sha256(config.registryHost) };
  }));
  checks.push(await execute('postgres_tls', async () => {
    const value = await adapter.postgresTls(
      config.postgresHost,
      config.postgresPort,
      config.postgresServerName,
      config.timeoutMs,
    );
    requireCondition(value.tls === true, 'TARGET_POSTGRES_TLS_REQUIRED');
    return { tls: true, protocol: safeToken(value.protocol) };
  }));
  checks.push(await execute('redis_auth_ping', async () => {
    const value = await adapter.redisPing(
      config.redisHost,
      config.redisPort,
      config.redisUsername,
      config.timeoutMs,
    );
    requireCondition(value.authenticated === true && value.pong === true, 'TARGET_REDIS_AUTH_PING_FAILED');
    return { authenticated: true, pong: true };
  }));
  checks.push(await execute('s3_health', async () => httpEvidence(
    await adapter.http(config.s3HealthUrl, config.timeoutMs),
    'TARGET_S3_HEALTH_FAILED',
  )));
  checks.push(await execute('clamav_ping', async () => {
    const value = await adapter.clamavPing(config.clamavHost, config.clamavPort, config.timeoutMs);
    requireCondition(value.pong === true, 'TARGET_CLAMAV_PING_FAILED');
    return { pong: true };
  }));
  checks.push(await execute('backup_target_health', async () => ({
    ...httpEvidence(await adapter.http(config.backupHealthUrl, config.timeoutMs), 'TARGET_BACKUP_HEALTH_FAILED'),
    destinationIdSha256: sha256(config.backupDestinationId),
  })));
  checks.push(await execute('alert_route_health', async () => ({
    ...httpEvidence(await adapter.http(config.alertHealthUrl, config.timeoutMs), 'TARGET_ALERT_HEALTH_FAILED'),
    routeIdSha256: sha256(config.alertRouteId),
  })));

  return report({ now, targetProfile, checks, config });
}

export function renderTargetPreflightMarkdown(value) {
  const lines = [
    '# FINANCE-AGENT Target Preflight Evidence',
    '',
    `- Schema: \`${value.schemaVersion}\``,
    `- Status: \`${value.status}\``,
    `- Checked at: \`${value.checkedAt}\``,
    `- Passed: ${value.summary.passed}`,
    `- Failed: ${value.summary.failed}`,
    `- Blocked external: ${value.summary.blockedExternal}`,
    '',
    '| Check | Status | Code |',
    '| --- | --- | --- |',
    ...value.checks.map((check) => `| \`${check.id}\` | \`${check.status}\` | \`${check.code}\` |`),
    '',
    'This evidence is anonymized and read-only. It does not authorize deployment, restore, production data, or UAT.',
    '',
  ];
  return lines.join('\n');
}

export function blockedTargetPreflight(errorCode, checkedAt = new Date()) {
  return report({
    now: () => checkedAt,
    targetProfile: null,
    checks: [{ id: 'target_profile', status: 'blocked_external', code: safeCode(errorCode), evidence: {} }],
    config: null,
  });
}

function resolvePreflightConfiguration(settings, environment) {
  const required = (key) => {
    const value = String(environment[key] ?? '').trim();
    if (!value) throw new TargetPreflightError(`MISSING_${key}`, 'blocked_external');
    if (/(?:^|[-_.])(required|replace|todo|tbd|changeme|placeholder|example)(?:$|[-_.])/i.test(value)) {
      throw new TargetPreflightError(`PLACEHOLDER_${key}`, 'blocked_external');
    }
    return value;
  };
  const registryHost = settings.registryPrefix.split('/')[0];
  return {
    minCpuCount: integer(environment.STAGING_TARGET_MIN_CPU_COUNT ?? '4', 1, 1_024, 'STAGING_TARGET_MIN_CPU_COUNT'),
    minMemoryBytes: gibibytes(environment.STAGING_TARGET_MIN_MEMORY_GIB ?? '12', 'STAGING_TARGET_MIN_MEMORY_GIB'),
    minDiskBytes: gibibytes(environment.STAGING_TARGET_MIN_DISK_GIB ?? '48', 'STAGING_TARGET_MIN_DISK_GIB'),
    minimumTlsValidDays: integer(environment.STAGING_TARGET_TLS_MIN_VALID_DAYS ?? '14', 1, 365, 'STAGING_TARGET_TLS_MIN_VALID_DAYS'),
    timeoutMs: integer(environment.STAGING_TARGET_PROBE_TIMEOUT_MS ?? '5000', 500, 30_000, 'STAGING_TARGET_PROBE_TIMEOUT_MS'),
    registryHost,
    postgresHost: endpointHost(required('STAGING_TARGET_POSTGRES_HOST'), 'STAGING_TARGET_POSTGRES_HOST'),
    postgresPort: integer(required('STAGING_TARGET_POSTGRES_PORT'), 1, 65_535, 'STAGING_TARGET_POSTGRES_PORT'),
    postgresServerName: endpointHost(required('STAGING_TARGET_POSTGRES_SERVER_NAME'), 'STAGING_TARGET_POSTGRES_SERVER_NAME'),
    redisHost: endpointHost(required('STAGING_TARGET_REDIS_HOST'), 'STAGING_TARGET_REDIS_HOST'),
    redisPort: integer(required('STAGING_TARGET_REDIS_PORT'), 1, 65_535, 'STAGING_TARGET_REDIS_PORT'),
    redisUsername: optionalIdentifier(environment.STAGING_TARGET_REDIS_USERNAME),
    s3HealthUrl: healthUrl(required('STAGING_TARGET_S3_HEALTH_URL'), 'STAGING_TARGET_S3_HEALTH_URL'),
    clamavHost: endpointHost(required('STAGING_TARGET_CLAMAV_HOST'), 'STAGING_TARGET_CLAMAV_HOST'),
    clamavPort: integer(required('STAGING_TARGET_CLAMAV_PORT'), 1, 65_535, 'STAGING_TARGET_CLAMAV_PORT'),
    backupDestinationId: identifier(required('STAGING_TARGET_BACKUP_DESTINATION_ID'), 'STAGING_TARGET_BACKUP_DESTINATION_ID'),
    backupHealthUrl: healthUrl(required('STAGING_TARGET_BACKUP_HEALTH_URL'), 'STAGING_TARGET_BACKUP_HEALTH_URL'),
    alertRouteId: identifier(required('STAGING_TARGET_ALERT_ROUTE_ID'), 'STAGING_TARGET_ALERT_ROUTE_ID'),
    alertHealthUrl: healthUrl(required('STAGING_TARGET_ALERT_HEALTH_URL'), 'STAGING_TARGET_ALERT_HEALTH_URL'),
  };
}

async function execute(id, operation) {
  const started = performance.now();
  try {
    const evidence = await operation();
    return { id, status: 'passed', code: 'PASS', durationMs: elapsed(started), evidence };
  } catch (error) {
    return {
      id,
      status: error instanceof TargetPreflightError ? error.status : 'failed',
      code: safeCode(error instanceof TargetPreflightError ? error.code : 'TARGET_PROBE_FAILED'),
      durationMs: elapsed(started),
      evidence: {},
    };
  }
}

function failedCheck(id, error) {
  return {
    id,
    status: error instanceof TargetPreflightError ? error.status : 'failed',
    code: safeCode(error instanceof TargetPreflightError ? error.code : 'TARGET_PREFLIGHT_CONFIGURATION_FAILED'),
    durationMs: 0,
    evidence: {},
  };
}

function report({ now, targetProfile, checks, config }) {
  const failed = checks.filter((check) => check.status === 'failed').length;
  const blockedExternal = checks.filter((check) => check.status === 'blocked_external').length;
  const passed = checks.filter((check) => check.status === 'passed').length;
  return Object.freeze({
    schemaVersion: TARGET_PREFLIGHT_SCHEMA,
    status: failed > 0 ? 'failed' : blockedExternal > 0 ? 'blocked_external' : 'passed',
    checkedAt: now().toISOString(),
    targetProfileSha256: targetProfile ? sha256(JSON.stringify(targetProfile)) : null,
    configurationSha256: config ? sha256(canonicalConfiguration(config)) : null,
    summary: { passed, failed, blockedExternal, total: checks.length },
    checks,
  });
}

function canonicalConfiguration(config) {
  return JSON.stringify(Object.fromEntries(Object.entries(config).sort(([left], [right]) => left.localeCompare(right))));
}

function tlsEvidence(value, minimumDays, currentTime) {
  requireCondition(value.authorized === true, 'TARGET_TLS_NOT_AUTHORIZED');
  const expiry = Date.parse(value.validTo);
  requireCondition(Number.isFinite(expiry), 'TARGET_TLS_EXPIRY_INVALID');
  const validDaysRemaining = Math.floor((expiry - currentTime.getTime()) / 86_400_000);
  requireCondition(validDaysRemaining >= minimumDays, 'TARGET_TLS_EXPIRING_SOON');
  return {
    authorized: true,
    protocol: safeToken(value.protocol),
    validDaysRemaining,
    certificateFingerprintSha256: sha256(String(value.fingerprint ?? '')),
  };
}

function httpEvidence(value, errorCode) {
  requireCondition([200, 204, 401, 403].includes(value.statusCode), errorCode);
  return { statusCode: value.statusCode };
}

function healthUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TargetPreflightError(`INVALID_${name}`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TargetPreflightError(`INVALID_${name}`);
  }
  return parsed.toString();
}

function endpointHost(value, name) {
  if (isIP(value) > 0) return value;
  if (value.length > 253 || !value.split('.').every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) {
    throw new TargetPreflightError(`INVALID_${name}`);
  }
  return value.toLowerCase();
}

function optionalIdentifier(value) {
  if (value === undefined || String(value).trim() === '') return null;
  return identifier(String(value).trim(), 'STAGING_TARGET_REDIS_USERNAME');
}

function identifier(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\/-]{2,127}$/.test(value)) throw new TargetPreflightError(`INVALID_${name}`);
  return value;
}

function integer(value, minimum, maximum, name) {
  const source = String(value);
  if (!/^\d+$/.test(source)) throw new TargetPreflightError(`INVALID_${name}`);
  const result = Number(source);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new TargetPreflightError(`INVALID_${name}`);
  }
  return result;
}

function gibibytes(value, name) {
  return integer(value, 1, 1_048_576, name) * 1_073_741_824;
}

function requireCondition(condition, code) {
  if (!condition) throw new TargetPreflightError(code);
}

function safeVersion(value) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/.test(result)) throw new TargetPreflightError('TARGET_VERSION_OUTPUT_INVALID');
  return result;
}

function safeToken(value) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,63}$/.test(result)) throw new TargetPreflightError('TARGET_PROBE_TOKEN_INVALID');
  return result;
}

function safeCode(value) {
  return /^[A-Z][A-Z0-9_]{1,127}$/.test(String(value)) ? String(value) : 'TARGET_PREFLIGHT_ERROR';
}

function elapsed(started) {
  return Math.max(0, Math.round(performance.now() - started));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
