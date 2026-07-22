import assert from 'node:assert/strict';
import test from 'node:test';

import { LOCAL_DEMO_DEPLOYMENT_DEFAULTS, resolveDeploymentEnvironment } from './deployment-environment.mjs';
import { TargetProfileError, validateTargetProfile } from './target-profile.mjs';

const digest = 'a'.repeat(64);
const targetEnvironment = {
  ...LOCAL_DEMO_DEPLOYMENT_DEFAULTS,
  STAGING_DEPLOYMENT_PROFILE: 'target',
  STAGING_APP_DOMAIN: 'finance-staging.corp.internal',
  STAGING_OBJECT_DOMAIN: 'finance-objects.corp.internal',
  STAGING_APP_BASE_URL: 'https://finance-staging.corp.internal',
  STAGING_OBJECT_BASE_URL: 'https://finance-objects.corp.internal:9443',
  STAGING_CORS_ORIGINS: 'https://finance-staging.corp.internal',
  STAGING_GATEWAY_BIND_ADDRESS: '0.0.0.0',
  STAGING_WEB_PORT: '443',
  STAGING_CERTIFICATE_MODE: 'provided',
  STAGING_ENVIRONMENT_ID: 'finance-agent-staging-cn1',
  STAGING_REGISTRY_PREFIX: 'registry.corp.internal/finance/agent',
  STAGING_SYNTHETIC_SEED_ENABLED: 'false',
  STAGING_TARGET_REGION: 'cn-north-1',
  STAGING_TARGET_OWNER_ID: 'platform-owner-01',
  STAGING_TARGET_CHANGE_ID: 'change-20260722-01',
  STAGING_TARGET_SECRET_PROVIDER: 'docker_secret_files',
  STAGING_TARGET_CERTIFICATE_ISSUER: 'enterprise-pki-01',
  STAGING_ALERTMANAGER_CONFIG_FILE: './monitoring/alertmanager-webhook.yml',
};
const compose = {
  services: {
    'backend-api': { image: `registry.corp.internal/finance/agent/backend@sha256:${digest}` },
    worker: { image: `registry.corp.internal/finance/agent/backend@sha256:${digest}` },
    backup: {
      image: `registry.corp.internal/finance/agent/staging-backup@sha256:${digest}`,
      environment: { IMAGE_IDENTITY_POLICY: 'signed_registry' },
    },
    gateway: { image: `nginx@sha256:${digest}` },
  },
};
const certificateFilesPresent = ['ca.crt', 'gateway.crt', 'gateway.key', 'postgres.crt', 'postgres.key'];

