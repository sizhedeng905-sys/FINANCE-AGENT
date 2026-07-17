import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileScanStatus, RawFileStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE, FileStorage } from './file-storage';
import { resolveUploadQuarantineRoot } from './secure-upload-options';

const QUARANTINE_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class FileStorageMaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(FileStorageMaintenanceService.name);
  private readonly quarantineRoot: string;
  private readonly quarantineMaxAgeMs: number;
  private readonly processRole: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    config: ConfigService
  ) {
    this.quarantineRoot = resolveUploadQuarantineRoot(config);
    this.quarantineMaxAgeMs = config.get<number>('uploadQuarantineMaxAgeMs') ?? 3_600_000;
    this.processRole = config.get<string>('processRole') ?? 'all';
  }

  async onModuleInit() {
    if (this.processRole === 'worker') return;
    await this.cleanupStaleQuarantine().catch((error: unknown) => {
      this.logger.error(`Quarantine cleanup failed: ${this.errorMessage(error)}`);
    });
    await this.reconcileDatabaseAndDisk().catch((error: unknown) => {
      this.logger.error(`Storage reconciliation failed: ${this.errorMessage(error)}`);
    });
  }

  async cleanupStaleQuarantine(now = Date.now()) {
    await mkdir(this.quarantineRoot, { recursive: true, mode: 0o700 });
    await chmod(this.quarantineRoot, 0o700);
    const entries = await readdir(this.quarantineRoot, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const absolutePath = resolve(this.quarantineRoot, entry.name);
      if (!absolutePath.startsWith(`${this.quarantineRoot}\\`) && !absolutePath.startsWith(`${this.quarantineRoot}/`)) continue;
      const metadata = await stat(absolutePath);
      if (now - metadata.mtimeMs <= this.quarantineMaxAgeMs && QUARANTINE_FILE.test(entry.name)) continue;
      await unlink(absolutePath);
      removed += 1;
    }
    if (removed > 0) this.logger.warn(`Removed ${removed} stale or invalid quarantined uploads`);
    return { removed };
  }

  async reconcileDatabaseAndDisk() {
    if (!this.storage.listPaths || !this.storage.exists) return { missing: 0, removed: 0, orphaned: 0 };
    const [records, diskPaths] = await Promise.all([
      this.prisma.rawFile.findMany({ select: { id: true, storagePath: true, isVoided: true } }),
      this.storage.listPaths()
    ]);
    const known = new Map(records.map((record) => [record.storagePath, record]));
    const missing = [] as typeof records;
    for (const record of records) {
      if (!record.isVoided && !(await this.storage.exists(record.storagePath))) missing.push(record);
    }

    const orphaned = diskPaths.filter((path) => !known.has(path));
    if (missing.length > 0 || orphaned.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        if (missing.length > 0) {
          await tx.rawFile.updateMany({
            where: { id: { in: missing.map((record) => record.id) }, isVoided: false },
            data: { status: RawFileStatus.failed, scanStatus: FileScanStatus.failed }
          });
          await tx.auditLog.create({
            data: {
              action: 'file.storage.reconcile_missing',
              resourceType: 'raw_file',
              metadata: {
                count: missing.length,
                pathHashes: missing.map((record) => this.pathHash(record.storagePath))
              }
            }
          });
        }
        if (orphaned.length > 0) {
          await tx.auditLog.create({
            data: {
              action: 'file.storage.reconcile_orphan_deferred',
              resourceType: 'raw_file',
              metadata: {
                count: orphaned.length,
                cleanupDeferred: true,
                pathHashes: orphaned.map((path) => this.pathHash(path))
              }
            }
          });
        }
      });
    }

    let removed = 0;
    for (const path of diskPaths) {
      const record = known.get(path);
      if (!record?.isVoided) continue;
      await this.storage.remove(path);
      removed += 1;
    }
    if (missing.length > 0 || removed > 0 || orphaned.length > 0) {
      this.logger.warn(`Storage reconciliation: missing=${missing.length}, removed=${removed}, orphaned=${orphaned.length}`);
    }
    return { missing: missing.length, removed, orphaned: orphaned.length };
  }

  private pathHash(path: string) {
    return createHash('sha256').update(path).digest('hex');
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
