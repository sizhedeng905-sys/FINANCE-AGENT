import { ConfigService } from '@nestjs/config';
import { FileScanStatus, RawFileStatus } from '@prisma/client';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lastValueFrom, of } from 'rxjs';

import { FileStorageMaintenanceService } from '../src/files/file-storage-maintenance.service';
import { UploadAdmissionInterceptor } from '../src/files/upload-admission.interceptor';
import { UploadAdmissionService } from '../src/files/upload-admission.service';

function config(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('upload resource and storage safety', () => {
  it('limits per-user concurrency, in-flight bytes, and request rate with idempotent release', async () => {
    const service = new UploadAdmissionService(config({
      'uploadAdmission.store': 'memory',
      'uploadAdmission.maxConcurrentPerUser': 2,
      'uploadAdmission.maxInFlightMbPerUser': 1,
      'uploadAdmission.rateWindowMs': 60_000,
      'uploadAdmission.rateMaxPerUser': 3,
      'uploadAdmission.leaseMs': 30_000
    }), {} as any);
    const first = await service.reserve('finance_1', 400_000);
    const second = await service.reserve('finance_1', 400_000);
    await expect(service.activeFor('finance_1')).resolves.toEqual({ count: 2, bytes: 800_000 });
    await expect(service.reserve('finance_1', 100_000)).rejects.toThrow('Concurrent upload limit exceeded');
    await service.release(first);
    await service.release(first);
    await expect(service.activeFor('finance_1')).resolves.toEqual({ count: 1, bytes: 400_000 });
    await service.release(second);
    await expect(service.activeFor('finance_1')).resolves.toEqual({ count: 0, bytes: 0 });
    await expect(service.reserve('finance_1', 100_000)).rejects.toThrow('Upload rate limit exceeded');
    await expect(service.reserve('finance_2', 2 * 1024 * 1024)).rejects.toThrow('in-flight byte limit');
    await expect(service.reserve('finance_3', Number.NaN)).rejects.toThrow('Content-Length');
  });

  it('releases an upload reservation when a downstream interceptor throws synchronously', async () => {
    const reservation = { store: 'memory', token: 'token', userKey: 'finance_1', contentLength: 1024, finished: false };
    const admission = {
      reserve: jest.fn(async () => reservation),
      release: jest.fn(async () => undefined),
      renewalIntervalMs: jest.fn(() => undefined)
    };
    const interceptor = new UploadAdmissionInterceptor(admission as any);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'finance_1' }, headers: { 'content-length': '1024' } })
      })
    } as any;

    await expect(interceptor.intercept(context, { handle: () => { throw new Error('downstream failure'); } } as any))
      .rejects.toThrow('downstream failure');
    expect(admission.release).toHaveBeenCalledTimes(1);
    expect(admission.release).toHaveBeenCalledWith(reservation);
  });

  it('waits for a healthy shared release before completing an upload response', async () => {
    const reservation = { store: 'redis', token: 'token', userKey: 'finance_1', contentLength: 1024, finished: false };
    let allowRelease!: () => void;
    const admission = {
      reserve: jest.fn(async () => reservation),
      release: jest.fn(() => new Promise<void>((resolve) => {
        allowRelease = resolve;
      })),
      renew: jest.fn(async () => undefined),
      renewalIntervalMs: jest.fn(() => 30_000)
    };
    const interceptor = new UploadAdmissionInterceptor(admission as any);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'finance_1' }, headers: { 'content-length': '1024' } })
      })
    } as any;

    const stream = await interceptor.intercept(context, { handle: () => of({ uploaded: true }) } as any);
    let completed = false;
    const result = lastValueFrom(stream).finally(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(admission.release).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    allowRelease();
    await expect(result).resolves.toEqual({ uploaded: true });
    expect(completed).toBe(true);
  });

  it('removes stale and invalid quarantine files while retaining a fresh server-generated upload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finance-agent-quarantine-'));
    const stale = '123e4567-e89b-42d3-a456-426614174000';
    const fresh = '223e4567-e89b-42d3-a456-426614174001';
    await writeFile(join(root, stale), 'stale');
    await writeFile(join(root, fresh), 'fresh');
    await writeFile(join(root, 'attacker-name'), 'invalid');
    const old = new Date(Date.now() - 120_000);
    await utimes(join(root, stale), old, old);

    const service = new FileStorageMaintenanceService(
      {} as any,
      {} as any,
      config({ uploadQuarantineDir: root, uploadQuarantineMaxAgeMs: 60_000 })
    );
    try {
      await expect(service.cleanupStaleQuarantine()).resolves.toEqual({ removed: 2 });
      expect(await readdir(root)).toEqual([fresh]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed for missing database files, removes voided remnants, and defers unknown objects', async () => {
    const records = [
      { id: 'active-present', storagePath: '2026/07/present.pdf', isVoided: false },
      { id: 'active-missing', storagePath: '2026/07/missing.pdf', isVoided: false },
      { id: 'voided', storagePath: '2026/07/voided.pdf', isVoided: true }
    ];
    const tx = {
      rawFile: { updateMany: jest.fn(async () => ({ count: 1 })) },
      auditLog: { create: jest.fn(async () => ({})) }
    };
    const prisma = {
      rawFile: { findMany: jest.fn(async () => records) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const storage = {
      listPaths: jest.fn(async () => ['2026/07/present.pdf', '2026/07/voided.pdf', '2026/07/orphan.pdf']),
      exists: jest.fn(async (path: string) => path !== '2026/07/missing.pdf'),
      remove: jest.fn(async () => undefined)
    };
    const service = new FileStorageMaintenanceService(prisma as any, storage as any, config({}));

    await expect(service.reconcileDatabaseAndDisk()).resolves.toEqual({ missing: 1, removed: 1, orphaned: 1 });
    expect(tx.rawFile.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['active-missing'] }, isVoided: false },
      data: { status: RawFileStatus.failed, scanStatus: FileScanStatus.failed }
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'file.storage.reconcile_missing' })
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'file.storage.reconcile_orphan_deferred',
        metadata: expect.objectContaining({ count: 1, cleanupDeferred: true })
      })
    }));
    expect(storage.remove).toHaveBeenCalledWith('2026/07/voided.pdf');
    expect(storage.remove).not.toHaveBeenCalledWith('2026/07/orphan.pdf');
  });
});
