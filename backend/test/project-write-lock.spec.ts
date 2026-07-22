import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  acquireProjectWriteLock,
  PROJECT_WRITE_LOCK_RETRY_CODE
} from '../src/common/database/project-write-lock';

function transactionClient(queryError?: unknown, lockError?: unknown) {
  return {
    $queryRaw: jest.fn().mockImplementation(() => (
      queryError ? Promise.reject(queryError) : Promise.resolve([{ value: '0' }])
    )),
    $executeRaw: jest.fn().mockImplementation(() => lockError ? Promise.reject(lockError) : Promise.resolve(1))
  } as unknown as Prisma.TransactionClient;
}

describe('acquireProjectWriteLock', () => {
  it('sets a transaction-local timeout before acquiring the shared project namespace', async () => {
    const tx = transactionClient();

    await acquireProjectWriteLock(tx, 'project-1');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect((tx.$queryRaw as jest.Mock).mock.invocationCallOrder[1])
      .toBeLessThan((tx.$executeRaw as jest.Mock).mock.invocationCallOrder[0]);
    expect((tx.$executeRaw as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan((tx.$queryRaw as jest.Mock).mock.invocationCallOrder[2]);
    expect((tx.$queryRaw as jest.Mock).mock.calls[1][1]).toBe('2s');
    expect((tx.$queryRaw as jest.Mock).mock.calls[2][1]).toBe('0');
    expect((tx.$executeRaw as jest.Mock).mock.calls[0].slice(1)).toEqual(['project-1', 22]);
  });

  it.each(['55P03', '40P01', '40001'])('normalizes PostgreSQL %s to a retryable conflict', async (code) => {
    const error = new Prisma.PrismaClientKnownRequestError('project lock failed', {
      code: 'P2010',
      clientVersion: 'test',
      meta: { code }
    });
    const tx = transactionClient(undefined, error);

    await expect(acquireProjectWriteLock(tx, 'project-1')).rejects.toMatchObject({
      status: 409,
      response: {
        data: {
          reason: PROJECT_WRITE_LOCK_RETRY_CODE,
          retryable: true
        }
      }
    });
  });

  it('normalizes Prisma transaction write conflicts and preserves unrelated errors', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('write conflict', {
      code: 'P2034',
      clientVersion: 'test'
    });
    await expect(acquireProjectWriteLock(transactionClient(undefined, conflict), 'project-1'))
      .rejects.toBeInstanceOf(ConflictException);

    const unrelated = new Error('database unavailable');
    await expect(acquireProjectWriteLock(transactionClient(unrelated), 'project-1')).rejects.toBe(unrelated);
  });

  it('keeps every project-scoped formal writer on the shared lock helper', async () => {
    const formalWriters = [
      'projects/projects.service.ts',
      'records/records.service.ts',
      'import-tasks/import-tasks.service.ts',
      'ocr/ocr-tasks.service.ts',
      'work-orders/work-order-records.service.ts',
      'files/files.service.ts'
    ];

    for (const relativePath of formalWriters) {
      const source = await readFile(resolve(process.cwd(), 'src', relativePath), 'utf8');
      expect(source).toContain('acquireProjectWriteLock(');
      expect(source).not.toMatch(/hashtextextended\([^\n]+,\s*22\)/);
    }
  });
});
