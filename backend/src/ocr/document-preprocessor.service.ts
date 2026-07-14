import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';

import { OcrDocumentPage } from './ocr-provider';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

@Injectable()
export class DocumentPreprocessorService {
  private readonly maxPdfPages: number;

  constructor(config: ConfigService) {
    this.maxPdfPages = config.get<number>('ocr.maxPdfPages') ?? 20;
  }

  async inspect(buffer: Buffer, mimeType: string): Promise<OcrDocumentPage[]> {
    if (mimeType === 'application/pdf') return this.inspectPdf(buffer);
    if (IMAGE_MIME_TYPES.has(mimeType)) {
      return [{
        page: 1,
        preprocessing: {
          rotationReserved: true,
          compressionReserved: true,
          scalingReserved: true,
          renderingReserved: false
        }
      }];
    }
    throw new BadRequestException('OCR 仅支持 PDF、PNG、JPEG 或 WebP 文件');
  }

  private async inspectPdf(buffer: Buffer): Promise<OcrDocumentPage[]> {
    if (buffer.includes(Buffer.from('/Encrypt'))) {
      throw new BadRequestException('PDF 已加密或受密码保护，请先解除密码');
    }

    let pages: ReturnType<PDFDocument['getPages']>;
    try {
      const document = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false });
      pages = document.getPages();
    } catch {
      throw new BadRequestException('PDF 文件损坏、格式不完整或受密码保护');
    }

    if (pages.length === 0) throw new BadRequestException('PDF 没有可识别页面');
    if (pages.length > this.maxPdfPages) {
      throw new BadRequestException(`PDF 页数不能超过 ${this.maxPdfPages} 页`);
    }

    return pages.map((page, index) => ({
      page: index + 1,
      width: Number(page.getWidth().toFixed(2)),
      height: Number(page.getHeight().toFixed(2)),
      rotation: page.getRotation().angle,
      preprocessing: {
        rotationReserved: true,
        compressionReserved: true,
        scalingReserved: true,
        renderingReserved: true
      }
    }));
  }
}
