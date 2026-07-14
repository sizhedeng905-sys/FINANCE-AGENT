import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';
import { Socket } from 'node:net';
import { extname } from 'node:path';
import * as yauzl from 'yauzl';

import { isStructurallyValidJpeg, isStructurallyValidPng } from './image-security';
import { hasActivePdfContent } from './pdf-security';
import { inspectOleCompoundFile, OleCompoundPolicyError } from './ole-compound-security';

const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_RATIO = 100;
const MAX_INSPECTED_XML_BYTES = 5 * 1024 * 1024;

@Injectable()
export class FileSecurityService {
  private readonly scanMode: 'basic' | 'clamav';
  private readonly clamavHost: string;
  private readonly clamavPort: number;
  private readonly clamavTimeoutMs: number;

  constructor(config: ConfigService) {
    this.scanMode = config.get<'basic' | 'clamav'>('fileScan.mode') ?? 'basic';
    this.clamavHost = config.get<string>('fileScan.clamavHost') ?? '127.0.0.1';
    this.clamavPort = config.get<number>('fileScan.clamavPort') ?? 3310;
    this.clamavTimeoutMs = config.get<number>('fileScan.timeoutMs') ?? 15_000;
  }

  async scan(fileName: string, buffer: Buffer) {
    if (buffer.includes(Buffer.from(EICAR_SIGNATURE, 'ascii'))) {
      throw new UnprocessableEntityException('文件安全扫描发现恶意内容');
    }
    const extension = extname(fileName).toLowerCase();
    await this.validateStructure(extension, buffer);
    if (this.scanMode === 'clamav') await this.scanWithClamAv(buffer);
  }

