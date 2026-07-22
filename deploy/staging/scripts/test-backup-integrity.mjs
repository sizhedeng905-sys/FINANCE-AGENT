import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = 'finance-agent/staging-backup:integrity-test';

run('docker', ['build', '-t', image, 'backup']);
run('docker', ['run', '--rm', '--entrypoint', '/opt/staging/integrity-self-test.sh', image]);
expectFailure(
  ['run', '--rm', '--entrypoint', '/opt/staging/run-backup.sh', image],
  'backup_must_run_as_postgres_uid_999'
);
expectFailure(
  ['run', '--rm', '--entrypoint', '/opt/staging/restore-drill.sh', image],
  'restore_drill_must_run_as_postgres_uid_999'
);
expectFailure([
  'run', '--rm', '--user', '999:999',
  '-e', 'BACKUP_LOCK_FILE=/tmp/finance-agent-backup-test.lock',
  '-e', 'BACKUP_REQUIRED_AFTER_EPOCH=invalid',
  '--entrypoint', '/opt/staging/run-backup.sh', image
], 'backup_required_after_epoch_invalid');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: stagingRoot,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function expectFailure(args, expectedCategory) {
  const result = spawnSync('docker', args, {
    cwd: stagingRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.notEqual(result.status, 0, `${expectedCategory} unexpectedly succeeded`);
  assert.match(`${result.stdout ?? ''}\n${result.stderr ?? ''}`, new RegExp(expectedCategory));
}
