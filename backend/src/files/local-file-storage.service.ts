import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, statfs, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { FileStorage } from './file-storage';
import { assertStorageKey, createStorageKey } from './storage-key';

@Injectable()
export class LocalFileStorageService implements FileStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    const configured = config.get<string>('uploadDir') || 'uploads';
    this.root = resolve(process.cwd(), configured);
  }

  async save(file: Express.Multer.File) {
    if (!Buffer.isBuffer(file.buffer) || file.size <= 0 || file.buffer.length !== file.size) {
      throw new Error('Validated file buffer is required');
    }
    const storagePath = createStorageKey(file.originalname);
    const [year, month, storageName] = storagePath.split('/');
    const root = await this.ensureRoot();
    const yearDirectory = await this.ensureDirectory(root, root, year);
    const directory = await this.ensureDirectory(root, yearDirectory, month);
    const absolutePath = resolve(directory, storageName);
    this.assertInsideRoot(root, absolutePath);
    const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0);
    const handle = await open(absolutePath, flags, 0o600);
    try {
      await handle.writeFile(file.buffer);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
    try {
      await handle.close();
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
    return storagePath;
  }

  async read(storagePath: string) {
    const absolutePath = await this.resolveExistingPath(storagePath);
    const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async openReadStream(storagePath: string) {
    const absolutePath = await this.resolveExistingPath(storagePath);
    const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    return handle.createReadStream({ autoClose: true });
  }

  async capacity() {
    const observedAt = new Date().toISOString();
    try {
      const root = await this.ensureRoot();
      const stats = await statfs(root, { bigint: true });
      return {
        backend: 'local' as const,
        probeOk: true,
        capacitySource: 'volume_metric' as const,
        totalBytes: stats.blocks * stats.bsize,
        usedBytes: (stats.blocks - stats.bfree) * stats.bsize,
        availableBytes: stats.bavail * stats.bsize,
        observedAt,
        stalenessSeconds: 0,
        isEstimated: false,
        limitations: ['filesystem_available_bytes_may_exclude_reserved_blocks']
      };
    } catch {
      return {
        backend: 'local' as const,
        probeOk: false,
        capacitySource: 'unknown' as const,
        observedAt,
        stalenessSeconds: 0,
        isEstimated: false,
        limitations: ['storage_probe_failed']
      };
    }
  }

  async remove(storagePath: string) {
    try {
      await unlink(await this.resolveExistingPath(storagePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async exists(storagePath: string) {
    assertStorageKey(storagePath, '非法文件路径');
    try {
      await this.resolveExistingPath(storagePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async listPaths() {
    const paths: string[] = [];
    const root = await this.ensureRoot();
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
        this.assertInsideRoot(root, absolutePath);
        if (entry.isSymbolicLink()) throw new Error('非法文件路径');
        if (entry.isDirectory()) await walk(absolutePath);
        else if (entry.isFile()) {
          const storagePath = relative(root, absolutePath).split(sep).join('/');
          paths.push(assertStorageKey(storagePath, '非法文件路径'));
        }
      }
    };
    await walk(root);
    return paths.sort();
  }

  private async ensureRoot() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('非法文件路径');
    await chmod(this.root, 0o700);
    return realpath(this.root);
  }

  private async ensureDirectory(root: string, parent: string, segment: string) {
    const directory = resolve(parent, segment);
    this.assertInsideRoot(root, directory);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const metadata = await lstat(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('非法文件路径');
    await chmod(directory, 0o700);
    const canonical = await realpath(directory);
    this.assertInsideRoot(root, canonical);
    return canonical;
  }

  private async resolveExistingPath(storagePath: string) {
    const key = assertStorageKey(storagePath, '非法文件路径');
    const root = await this.ensureRoot();
    const segments = key.split('/');
    let current = root;
    for (const [index, segment] of segments.entries()) {
      const candidate = resolve(current, segment);
      this.assertInsideRoot(root, candidate);
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink()) throw new Error('非法文件路径');
      const isLast = index === segments.length - 1;
      if ((isLast && !metadata.isFile()) || (!isLast && !metadata.isDirectory())) {
        throw new Error('非法文件路径');
      }
      current = candidate;
    }
    const canonical = await realpath(current);
    this.assertInsideRoot(root, canonical);
    return canonical;
  }

  private assertInsideRoot(root: string, absolutePath: string) {
    const relativePath = relative(root, absolutePath);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error('非法文件路径');
    }
  }
}
