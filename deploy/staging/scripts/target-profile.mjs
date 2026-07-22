import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const TARGET_PROFILE_SCHEMA = 'staging-target-profile/1.0';
export const TARGET_METADATA_KEYS = Object.freeze([
  'STAGING_TARGET_REGION',
  'STAGING_TARGET_OWNER_ID',
  'STAGING_TARGET_CHANGE_ID',
  'STAGING_TARGET_SECRET_PROVIDER',
  'STAGING_TARGET_CERTIFICATE_ISSUER',
]);

const targetSecretProviders = new Set([
  'docker_secret_files',
  'vault',
  'aws_secrets_manager',
  'azure_key_vault',
  'gcp_secret_manager',
]);
const placeholderPattern = /(?:^|[-_.])(required|replace|todo|tbd|changeme|placeholder|example)(?:$|[-_.])/i;
const localEnvironmentPattern = /(?:^|[-_.])(local|demo|test)(?:$|[-_.])/i;

export class TargetProfileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TargetProfileError';
    this.code = code;
  }
}

export function validateTargetProfile({
  settings,
  environment,
  compose,
  initialization = null,
  certificateFilesPresent = [],
  caSubject = '',
}) {
  if (settings.profile !== 'target') {
    fail('TARGET_PROFILE_REQUIRED', 'STAGING_DEPLOYMENT_PROFILE must be target');
  }
  if (settings.certificateMode !== 'provided') {
    fail('TARGET_LOCAL_CA_FORBIDDEN', 'Target profile requires operator-provided certificates');
  }
  if (settings.syntheticSeedEnabled) {
    fail('TARGET_SYNTHETIC_SEED_FORBIDDEN', 'Target profile forbids the synthetic staging seed');
  }
  for (const domain of [settings.appDomain, settings.objectDomain]) {
    if (isReservedTargetDomain(domain)) {
      fail('TARGET_TEST_DOMAIN_FORBIDDEN', 'Target profile forbids local, test, and reserved example domains');
    }
  }
  for (const origin of settings.corsOrigins) {
    const hostname = new URL(origin).hostname;
    if (isReservedTargetDomain(hostname) || isLoopback(hostname)) {
      fail('TARGET_CORS_ORIGIN_FORBIDDEN', 'Target CORS origins must not include local, test, or reserved hosts');
    }
  }
  if (localEnvironmentPattern.test(settings.environmentId) || placeholderPattern.test(settings.environmentId)) {
    fail('TARGET_ENVIRONMENT_ID_FORBIDDEN', 'Target environment ID must not be local, demo, test, or a placeholder');
  }
  if (isLoopback(settings.gatewayBindAddress)) {
    fail('TARGET_LOOPBACK_BIND_FORBIDDEN', 'Target gateway must not bind only to loopback');
  }
  if (settings.trustedProxyCidrs.some((entry) => ['0.0.0.0/0', '::/0', 'all', '*'].includes(entry.toLowerCase()))) {
    fail('TARGET_PROXY_SCOPE_FORBIDDEN', 'Target trusted proxy scope must not trust every source');
  }
  if (!settings.trustedProxyCidrs.some((entry) => proxyCovers(entry, settings.gatewayInternalIp))) {
    fail('TARGET_PROXY_GATEWAY_MISMATCH', 'Target trusted proxies must cover the configured gateway address');
  }
  if (!isRemoteRegistryPrefix(settings.registryPrefix)) {
    fail('TARGET_REGISTRY_REQUIRED', 'Target profile requires a non-local registry repository prefix');
  }

  const metadata = {};
  for (const key of TARGET_METADATA_KEYS) {
    const value = String(environment[key] ?? '').trim();
    if (!value) fail('TARGET_METADATA_REQUIRED', `Target profile requires ${key}`);
    if (placeholderPattern.test(value)) fail('TARGET_PLACEHOLDER_FORBIDDEN', `${key} contains a placeholder`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:\/-]{2,127}$/.test(value)) {
      fail('TARGET_METADATA_INVALID', `${key} must be a stable non-secret identifier`);
    }
    metadata[key] = value;
  }
  if (!targetSecretProviders.has(metadata.STAGING_TARGET_SECRET_PROVIDER)) {
    fail('TARGET_SECRET_PROVIDER_INVALID', 'STAGING_TARGET_SECRET_PROVIDER is not an allowed secret provider class');
  }

  const requiredCertificateFiles = ['ca.crt', 'gateway.crt', 'gateway.key', 'postgres.crt', 'postgres.key'];
  const present = new Set(certificateFilesPresent);
  if (requiredCertificateFiles.some((name) => !present.has(name))) {
    fail('TARGET_CERTIFICATE_FILES_REQUIRED', 'Target profile requires all operator-provided TLS files');
  }
  if (/FINANCE-AGENT Staging CA/i.test(caSubject)) {
    fail('TARGET_LOCAL_CA_FORBIDDEN', 'Target profile detected the generated local Staging CA');
  }
  if (
    initialization?.certificateMode === 'local_ca'
    || initialization?.deploymentProfile === 'local_demo'
    || initialization?.generatedFiles?.some((path) => path === '.runtime/tls/ca.crt')
  ) {
    fail('TARGET_LOCAL_INITIALIZATION_FORBIDDEN', 'Target profile cannot reuse local-demo initialization material');
  }

  const services = compose?.services ?? {};
  const imageIdentityPolicy = String(services.backup?.environment?.IMAGE_IDENTITY_POLICY ?? '');
  if (imageIdentityPolicy !== 'signed_registry') {
    fail('TARGET_LOCAL_IDENTITY_FORBIDDEN', 'Target profile requires IMAGE_IDENTITY_POLICY=signed_registry');
  }
  const imageReferences = Object.entries(services).map(([service, value]) => ({
    service,
    image: String(value?.image ?? ''),
  }));
  if (imageReferences.length === 0 || imageReferences.some(({ image }) => !/@sha256:[a-f0-9]{64}$/i.test(image))) {
    fail('TARGET_IMAGE_DIGEST_REQUIRED', 'Every target service image must use an immutable sha256 digest');
  }
  const repositoryImages = imageReferences.filter(({ image }) => image.startsWith(`${settings.registryPrefix}/`));
  if (repositoryImages.length === 0) {
    fail('TARGET_REGISTRY_BINDING_REQUIRED', 'Target Compose does not reference the configured registry prefix');
  }

  return Object.freeze({
    schemaVersion: TARGET_PROFILE_SCHEMA,
    status: 'passed',
    deploymentProfile: 'target',
    metadataKeysPresent: TARGET_METADATA_KEYS.length,
    certificateFilesPresent: requiredCertificateFiles.length,
    serviceImageCount: imageReferences.length,
    repositoryImageCount: repositoryImages.length,
    environmentIdSha256: sha256(settings.environmentId),
    appDomainSha256: sha256(settings.appDomain),
    objectDomainSha256: sha256(settings.objectDomain),
    registryPrefixSha256: sha256(settings.registryPrefix),
    certificateIssuerSha256: sha256(metadata.STAGING_TARGET_CERTIFICATE_ISSUER),
  });
}

