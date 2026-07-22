import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';

export const REGISTRY_SIGNATURE_SCHEMA = 'staging-registry-signature/1.0';

const digestReferencePattern = /^(?<repository>[a-z0-9][a-z0-9._:/-]*)@sha256:(?<digest>[a-f0-9]{64})$/;
const allowedAuthModes = new Set(['docker_config', 'credential_helper', 'workload_identity']);
const allowedPredicateTypes = new Set([
  'https://slsa.dev/provenance/v0.2',
  'https://slsa.dev/provenance/v1',
  'https://slsa.dev/provenance/v1.0',
]);
const allowedStatementTypes = new Set([
  'https://in-toto.io/Statement/v0.1',
  'https://in-toto.io/Statement/v1',
]);

export class RegistrySignatureError extends Error {
  constructor(code, status = 'failed') {
    super(code);
    this.name = 'RegistrySignatureError';
    this.code = code;
    this.status = status;
  }
}

export async function readPublicKeyFile(
  publicKeyPath,
  { inspect = lstat, read = readFile } = {},
) {
  if (typeof publicKeyPath !== 'string' || publicKeyPath.length === 0) {
    throw new RegistrySignatureError('SIGNATURE_PUBLIC_KEY_FILE_MISSING', 'blocked_external');
  }
  let metadata;
  try {
    metadata = await inspect(publicKeyPath);
  } catch {
    throw new RegistrySignatureError('SIGNATURE_PUBLIC_KEY_FILE_MISSING', 'blocked_external');
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new RegistrySignatureError('SIGNATURE_PUBLIC_KEY_FILE_INVALID');
  }
  let publicKey;
  try {
    publicKey = await read(publicKeyPath);
  } catch {
    throw new RegistrySignatureError('SIGNATURE_PUBLIC_KEY_FILE_UNREADABLE', 'blocked_external');
  }
  validatePublicKey(publicKey);
  return publicKey;
}

export function collectComposeSignatureTargets(compose, registryPrefix) {
  if (!compose?.services || typeof compose.services !== 'object') {
    throw new RegistrySignatureError('SIGNATURE_COMPOSE_SERVICES_REQUIRED');
  }
  return normalizeTargets(Object.entries(compose.services).map(([service, definition]) => ({
    reference: definition?.image,
    uses: [`service:${service}`],
  })), registryPrefix);
}

export function collectLockSignatureTargets(entries, registryPrefix) {
  if (!Array.isArray(entries)) throw new RegistrySignatureError('SIGNATURE_IMAGE_LOCK_REQUIRED');
  const deployed = entries
    .filter((entry) => entry?.uses?.some((use) => use?.kind === 'service'))
    .map((entry) => ({
      reference: entry.repoDigest ?? entry.immutableReference,
      uses: entry.uses
        .filter((use) => use?.kind === 'service')
        .map((use) => `${use.scope}:${use.name}`),
    }));
  return normalizeTargets(deployed, registryPrefix);
}

