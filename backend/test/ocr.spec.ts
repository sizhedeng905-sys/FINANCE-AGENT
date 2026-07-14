import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldType, SemanticType } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';

import { DocumentPreprocessorService } from '../src/ocr/document-preprocessor.service';
import { MockOcrProvider } from '../src/ocr/mock-ocr.provider';
import { OcrProviderRegistry } from '../src/ocr/ocr-provider.registry';
import { OcrProviderInput, OcrTemplateField } from '../src/ocr/ocr-provider';

function config(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as ConfigService;
}

const fields: OcrTemplateField[] = [
  {
    id: 'f-date', fieldKey: 'date', fieldName: '日期', fieldType: FieldType.date,
    semanticType: SemanticType.date, aliases: ['发生日期'], isRequired: true, isVisible: true
  },
  {
    id: 'f-amount', fieldKey: 'amount', fieldName: '金额', fieldType: FieldType.money,
    semanticType: SemanticType.amount, aliases: ['费用金额'], isRequired: true, isVisible: true
  }
];

function input(attemptNo = 1): OcrProviderInput {
  return {
    documentId: 'ocr-test',
    rawFileId: 'raw-test',
    fileName: 'receipt.pdf',
    mimeType: 'application/pdf',
    sha256: 'a'.repeat(64),
    buffer: Buffer.from('test'),
    pages: [{
      page: 1,
      preprocessing: {
        rotationReserved: true,
        compressionReserved: true,
        scalingReserved: true,
        renderingReserved: true
      }
    }],
    fields,
    attemptNo
  };
}

describe('OCR phase 10 providers and preprocessing', () => {
  it('selects an enabled database OCR route before the environment fallback', async () => {
    const mock = { name: 'mock' } as any;
    const local = { name: 'local_paddle' } as any;
    const runtime = {
      resolve: jest.fn(async () => ({ deployment: { provider: 'local_paddle' } }))
    } as any;
    const registry = new OcrProviderRegistry(config({ 'ocr.provider': 'mock' }), mock, local, runtime);

    await expect(registry.current()).resolves.toBe(local);
    runtime.resolve.mockResolvedValue(undefined);
    await expect(registry.current()).resolves.toBe(mock);
    expect(() => registry.byName('unknown')).toThrow('不支持的 OCR Provider');
  });

  it('returns deterministic normal, low-confidence, and missing-field results', async () => {
    const provider = new MockOcrProvider(config({ 'ocr.model': 'mock-test', 'ocr.modelVersion': 'test-v1' }));
    const normal = await provider.recognize(input());
    expect(normal).toMatchObject({ documentId: 'ocr-test', extractedText: expect.stringContaining('金额') });
    expect(normal.fieldCandidates).toHaveLength(2);
    expect(normal.fieldCandidates.every((candidate) => candidate.confidence >= 0.8)).toBe(true);

    const low = await provider.recognize({ ...input(), scenario: 'low_confidence' });
    expect(low.fieldCandidates[0]).toMatchObject({ confidence: 0.55, evidence: expect.stringContaining('需人工确认') });

    const missing = await provider.recognize({ ...input(), scenario: 'missing_field' });
    expect(missing.fieldCandidates).toHaveLength(1);
    expect(missing.fieldCandidates.some((candidate) => candidate.targetFieldId === 'f-date')).toBe(false);
  });

  it('returns stable failure and recoverable failure-once behavior', async () => {
    const provider = new MockOcrProvider(config({}));
    await expect(provider.recognize({ ...input(), scenario: 'failure' })).rejects.toThrow('识别失败');
    await expect(provider.recognize({ ...input(1), scenario: 'failure_once' })).rejects.toThrow('识别失败');
    await expect(provider.recognize({ ...input(2), scenario: 'failure_once' })).resolves.toMatchObject({
      documentId: 'ocr-test',
      fieldCandidates: expect.any(Array)
    });
  });

  it('reads real PDF pages and rejects page limits, damaged files, and encrypted markers', async () => {
    const preprocessor = new DocumentPreprocessorService(config({ 'ocr.maxPdfPages': 2 }));
    const valid = await PDFDocument.create();
    valid.addPage([320, 480]);
    valid.addPage([640, 480]);
    const pages = await preprocessor.inspect(Buffer.from(await valid.save()), 'application/pdf');
    expect(pages).toMatchObject([
      { page: 1, width: 320, height: 480 },
      { page: 2, width: 640, height: 480 }
    ]);

    const tooLong = await PDFDocument.create();
    tooLong.addPage();
    tooLong.addPage();
    tooLong.addPage();
    await expect(preprocessor.inspect(Buffer.from(await tooLong.save()), 'application/pdf')).rejects.toThrow('不能超过 2 页');
    await expect(preprocessor.inspect(Buffer.from('%PDF-1.4\nbroken\n%%EOF'), 'application/pdf')).rejects.toBeInstanceOf(BadRequestException);
    await expect(preprocessor.inspect(Buffer.from('%PDF-1.4\n/Encrypt\n%%EOF'), 'application/pdf')).rejects.toThrow('受密码保护');
  });
});
