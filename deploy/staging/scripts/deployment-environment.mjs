import { isIP } from 'node:net';

export const LOCAL_DEMO_DEPLOYMENT_DEFAULTS = Object.freeze({
  STAGING_DEPLOYMENT_PROFILE: 'local_demo',
  STAGING_APP_DOMAIN: 'staging.finance-agent.local',
  STAGING_OBJECT_DOMAIN: 'objects.finance-agent.local',
  STAGING_APP_BASE_URL: 'https://staging.finance-agent.local:8443',
  STAGING_OBJECT_BASE_URL: 'https://objects.finance-agent.local:9443',
  STAGING_CORS_ORIGINS: 'https://staging.finance-agent.local:8443',
  STAGING_TRUSTED_PROXY_CIDRS: '172.31.90.10',
  STAGING_GATEWAY_BIND_ADDRESS: '127.0.0.1',
  STAGING_GATEWAY_PROBE_ADDRESS: '127.0.0.1',
  STAGING_GATEWAY_INTERNAL_IP: '172.31.90.10',
  STAGING_WEB_PORT: '8443',
  STAGING_OBJECT_PORT: '9443',
  STAGING_CERTIFICATE_MODE: 'local_ca',
  STAGING_ENVIRONMENT_ID: 'finance-agent-staging-local',
  STAGING_REGISTRY_PREFIX: 'finance-agent',
  STAGING_SYNTHETIC_SEED_ENABLED: 'true',
});

export function parseEnvironmentSource(source, label = 'environment') {
  if (typeof source !== 'string') throw new TypeError(`${label} must be a string`);
  const values = {};
  for (const [index, rawLine] of source.replace(/\r\n/g, '\n').split('\n').entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    const key = separator > 0 ? line.slice(0, separator).trim() : '';
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid ${label} line ${index + 1}`);
    }
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate ${label} key: ${key}`);
    values[key] = line.slice(separator + 1);
  }
  return values;
}

