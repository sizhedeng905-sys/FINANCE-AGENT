import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, mkdir, readFile, readdir, statfs, unlink } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

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
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    await chmod(directory, 0o700);
    const absolutePath = resolve(directory, storageName);
    this.assertInsideRoot(absolutePath);
    const source = file.path ? createReadStream(file.path) : Readable.from(file.buffer);
    try {
      await pipeline(source, createWriteStream(absolutePath, { flags: 'wx', mode: 0o600 }));
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
    return relative(this.root, absolutePath).split(sep).join('/');
  }

  async read(storagePath: string) {
    return readFile(this.resolvePath(storagePath));
  }

  openReadStream(storagePath: string) {
    return createReadStream(this.resolvePath(storagePath));
  }

  async availableBytes() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    const stats = await statfs(this.root, { bigint: true });
    return stats.bavail * stats.bsize;
  }

  async remove(storagePath: string) {
    try {
      await unlink(this.resolvePath(storagePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async exists(storagePath: string) {
    try {
      await access(this.resolvePath(storagePath));
      return true;
    } catch {
      return false;
    }
  }

  async listPaths() {
    const paths: string[] = [];
    const walk = async (directory: string) => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const absolutePath = resolve(directory, entry.name);
        this.assertInsideRoot(absolutePath);
        if (entry.isDirectory()) await walk(absolutePath);
        else if (entry.isFile()) paths.push(relative(this.root, absolutePath).split(sep).join('/'));
      }
    };
    await walk(this.root);
    return paths.sort();
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
