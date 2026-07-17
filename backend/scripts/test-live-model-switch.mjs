import { spawn, spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readModelState } from './model-switch-lock.mjs';

const kind = process.argv[2] || 'vl';
if (!['vl', 'embedding'].includes(kind)) throw new Error('Live model switch test requires vl or embedding.');

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const stateRoot = path.join(repositoryRoot, 'deploy', 'model-services', '.state');
const modelScript = path.join(scriptDirectory, 'model-services.mjs');
let firstOutput = '';
let acceptanceError;

try {
  const first = spawn(process.execPath, [modelScript, 'start-on-demand', kind], {
    cwd: path.join(repositoryRoot, 'backend'),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  first.stdout.on('data', (chunk) => { firstOutput += chunk.toString(); });
  first.stderr.on('data', (chunk) => { firstOutput += chunk.toString(); });
  const firstExit = new Promise((resolve, reject) => {
    first.once('error', reject);
    first.once('exit', resolve);
  });
  await waitForActiveLock();

  const concurrent = spawnSync(process.execPath, [modelScript, 'start-on-demand', kind], {
    cwd: path.join(repositoryRoot, 'backend'),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000
  });
  const concurrentOutput = `${concurrent.stdout || ''}${concurrent.stderr || ''}`;
  if (concurrent.status === 0 || !concurrentOutput.includes('Another model transition is active')) {
    throw new Error(`Concurrent live model transition was not rejected: ${concurrentOutput}`);
  }

  const exitCode = await firstExit;
  if (exitCode !== 0) throw new Error(`Primary live model transition failed (${exitCode}).\n${tail(firstOutput)}`);
  if (/out of memory|cuda.*oom/i.test(firstOutput)) throw new Error(`GPU OOM appeared during the live transition.\n${tail(firstOutput)}`);
  const switched = await readModelState(stateRoot);
  if (switched?.status !== 'on_demand_ready') {
    throw new Error(`Unexpected state after live switch: ${switched?.status ?? 'missing'}`);
  }
} catch (error) {
  acceptanceError = error;
} finally {
  const restore = spawnSync(process.execPath, [modelScript, 'stop-on-demand'], {
    cwd: path.join(repositoryRoot, 'backend'),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024
  });
  if (restore.status !== 0) {
    const restoreError = new Error(`Could not restore qwen-text after the live switch test.\n${tail(`${restore.stdout || ''}${restore.stderr || ''}`)}`);
    acceptanceError = acceptanceError
      ? new AggregateError([acceptanceError, restoreError], 'Live switch and restoration failed.')
      : restoreError;
  }
}

if (acceptanceError) throw acceptanceError;
const finalState = await readModelState(stateRoot);
if (finalState?.status !== 'resident_ready') throw new Error(`Unexpected final model state: ${finalState?.status ?? 'missing'}`);
console.log(`Live ${kind} switch passed: one concurrent winner, no OOM, deterministic resident restoration.`);

async function waitForActiveLock() {
  const ownerPath = path.join(stateRoot, 'switch.lock', 'owner.json');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    try {
      await access(ownerPath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Primary model transition did not acquire the cross-process lock.');
}

function tail(value) {
  return value.slice(-12_000);
}
