import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE, FileStorage, StorageCapacitySnapshot } from './file-storage';

export type StorageAdmissionReason =
  | 'capacity_available'
  | 'storage_probe_failed'
  | 'capacity_metric_stale'
  | 'capacity_unknown'
  | 'capacity_estimated'
  | 'capacity_inconsistent'
  | 'incoming_file_exceeds_available'
  | 'capacity_reserve_breached';

export interface StorageAdmissionDecision {
  allowed: boolean;
  reason: StorageAdmissionReason;
  incomingBytes: bigint;
  reserveBytes: bigint;
  remainingBytes?: bigint;
}

export { StorageCapacitySnapshot } from './file-storage';

export function evaluateStorageAdmission(
  snapshot: StorageCapacitySnapshot,
  incomingBytes: bigint,
  reserveBytes: bigint,
  maxStalenessSeconds: number
): StorageAdmissionDecision {
  const base = { incomingBytes, reserveBytes };
  if (!snapshot.probeOk) return { allowed: false, reason: 'storage_probe_failed', ...base };
  if (
    !Number.isFinite(snapshot.stalenessSeconds) ||
    snapshot.stalenessSeconds < 0 ||
    snapshot.stalenessSeconds > maxStalenessSeconds
  ) {
    return { allowed: false, reason: 'capacity_metric_stale', ...base };
  }
  if (snapshot.capacitySource === 'unknown' || snapshot.availableBytes === undefined) {
    return { allowed: false, reason: 'capacity_unknown', ...base };
  }
  if (snapshot.isEstimated || snapshot.capacitySource === 'estimated_usage') {
    return { allowed: false, reason: 'capacity_estimated', ...base };
  }
  if (
    incomingBytes < 0n ||
    reserveBytes < 0n ||
    snapshot.availableBytes < 0n ||
    (snapshot.totalBytes !== undefined && snapshot.totalBytes < 0n) ||
    (snapshot.usedBytes !== undefined && snapshot.usedBytes < 0n) ||
    (
      snapshot.totalBytes !== undefined &&
      snapshot.usedBytes !== undefined &&
      snapshot.usedBytes > snapshot.totalBytes
    )
  ) {
    return { allowed: false, reason: 'capacity_inconsistent', ...base };
  }
  if (snapshot.availableBytes < incomingBytes) {
    return {
      allowed: false,
      reason: 'incoming_file_exceeds_available',
      remainingBytes: snapshot.availableBytes - incomingBytes,
      ...base
    };
  }
  const remainingBytes = snapshot.availableBytes - incomingBytes;
  if (remainingBytes < reserveBytes) {
    return { allowed: false, reason: 'capacity_reserve_breached', remainingBytes, ...base };
  }
  return { allowed: true, reason: 'capacity_available', remainingBytes, ...base };
}

@Injectable()
export class StorageCapacityService {
  private readonly driver: string;
  private readonly logicalQuotaBytes?: bigint;
  private readonly minimumReserveBytes: bigint;
  private readonly maxStalenessSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    config: ConfigService
  ) {
    this.driver = config.get<string>('storage.driver') ?? 'local';
    const configuredQuota = config.get<string>('storage.s3.logicalQuotaBytes');
    this.logicalQuotaBytes = configuredQuota ? BigInt(configuredQuota) : undefined;
    this.minimumReserveBytes = BigInt(config.get<number>('fileQuotas.minimumFreeMb') ?? 1024) * 1024n * 1024n;
    this.maxStalenessSeconds = config.get<number>('storage.capacityMaxStalenessSeconds') ?? 60;
  }

  async read(): Promise<StorageCapacitySnapshot> {
    const providerSnapshot = await this.readProviderSnapshot();
    if (
      this.driver !== 's3' ||
      !providerSnapshot.probeOk ||
      providerSnapshot.capacitySource !== 'unknown'
    ) {
      return providerSnapshot;
    }
    if (this.logicalQuotaBytes === undefined) {
      return this.withLimitations(providerSnapshot, 'logical_quota_not_configured');
    }
    try {
      const usage = await this.prisma.rawFile.aggregate({
        where: { isVoided: false },
        _sum: { fileSize: true }
      });
      return this.logicalSnapshot(usage._sum.fileSize ?? 0n, providerSnapshot.limitations);
    } catch {
      return this.withLimitations(providerSnapshot, 'logical_usage_unavailable');
    }
  }

  async assertUploadAllowed(incomingBytes: bigint) {
    const snapshot = await this.read();
    const decision = evaluateStorageAdmission(
      snapshot,
      incomingBytes,
      this.minimumReserveBytes,
      this.maxStalenessSeconds
    );
    if (!decision.allowed) throw this.admissionException(decision.reason);
    return { snapshot, decision };
  }

  async assertWithinTransaction(tx: Prisma.TransactionClient, incomingBytes: bigint) {
    if (this.driver !== 's3') return;
    if (this.logicalQuotaBytes === undefined) throw this.admissionException('capacity_unknown');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('finance-agent:s3-logical-quota', 24))`;
    const usage = await tx.rawFile.aggregate({
      where: { isVoided: false },
      _sum: { fileSize: true }
    });
    const snapshot = this.logicalSnapshot(usage._sum.fileSize ?? 0n, [
      's3_physical_capacity_unavailable'
    ]);
    const decision = evaluateStorageAdmission(
      snapshot,
      incomingBytes,
      this.minimumReserveBytes,
      this.maxStalenessSeconds
    );
    if (!decision.allowed) throw this.admissionException(decision.reason);
  }

  admission(snapshot: StorageCapacitySnapshot, incomingBytes = 0n) {
    return evaluateStorageAdmission(
      snapshot,
      incomingBytes,
      this.minimumReserveBytes,
      this.maxStalenessSeconds
    );
  }

  private async readProviderSnapshot(): Promise<StorageCapacitySnapshot> {
    try {
      return await this.storage.capacity();
    } catch {
      return {
        backend: this.driver === 's3' ? 's3' : 'local',
        probeOk: false,
        capacitySource: 'unknown',
        observedAt: new Date().toISOString(),
        stalenessSeconds: 0,
        isEstimated: false,
        limitations: ['storage_probe_failed']
      };
    }
  }

  private logicalSnapshot(usedBytes: bigint, limitations: string[]): StorageCapacitySnapshot {
    const totalBytes = this.logicalQuotaBytes!;
    return {
      backend: 's3',
      probeOk: true,
      capacitySource: 'logical_quota',
      totalBytes,
      usedBytes,
      availableBytes: usedBytes < totalBytes ? totalBytes - usedBytes : 0n,
      observedAt: new Date().toISOString(),
      stalenessSeconds: 0,
      isEstimated: false,
      limitations: [...new Set([
        ...limitations,
        'logical_usage_excludes_uncommitted_objects',
        'physical_capacity_requires_independent_monitoring'
      ])]
    };
  }

  private withLimitations(snapshot: StorageCapacitySnapshot, ...limitations: string[]) {
    return {
      ...snapshot,
      limitations: [...new Set([...snapshot.limitations, ...limitations])]
    };
  }

  private admissionException(reason: StorageAdmissionReason) {
    const insufficient = reason === 'incoming_file_exceeds_available' || reason === 'capacity_reserve_breached';
    return new HttpException(
      {
        message: insufficient ? 'Storage capacity reserve would be exceeded' : 'Storage capacity cannot be verified',
        data: { reason }
      },
      insufficient ? HttpStatus.INSUFFICIENT_STORAGE : HttpStatus.SERVICE_UNAVAILABLE
    );
  }
}
