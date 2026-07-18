import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertConfigurationImageReferences,
  assertMigrationCompatibility,
  assertReleaseBundle,
  assertSafeImageReference,
  createImageLock,
  IMAGE_LOCK_SCHEMA,
  readSealedJson,
  RELEASE_MANIFEST_SCHEMA,
  RELEASE_PLAN_SCHEMA,
  sealDocument,
  sha256,
  verifyImageLock,
  verifySealedDocument,
  writeSealedDocument,
  writeSealedJson
} from './image-integrity-lib.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = join(stagingRoot, '.evidence', 'r5-image-integrity');
const contextPath = join(evidenceRoot, 'fixture-context.json');
const arguments_ = process.argv.slice(2);
if (arguments_.includes('--cleanup')) {
  await cleanupFromContext();
  process.stdout.write('{"status":"cleaned"}\n');
  process.exit(0);
}
if (arguments_.includes('--finalize-ci')) {
  await finalizeCiEvidence();
  if (!arguments_.includes('--retain-fixtures')) await cleanupFromContext();
  process.stdout.write('{"status":"finalized"}\n');
  process.exit(0);
}

const deferScan = arguments_.includes('--defer-scan');
const retainFixtures = arguments_.includes('--retain-fixtures');
const runId = `${Date.now()}-${process.pid}`;
const repository = `finance-agent/r5-integrity-${runId}`;
const v1Tag = `${repository}:v1`;
const v2Tag = `${repository}:v2`;
const mutableTag = `${repository}:candidate`;
const composeProject = `finance-agent-r5-${runId}`;
const temporaryRoot = await mkdtemp(join(tmpdir(), 'finance-agent-r5-'));
let imageIds = [];
let fixtureImageId = null;

