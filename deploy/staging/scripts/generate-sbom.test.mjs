import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  canonicalizeDirectorySource,
  ensureOutputDirectory,
  normalizeSource,
  parseSyftVersion,
  PINNED_SYFT_VERSION,
  resolveExpectedSyftVersion,
  resolveOutputPath,
  validateSpdxDocument
} from './generate-sbom.mjs';

const fixtureRoot = resolve('sbom-contract-fixture');

test('accepts local Docker image and repository directory sources', () => {
  assert.equal(normalizeSource('docker:finance-agent/backend:ci-abc', fixtureRoot), 'docker:finance-agent/backend:ci-abc');
  assert.equal(normalizeSource('docker:sha256:' + 'a'.repeat(64), fixtureRoot), 'docker:sha256:' + 'a'.repeat(64));
  assert.equal(normalizeSource('dir:deploy/staging/scripts', fixtureRoot), `dir:${join(fixtureRoot, 'deploy/staging/scripts')}`);
});

test('rejects remote, malformed, traversal, whitespace, and control-character sources', () => {
  for (const source of [
    'registry:example.invalid/image:tag',
    'docker:',
    'docker:example.invalid/image with-space:tag',
    'docker:example.invalid/image:tag\nforged',
    'dir:../outside'
  ]) {
    assert.throws(() => normalizeSource(source, fixtureRoot));
  }
});

test('keeps SPDX output inside the repository and requires the expected suffix', () => {
  assert.equal(
    resolveOutputPath('deploy/staging/.evidence/backend.spdx.json', fixtureRoot),
    join(fixtureRoot, 'deploy/staging/.evidence/backend.spdx.json')
  );
  assert.throws(() => resolveOutputPath('../outside.spdx.json', fixtureRoot));
  assert.throws(() => resolveOutputPath('deploy/staging/.evidence/backend.json', fixtureRoot));
});

test('rejects directory sources and outputs that escape through symbolic links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'finance-agent-sbom-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'finance-agent-sbom-outside-'));
  try {
    await mkdir(join(root, 'inside'));
    assert.equal(
      await canonicalizeDirectorySource(normalizeSource('dir:inside', root), root),
      `dir:${await realpath(join(root, 'inside'))}`
    );

    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(outside, join(root, 'escaped'), linkType);
    await assert.rejects(() => canonicalizeDirectorySource(normalizeSource('dir:escaped', root), root));
    await assert.rejects(() => ensureOutputDirectory(resolveOutputPath('escaped/result.spdx.json', root), root));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('requires the pinned Syft semantic version', () => {
  assert.equal(parseSyftVersion(`Application: syft\nVersion: ${PINNED_SYFT_VERSION}\n`), PINNED_SYFT_VERSION);
  assert.equal(parseSyftVersion(`Version: v${PINNED_SYFT_VERSION}\r\n`), PINNED_SYFT_VERSION);
  assert.throws(() => parseSyftVersion('syft unknown'));
});

test('does not allow environment configuration to weaken the pinned Syft version', () => {
  assert.equal(resolveExpectedSyftVersion(undefined), PINNED_SYFT_VERSION);
  assert.equal(resolveExpectedSyftVersion(PINNED_SYFT_VERSION), PINNED_SYFT_VERSION);
  assert.throws(() => resolveExpectedSyftVersion('1.43.1'));
  assert.throws(() => resolveExpectedSyftVersion(''));
});

test('accepts a minimal SPDX document and rejects incomplete output', () => {
  const valid = {
    spdxVersion: 'SPDX-2.3',
    SPDXID: 'SPDXRef-DOCUMENT',
    documentNamespace: 'https://example.invalid/spdx/fixture',
    creationInfo: { creators: [`Tool: syft-${PINNED_SYFT_VERSION}`] },
    packages: []
  };
  assert.equal(validateSpdxDocument(valid), valid);
  assert.throws(() => validateSpdxDocument({ ...valid, packages: null }));
  assert.throws(() => validateSpdxDocument({ ...valid, SPDXID: 'SPDXRef-Package' }));
});
