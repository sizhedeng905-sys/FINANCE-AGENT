import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { FileStorage } from './file-storage';

@Injectable()
export class LocalFileStorageService implements FileStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>('uploadDir') || 'uploads';
    this.root = resolve(process.cwd(), configured);
  }

  async save(file: Express.Multer.File) {
    const now = new Date();
    const folder = join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
    const extension = extname(file.originalname).toLowerCase();
    const storageName = `${randomUUID()}${extension}`;
    const directory = resolve(this.root, folder);
    await mkdir(directory, { recursive: true });
    const absolutePath = resolve(directory, storageName);
    this.assertInsideRoot(absolutePath);
    await writeFile(absolutePath, file.buffer, { flag: 'wx' });
    return relative(this.root, absolutePath).split(sep).join('/');
  }

  async read(storagePath: string) {
    return readFile(this.resolvePath(storagePath));
  }

  async remove(storagePath: string) {
    try {
      await unlink(this.resolvePath(storagePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private resolvePath(storagePath: string) {
    if (isAbsolute(storagePath)) throw new Error('非法文件路径');
    const absolutePath = resolve(this.root, storagePath);
    this.assertInsideRoot(absolutePath);
    return absolutePath;
  }

  private assertInsideRoot(absolutePath: string) {
    if (absolutePath !== this.root && !absolutePath.startsWith(`${this.root}${sep}`)) {
      throw new Error('非法文件路径');
    }
  }
}
