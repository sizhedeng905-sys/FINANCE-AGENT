import { spawnSync } from 'node:child_process';
import path from 'node:path';

describe('cross-process model switch lock', () => {
  it('allows one concurrent winner and leaves a deterministic atomic state', () => {
    const script = path.resolve(process.cwd(), 'scripts', 'test-model-switch-lock.mjs');
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15_000
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('one concurrent winner and a deterministic final state');
  });
});