await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
try {
  await writeFile(join(temporaryRoot, 'Dockerfile'), [
    'FROM nginx:1.28.0-alpine@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284',
    'ARG FIXTURE_VERSION',
    'ENV R5_FIXTURE_VERSION=${FIXTURE_VERSION}',
    'LABEL org.opencontainers.image.revision="r5-${FIXTURE_VERSION}"',
    ''
  ].join('\n'));
  buildFixture(v1Tag, 'v1');
  buildFixture(v2Tag, 'v2');
  run('docker', ['tag', v1Tag, mutableTag]);
  const v1ImageId = inspectImageId(v1Tag);
  const v2ImageId = inspectImageId(v2Tag);
  fixtureImageId = v1ImageId;
  imageIds = [v1ImageId, v2ImageId];
  if (v1ImageId === v2ImageId) throw new Error('Fixture builds did not produce distinct image identities');

  const lock = createImageLock({
    targets: [{
      requestedReference: mutableTag,
      uses: [{ scope: 'staging', kind: 'service', name: 'app' }]
    }],
    environmentBindings: { BACKEND_IMAGE: mutableTag },
    metadata: {
      identityPolicy: 'local_identity',
      sourceEnvironmentId: 'r5-ci-local',
      fixture: true
    }
  });
  const lockPath = join(evidenceRoot, 'fixture.images.lock.json');
  const lockWritten = await writeSealedDocument(lockPath, lock, IMAGE_LOCK_SCHEMA);
  const manifestPath = join(evidenceRoot, 'fixture.release.json');
  const migrations = {
    count: 1,
    latest: '20260718000000_r5_fixture',
    ledgerSha256: sha256('[fixture-migration]'),
    migrations: [{ name: '20260718000000_r5_fixture', checksum: 'a'.repeat(64) }]
  };
  const manifestWritten = await writeSealedJson(manifestPath, {
    schemaVersion: RELEASE_MANIFEST_SCHEMA,
    releaseId: `r5-fixture-${runId}`,
    createdAt: new Date().toISOString(),
    gitSha: '0'.repeat(40),
    migrations,
    imageLock: {
      path: relative(stagingRoot, lockPath).replace(/\\/g, '/'),
      fileSha256: lockWritten.fileSha256,
      contentSha256: lock.integrity.contentSha256
    }
  });
  assertReleaseBundle({ manifest: manifestWritten.document, lock, lockFileSha256: lockWritten.fileSha256 });

  const cases = [];
  const releasePlan = sealDocument({
    schemaVersion: RELEASE_PLAN_SCHEMA,
    releaseId: `r5-fixture-${runId}`,
    imageLock: {
      path: relative(stagingRoot, lockPath).replace(/\\/g, '/'),
      fileSha256: lockWritten.fileSha256,
      contentSha256: lock.integrity.contentSha256
    }
  });
  assertReleaseBundle({
    manifest: releasePlan,
    lock,
    lockFileSha256: lockWritten.fileSha256,
    expectedSchema: RELEASE_PLAN_SCHEMA
  });
  cases.push({ case: 'predeployment_manifest_lock_match', status: 'passed' });
  expectRejected(() => assertSafeImageReference('finance-agent/backend:latest'), 'latest_tag', cases);
  verifyImageLock(lock);
  cases.push({ case: 'baseline_lock', status: 'passed' });
  const configurationEvidence = {
    status: 'passed',
    checks: { imageIdentityPolicy: 'local_identity' },
    imageReferences: { app: mutableTag }
  };
  assertConfigurationImageReferences(configurationEvidence, lock);
  cases.push({ case: 'configuration_image_references', status: 'passed' });
  expectRejected(
    () => assertConfigurationImageReferences({
      ...configurationEvidence,
      imageReferences: { app: v2Tag }
    }, lock),
    'stale_configuration_image_reference',
    cases
  );

  const tamperedLock = structuredClone(lock);
  tamperedLock.entries[0].imageId = `sha256:${'f'.repeat(64)}`;
  expectRejected(() => verifySealedDocument(tamperedLock, IMAGE_LOCK_SCHEMA), 'lock_tamper', cases);
  const sidecarTamperPath = join(evidenceRoot, 'fixture.sidecar-tamper.json');
  await writeSealedDocument(sidecarTamperPath, lock, IMAGE_LOCK_SCHEMA);
  await appendFile(sidecarTamperPath, ' ');
  await expectRejectedAsync(
    () => readSealedJson(sidecarTamperPath, IMAGE_LOCK_SCHEMA),
    'lock_sidecar_tamper',
    cases
  );
  const aliasPath = join(evidenceRoot, 'fixture.current-lock.json');
  await writeSealedDocument(aliasPath, lock, IMAGE_LOCK_SCHEMA);
  await readSealedJson(aliasPath, IMAGE_LOCK_SCHEMA);
  cases.push({ case: 'sealed_alias_sidecar', status: 'passed' });
  const tamperedManifest = structuredClone(manifestWritten.document);
  tamperedManifest.releaseId = 'tampered';
  expectRejected(() => verifySealedDocument(tamperedManifest, RELEASE_MANIFEST_SCHEMA), 'manifest_tamper', cases);
  const mismatchedBundle = sealDocument({
    ...stripIntegrity(manifestWritten.document),
    imageLock: { ...manifestWritten.document.imageLock, fileSha256: 'b'.repeat(64) }
  });
  expectRejected(
    () => assertReleaseBundle({ manifest: mismatchedBundle, lock, lockFileSha256: lockWritten.fileSha256 }),
    'manifest_lock_mismatch',
    cases
  );

  run('docker', ['tag', v2Tag, mutableTag]);
  expectRejected(() => verifyImageLock(lock), 'mutable_tag_drift', cases);
  const fixtureComposePath = join(temporaryRoot, 'compose.yaml');
  await writeFile(fixtureComposePath, [
    'services:',
    '  app:',
    '    image: ${APP_IMAGE:?APP_IMAGE is required}',
    '    entrypoint: ["/bin/sh", "-c"]',
    '    command: ["test \\\"$$R5_FIXTURE_VERSION\\\" = \\\"v1\\\" && sleep 60"]',
    ''
  ].join('\n'));
  runWithEnv('docker', [
    'compose', '-p', composeProject, '-f', fixtureComposePath,
    'up', '-d', '--no-build', '--pull', 'never', 'app'
  ], { ...process.env, APP_IMAGE: v1ImageId });
  const rollbackContainerId = captureWithEnv('docker', [
    'compose', '-p', composeProject, '-f', fixtureComposePath, 'ps', '-a', '-q', 'app'
  ], { ...process.env, APP_IMAGE: v1ImageId }).trim();
  const rollbackContainer = capture('docker', [
    'container', 'inspect', rollbackContainerId, '--format', '{{.State.Running}}|{{.Image}}'
  ]).trim();
  if (rollbackContainer !== `true|${v1ImageId}`) {
    throw new Error(`R5 rollback container identity mismatch: ${rollbackContainer}`);
  }
  cases.push({ case: 'immutable_rollback_smoke', status: 'passed' });
  cases.push({ case: 'running_container_identity', status: 'passed' });
  runWithEnv(
    'docker',
    ['compose', '-p', composeProject, '-f', fixtureComposePath, 'down', '-v', '--remove-orphans'],
    { ...process.env, APP_IMAGE: v1ImageId }
  );
  const residualContainers = capture('docker', [
    'ps', '-a', '--filter', `label=com.docker.compose.project=${composeProject}`, '--format', '{{.ID}}'
  ]).trim();
  const residualNetworks = capture('docker', [
    'network', 'ls', '--filter', `label=com.docker.compose.project=${composeProject}`, '--format', '{{.ID}}'
  ]).trim();
  if (residualContainers || residualNetworks) throw new Error('R5 isolated rollback project was not fully cleaned');
  cases.push({ case: 'isolated_rollback_cleanup', status: 'passed' });
  expectRejected(
    () => assertMigrationCompatibility(migrations, [
      ...migrations.migrations,
      { name: '20260718000001_unapproved', checksum: 'b'.repeat(64) }
    ]),
    'newer_database_migration',
    cases
  );
  expectRejected(
    () => assertMigrationCompatibility(migrations, [{ ...migrations.migrations[0], checksum: 'c'.repeat(64) }]),
    'migration_checksum_tamper',
    cases
  );
  run('docker', ['tag', v1Tag, mutableTag]);
  verifyImageLock(lock);
  cases.push({ case: 'tag_binding_restored', status: 'passed' });

  await writeFile(contextPath, JSON.stringify({
    schemaVersion: 'r5-fixture-context/1.0',
    repository,
    tags: [v1Tag, v2Tag, mutableTag],
    imageIds,
    fixtureImage: v1Tag,
    immutableImage: v1ImageId,
    lockPath: relative(stagingRoot, lockPath).replace(/\\/g, '/'),
    manifestPath: relative(stagingRoot, manifestPath).replace(/\\/g, '/')
  }, null, 2) + '\n', { mode: 0o600 });
  await writeSealedJson(join(evidenceRoot, 'image-integrity-test.json'), {
    schemaVersion: 'staging-image-integrity-test/1.0',
    completedAt: new Date().toISOString(),
    status: 'passed',
    cases,
    caseCount: cases.length,
    fixture: {
      imageId: v1ImageId,
      mutableReference: mutableTag,
      manifestSha256: manifestWritten.fileSha256,
      imageLockSha256: lockWritten.fileSha256
    },
    scope: 'synthetic_local_image_identity_only'
  });

  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, [
      `R5_FIXTURE_IMAGE=${v1Tag}`,
      `R5_EVIDENCE_DIR=${relative(resolve(stagingRoot, '../..'), evidenceRoot).replace(/\\/g, '/')}`,
      ''
    ].join('\n'));
  }
  if (!deferScan) {
    run('node', [
      join(stagingRoot, 'scripts', 'scan-image-lock.mjs'),
      '--lock', lockPath,
      '--output', join(evidenceRoot, 'local-scan')
    ]);
  }
  process.stdout.write(JSON.stringify({
    status: 'passed',
    cases: cases.length,
    deferredScan: deferScan,
    fixtureImage: v1Tag,
    evidenceRoot
  }, null, 2) + '\n');
} finally {
  if (fixtureImageId) {
    runAllowFailureWithEnv(
      'docker',
      ['compose', '-p', composeProject, '-f', join(temporaryRoot, 'compose.yaml'), 'down', '-v', '--remove-orphans'],
      { ...process.env, APP_IMAGE: fixtureImageId }
    );
  }
  await rm(temporaryRoot, { recursive: true, force: true });
  if (!retainFixtures) await cleanupImages([v1Tag, v2Tag, mutableTag], imageIds);
}

