import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_DEMO_DEPLOYMENT_DEFAULTS,
  parseEnvironmentSource,
  resolveDeploymentEnvironment,
} from './deployment-environment.mjs';

test('resolves the existing local demo topology without changing its public endpoints', () => {
  const settings = resolveDeploymentEnvironment({});

  assert.equal(settings.profile, 'local_demo');
  assert.equal(settings.appBaseUrl, 'https://staging.finance-agent.local:8443');
  assert.equal(settings.objectBaseUrl, 'https://objects.finance-agent.local:9443');
  assert.equal(settings.gatewayBindAddress, '127.0.0.1');
  assert.equal(settings.certificateMode, 'local_ca');
  assert.equal(settings.environmentId, 'finance-agent-staging-local');
  assert.equal(settings.registryPrefix, 'finance-agent');
  assert.equal(settings.syntheticSeedEnabled, true);
});

test('accepts one internally consistent parameterized target-shaped topology', () => {
  const settings = resolveDeploymentEnvironment({
    ...LOCAL_DEMO_DEPLOYMENT_DEFAULTS,
    STAGING_DEPLOYMENT_PROFILE: 'target',
    STAGING_APP_DOMAIN: 'finance-staging.example.com',
    STAGING_OBJECT_DOMAIN: 'finance-objects.example.com',
    STAGING_APP_BASE_URL: 'https://finance-staging.example.com',
    STAGING_OBJECT_BASE_URL: 'https://finance-objects.example.com:9443',
    STAGING_CORS_ORIGINS: 'https://finance-staging.example.com,https://finance-admin.example.com',
    STAGING_GATEWAY_BIND_ADDRESS: '0.0.0.0',
    STAGING_WEB_PORT: '443',
    STAGING_CERTIFICATE_MODE: 'provided',
    STAGING_ENVIRONMENT_ID: 'finance-agent-staging-cn1',
    STAGING_REGISTRY_PREFIX: 'registry.example.com/finance/agent',
    STAGING_SYNTHETIC_SEED_ENABLED: 'false',
  });

  assert.equal(settings.profile, 'target');
  assert.equal(settings.webPort, 443);
  assert.deepEqual(settings.corsOrigins, [
    'https://finance-staging.example.com',
    'https://finance-admin.example.com',
  ]);
  assert.equal(settings.registryPrefix, 'registry.example.com/finance/agent');
  assert.equal(settings.syntheticSeedEnabled, false);
});

test('rejects mismatched domains, ports, CORS, unsafe registry values, and invalid modes', () => {
  const invalidCases = [
    { STAGING_APP_BASE_URL: 'https://other.example.com:8443' },
    { STAGING_OBJECT_BASE_URL: 'https://objects.finance-agent.local:9444' },
    { STAGING_CORS_ORIGINS: 'https://admin.example.com' },
    { STAGING_CORS_ORIGINS: 'https://staging.finance-agent.local:8443/path' },
    { STAGING_REGISTRY_PREFIX: 'https://registry.example.com/finance' },
    { STAGING_CERTIFICATE_MODE: 'automatic' },
    { STAGING_SYNTHETIC_SEED_ENABLED: 'yes' },
    { STAGING_WEB_PORT: '9443' },
  ];

  for (const invalid of invalidCases) {
    assert.throws(() => resolveDeploymentEnvironment({ ...LOCAL_DEMO_DEPLOYMENT_DEFAULTS, ...invalid }));
  }
});

test('parses environment files without interpolation and rejects duplicate keys', () => {
  assert.deepEqual(parseEnvironmentSource('# comment\nSTAGING_WEB_PORT=10443\nEMPTY=\n'), {
    STAGING_WEB_PORT: '10443',
    EMPTY: '',
  });
  assert.throws(
    () => parseEnvironmentSource('STAGING_WEB_PORT=8443\nSTAGING_WEB_PORT=9443\n'),
    /Duplicate environment key/,
  );
});
