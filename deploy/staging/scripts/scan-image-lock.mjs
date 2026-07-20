import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  IMAGE_LOCK_SCHEMA,
  readSealedJson,
  sha256,
  SUPPLY_CHAIN_INDEX_SCHEMA,
  verifyImageLock,
  writeSealedJson
} from './image-integrity-lib.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arguments_ = process.argv.slice(2);
const lockPath = resolve(stagingRoot, requiredOption(arguments_, '--lock'));
const outputRoot = resolve(stagingRoot, requiredOption(arguments_, '--output'));
const { document: lock, fileSha256: lockFileSha256 } = await readSealedJson(lockPath, IMAGE_LOCK_SCHEMA);
verifyImageLock(lock);
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const imageScanTimeoutMs = boundedInteger(
  process.env.IMAGE_SCAN_TIMEOUT_MS ?? '1800000',
  60_000,
  3_600_000,
  'IMAGE_SCAN_TIMEOUT_MS'
);
const syftBinary = process.env.SYFT_BIN || 'syft';
const imageEntries = lock.entries;
const artifacts = [];
const scannerVersion = capture(syftBinary, ['version']).slice(0, 2_000);
for (const entry of imageEntries) {
  const stem = `${safeStem(entry.requestedReference)}-${entry.imageId.slice(7, 19)}`;
  const sbomPath = join(outputRoot, `${stem}.spdx.json`);
  const cvePath = join(outputRoot, `${stem}.grype.sarif.json`);
  const criticalPath = join(outputRoot, `${stem}.critical-fixed.txt`);
  run(
    'node',
    [
      join(stagingRoot, 'scripts', 'generate-sbom.mjs'),
      '--source', `docker:${entry.immutableReference}`,
      '--output', sbomPath
    ],
    imageScanTimeoutMs
  );
  run('node', [
    join(stagingRoot, 'scripts', 'grype-sbom.mjs'),
    '--sbom', sbomPath,
    '--output', cvePath,
    '--gate-output', criticalPath
  ]);
  artifacts.push(await describeArtifact(sbomPath, 'spdx_sbom', entry));
  artifacts.push(await describeArtifact(cvePath, 'grype_sarif', entry));
  artifacts.push(await describeArtifact(criticalPath, 'critical_gate', entry));
}

const identityPolicy = lock.metadata?.identityPolicy;
const signatureEvidence = identityPolicy === 'signed_registry'
  ? await verifySignedImages(imageEntries, outputRoot)
  : {
      status: 'pending_h13',
      reason: 'Local engineering identity uses digest/image ID checks; target registry, signer and public key require H13.'
    };
const indexPath = join(outputRoot, 'supply-chain-index.json');
const written = await writeSealedJson(indexPath, {
  schemaVersion: SUPPLY_CHAIN_INDEX_SCHEMA,
  createdAt: new Date().toISOString(),
  imageLock: {
    path: relative(stagingRoot, lockPath).replace(/\\/g, '/'),
    fileSha256: lockFileSha256,
    contentSha256: lock.integrity.contentSha256
  },
  scanner: {
    name: 'pinned-syft-spdx-and-pinned-grype',
    versionOutputSha256: sha256(scannerVersion),
    vulnerabilityGate: 'no_fixable_critical'
  },
  artifacts: artifacts.sort((left, right) => left.path.localeCompare(right.path)),
  provenance: {
    imageIdentityVerified: true,
    revisionLabelsRecorded: true,
    buildkitProvenanceRequested: true,
    sbomSource: 'syft_spdx_sealed'
  },
  signatures: signatureEvidence,
  registryAuthorization: identityPolicy === 'signed_registry' ? 'operator_verified_h13' : 'pending_h13'
});
process.stdout.write(JSON.stringify({
  status: 'passed',
  imageCount: imageEntries.length,
  artifactCount: artifacts.length,
  indexPath,
  indexSha256: written.fileSha256,
  signatures: signatureEvidence.status
}, null, 2) + '\n');

async function verifySignedImages(entries, outputDirectory) {
  const publicKey = process.env.COSIGN_PUBLIC_KEY_FILE;
  if (!publicKey) throw new Error('COSIGN_PUBLIC_KEY_FILE is required for signed_registry');
  const results = [];
  for (const entry of entries) {
    if (!entry.repoDigest) throw new Error(`Signed image has no registry digest: ${entry.requestedReference}`);
    const signaturePath = join(outputDirectory, `${safeStem(entry.requestedReference)}-${entry.imageId.slice(7, 19)}.cosign.json`);
    const provenancePath = join(outputDirectory, `${safeStem(entry.requestedReference)}-${entry.imageId.slice(7, 19)}.provenance.json`);
    const signature = capture('cosign', ['verify', '--key', publicKey, '--output', 'json', entry.repoDigest]);
    const provenance = capture('cosign', [
      'verify-attestation', '--key', publicKey, '--type', 'slsaprovenance', '--output', 'json', entry.repoDigest
    ]);
    await writeFile(signaturePath, signature, { mode: 0o600 });
    await writeFile(provenancePath, provenance, { mode: 0o600 });
    results.push({ imageId: entry.imageId, signatureSha256: sha256(signature), provenanceSha256: sha256(provenance) });
  }
  return { status: 'passed', evidence: results };
}

async function describeArtifact(path, kind, entry) {
  const content = await readFile(path);
  const information = await stat(path);
  if (information.size === 0) throw new Error(`Supply-chain artifact is empty: ${path}`);
  if (kind !== 'critical_gate') JSON.parse(content.toString('utf8'));
  return {
    kind,
    path: relative(stagingRoot, path).replace(/\\/g, '/'),
    bytes: information.size,
    sha256: sha256(content),
    imageId: entry.imageId,
    immutableReference: entry.immutableReference
  };
}

function safeStem(reference) {
  return reference.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

function requiredOption(arguments_, name) {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : null;
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function boundedInteger(rawValue, minimum, maximum, name) {
  if (!/^[0-9]+$/.test(rawValue)) throw new Error(`${name} must be an integer`);
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function run(command, args, timeout = 300_000) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit', windowsHide: true, timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(' ')} failed with exit ${result.status}`);
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 300_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(' ')} failed: ${String(result.stderr).trim()}`);
  return result.stdout;
}
