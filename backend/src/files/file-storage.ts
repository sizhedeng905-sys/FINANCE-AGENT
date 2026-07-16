import { Readable } from 'node:stream';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface FileStorage {
  save(file: Express.Multer.File): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  openReadStream(storagePath: string): Readable;
  availableBytes(): Promise<bigint>;
  remove(storagePath: string): Promise<void>;
  listPaths?(): Promise<string[]>;
  exists?(storagePath: string): Promise<boolean>;
}