async function finalizeCiEvidence() {
  if (process.env.R5_CRITICAL_GATE_PASSED !== 'true') {
    throw new Error('R5_CRITICAL_GATE_PASSED=true is required after the Docker Scout critical gate');
  }
  const context = JSON.parse(await readFile(contextPath, 'utf8'));
  validateContext(context);
  const lockPath = resolve(stagingRoot, context.lockPath);
  const manifestPath = resolve(stagingRoot, context.manifestPath);
  const { document: lock, fileSha256: lockFileSha256 } = await readSealedJson(lockPath, IMAGE_LOCK_SCHEMA);
  const { document: manifest } = await readSealedJson(manifestPath, RELEASE_MANIFEST_SCHEMA);
  assertReleaseBundle({ manifest, lock, lockFileSha256 });
  const artifacts = [];
  for (const [kind, fileName] of [
    ['spdx_sbom', 'fixture.spdx.json'],
    ['grype_sarif', 'fixture.grype.sarif.json']
  ]) {
    const path = join(evidenceRoot, fileName);
    const content = await readFile(path);
    JSON.parse(content.toString('utf8'));
    artifacts.push({ kind, path: fileName, bytes: content.byteLength, sha256: sha256(content) });
  }
  const critical = await readFile(join(evidenceRoot, 'fixture.critical-fixed.txt'));
  if (critical.byteLength === 0) throw new Error('Grype critical gate evidence is empty');
  artifacts.push({ kind: 'critical_gate', path: 'fixture.critical-fixed.txt', bytes: critical.byteLength, sha256: sha256(critical) });
  await writeSealedJson(join(evidenceRoot, 'ci-supply-chain-index.json'), {
    schemaVersion: 'r5-ci-supply-chain/1.0',
    createdAt: new Date().toISOString(),
    fixtureImageId: context.immutableImage,
    imageLockSha256: lockFileSha256,
    artifacts,
    gates: {
      sbom: 'passed',
      criticalHighScan: 'passed',
      fixableCritical: 'passed',
      rollbackIntegrity: 'passed'
    },
    scope: 'synthetic_ci_fixture_not_release_approval'
  });
}

