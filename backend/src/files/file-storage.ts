export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface FileStorage {
  save(file: Express.Multer.File): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  remove(storagePath: string): Promise<void>;
}