export async function verifyRegistrySignatures({
  targets,
  registryPrefix,
  publicKey,
  publicKeyPath,
  signaturePolicy,
  registryAuthMode,
  adapter,
  now = () => new Date(),
}) {
  if (signaturePolicy !== 'cosign_key_slsa_v1') {
    throw new RegistrySignatureError('SIGNATURE_POLICY_REQUIRED', 'blocked_external');
  }
  if (!allowedAuthModes.has(registryAuthMode)) {
    throw new RegistrySignatureError('SIGNATURE_REGISTRY_AUTH_MODE_REQUIRED', 'blocked_external');
  }
  if (!adapter || typeof adapter.version !== 'function'
    || typeof adapter.verifySignature !== 'function'
    || typeof adapter.verifyAttestation !== 'function') {
    throw new RegistrySignatureError('SIGNATURE_ADAPTER_INVALID');
  }
  const keySha256 = validatePublicKey(publicKey);
  if (typeof publicKeyPath !== 'string' || publicKeyPath.length === 0) {
    throw new RegistrySignatureError('SIGNATURE_PUBLIC_KEY_FILE_MISSING', 'blocked_external');
  }
  const normalizedTargets = normalizeTargets(targets, registryPrefix);
  let versionOutput;
  try {
    versionOutput = await adapter.version();
  } catch (error) {
    throw normalizeAdapterError(error);
  }
  if (typeof versionOutput !== 'string' || versionOutput.length < 1 || versionOutput.length > 16_384) {
    throw new RegistrySignatureError('SIGNATURE_COSIGN_VERSION_INVALID');
  }

  const images = [];
  for (const target of normalizedTargets) {
    let signatureOutput;
    let attestationOutput;
    try {
      signatureOutput = await adapter.verifySignature(target.reference, publicKeyPath);
      attestationOutput = await adapter.verifyAttestation(target.reference, publicKeyPath);
    } catch (error) {
      throw normalizeAdapterError(error);
    }
    const verified = verifyCosignOutputs(target, signatureOutput, attestationOutput);
    images.push({
      repositorySha256: sha256(target.repository),
      digest: `sha256:${target.digest}`,
      useCount: target.uses.length,
      signatureCount: verified.signatureCount,
      attestationCount: verified.attestationCount,
      signatureOutputSha256: sha256(signatureOutput),
      attestationOutputSha256: sha256(attestationOutput),
    });
  }

  return Object.freeze({
    schemaVersion: REGISTRY_SIGNATURE_SCHEMA,
    status: 'passed',
    checkedAt: now().toISOString(),
    policy: signaturePolicy,
    registryAuthMode,
    registryPrefixSha256: sha256(registryPrefix),
    publicKeySha256: keySha256,
    cosignVersionOutputSha256: sha256(versionOutput),
    registryReadVerification: 'cosign_signature_and_slsa_attestation',
    imageCount: images.length,
    images,
  });
}

export function verifyCosignOutputs(target, signatureOutput, attestationOutput) {
  const signatures = parseJsonDocuments(signatureOutput, 'SIGNATURE_OUTPUT_INVALID');
  if (signatures.length < 1 || signatures.length > 100) {
    throw new RegistrySignatureError('SIGNATURE_CLAIM_COUNT_INVALID');
  }
  const expectedDigest = `sha256:${target.digest}`;
  for (const claim of signatures) {
    const critical = claim?.critical;
    if (
      critical?.image?.['docker-manifest-digest'] !== expectedDigest
      || critical?.type !== 'cosign container image signature'
    ) {
      throw new RegistrySignatureError('SIGNATURE_DIGEST_CLAIM_MISMATCH');
    }
    const identity = critical?.identity?.['docker-reference'];
    if (identity !== target.repository) {
      throw new RegistrySignatureError('SIGNATURE_REPOSITORY_CLAIM_MISMATCH');
    }
  }

  const attestations = parseJsonDocuments(attestationOutput, 'SIGNATURE_ATTESTATION_OUTPUT_INVALID');
  if (attestations.length < 1 || attestations.length > 100) {
    throw new RegistrySignatureError('SIGNATURE_ATTESTATION_COUNT_INVALID');
  }
  for (const envelope of attestations) {
    const statement = decodeAttestationPayload(envelope?.payload);
    if (!allowedStatementTypes.has(statement?._type)) {
      throw new RegistrySignatureError('SIGNATURE_ATTESTATION_STATEMENT_TYPE_INVALID');
    }
    if (!allowedPredicateTypes.has(statement?.predicateType)) {
      throw new RegistrySignatureError('SIGNATURE_ATTESTATION_TYPE_INVALID');
    }
    const subjectMatches = Array.isArray(statement.subject) && statement.subject.some((subject) => (
      subject?.name === target.repository
      && subject?.digest?.sha256 === target.digest
    ));
    if (!subjectMatches) throw new RegistrySignatureError('SIGNATURE_ATTESTATION_SUBJECT_MISMATCH');
  }
  return { signatureCount: signatures.length, attestationCount: attestations.length };
}