function isReservedTargetDomain(domain) {
  return (
    domain === 'localhost'
    || domain.endsWith('.localhost')
    || domain.endsWith('.local')
    || domain.endsWith('.test')
    || domain.endsWith('.invalid')
    || domain === 'example.com'
    || domain.endsWith('.example.com')
  );
}

function isLoopback(address) {
  if (isIP(address) === 4) return address.startsWith('127.');
  if (isIP(address) === 6) return address === '::1';
  return false;
}

function isRemoteRegistryPrefix(prefix) {
  const registryHost = prefix.split('/')[0];
  const hostname = registryHost.replace(/:\d+$/, '');
  return (
    prefix.includes('/')
    && (registryHost.includes('.') || registryHost.includes(':'))
    && registryHost !== 'localhost'
    && !registryHost.startsWith('127.')
    && registryHost !== '[::1]'
    && !isReservedTargetDomain(hostname)
  );
}

function proxyCovers(entry, gatewayAddress) {
  if (entry === gatewayAddress) return true;
  const [network, prefixSource, extra] = entry.split('/');
  if (extra !== undefined || prefixSource === undefined || isIP(network) !== 4 || isIP(gatewayAddress) !== 4) return false;
  if (!/^\d{1,2}$/.test(prefixSource)) return false;
  const prefix = Number(prefixSource);
  if (prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Integer(network) & mask) === (ipv4Integer(gatewayAddress) & mask);
}

function ipv4Integer(value) {
  return value.split('.').reduce((result, octet) => ((result << 8) | Number(octet)) >>> 0, 0);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(code, message) {
  throw new TargetProfileError(code, message);
}
