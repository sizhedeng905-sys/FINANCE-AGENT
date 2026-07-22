import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectComposeSignatureTargets,
  createCosignAdapter,
  readPublicKeyFile,
  RegistrySignatureError,
  verifyRegistrySignatures,
} from './registry-signature.mjs';

const registryPrefix = 'registry.corp.internal/finance/agent';
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const publicKey = Buffer.from([
  '-----BEGIN PUBLIC KEY-----',
  'c3ludGhldGljLWZpeHR1cmUtcHVibGljLWtleS1ub3QtYS1yZWFsLWtleQ==',
  '-----END PUBLIC KEY-----',
  '',
].join('\n'));

test('verifies each unique managed digest and binds signature plus SLSA subjects', async () => {
  const compose = { services: {
    api: { image: `${registryPrefix}/backend@sha256:${digestA}` },
    worker: { image: `${registryPrefix}/backend@sha256:${digestA}` },
    web: { image: `${registryPrefix}/frontend@sha256:${digestB}` },
  } };
  const targets = collectComposeSignatureTargets(compose, registryPrefix);
  const calls = [];
  const result = await verifyRegistrySignatures({
    targets,
    registryPrefix,
    publicKey,
    publicKeyPath: '/private/cosign.pub',
    signaturePolicy: 'cosign_key_slsa_v1',
    registryAuthMode: 'credential_helper',
    adapter: fixtureAdapter(calls),
    now: () => new Date('2026-07-22T00:00:00.000Z'),
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.imageCount, 2);
  assert.deepEqual(result.images.map((image) => image.useCount), [2, 1]);
  assert.equal(calls.length, 5);
  assert.equal(JSON.stringify(result).includes('registry.corp.internal'), false);
  assert.equal(JSON.stringify(result).includes('/private/cosign.pub'), false);
});

test('blocks mutable, external-registry, and missing target inputs before adapter execution', async () => {
  for (const [compose, code] of [
    [{ services: { api: { image: `${registryPrefix}/backend:latest` } } }, 'SIGNATURE_DIGEST_REFERENCE_REQUIRED'],
    [{ services: { api: { image: `docker.io/library/nginx@sha256:${digestA}` } } }, 'SIGNATURE_MANAGED_REGISTRY_REQUIRED'],
  ]) {
    assert.throws(
      () => collectComposeSignatureTargets(compose, registryPrefix),
      (error) => error instanceof RegistrySignatureError && error.code === code && error.status === 'blocked_external',
    );
  }

  const target = [{ reference: `${registryPrefix}/backend@sha256:${digestA}`, uses: ['service:api'] }];
  let calls = 0;
  const adapter = fixtureAdapter([], () => { calls += 1; });
  for (const override of [
    { signaturePolicy: undefined },
    { registryAuthMode: undefined },
    { publicKey: undefined },
  ]) {
    await assert.rejects(
      verifyRegistrySignatures({
        targets: target,
        registryPrefix,
        publicKey,
        publicKeyPath: '/private/cosign.pub',
        signaturePolicy: 'cosign_key_slsa_v1',
        registryAuthMode: 'docker_config',
        adapter,
        ...override,
      }),
      (error) => error instanceof RegistrySignatureError && error.status === 'blocked_external',
    );
  }
  assert.equal(calls, 0);
});

test('rejects private, empty, oversized, and malformed public key material', async () => {
  const target = [{ reference: `${registryPrefix}/backend@sha256:${digestA}`, uses: ['service:api'] }];
  for (const value of [
    Buffer.alloc(0),
    Buffer.alloc(65_537, 65),
    Buffer.from(['-----BEGIN ', 'PRIVATE KEY-----\nsecret\n-----END ', 'PRIVATE KEY-----'].join('')),
    Buffer.from('x'.repeat(128)),
  ]) {
    await assert.rejects(
      verifyRegistrySignatures({
        targets: target,
        registryPrefix,
        publicKey: value,
        publicKeyPath: '/private/cosign.pub',
        signaturePolicy: 'cosign_key_slsa_v1',
        registryAuthMode: 'docker_config',
        adapter: fixtureAdapter([]),
      }),
      (error) => error instanceof RegistrySignatureError && error.code === 'SIGNATURE_PUBLIC_KEY_INVALID',
    );
  }
});

test('rejects missing, symlinked, non-file, and unreadable public key paths', async () => {
  const regularFile = { isSymbolicLink: () => false, isFile: () => true };
  for (const [options, code, status] of [
    [{ inspect: async () => { throw new Error('path hidden'); } }, 'SIGNATURE_PUBLIC_KEY_FILE_MISSING', 'blocked_external'],
    [{ inspect: async () => ({ isSymbolicLink: () => true, isFile: () => true }) }, 'SIGNATURE_PUBLIC_KEY_FILE_INVALID', 'failed'],
    [{ inspect: async () => ({ isSymbolicLink: () => false, isFile: () => false }) }, 'SIGNATURE_PUBLIC_KEY_FILE_INVALID', 'failed'],
    [{ inspect: async () => regularFile, read: async () => { throw new Error('path hidden'); } }, 'SIGNATURE_PUBLIC_KEY_FILE_UNREADABLE', 'blocked_external'],
  ]) {
    await assert.rejects(
      readPublicKeyFile('/private/cosign.pub', options),
      (error) => error instanceof RegistrySignatureError && error.code === code && error.status === status,
    );
  }
  assert.deepEqual(
    await readPublicKeyFile('/private/cosign.pub', { inspect: async () => regularFile, read: async () => publicKey }),
    publicKey,
  );
});

test('rejects mismatched signature digest, repository, type, and malformed output', async () => {
  const target = [{ reference: `${registryPrefix}/backend@sha256:${digestA}`, uses: ['service:api'] }];
  for (const signatureOutput of [
    signature(`${registryPrefix}/backend`, digestB),
    signature(`${registryPrefix}/other`, digestA),
    JSON.stringify([{ critical: {
      image: { 'docker-manifest-digest': `sha256:${digestA}` },
      type: 'cosign container image signature',
    } }]),
    JSON.stringify([{ critical: { type: 'unknown', image: { 'docker-manifest-digest': `sha256:${digestA}` } } }]),
    '```json\n{}\n```',
  ]) {
    await assert.rejects(runWithOutputs(target, signatureOutput, attestation(`${registryPrefix}/backend`, digestA)));
  }
});

test('rejects absent, malformed, wrong-type, and wrong-subject attestations', async () => {
  const target = [{ reference: `${registryPrefix}/backend@sha256:${digestA}`, uses: ['service:api'] }];
  for (const attestationOutput of [
    '[]',
    JSON.stringify([{ payload: 'not-base64' }]),
    attestation(`${registryPrefix}/backend`, digestA, 'https://example.invalid/provenance'),
    attestation(`${registryPrefix}/backend`, digestA, 'https://slsa.dev/provenance/v1', 'https://example.invalid/Statement/v1'),
    attestation(`${registryPrefix}/other`, digestA),
    attestation(`${registryPrefix}/backend`, digestB),
  ]) {
    await assert.rejects(runWithOutputs(target, signature(`${registryPrefix}/backend`, digestA), attestationOutput));
  }
});

test('accepts newline-delimited Cosign JSON while preserving bounded counts', async () => {
  const repository = `${registryPrefix}/backend`;
  const target = [{ reference: `${repository}@sha256:${digestA}`, uses: ['service:api'] }];
  const signatureDocument = JSON.parse(signature(repository, digestA))[0];
  const attestationDocument = JSON.parse(attestation(repository, digestA))[0];
  const result = await runWithOutputs(
    target,
    `${JSON.stringify(signatureDocument)}\n${JSON.stringify(signatureDocument)}\n`,
    `${JSON.stringify(attestationDocument)}\n${JSON.stringify(attestationDocument)}\n`,
  );
  assert.equal(result.images[0].signatureCount, 2);
  assert.equal(result.images[0].attestationCount, 2);
});

test('Cosign adapter exposes only read-only version and verification commands', () => {
  const calls = [];
  const adapter = createCosignAdapter({
    spawn: (command, arguments_) => {
      calls.push([command, ...arguments_]);
      return { status: 0, stdout: 'fixture' };
    },
    environment: {},
  });
  adapter.version();
  adapter.verifySignature(`${registryPrefix}/backend@sha256:${digestA}`, '/private/cosign.pub');
  adapter.verifyAttestation(`${registryPrefix}/backend@sha256:${digestA}`, '/private/cosign.pub');

  assert.deepEqual(calls.map((call) => call[1]), ['version', 'verify', 'verify-attestation']);
  assert.equal(calls.flat().some((value) => ['sign', 'copy', 'push', 'upload'].includes(value)), false);
});

test('Cosign adapter redacts missing binary and verification stderr', () => {
  for (const [result, code, status] of [
    [{ error: { code: 'ENOENT' } }, 'SIGNATURE_COSIGN_UNAVAILABLE', 'blocked_external'],
    [{ status: 1, stderr: 'registry-token-must-not-leak' }, 'SIGNATURE_COSIGN_VERIFICATION_FAILED', 'failed'],
  ]) {
    const adapter = createCosignAdapter({ spawn: () => result, environment: {} });
    assert.throws(
      () => adapter.version(),
      (error) => (
        error instanceof RegistrySignatureError
        && error.code === code
        && error.status === status
        && !error.message.includes('registry-token')
      ),
    );
  }
});

function fixtureAdapter(calls, onCall = () => {}) {
  return {
    version: async () => { calls.push('version'); onCall(); return 'cosign fixture v3'; },
    verifySignature: async (reference) => {
      calls.push(`signature:${reference}`); onCall();
      const { repository, digest } = parseReference(reference);
      return signature(repository, digest);
    },
    verifyAttestation: async (reference) => {
      calls.push(`attestation:${reference}`); onCall();
      const { repository, digest } = parseReference(reference);
      return attestation(repository, digest);
    },
  };
}

function runWithOutputs(targets, signatureOutput, attestationOutput) {
  return verifyRegistrySignatures({
    targets,
    registryPrefix,
    publicKey,
    publicKeyPath: '/private/cosign.pub',
    signaturePolicy: 'cosign_key_slsa_v1',
    registryAuthMode: 'docker_config',
    adapter: {
      version: async () => 'cosign fixture v3',
      verifySignature: async () => signatureOutput,
      verifyAttestation: async () => attestationOutput,
    },
  });
}

function signature(repository, digest) {
  return JSON.stringify([{
    critical: {
      identity: { 'docker-reference': repository },
      image: { 'docker-manifest-digest': `sha256:${digest}` },
      type: 'cosign container image signature',
    },
    optional: null,
  }]);
}

function attestation(
  repository,
  digest,
  predicateType = 'https://slsa.dev/provenance/v1',
  statementType = 'https://in-toto.io/Statement/v1',
) {
  const statement = {
    _type: statementType,
    predicateType,
    subject: [{ name: repository, digest: { sha256: digest } }],
    predicate: {},
  };
  return JSON.stringify([{ payload: Buffer.from(JSON.stringify(statement)).toString('base64') }]);
}

function parseReference(reference) {
  const [repository, digest] = reference.split('@sha256:');
  return { repository, digest };
}
