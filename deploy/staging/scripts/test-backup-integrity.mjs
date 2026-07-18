import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const image = 'finance-agent/staging-backup:integrity-test';

run('docker', ['build', '-t', image, 'backup']);
run('docker', ['run', '--rm', '--entrypoint', '/opt/staging/integrity-self-test.sh', image]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: stagingRoot,
    encoding: 'utf8',
    stdio: 'inherit'
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}