export function resolveDeploymentEnvironment(environment = {}) {
  const value = (key) => {
    const resolved = environment[key] ?? LOCAL_DEMO_DEPLOYMENT_DEFAULTS[key];
    if (typeof resolved !== 'string' || resolved.trim() === '') {
      throw new Error(`${key} must not be empty`);
    }
    return resolved.trim();
  };

  const profile = enumValue(value('STAGING_DEPLOYMENT_PROFILE'), ['local_demo', 'target'], 'STAGING_DEPLOYMENT_PROFILE');
  const appDomain = hostname(value('STAGING_APP_DOMAIN'), 'STAGING_APP_DOMAIN');
  const objectDomain = hostname(value('STAGING_OBJECT_DOMAIN'), 'STAGING_OBJECT_DOMAIN');
  if (appDomain === objectDomain) throw new Error('STAGING_APP_DOMAIN and STAGING_OBJECT_DOMAIN must differ');

  const webPort = port(value('STAGING_WEB_PORT'), 'STAGING_WEB_PORT');
  const objectPort = port(value('STAGING_OBJECT_PORT'), 'STAGING_OBJECT_PORT');
  if (webPort === objectPort) throw new Error('STAGING_WEB_PORT and STAGING_OBJECT_PORT must differ');

  const appBaseUrl = httpsBaseUrl(value('STAGING_APP_BASE_URL'), appDomain, webPort, 'STAGING_APP_BASE_URL');
  const objectBaseUrl = httpsBaseUrl(
    value('STAGING_OBJECT_BASE_URL'),
    objectDomain,
    objectPort,
    'STAGING_OBJECT_BASE_URL',
  );
  const corsOrigins = commaSeparated(value('STAGING_CORS_ORIGINS'), 'STAGING_CORS_ORIGINS').map((origin) => {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.username || parsed.password) {
      throw new Error('STAGING_CORS_ORIGINS must contain HTTPS origins without paths, credentials, query, or fragment');
    }
    return parsed.origin;
  });
  if (!corsOrigins.includes(appBaseUrl)) {
    throw new Error('STAGING_CORS_ORIGINS must include STAGING_APP_BASE_URL');
  }

  const trustedProxyCidrs = commaSeparated(
    value('STAGING_TRUSTED_PROXY_CIDRS'),
    'STAGING_TRUSTED_PROXY_CIDRS',
  );
  for (const proxy of trustedProxyCidrs) {
    if (!/^[A-Za-z0-9._:[\]\/\-]+$/.test(proxy)) {
      throw new Error('STAGING_TRUSTED_PROXY_CIDRS contains an invalid proxy address or CIDR');
    }
  }

  const gatewayBindAddress = ipAddress(value('STAGING_GATEWAY_BIND_ADDRESS'), 'STAGING_GATEWAY_BIND_ADDRESS');
  const gatewayInternalIp = ipAddress(value('STAGING_GATEWAY_INTERNAL_IP'), 'STAGING_GATEWAY_INTERNAL_IP');
  const gatewayProbeAddress = hostOrIp(value('STAGING_GATEWAY_PROBE_ADDRESS'), 'STAGING_GATEWAY_PROBE_ADDRESS');
  const certificateMode = enumValue(
    value('STAGING_CERTIFICATE_MODE'),
    ['local_ca', 'provided'],
    'STAGING_CERTIFICATE_MODE',
  );
  const environmentId = identifier(value('STAGING_ENVIRONMENT_ID'), 'STAGING_ENVIRONMENT_ID');
  const registryPrefix = registryPrefixValue(value('STAGING_REGISTRY_PREFIX'));
  const syntheticSeedEnabled = booleanValue(
    value('STAGING_SYNTHETIC_SEED_ENABLED'),
    'STAGING_SYNTHETIC_SEED_ENABLED',
  );

  return Object.freeze({
    profile,
    appDomain,
    objectDomain,
    appBaseUrl,
    objectBaseUrl,
    corsOrigins,
    trustedProxyCidrs,
    gatewayBindAddress,
    gatewayProbeAddress,
    gatewayInternalIp,
    webPort,
    objectPort,
    certificateMode,
    environmentId,
    registryPrefix,
    syntheticSeedEnabled,
  });
}

function enumValue(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

function hostname(value, name) {
  const normalized = value.toLowerCase();
  if (
    normalized.length > 253
    || normalized.includes('..')
    || !normalized.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new Error(`${name} must be a plain DNS hostname`);
  }
  return normalized;
}

function port(value, name) {
  if (!/^\d{1,5}$/.test(value)) throw new Error(`${name} must be an integer between 1 and 65535`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > 65_535) throw new Error(`${name} must be an integer between 1 and 65535`);
  return parsed;
}

function httpsBaseUrl(value, expectedHostname, expectedPort, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL`);
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
    || parsed.hostname.toLowerCase() !== expectedHostname
    || effectivePort(parsed) !== expectedPort
  ) {
    throw new Error(`${name} must match its configured domain and port without credentials, path, query, or fragment`);
  }
  return parsed.origin;
}

function effectivePort(url) {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

function commaSeparated(value, name) {
  const values = value.split(',').map((entry) => entry.trim());
  if (values.some((entry) => !entry) || new Set(values).size !== values.length) {
    throw new Error(`${name} must contain unique, non-empty comma-separated values`);
  }
  return values;
}

function ipAddress(value, name) {
  if (isIP(value) === 0) throw new Error(`${name} must be an IP address`);
  return value;
}

function hostOrIp(value, name) {
  return isIP(value) > 0 ? value : hostname(value, name);
}

function identifier(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(value)) {
    throw new Error(`${name} must be a 3-128 character stable identifier`);
  }
  return value;
}

function registryPrefixValue(value) {
  if (
    value.length > 200
    || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(value)
  ) {
    throw new Error('STAGING_REGISTRY_PREFIX must be a lowercase OCI repository prefix without a tag or digest');
  }
  return value;
}

function booleanValue(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}
