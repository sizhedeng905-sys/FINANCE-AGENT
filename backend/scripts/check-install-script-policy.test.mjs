import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectInstallScriptPackages,
  packageNameFromLockPath,
  validateInstallScriptPolicy
} from './check-install-script-policy.mjs';

function lockfile(packages) {
  return { lockfileVersion: 3, packages };
}

test('extracts unscoped, scoped, and nested package names from lock paths', () => {
  assert.equal(packageNameFromLockPath('node_modules/esbuild'), 'esbuild');
  assert.equal(packageNameFromLockPath('node_modules/@prisma/client'), '@prisma/client');
  assert.equal(packageNameFromLockPath('node_modules/playwright/node_modules/fsevents'), 'fsevents');
  assert.throws(() => packageNameFromLockPath('packages/esbuild'));
});

test('collects only packages with install scripts and deduplicates identities', () => {
  const result = collectInstallScriptPackages(lockfile({
    'node_modules/esbuild': { version: '1.2.3', hasInstallScript: true },
    'node_modules/tool': { version: '2.0.0' },
    'node_modules/parent/node_modules/esbuild': { version: '1.2.3', hasInstallScript: true, optional: true }
  }));
  assert.deepEqual(result, [{ identity: 'esbuild@1.2.3', name: 'esbuild', version: '1.2.3', optionalOnly: false }]);
});

test('accepts exact approvals and package-wide denials', () => {
  const result = validateInstallScriptPolicy({
    workspaceName: 'fixture',
    packageJson: { allowScripts: { 'esbuild@1.2.3': true, fsevents: false, '@scarf/scarf': false } },
    lockfile: lockfile({
      'node_modules/esbuild': { version: '1.2.3', hasInstallScript: true },
      'node_modules/fsevents': { version: '2.3.3', hasInstallScript: true, optional: true },
      'node_modules/@scarf/scarf': { version: '1.4.0', hasInstallScript: true }
    })
  });
  assert.deepEqual(result, {
    workspaceName: 'fixture',
    installScriptPackageCount: 3,
    approvedCount: 1,
    deniedCount: 2
  });
});

test('rejects a missing decision for a new install script', () => {
  assert.throws(
    () => validateInstallScriptPolicy({
      packageJson: { allowScripts: {} },
      lockfile: lockfile({ 'node_modules/esbuild': { version: '1.2.3', hasInstallScript: true } })
    }),
    /requires an exact-version approval/
  );
});

test('rejects package-wide approvals and stale exact approvals', () => {
  for (const policy of [{ esbuild: true }, { 'esbuild@1.2.2': true }]) {
    assert.throws(
      () => validateInstallScriptPolicy({
        packageJson: { allowScripts: policy },
        lockfile: lockfile({ 'node_modules/esbuild': { version: '1.2.3', hasInstallScript: true } })
      }),
      /approvals must match an exact current package version/
    );
  }
});

test('rejects approval of a package that must remain denied', () => {
  assert.throws(
    () => validateInstallScriptPolicy({
      packageJson: { allowScripts: { '@scarf/scarf@1.4.0': true } },
      lockfile: lockfile({ 'node_modules/@scarf/scarf': { version: '1.4.0', hasInstallScript: true } })
    }),
    /must be explicitly denied/
  );
});

test('rejects conflicting, stale, and non-boolean policy entries', () => {
  const fixture = lockfile({ 'node_modules/esbuild': { version: '1.2.3', hasInstallScript: true } });
  assert.throws(() => validateInstallScriptPolicy({
    packageJson: { allowScripts: { esbuild: false, 'esbuild@1.2.3': true } },
    lockfile: fixture
  }), /conflicts with package-wide denial/);
  assert.throws(() => validateInstallScriptPolicy({
    packageJson: { allowScripts: { 'esbuild@1.2.3': true, stale: false } },
    lockfile: fixture
  }), /denied package is not present/);
  assert.throws(() => validateInstallScriptPolicy({
    packageJson: { allowScripts: { 'esbuild@1.2.3': 'yes' } },
    lockfile: fixture
  }), /must be boolean/);
});
