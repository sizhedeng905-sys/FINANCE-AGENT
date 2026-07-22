import { Readable } from 'node:stream';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

export type StorageBackend = 'local' | 's3';
export type StorageCapacitySource =
  | 'logical_quota'
  | 'volume_metric'
  | 'provider_metric'
  | 'estimated_usage'
  | 'unknown';

export interface StorageCapacitySnapshot {
  backend: StorageBackend;
  probeOk: boolean;
  capacitySource: StorageCapacitySource;
  totalBytes?: bigint;
  usedBytes?: bigint;
  availableBytes?: bigint;
  observedAt: string;
  stalenessSeconds: number;
  isEstimated: boolean;
  limitations: string[];
}

export interface FileStorage {
  save(file: Express.Multer.File): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  openReadStream(storagePath: string): Promise<Readable> | Readable;
  capacity(): Promise<StorageCapacitySnapshot>;
  remove(storagePath: string): Promise<void>;
  healthCheck?(): Promise<void>;
  createSignedReadUrl?(
    storagePath: string,
    options: { expiresInSeconds: number; fileName: string; mimeType: string }
  ): Promise<string>;
  listPaths?(): Promise<string[]>;
  exists?(storagePath: string): Promise<boolean>;
}
