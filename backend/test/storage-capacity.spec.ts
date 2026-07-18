import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  evaluateStorageAdmission,
  StorageCapacityService,
  StorageCapacitySnapshot
} from '../src/files/storage-capacity.service';

const MIB = 1024n * 1024n;

function snapshot(overrides: Partial<StorageCapacitySnapshot> = {}): StorageCapacitySnapshot {
  return {
    backend: 'local',
    probeOk: true,
    capacitySource: 'volume_metric',
    totalBytes: 1_000n,
    usedBytes: 100n,
    availableBytes: 900n,
    observedAt: '2026-07-18T00:00:00.000Z',
    stalenessSeconds: 0,
    isEstimated: false,
    limitations: [],
    ...overrides
  };
}

describe('storage capacity policy', () => {
  it('admits only fresh, trustworthy capacity with the reserve intact', () => {
    expect(evaluateStorageAdmission(snapshot(), 100n, 200n, 60)).toEqual({
      allowed: true,
      reason: 'capacity_available',
      incomingBytes: 100n,
      reserveBytes: 200n,
      remainingBytes: 800n
    });
  });

  it.each([
    { candidate: snapshot({ probeOk: false, capacitySource: 'unknown', totalBytes: undefined, usedBytes: undefined, availableBytes: undefined }), reason: 'storage_probe_failed' },
    { candidate: snapshot({ stalenessSeconds: 61 }), reason: 'capacity_metric_stale' },
    { candidate: snapshot({ capacitySource: 'unknown', totalBytes: undefined, usedBytes: undefined, availableBytes: undefined }), reason: 'capacity_unknown' },
    { candidate: snapshot({ capacitySource: 'estimated_usage', isEstimated: true }), reason: 'capacity_estimated' },
    { candidate: snapshot({ totalBytes: 100n, usedBytes: 101n, availableBytes: 0n }), reason: 'capacity_inconsistent' },
    { candidate: snapshot({ availableBytes: 250n }), reason: 'capacity_reserve_breached' },
    { candidate: snapshot({ availableBytes: 99n }), reason: 'incoming_file_exceeds_available' }
  ] as const)('fails closed with reason $reason', ({ candidate, reason }) => {
    expect(evaluateStorageAdmission(candidate, 100n, 200n, 60)).toMatchObject({
      allowed: false,
      reason
    });
  });

  it('combines an S3 probe with committed PostgreSQL usage and an explicit logical quota', async () => {
    const prisma = {
      rawFile: {
        aggregate: jest.fn(async () => ({ _sum: { fileSize: 50n * MIB } }))
      }
    };
    const storage = {
      capacity: jest.fn(async () => snapshot({
        backend: 's3',
        capacitySource: 'unknown',
        totalBytes: undefined,
        usedBytes: undefined,
        availableBytes: undefined,
        limitations: ['s3_physical_capacity_unavailable']
      }))
    };
    const service = new StorageCapacityService(
      prisma as any,
      storage as any,
      config({
        'storage.driver': 's3',
        'storage.s3.logicalQuotaBytes': (200n * MIB).toString(),
        'fileQuotas.minimumFreeMb': 100,
        'storage.capacityMaxStalenessSeconds': 60
      })
    );

    const result = await service.read();

    expect(result).toMatchObject({
      backend: 's3',
      probeOk: true,
      capacitySource: 'logical_quota',
      totalBytes: 200n * MIB,
      usedBytes: 50n * MIB,
      availableBytes: 150n * MIB,
      isEstimated: false,
      limitations: expect.arrayContaining([
        's3_physical_capacity_unavailable',
        'logical_usage_excludes_uncommitted_objects'
      ])
    });
  });

  it('serializes concurrent logical quota decisions with a database advisory lock', async () => {
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      rawFile: {
        aggregate: jest.fn(async () => ({ _sum: { fileSize: 100n * MIB } }))
      }
    };
    const service = new StorageCapacityService(
      { rawFile: { aggregate: jest.fn() } } as any,
      { capacity: jest.fn() } as any,
      config({
        'storage.driver': 's3',
        'storage.s3.logicalQuotaBytes': (200n * MIB).toString(),
        'fileQuotas.minimumFreeMb': 100,
        'storage.capacityMaxStalenessSeconds': 60
      })
    );

    const error = await service.assertWithinTransaction(tx as any, 1n * MIB).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.INSUFFICIENT_STORAGE);
    expect((error as HttpException).getResponse()).toMatchObject({
      data: { reason: 'capacity_reserve_breached' }
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.rawFile.aggregate).toHaveBeenCalledWith({
      where: { isVoided: false },
      _sum: { fileSize: true }
    });
  });
});

function config(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string) => values[key])
  } as unknown as ConfigService;
}
