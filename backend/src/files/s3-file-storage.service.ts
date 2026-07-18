import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { FileStorage } from './file-storage';
import { assertStorageKey, createStorageKey } from './storage-key';

@Injectable()
export class S3FileStorageService implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('storage.s3.endpoint') ?? '';
    const region = config.get<string>('storage.s3.region') ?? 'us-east-1';
    const accessKeyId = config.get<string>('storage.s3.accessKeyId') ?? '';
    const secretAccessKey = config.get<string>('storage.s3.secretAccessKey') ?? '';
    this.bucket = config.get<string>('storage.s3.bucket') ?? '';
    this.client = new S3Client({
      endpoint: endpoint || undefined,
      region,
      forcePathStyle: config.get<boolean>('storage.s3.forcePathStyle') ?? true,
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined
    });
  }

  async save(file: Express.Multer.File) {
    if (!Buffer.isBuffer(file.buffer) || file.size <= 0 || file.buffer.length !== file.size) {
      throw new Error('Validated file buffer is required');
    }
    const key = createStorageKey(file.originalname);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentLength: file.size,
      ContentType: 'application/octet-stream',
      Metadata: {
        source: 'finance-agent',
        sha256: createHash('sha256').update(file.buffer).digest('hex')
      }
    }));
    return key;
  }

  async read(storagePath: string) {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.assertKey(storagePath)
    }));
    if (!response.Body) throw new Error('Object storage returned an empty body');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async openReadStream(storagePath: string) {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.assertKey(storagePath)
    }));
    if (!response.Body) throw new Error('Object storage returned an empty body');
    if (response.Body instanceof Readable) return response.Body;
    return Readable.fromWeb(response.Body.transformToWebStream() as never);
  }

  async capacity() {
    const observedAt = new Date().toISOString();
    try {
      await this.healthCheck();
      return {
        backend: 's3' as const,
        probeOk: true,
        capacitySource: 'unknown' as const,
        observedAt,
        stalenessSeconds: 0,
        isEstimated: false,
        limitations: [
          's3_physical_capacity_unavailable',
          'physical_capacity_requires_independent_monitoring'
        ]
      };
    } catch {
      return {
        backend: 's3' as const,
        probeOk: false,
        capacitySource: 'unknown' as const,
        observedAt,
        stalenessSeconds: 0,
        isEstimated: false,
        limitations: ['storage_probe_failed']
      };
    }
  }

  async healthCheck() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async remove(storagePath: string) {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: this.assertKey(storagePath)
    }));
  }

  async exists(storagePath: string) {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.assertKey(storagePath)
      }));
      return true;
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (statusCode === 404) return false;
      throw error;
    }
  }

  async listPaths() {
    const paths: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        ContinuationToken: continuationToken
      }));
      for (const item of response.Contents ?? []) {
        if (item.Key) paths.push(this.assertKey(item.Key));
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return paths.sort();
  }

  createSignedReadUrl(
    storagePath: string,
    options: { expiresInSeconds: number; fileName: string; mimeType: string }
  ) {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.assertKey(storagePath),
      ResponseContentType: options.mimeType,
      ResponseContentDisposition: this.contentDisposition(options.fileName)
    }), { expiresIn: options.expiresInSeconds });
  }

  private assertKey(storagePath: string) {
    return assertStorageKey(storagePath, 'Invalid object storage key');
  }

  private contentDisposition(fileName: string) {
    const encoded = encodeURIComponent(fileName).replace(/['()]/g, escape);
    return `attachment; filename="file"; filename*=UTF-8''${encoded}`;
  }
}
