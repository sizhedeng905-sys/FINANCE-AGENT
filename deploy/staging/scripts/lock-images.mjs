import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compose = JSON.parse(run('docker', ['compose', '--env-file', '.env', '-f', 'compose.yaml', 'config', '--format', 'json']).stdout);
const uniqueImages = [...new Set(Object.values(compose.services).map((service) => service.image))].sort();
const locks = [];
for (const image of uniqueImages) {
  const inspected = spawnSync('docker', ['image', 'inspect', image, '--format', '{{json .RepoDigests}}|{{.Id}}'], {
    cwd: stagingRoot,
    encoding: 'utf8',
    timeout: 20_000
  });
  if (inspected.status === 0) {
    const [repoDigestsRaw, imageId] = inspected.stdout.trim().split('|');
    const repoDigests = JSON.parse(repoDigestsRaw || '[]');
    locks.push({ image, digestReference: repoDigests[0] ?? null, imageId, source: repoDigests[0] ? 'registry' : 'local' });
    continue;
  }
  const remote = spawnSync('docker', [
    'buildx', 'imagetools', 'inspect', image, '--format', '{{json .Manifest.Digest}}'
  ], { cwd: stagingRoot, encoding: 'utf8', timeout: 30_000 });
  if (remote.status !== 0) {
    locks.push({ image, digestReference: null, imageId: null, source: 'unresolved' });
    continue;
  }
  const digest = JSON.parse(remote.stdout.trim());
  locks.push({ image, digestReference: `${image.split(':')[0]}@${digest}`, imageId: null, source: 'registry' });
}

const unresolved = locks.filter((item) => item.source === 'unresolved');
const result = {
  status: unresolved.length === 0 ? 'passed' : 'blocked_registry',
  createdAt: new Date().toISOString(),
  locks,
  unresolved: unresolved.map((item) => item.image)
};
const releaseRoot = join(stagingRoot, '.release');
await mkdir(releaseRoot, { recursive: true });
await writeFile(join(releaseRoot, 'images.lock.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (unresolved.length > 0) process.exitCode = 2;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: stagingRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${command} failed: ${String(result.stderr).trim()}`);
  return result;
}