  private async validateStructure(extension: string, buffer: Buffer) {
    if (extension === '.png') {
      this.assert(isStructurallyValidPng(buffer), 'PNG 文件结构不完整');
      return;
    }
    if (extension === '.jpg' || extension === '.jpeg') {
      this.assert(isStructurallyValidJpeg(buffer), 'JPEG 文件结构不完整');
      return;
    }
    if (extension === '.webp') {
      this.assert(
        buffer.length >= 12 &&
          buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
          buffer.subarray(8, 12).toString('ascii') === 'WEBP' &&
          buffer.readUInt32LE(4) + 8 === buffer.length,
        'WebP 文件结构不完整'
      );
      return;
    }
    if (extension === '.pdf') {
      await this.validatePdf(buffer);
      return;
    }
    if (extension === '.xls') {
      this.validateLegacyExcel(buffer);
      return;
    }
    if (extension === '.xlsx' || extension === '.docx') {
      await this.validateOoxml(buffer, extension);
      return;
    }
    if (extension === '.csv') {
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        this.assert(text.length > 0 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text), 'CSV 内容不合法');
      } catch {
        throw new BadRequestException('CSV 必须使用 UTF-8 编码');
      }
      return;
    }
    throw new BadRequestException('不支持的文件类型');
  }

  private async validatePdf(buffer: Buffer) {
    this.assert(
      buffer.subarray(0, 5).toString('ascii') === '%PDF-' &&
        buffer.subarray(Math.max(0, buffer.length - 2048)).includes(Buffer.from('%%EOF')),
      'PDF 文件结构不完整'
    );
    try {
      const document = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false });
      if (hasActivePdfContent(document)) throw new BadRequestException('PDF 包含活动内容或嵌入文件');
      const pages = document.getPageCount();
      this.assert(pages > 0 && pages <= 500, 'PDF 页数超出允许范围');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('PDF 无法安全解析或已加密');
    }
  }

  private validateLegacyExcel(buffer: Buffer) {
    try {
      inspectOleCompoundFile(buffer);
    } catch (error) {
      if (error instanceof OleCompoundPolicyError) throw new BadRequestException(error.message);
      throw new BadRequestException('XLS OLE 结构无法安全检查');
    }
  }

  private validateOoxml(buffer: Buffer, extension: '.xlsx' | '.docx') {
    return new Promise<void>((resolve, reject) => {
      yauzl.fromBuffer(buffer, { lazyEntries: true, decodeStrings: true }, (openError, zip) => {
        if (openError || !zip) {
          reject(new BadRequestException('Office 文件不是有效的 OOXML 压缩包'));
          return;
        }
        let entries = 0;
        let totalCompressed = 0;
        let totalExpanded = 0;
        let hasContentTypes = false;
        let hasMainDocument = false;
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          zip.close();
          if (error) reject(error);
          else resolve();
        };
        zip.on('error', () => finish(new BadRequestException('Office 压缩包读取失败')));
        zip.on('end', () => {
          if (!hasContentTypes || !hasMainDocument) {
            finish(new BadRequestException('Office 文件缺少必要的 OOXML 结构'));
            return;
          }
          finish();
        });
        zip.on('entry', (entry: yauzl.Entry) => {
          try {
            entries += 1;
            totalCompressed += entry.compressedSize;
            totalExpanded += entry.uncompressedSize;
            this.assert(entries <= MAX_ARCHIVE_ENTRIES, 'Office 压缩包条目过多');
            this.assert(totalExpanded <= MAX_ARCHIVE_EXPANDED_BYTES, 'Office 文件展开后过大');
            this.assert(
              totalExpanded / Math.max(1, totalCompressed) <= MAX_ARCHIVE_RATIO,
              'Office 文件总压缩比异常'
            );
            this.assert(
              entry.uncompressedSize / Math.max(1, entry.compressedSize) <= MAX_ARCHIVE_RATIO,
              'Office 文件压缩比异常'
            );
            this.assert((entry.generalPurposeBitFlag & 0x1) === 0, '不支持加密 Office 文件');
            this.assert(
              !entry.fileName.startsWith('/') &&
                !entry.fileName.includes('\\') &&
                !entry.fileName.split('/').includes('..'),
              'Office 压缩包包含非法路径'
            );
            if (entry.fileName === '[Content_Types].xml') hasContentTypes = true;
            if (extension === '.xlsx' && entry.fileName === 'xl/workbook.xml') hasMainDocument = true;
            if (extension === '.docx' && entry.fileName === 'word/document.xml') hasMainDocument = true;
            if (/vbaProject|macrosheets|embeddings|externalLinks|oleObject/i.test(entry.fileName)) {
              throw new BadRequestException('Office 文件包含宏、嵌入对象或外部链接');
            }
            const inspectContent = entry.fileName.endsWith('.rels') || entry.fileName === '[Content_Types].xml';
            if (!inspectContent || /\/$/.test(entry.fileName)) {
              zip.readEntry();
              return;
            }
            this.assert(entry.uncompressedSize <= MAX_INSPECTED_XML_BYTES, 'Office XML 条目过大');
            zip.openReadStream(entry, (streamError, stream) => {
              if (streamError || !stream) {
                finish(new BadRequestException('Office XML 条目读取失败'));
                return;
              }
              const chunks: Buffer[] = [];
              let size = 0;
              stream.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_INSPECTED_XML_BYTES) {
                  stream.destroy(new Error('entry too large'));
                  return;
                }
                chunks.push(chunk);
              });
              stream.on('error', () => finish(new BadRequestException('Office XML 条目读取失败')));
              stream.on('end', () => {
                const xml = Buffer.concat(chunks).toString('utf8');
                if (/TargetMode\s*=\s*["']External["']/i.test(xml)) {
                  finish(new BadRequestException('Office 文件包含外部关系'));
                  return;
                }
                zip.readEntry();
              });
            });
          } catch (error) {
            finish(error instanceof Error ? error : new BadRequestException('Office 文件结构不合法'));
          }
        });
        zip.readEntry();
      });
    });
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
      socket.setTimeout(this.clamavTimeoutMs, () =>
        finish(new ServiceUnavailableException('ClamAV 扫描超时'))
      );
      socket.on('error', () => finish(new ServiceUnavailableException('无法连接 ClamAV 扫描服务')));
      socket.on('data', (chunk) => {
        response += chunk.toString('utf8');
        if (response.length > 4096) finish(new ServiceUnavailableException('ClamAV 返回异常响应'));
      });
      socket.on('end', () => {
        if (/\bFOUND\b/.test(response)) finish(new UnprocessableEntityException('文件安全扫描发现恶意内容'));
        else if (/\bOK\b/.test(response)) finish();
        else finish(new ServiceUnavailableException('ClamAV 未返回有效扫描结果'));
      });
      socket.connect(this.clamavPort, this.clamavHost, () => {
        socket.write(Buffer.from('zINSTREAM\0'));
        for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
          const chunk = buffer.subarray(offset, Math.min(offset + 64 * 1024, buffer.length));
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        const terminator = Buffer.alloc(4);
        socket.end(terminator);
      });
    });
  }

  private assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new BadRequestException(message);
  }
}
