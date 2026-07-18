import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createRuntimeLogEvidence,
  locateExactSecretMatches,
} from './runtime-log-policy.mjs';

const stagingRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const secretsRoot = join(stagingRoot, '.secrets');
const evidenceRoot = join(stagingRoot, '.evidence');
const secretEntries = [];
for (const entry of await readdir(secretsRoot, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const value = (await readFile(join(secretsRoot, entry.name), 'utf8')).trim();
  if (value.length >= 8) secretEntries.push({ name: entry.name, value });
}

const result = spawnSync(
  'docker',
  ['compose', '--env-file', '.env', '-f', 'compose.yaml', 'logs', '--no-color', '--timestamps', '--tail', '20000'],
  {
    cwd: stagingRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
  },
);
if (result.error || result.status !== 0) throw new Error('Unable to collect staging runtime logs');

const logs = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const evidence = {
  ...createRuntimeLogEvidence(logs, secretEntries.map((entry) => entry.value)),
  exactSecretMatches: locateExactSecretMatches(logs, secretEntries),
  generatedAt: new Date().toISOString(),
  source: 'docker-compose-logs-tail-20000',
};
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
const evidencePath = join(evidenceRoot, 'runtime-log-verification.json');
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
if (evidence.status !== 'passed') {
  throw new Error(`Runtime log verification failed: ${evidence.findingCategories.join(', ')}`);
}
process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath })}\n`);
