import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'node:net';
import { extname } from 'node:path';

import { assertSafeCsv, CsvSecurityError } from './csv-security';
import { inspectOleCompoundFile, OleCompoundPolicyError } from './ole-compound-security';
import { isStructurallyValidJpeg, isStructurallyValidPng } from './image-security';
import { jpegDimensions, pngDimensions, webpDimensions } from './image-dimensions';
import { OoxmlSecurityError, validateOoxmlPackage } from './ooxml-security';
import { inspectPdfInWorker } from './pdf-inspection-runner';

const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

@Injectable()
export class FileSecurityService {
  private readonly scanMode: 'basic' | 'clamav';
  private readonly clamavHost: string;
  private readonly clamavPort: number;
  private readonly clamavTimeoutMs: number;
  private readonly imageMaxWidth: number;
  private readonly imageMaxHeight: number;
  private readonly imageMaxPixels: bigint;
  private readonly imageMaxDecodedBytes: bigint;
  private readonly pdfMaxPages: number;
  private readonly pdfMaxObjects: number;
  private readonly parseTimeoutMs: number;

  constructor(config: ConfigService) {
    this.scanMode = config.get<'basic' | 'clamav'>('fileScan.mode') ?? 'basic';
    this.clamavHost = config.get<string>('fileScan.clamavHost') ?? '127.0.0.1';
    this.clamavPort = config.get<number>('fileScan.clamavPort') ?? 3310;
    this.clamavTimeoutMs = config.get<number>('fileScan.timeoutMs') ?? 15_000;
    this.imageMaxWidth = config.get<number>('fileLimits.imageMaxWidth') ?? 20_000;
    this.imageMaxHeight = config.get<number>('fileLimits.imageMaxHeight') ?? 20_000;
    this.imageMaxPixels = BigInt(config.get<number>('fileLimits.imageMaxPixels') ?? 100_000_000);
    this.imageMaxDecodedBytes = BigInt(config.get<number>('fileLimits.imageMaxDecodedMb') ?? 400) * 1024n * 1024n;
    this.pdfMaxPages = config.get<number>('fileLimits.pdfMaxPages') ?? 200;
    this.pdfMaxObjects = config.get<number>('fileLimits.pdfMaxObjects') ?? 100_000;
    this.parseTimeoutMs = config.get<number>('fileLimits.parseTimeoutMs') ?? 5_000;
  }

  async scan(fileName: string, buffer: Buffer) {
    if (buffer.includes(Buffer.from(EICAR_SIGNATURE, 'ascii'))) {
      throw new UnprocessableEntityException('File security scan detected malicious content');
    }
    await this.validateStructure(extname(fileName).toLowerCase(), buffer);
    if (this.scanMode === 'clamav') await this.scanWithClamAv(buffer);
  }

  async readiness() {
    if (this.scanMode === 'basic') return { status: 'not_required', mode: 'basic' } as const;
    await this.pingClamAv();
    return { status: 'ok', mode: 'clamav' } as const;
  }

