import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFDocument } from 'pdf-lib';

import { jpegDimensions, pngDimensions, webpDimensions } from '../files/image-dimensions';
import { OcrDocumentPage } from './ocr-provider';
import { OCR_PREPROCESSING_VERSION } from './ocr-ir';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface OcrPageSelection {
  pageStart?: number;
  pageEnd?: number;
}

export interface PreparedOcrDocument {
  buffer: Buffer;
  pages: OcrDocumentPage[];
}

@Injectable()
export class DocumentPreprocessorService {
  private readonly maxPdfPages: number;

  constructor(config: ConfigService) {
    this.maxPdfPages = config.get<number>('ocr.maxPdfPages') ?? 20;
  }

  async inspect(
    buffer: Buffer,
    mimeType: string,
    selection: OcrPageSelection = {}
  ): Promise<OcrDocumentPage[]> {
    if (mimeType === 'application/pdf') return (await this.inspectPdf(buffer, selection)).pages;
    if (IMAGE_MIME_TYPES.has(mimeType)) {
      this.assertNoImagePageSelection(selection);
      const dimensions = mimeType === 'image/png'
        ? pngDimensions(buffer)
        : mimeType === 'image/jpeg'
          ? jpegDimensions(buffer)
          : webpDimensions(buffer);
      if (!dimensions) throw new BadRequestException('OCR 图片尺寸无法识别');
      return [{
        page: 1,
        width: dimensions.width,
        height: dimensions.height,
        preprocessing: {
          rotationReserved: true,
          compressionReserved: true,
          scalingReserved: true,
          renderingReserved: false,
          version: OCR_PREPROCESSING_VERSION,
          operations: [],
          rotationApplied: 0
        }
      }];
    }
    throw new BadRequestException('OCR 仅支持 PDF、PNG、JPEG 或 WebP 文件');
  }

  async prepare(
    buffer: Buffer,
    mimeType: string,
    selection: OcrPageSelection = {}
  ): Promise<PreparedOcrDocument> {
    if (mimeType !== 'application/pdf') {
      return { buffer, pages: await this.inspect(buffer, mimeType, selection) };
    }
    const inspected = await this.inspectPdf(buffer, selection);
    if (inspected.indices.length === inspected.document.getPageCount()) {
      return { buffer, pages: inspected.pages };
    }
    const selected = await PDFDocument.create();
    const copied = await selected.copyPages(inspected.document, inspected.indices);
    for (const page of copied) selected.addPage(page);
    return {
      buffer: Buffer.from(await selected.save()),
      pages: inspected.pages.map((page) => ({
        ...page,
        preprocessing: {
          ...page.preprocessing,
          operations: [...(page.preprocessing.operations ?? []), 'PDF_PAGE_SLICE']
        }
      }))
    };
  }

  private async inspectPdf(buffer: Buffer, selection: OcrPageSelection) {
    if (buffer.includes(Buffer.from('/Encrypt'))) {
      throw new BadRequestException('PDF 已加密或受密码保护，请先解除密码');
    }

    let document: PDFDocument;
    let pages: ReturnType<PDFDocument['getPages']>;
    try {
      document = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false });
      pages = document.getPages();
    } catch {
      throw new BadRequestException('PDF 文件损坏、格式不完整或受密码保护');
    }

    if (pages.length === 0) throw new BadRequestException('PDF 没有可识别页面');
    const indices = this.resolvePageIndices(pages.length, selection);

    return {
      document,
      indices,
      pages: indices.map((sourceIndex) => ({
        page: sourceIndex + 1,
        width: Number(pages[sourceIndex].getWidth().toFixed(2)),
        height: Number(pages[sourceIndex].getHeight().toFixed(2)),
        rotation: pages[sourceIndex].getRotation().angle,
        preprocessing: {
          rotationReserved: true as const,
          compressionReserved: true as const,
          scalingReserved: true as const,
          renderingReserved: true,
          version: OCR_PREPROCESSING_VERSION,
          operations: [],
          rotationApplied: 0
        }
      }))
    };
  }

  private resolvePageIndices(pageCount: number, selection: OcrPageSelection) {
    const hasStart = selection.pageStart !== undefined;
    const hasEnd = selection.pageEnd !== undefined;
    if (hasStart !== hasEnd) throw new BadRequestException('pageStart 和 pageEnd 必须同时提供');
    if (!hasStart || !hasEnd) {
      if (pageCount > this.maxPdfPages) {
        throw new BadRequestException(`PDF 共 ${pageCount} 页，请选择不超过 ${this.maxPdfPages} 页的连续页段`);
      }
      return Array.from({ length: pageCount }, (_, index) => index);
    }
    const start = selection.pageStart!;
    const end = selection.pageEnd!;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > pageCount) {
      throw new BadRequestException(`PDF 页段必须位于 1-${pageCount} 页且起始页不大于结束页`);
    }
    if (end - start + 1 > this.maxPdfPages) {
      throw new BadRequestException(`单个 OCR 任务最多选择 ${this.maxPdfPages} 页`);
    }
    return Array.from({ length: end - start + 1 }, (_, index) => start - 1 + index);
  }

  private assertNoImagePageSelection(selection: OcrPageSelection) {
    if (selection.pageStart !== undefined || selection.pageEnd !== undefined) {
      throw new BadRequestException('图片 OCR 不支持 PDF 页段参数');
    }
  }
}