export function createCosignAdapter({ spawn = spawnSync, environment = process.env } = {}) {
  const capture = (arguments_) => {
    const result = spawn('cosign', arguments_, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 300_000,
      maxBuffer: 2_200_000,
      env: environment,
    });
    if (result?.error?.code === 'ENOENT') {
      throw new RegistrySignatureError('SIGNATURE_COSIGN_UNAVAILABLE', 'blocked_external');
    }
    if (result?.error || result?.status !== 0) {
      throw new RegistrySignatureError('SIGNATURE_COSIGN_VERIFICATION_FAILED');
    }
    if (typeof result.stdout !== 'string') {
      throw new RegistrySignatureError('SIGNATURE_COSIGN_OUTPUT_INVALID');
    }
    return result.stdout;
  };
  return Object.freeze({
    version: () => capture(['version']),
    verifySignature: (reference, keyPath) => capture([
      'verify', '--key', keyPath, '--output', 'json', reference,
    ]),
    verifyAttestation: (reference, keyPath) => capture([
      'verify-attestation', '--key', keyPath, '--type', 'slsaprovenance', '--output', 'json', reference,
    ]),
  });
}

function normalizeTargets(targets, registryPrefix) {
  if (!/^[a-z0-9][a-z0-9._:-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/.test(String(registryPrefix ?? ''))) {
    throw new RegistrySignatureError('SIGNATURE_REGISTRY_PREFIX_REQUIRED', 'blocked_external');
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new RegistrySignatureError('SIGNATURE_TARGETS_REQUIRED');
  }
  const unique = new Map();
  for (const target of targets) {
    const match = digestReferencePattern.exec(String(target?.reference ?? ''));
    if (!match) throw new RegistrySignatureError('SIGNATURE_DIGEST_REFERENCE_REQUIRED', 'blocked_external');
    const { repository, digest } = match.groups;
    if (!repository.startsWith(`${registryPrefix}/`)) {
      throw new RegistrySignatureError('SIGNATURE_MANAGED_REGISTRY_REQUIRED', 'blocked_external');
    }
    const uses = Array.isArray(target.uses) ? [...new Set(target.uses.map(String))].sort() : [];
    const existing = unique.get(target.reference);
    if (existing) existing.uses = [...new Set([...existing.uses, ...uses])].sort();
    else unique.set(target.reference, { reference: target.reference, repository, digest, uses });
  }
  return [...unique.values()].sort((left, right) => left.reference.localeCompare(right.reference));
}

function validatePublicKey(value) {
  if (value === undefined || value === null) {
    throw new RegistrySignatureError('SIGNATURE_PUBLIC_KEY_FILE_MISSING', 'blocked_external');
  }
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (bytes.length < 64 || bytes.length > 65_536) {
    throw new RegistrySignatureError('SIGNATURE_PUBLIC_KEY_INVALID');
  }
  const text = bytes.toString('utf8');
  if (!text.includes('-----BEGIN PUBLIC KEY-----') || !text.includes('-----END PUBLIC KEY-----')
    || /PRIVATE KEY/.test(text)) {
    throw new RegistrySignatureError('SIGNATURE_PUBLIC_KEY_INVALID');
  }
  return sha256(bytes);
}

function parseJsonDocuments(value, code) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 2_000_000) {
    throw new RegistrySignatureError(code);
  }
  const source = value.trim();
  try {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try {
      return source.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      throw new RegistrySignatureError(code);
    }
  }
}

function decodeAttestationPayload(value) {
  if (typeof value !== 'string' || value.length < 4 || value.length > 1_500_000
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new RegistrySignatureError('SIGNATURE_ATTESTATION_PAYLOAD_INVALID');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new RegistrySignatureError('SIGNATURE_ATTESTATION_PAYLOAD_INVALID');
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new RegistrySignatureError('SIGNATURE_ATTESTATION_PAYLOAD_INVALID');
  }
}

function normalizeAdapterError(error) {
  if (error instanceof RegistrySignatureError) return error;
  return new RegistrySignatureError('SIGNATURE_VERIFICATION_FAILED');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