  private async validateStructure(extension: string, buffer: Buffer) {
    if (extension === '.png') {
      this.assert(isStructurallyValidPng(buffer), 'PNG structure is invalid');
      this.assertImageDimensions(pngDimensions(buffer));
      return;
    }
    if (extension === '.jpg' || extension === '.jpeg') {
      this.assert(isStructurallyValidJpeg(buffer), 'JPEG structure is invalid');
      this.assertImageDimensions(jpegDimensions(buffer));
      return;
    }
    if (extension === '.webp') {
      this.assert(
        buffer.length >= 12 &&
          buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
          buffer.subarray(8, 12).toString('ascii') === 'WEBP' &&
          buffer.readUInt32LE(4) + 8 === buffer.length,
        'WebP structure is invalid'
      );
      this.assertImageDimensions(webpDimensions(buffer));
      return;
    }
    if (extension === '.pdf') {
      await this.validatePdf(buffer);
      return;
    }
    if (extension === '.xls') {
      try {
        inspectOleCompoundFile(buffer);
      } catch (error) {
        if (error instanceof OleCompoundPolicyError) throw new BadRequestException(error.message);
        throw new BadRequestException('XLS OLE structure cannot be inspected safely');
      }
      return;
    }
    if (extension === '.xlsx' || extension === '.docx') {
      try {
        await validateOoxmlPackage(buffer, extension);
      } catch (error) {
        if (error instanceof OoxmlSecurityError) throw new BadRequestException(error.message);
        throw new BadRequestException('Office file cannot be inspected safely');
      }
      return;
    }
    if (extension === '.csv') {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        assertSafeCsv(text);
      } catch (error) {
        if (error instanceof CsvSecurityError) throw new BadRequestException(error.message);
        throw new BadRequestException('CSV must use valid UTF-8 encoding');
      }
      return;
    }
    throw new BadRequestException('Unsupported file type');
  }

  private async validatePdf(buffer: Buffer) {
    this.assert(
      buffer.subarray(0, 5).toString('ascii') === '%PDF-' &&
        buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF')),
      'PDF structure is invalid'
    );
    try {
      const result = await inspectPdfInWorker(buffer, this.parseTimeoutMs);
      this.assert(!result.activeContent, 'PDF contains active content or embedded files');
      this.assert(result.pages > 0 && result.pages <= this.pdfMaxPages, 'PDF page limit exceeded');
      this.assert(result.objects > 0 && result.objects <= this.pdfMaxObjects, 'PDF object complexity limit exceeded');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'PDF cannot be inspected safely');
    }
  }

  private assertImageDimensions(dimensions: { width: number; height: number } | undefined) {
    this.assert(dimensions && dimensions.width > 0 && dimensions.height > 0, 'Image dimensions cannot be determined');
    const pixels = BigInt(dimensions.width) * BigInt(dimensions.height);
    this.assert(dimensions.width <= this.imageMaxWidth, 'Image width limit exceeded');
    this.assert(dimensions.height <= this.imageMaxHeight, 'Image height limit exceeded');
    this.assert(pixels <= this.imageMaxPixels, 'Image pixel limit exceeded');
    this.assert(pixels * 4n <= this.imageMaxDecodedBytes, 'Image decoded-memory limit exceeded');
  }

  private scanWithClamAv(buffer: Buffer) {
    return new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      let response = '';
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      socket.setTimeout(this.clamavTimeoutMs, () => finish(new ServiceUnavailableException('ClamAV scan timed out')));
      socket.on('error', () => finish(new ServiceUnavailableException('ClamAV is unavailable')));
      socket.on('data', (chunk) => {
        response += chunk.toString('utf8');
        if (response.length > 4096) finish(new ServiceUnavailableException('ClamAV returned an invalid response'));
      });
      socket.on('end', () => {
        if (/\bFOUND\b/.test(response)) finish(new UnprocessableEntityException('File security scan detected malicious content'));
        else if (/\bOK\b/.test(response)) finish();
        else finish(new ServiceUnavailableException('ClamAV did not return a valid result'));
      });
      socket.connect(this.clamavPort, this.clamavHost, () => {
        void this.writeClamAvStream(socket, buffer).catch(() => finish(new ServiceUnavailableException('ClamAV stream failed')));
      });
    });
  }

  private pingClamAv() {
    return new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      let response = '';
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      socket.setTimeout(this.clamavTimeoutMs, () => finish(new ServiceUnavailableException('ClamAV readiness timed out')));
      socket.on('error', () => finish(new ServiceUnavailableException('ClamAV is unavailable')));
      socket.on('data', (chunk) => {
        response += chunk.toString('utf8');
        if (response.length > 64) finish(new ServiceUnavailableException('ClamAV readiness response is invalid'));
      });
      socket.on('end', () => {
        if (/^PONG\0?$/.test(response)) finish();
        else finish(new ServiceUnavailableException('ClamAV readiness response is invalid'));
      });
      socket.connect(this.clamavPort, this.clamavHost, () => socket.end('zPING\0'));
    });
  }

  private async writeClamAvStream(socket: Socket, buffer: Buffer) {
    await this.writeWithBackpressure(socket, Buffer.from('zINSTREAM\0'));
    for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
      const chunk = buffer.subarray(offset, Math.min(offset + 64 * 1024, buffer.length));
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.length);
      await this.writeWithBackpressure(socket, length);
      await this.writeWithBackpressure(socket, chunk);
    }
    await this.writeWithBackpressure(socket, Buffer.alloc(4));
    socket.end();
  }

  private writeWithBackpressure(socket: Socket, chunk: Buffer) {
    if (socket.write(chunk)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        socket.off('drain', onDrain);
        socket.off('error', onError);
      };
      socket.once('drain', onDrain);
      socket.once('error', onError);
    });
  }

  private assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new BadRequestException(message);
  }
}
