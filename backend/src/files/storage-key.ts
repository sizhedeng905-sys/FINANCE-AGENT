import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

const ALLOWED_STORAGE_EXTENSION = /^\.(?:csv|docx|jpe?g|pdf|png|webp|xlsx?)$/;
const STORAGE_KEY_PATTERN = /^\d{4}\/(?:0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:csv|docx|jpe?g|pdf|png|webp|xlsx?)$/i;

export function createStorageKey(originalFileName: string, now = new Date()) {
  const extension = extname(originalFileName).toLowerCase();
  if (!ALLOWED_STORAGE_EXTENSION.test(extension)) {
    throw new Error('Unsupported storage extension');
  }
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}/${randomUUID()}${extension}`;
}

export function assertStorageKey(storagePath: string, message = 'Invalid storage key') {
  if (typeof storagePath !== 'string' || storagePath.length > 80 || !STORAGE_KEY_PATTERN.test(storagePath)) {
    throw new Error(message);
  }
  return storagePath;
}
