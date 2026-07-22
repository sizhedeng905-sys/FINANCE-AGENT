import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function globalTeardown() {
  const root = resolve(import.meta.dirname, '..');
  const result = spawnSync(process.execPath, [resolve(root, 'backend/scripts/cleanup-e2e.mjs')], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`E2E cleanup failed with exit code ${result.status ?? 'unknown'}.`);
  }
}
