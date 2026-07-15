import { randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';

const MEBIBYTE = 1024 * 1024;
const quarantineFilePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveUploadQuarantineRoot(config?: ConfigService) {
  const configured = config?.get<string>('uploadQuarantineDir')
    ?? process.env.UPLOAD_QUARANTINE_DIR
    ?? '.upload-quarantine';
  return resolve(process.cwd(), configured);
}

export function resolveQuarantinedUploadPath(
  file: Pick<Express.Multer.File, 'filename' | 'path'>,
  quarantineRoot = resolveUploadQuarantineRoot()
) {
  const leafName = basename(file.filename);
  if (leafName !== file.filename || !quarantineFilePattern.test(leafName)) {
    throw new Error('Invalid quarantined upload name');
  }
  const expectedPath = resolve(quarantineRoot, leafName);
  if (resolve(file.path) !== expectedPath) throw new Error('Upload path escaped quarantine');
  return expectedPath;
}

export function createSecureUploadOptions(config: ConfigService): MulterOptions {
  const configuredLimitMb = config.get<number>('maxFileSizeMb') ?? 10;
  if (!Number.isInteger(configuredLimitMb) || configuredLimitMb < 1 || configuredLimitMb > 50) {
    throw new Error('maxFileSizeMb must be an integer between 1 and 50');
  }
  const quarantineRoot = resolveUploadQuarantineRoot(config);

  return {
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
    limits: {
      // Busboy emits LIMIT_FILE_SIZE when the stream reaches this value.
      // One extra byte keeps the documented business limit inclusive.
      fileSize: configuredLimitMb * MEBIBYTE + 1,
      files: 1,
      fields: 20,
      fieldSize: 64 * 1024
    }
  };
}