test('accepts a complete target contract and returns only hashed environment identities', () => {
  const result = validateTargetProfile({
    settings: resolveDeploymentEnvironment(targetEnvironment),
    environment: targetEnvironment,
    compose,
    certificateFilesPresent,
    caSubject: 'CN=Enterprise Root CA',
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.serviceImageCount, 4);
  assert.equal(result.repositoryImageCount, 3);
  assert.match(result.environmentIdSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('finance-agent-staging-cn1'), false);
});

test('rejects every local-demo safety boundary under the target profile', () => {
  const cases = [
    [{ STAGING_CERTIFICATE_MODE: 'local_ca' }, 'TARGET_LOCAL_CA_FORBIDDEN'],
    [{ STAGING_SYNTHETIC_SEED_ENABLED: 'true' }, 'TARGET_SYNTHETIC_SEED_FORBIDDEN'],
    [{
      STAGING_APP_DOMAIN: 'staging.finance-agent.local',
      STAGING_APP_BASE_URL: 'https://staging.finance-agent.local',
      STAGING_CORS_ORIGINS: 'https://staging.finance-agent.local',
    }, 'TARGET_TEST_DOMAIN_FORBIDDEN'],
    [{ STAGING_ENVIRONMENT_ID: 'finance-agent-staging-local' }, 'TARGET_ENVIRONMENT_ID_FORBIDDEN'],
    [{ STAGING_GATEWAY_BIND_ADDRESS: '127.0.0.1' }, 'TARGET_LOOPBACK_BIND_FORBIDDEN'],
    [{ STAGING_TRUSTED_PROXY_CIDRS: '0.0.0.0/0' }, 'TARGET_PROXY_SCOPE_FORBIDDEN'],
    [{ STAGING_TRUSTED_PROXY_CIDRS: '10.0.0.0/8' }, 'TARGET_PROXY_GATEWAY_MISMATCH'],
    [{ STAGING_REGISTRY_PREFIX: 'finance-agent' }, 'TARGET_REGISTRY_REQUIRED'],
    [{ STAGING_REGISTRY_PREFIX: 'registry.example.com/finance/agent' }, 'TARGET_REGISTRY_REQUIRED'],
    [{ STAGING_ALERTMANAGER_CONFIG_FILE: './monitoring/alertmanager.yml' }, 'TARGET_ALERT_WEBHOOK_CONFIG_REQUIRED'],
  ];

  for (const [override, expectedCode] of cases) {
    expectCode(() => validateTargetProfile({
      settings: resolveDeploymentEnvironment({ ...targetEnvironment, ...override }),
      environment: { ...targetEnvironment, ...override },
      compose,
      certificateFilesPresent,
      caSubject: 'CN=Enterprise Root CA',
    }), expectedCode);
  }
});

test('rejects missing metadata, placeholders, local initialization, local CA, and incomplete certificates', () => {
  const settings = resolveDeploymentEnvironment(targetEnvironment);
  const missingMetadata = { ...targetEnvironment };
  delete missingMetadata.STAGING_TARGET_REGION;
  expectCode(() => validateTargetProfile({
    settings,
    environment: missingMetadata,
    compose,
    certificateFilesPresent,
  }), 'TARGET_METADATA_REQUIRED');
  expectCode(() => validateTargetProfile({
    settings,
    environment: { ...targetEnvironment, STAGING_TARGET_CHANGE_ID: 'required-change' },
    compose,
    certificateFilesPresent,
  }), 'TARGET_PLACEHOLDER_FORBIDDEN');
  expectCode(() => validateTargetProfile({
    settings,
    environment: { ...targetEnvironment, STAGING_TARGET_OWNER_ID: 'owner id with spaces' },
    compose,
    certificateFilesPresent,
  }), 'TARGET_METADATA_INVALID');
  expectCode(() => validateTargetProfile({
    settings: resolveDeploymentEnvironment({
      ...targetEnvironment,
      STAGING_CORS_ORIGINS: `${targetEnvironment.STAGING_CORS_ORIGINS},https://localhost`,
    }),
    environment: targetEnvironment,
    compose,
    certificateFilesPresent,
  }), 'TARGET_CORS_ORIGIN_FORBIDDEN');
  expectCode(() => validateTargetProfile({
    settings,
    environment: targetEnvironment,
    compose,
    initialization: { deploymentProfile: 'local_demo' },
    certificateFilesPresent,
  }), 'TARGET_LOCAL_INITIALIZATION_FORBIDDEN');
  expectCode(() => validateTargetProfile({
    settings,
    environment: targetEnvironment,
    compose,
    certificateFilesPresent,
    caSubject: 'CN=FINANCE-AGENT Staging CA',
  }), 'TARGET_LOCAL_CA_FORBIDDEN');
  expectCode(() => validateTargetProfile({
    settings,
    environment: targetEnvironment,
    compose,
    certificateFilesPresent: certificateFilesPresent.slice(1),
  }), 'TARGET_CERTIFICATE_FILES_REQUIRED');
});

test('rejects local image identity, mutable images, and missing registry binding', () => {
  const settings = resolveDeploymentEnvironment(targetEnvironment);
  expectCode(() => validateTargetProfile({
    settings,
    environment: targetEnvironment,
    compose: {
      services: {
        ...compose.services,
        backup: { ...compose.services.backup, environment: { IMAGE_IDENTITY_POLICY: 'local_identity' } },
      },
    },
    certificateFilesPresent,
  }), 'TARGET_LOCAL_IDENTITY_FORBIDDEN');
  expectCode(() => validateTargetProfile({
    settings,
    environment: targetEnvironment,
    compose: { services: { ...compose.services, gateway: { image: 'nginx:stable' } } },
    certificateFilesPresent,
  }), 'TARGET_IMAGE_DIGEST_REQUIRED');
  expectCode(() => validateTargetProfile({
    settings,
    environment: targetEnvironment,
    compose: { services: { backup: { image: `backup.example.net/image@sha256:${digest}`, environment: { IMAGE_IDENTITY_POLICY: 'signed_registry' } } } },
    certificateFilesPresent,
  }), 'TARGET_REGISTRY_BINDING_REQUIRED');
});

test('rejects invoking target validation for the local demo profile', () => {
  expectCode(() => validateTargetProfile({
    settings: resolveDeploymentEnvironment({}),
    environment: {},
    compose,
    certificateFilesPresent,
  }), 'TARGET_PROFILE_REQUIRED');
});

function expectCode(operation, expectedCode) {
  assert.throws(operation, (error) => error instanceof TargetProfileError && error.code === expectedCode);
}
