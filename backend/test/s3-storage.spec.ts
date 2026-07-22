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
      'storage.s3.logicalQuotaBytes': '1099511627776'
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

  it('reports successful S3 probing without inventing physical capacity', async () => {
    const storage = new S3FileStorageService(config) as any;
    storage.client.send = jest.fn(async () => ({}));

    const snapshot = await storage.capacity();

    expect(snapshot).toMatchObject({
      backend: 's3',
      probeOk: true,
      capacitySource: 'unknown',
      stalenessSeconds: 0,
      isEstimated: false,
      limitations: expect.arrayContaining(['s3_physical_capacity_unavailable'])
    });
    expect(snapshot).not.toHaveProperty('totalBytes');
    expect(snapshot).not.toHaveProperty('usedBytes');
    expect(snapshot).not.toHaveProperty('availableBytes');
  });

  it('reports an unreachable S3 provider without leaking the provider error', async () => {
    const storage = new S3FileStorageService(config) as any;
    storage.client.send = jest.fn(async () => {
      throw new Error('http://minio:9000/private-provider-detail');
    });

    const snapshot = await storage.capacity();

    expect(snapshot).toMatchObject({
      backend: 's3',
      probeOk: false,
      capacitySource: 'unknown',
      limitations: ['storage_probe_failed']
    });
    expect(JSON.stringify(snapshot)).not.toContain('private-provider-detail');
  });

  it('stores a strong content digest as object metadata', async () => {
    const storage = new S3FileStorageService(config) as any;
    storage.client.send = jest.fn(async () => ({}));
    const buffer = Buffer.from('backup-integrity');

    await storage.save({
      buffer,
      size: buffer.length,
      originalname: 'evidence.pdf'
    } as Express.Multer.File);

    const command = storage.client.send.mock.calls[0][0];
    expect(command.input.Metadata).toMatchObject({
      source: 'finance-agent',
      sha256: '9af37706942626fb349c3d221f442bb218e7e7f41dfaaedda2707524ef35cb1d'
    });
  });
});
