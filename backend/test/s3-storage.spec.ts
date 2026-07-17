import { ConfigService } from '@nestjs/config';

import { S3FileStorageService } from '../src/files/s3-file-storage.service';

describe('S3 file storage boundary', () => {
  const config = {
    get: (key: string) => ({
      'storage.s3.endpoint': 'http://minio:9000',
      'storage.s3.region': 'us-east-1',
      'storage.s3.bucket': 'finance-agent-raw',
      'storage.s3.accessKeyId': 'runtime-user',
      'storage.s3.secretAccessKey': 'runtime-secret-with-enough-length',
      'storage.s3.forcePathStyle': true,
      'storage.s3.capacityBytes': '1099511627776'
    } as Record<string, unknown>)[key]
  } as ConfigService;

  it('accepts only relative normalized object keys', () => {
    const storage = new S3FileStorageService(config) as any;
    const valid = '2026/07/123e4567-e89b-42d3-a456-426614174000.pdf';
    expect(storage.assertKey(valid)).toBe(valid);
    for (const value of [
      '',
      '/absolute.pdf',
      'C:\\absolute.pdf',
      '\\\\server\\share\\file.pdf',
      '../escape.pdf',
      '2026/07/../escape.pdf',
      '2026\\07/123e4567-e89b-42d3-a456-426614174000.pdf',
      '2026/07/%2e%2e%2fescape.pdf',
      `2026/07/${'a'.repeat(200)}.pdf`,
      'bad\u0000.pdf'
    ]) {
      expect(() => storage.assertKey(value)).toThrow('Invalid object storage key');
    }
  });

  it('declares downloads as attachments without exposing an internal key', () => {
    const storage = new S3FileStorageService(config) as any;
    const disposition = storage.contentDisposition('财务凭证 1.pdf');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).not.toContain('2026/07');
  });
});