async function cleanupFromContext() {
  try {
    const context = JSON.parse(await readFile(contextPath, 'utf8'));
    validateContext(context);
    await cleanupImages(context.tags, context.imageIds);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function validateContext(context) {
  if (context?.schemaVersion !== 'r5-fixture-context/1.0'
    || !Array.isArray(context.tags)
    || !context.tags.every((tag) => /^finance-agent\/r5-integrity-[0-9]+-[0-9]+:(?:v1|v2|candidate)$/.test(tag))
    || !Array.isArray(context.imageIds)
    || !context.imageIds.every((id) => /^sha256:[a-f0-9]{64}$/.test(id))) {
    throw new Error('R5 fixture cleanup context is invalid');
  }
}

async function cleanupImages(tags, ids) {
  for (const tag of [...new Set(tags)]) runAllowFailure('docker', ['image', 'rm', tag]);
  for (const id of [...new Set(ids)]) {
    const inspect = spawnSync('docker', ['image', 'inspect', id, '--format', '{{json .RepoTags}}'], {
      encoding: 'utf8', windowsHide: true
    });
    if (inspect.status !== 0) continue;
    const remainingTags = JSON.parse(inspect.stdout.trim() || 'null');
    if (remainingTags === null || remainingTags.length === 0) runAllowFailure('docker', ['image', 'rm', id]);
  }
}

function buildFixture(tag, version) {
  run('docker', [
    'build', '--pull=false', '--build-arg', `FIXTURE_VERSION=${version}`,
    '--tag', tag, '--file', join(temporaryRoot, 'Dockerfile'), temporaryRoot
  ]);
}

function inspectImageId(reference) {
  return capture('docker', ['image', 'inspect', reference, '--format', '{{.Id}}']).trim();
}

function expectRejected(action, name, cases) {
  try {
    action();
  } catch {
    cases.push({ case: name, status: 'rejected' });
    return;
  }
  throw new Error(`Fault injection was not rejected: ${name}`);
}

async function expectRejectedAsync(action, name, cases) {
  try {
    await action();
  } catch {
    cases.push({ case: name, status: 'rejected' });
    return;
  }
  throw new Error(`Fault injection was not rejected: ${name}`);
}

function stripIntegrity(document) {
  const { integrity: _ignored, ...payload } = document;
  return payload;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit', windowsHide: true, timeout: 600_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(' ')} failed with exit ${result.status}`);
}

function runWithEnv(command, args, environment) {
  const result = spawnSync(command, args, {
    env: environment,
    encoding: 'utf8',
    stdio: 'inherit',
    windowsHide: true,
    timeout: 600_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 2).join(' ')} failed with exit ${result.status}`);
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 60_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  return result.stdout;
}

function captureWithEnv(command, args, environment) {
  const result = spawnSync(command, args, {
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 60_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
  return result.stdout;
}

function runAllowFailure(command, args) {
  spawnSync(command, args, { encoding: 'utf8', stdio: 'ignore', windowsHide: true, timeout: 60_000 });
}

function runAllowFailureWithEnv(command, args, environment) {
  spawnSync(command, args, {
    env: environment,
    encoding: 'utf8',
    stdio: 'ignore',
    windowsHide: true,
    timeout: 60_000
  });
}
