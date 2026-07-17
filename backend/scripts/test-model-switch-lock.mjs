import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquireModelSwitchLock } from './model-switch-lock.mjs';

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[2] === '--worker') {
  await worker(process.argv[3], Number(process.argv[4] ?? 0));
} else {
  await selfTest();
}

async function worker(stateRoot, holdMs) {
  try {
    const lock = await acquireModelSwitchLock({ stateRoot, operation: `self-test:${process.pid}` });
    await lock.transition('switching', { workerPid: process.pid });
    console.log('LOCKED');
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    await lock.transition('resident_ready', { workerPid: process.pid });
    await lock.release();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}

async function selfTest() {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'finance-agent-model-lock-'));
  try {
    const first = spawn(process.execPath, [scriptPath, '--worker', stateRoot, '750'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const firstExit = new Promise((resolve, reject) => {
      first.once('error', reject);
      first.once('exit', resolve);
    });
    await waitForLock(first);

    const concurrent = spawnSync(process.execPath, [scriptPath, '--worker', stateRoot, '0'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (concurrent.status === 0 || !concurrent.stderr.includes('Another model transition is active')) {
      throw new Error(`Concurrent lock attempt was not rejected deterministically: ${concurrent.stderr}`);
    }

    const firstStatus = await firstExit;
    if (firstStatus !== 0) throw new Error(`First lock worker exited with ${firstStatus}.`);

    const next = spawnSync(process.execPath, [scriptPath, '--worker', stateRoot, '0'], {
      encoding: 'utf8',
      windowsHide: true
    });
    if (next.status !== 0) throw new Error(`Lock was not reusable after release: ${next.stderr}`);
    const state = JSON.parse(await readFile(path.join(stateRoot, 'state.json'), 'utf8'));
    if (state.status !== 'resident_ready') throw new Error(`Unexpected final model state: ${state.status}`);
    console.log('Model switch lock self-test passed: one concurrent winner and a deterministic final state.');
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
}

function waitForLock(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for lock worker. ${stderr}`)), 5000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes('LOCKED')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      if (!stdout.includes('LOCKED')) {
        clearTimeout(timer);
        reject(new Error(`Lock worker exited before acquiring the lock (${code}). ${stderr}`));
      }
    });
  });
}
