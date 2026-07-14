import { randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';

const quarantineRoot = resolve(
  process.cwd(),
  process.env.UPLOAD_QUARANTINE_DIR || '.upload-quarantine'
);
const configuredLimitMb = Number(process.env.MAX_FILE_SIZE_MB ?? '10');
const fileSizeLimit =
  Number.isInteger(configuredLimitMb) && configuredLimitMb >= 1 && configuredLimitMb <= 50
    ? configuredLimitMb * 1024 * 1024
    : 10 * 1024 * 1024;

export const secureUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination(_request, _file, callback) {
      void mkdir(quarantineRoot, { recursive: true, mode: 0o700 })
        .then(() => chmod(quarantineRoot, 0o700))
        .then(() => callback(null, quarantineRoot))
        .catch((error) => callback(error as Error, quarantineRoot));
    },
    filename(_request, _file, callback) {
      callback(null, randomUUID());
    }
  }),
  limits: { fileSize: fileSizeLimit, files: 1, fields: 20, fieldSize: 64 * 1024 }
};
