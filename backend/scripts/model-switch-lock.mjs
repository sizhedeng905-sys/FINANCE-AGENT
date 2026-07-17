import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const LOCK_STALE_MS = 24 * 60 * 60 * 1000;

export class ModelSwitchLockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ModelSwitchLockError';
  }
}

export async function acquireModelSwitchLock(options) {
  const stateRoot = path.resolve(options.stateRoot);
  const lockDirectory = path.join(stateRoot, 'switch.lock');
  const ownerFile = path.join(lockDirectory, 'owner.json');
  await mkdir(stateRoot, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDirectory);
      const owner = {
        token: randomUUID(),
        pid: process.pid,
        operation: options.operation,
        acquiredAt: new Date().toISOString()
      };
      await writeFile(ownerFile, `${JSON.stringify(owner, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      return createLockHandle(stateRoot, lockDirectory, ownerFile, owner);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readLockOwner(ownerFile, lockDirectory);
      if (!isStale(existing)) {
        throw new ModelSwitchLockError(
          `Another model transition is active (pid=${existing.pid ?? 'unknown'}, operation=${existing.operation ?? 'unknown'}).`
        );
      }
      await reapStaleLock(ownerFile, lockDirectory);
    }
  }
  throw new ModelSwitchLockError('Could not acquire the model transition lock.');
}

export async function withModelSwitchLock(options, operation) {
  const lock = await acquireModelSwitchLock(options);
  try {
    return await operation(lock);
  } finally {
    await lock.release();
  }
}

export async function readModelState(stateRoot) {
  try {
    return JSON.parse(await readFile(path.join(path.resolve(stateRoot), 'state.json'), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function createLockHandle(stateRoot, lockDirectory, ownerFile, owner) {
  let released = false;
  return {
    owner,
    async transition(status, details = {}) {
      if (released) throw new ModelSwitchLockError('Cannot write model state after releasing the lock.');
      const state = {
        status,
        operation: owner.operation,
        operationId: owner.token,
        pid: owner.pid,
        updatedAt: new Date().toISOString(),
        ...details
      };
      const temporary = path.join(stateRoot, `state.${owner.token}.tmp`);
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, path.join(stateRoot, 'state.json'));
      return state;
    },
    async release() {
      if (released) return;
      released = true;
      const current = await readLockOwner(ownerFile, lockDirectory);
      if (current.token !== owner.token) {
        throw new ModelSwitchLockError('Model transition lock ownership changed before release.');
      }
      await unlink(ownerFile);
      await rmdir(lockDirectory);
    }
  };
}

async function readLockOwner(ownerFile, lockDirectory) {
  try {
    return JSON.parse(await readFile(ownerFile, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    const details = await stat(lockDirectory);
    return { pid: undefined, operation: undefined, acquiredAt: details.mtime.toISOString() };
  }
}

function isStale(owner) {
  const acquiredAt = Date.parse(owner.acquiredAt ?? '');
  if (!Number.isFinite(acquiredAt) || Date.now() - acquiredAt > LOCK_STALE_MS) return true;
  if (!Number.isInteger(owner.pid) || owner.pid < 1) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

async function reapStaleLock(ownerFile, lockDirectory) {
  await unlink(ownerFile).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  await rmdir(lockDirectory).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
