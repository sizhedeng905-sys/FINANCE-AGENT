import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FieldType, SemanticType } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';

import { DocumentPreprocessorService } from '../src/ocr/document-preprocessor.service';
import { LocalPaddleOcrProvider } from '../src/ocr/local-paddle-ocr.provider';
import { MockOcrProvider } from '../src/ocr/mock-ocr.provider';
import { OcrProviderRegistry } from '../src/ocr/ocr-provider.registry';
import { OcrProviderInput, OcrTemplateField } from '../src/ocr/ocr-provider';
import { OcrTasksService } from '../src/ocr/ocr-tasks.service';

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
    const snapshot = (provider: string) => ({
      provider,
      modelName: `${provider}-model`,
      timeoutMs: 1000,
      maxConcurrency: 1,
      configSummary: { source: 'test' }
    });
    const mock = { name: 'mock', snapshot: () => snapshot('mock') } as any;
    const local = { name: 'local_paddle', snapshot: () => snapshot('local_paddle') } as any;
    const runtime = {
      resolve: jest.fn(async () => ({
        id: 'route-1',
        taskType: 'ocr_document',
        deployment: {
          id: 'deployment-1',
          provider: 'local_paddle',
          modelName: 'paddle-test',
          modelVersion: 'v1',
          endpoint: 'http://127.0.0.1:8868',
          secretRef: 'OCR_API_KEY',
          timeoutMs: 1000,
          maxConcurrency: 1,
          key: 'paddle-test',
          taskTypes: ['ocr_document'],
          isLocal: true,
          isEnabled: true,
          configHash: 'deployment-hash'
        }
      })),
      resolveSecret: jest.fn(() => 'test-secret')
    } as any;
    const registry = new OcrProviderRegistry(config({ 'ocr.provider': 'mock' }), mock, local, runtime);

    await expect(registry.current()).resolves.toBe(local);
    const resolution = await registry.resolve();
    expect(resolution.config).toMatchObject({
      provider: 'local_paddle',
      endpoint: 'http://127.0.0.1:8868',
      secretRef: 'OCR_API_KEY',
      secret: 'test-secret',
      timeoutMs: 1000,
      maxConcurrency: 1,
      configHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    const { secret: _secret, ...persisted } = resolution.config;
    expect(registry.fromSnapshot(JSON.parse(JSON.stringify(persisted)), persisted.configHash).config)
      .toMatchObject({ ...persisted, secret: 'test-secret' });
    expect(() => registry.fromSnapshot(persisted, '0'.repeat(64))).toThrow('hash does not match');
    expect(() => registry.fromSnapshot({
      ...persisted,
      configSummary: { source: 'test', apiKey: 'must-not-persist' }
    })).toThrow('must not contain a credential');
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
    expect(normal.fieldCandidates.find((candidate) => candidate.targetFieldId === 'f-amount')?.normalizedValue)
      .toBe('1280.50');

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

  it('prepares OCR input before opening the database transaction', async () => {
    const events: string[] = [];
    const prisma = {
      rawFile: {
        findUnique: jest.fn(async () => ({
          id: 'raw-test',
          relatedProjectId: 'project-test',
          isVoided: false,
          sha256: 'a'.repeat(64)
        }))
      },
      $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
        events.push('transaction');
        return callback({});
      })
    };
    const files = {
      readForProcessing: jest.fn(async () => {
        events.push('file');
        return { buffer: Buffer.from('image'), mimeType: 'image/png' };
      })
    };
    const preprocessor = {
      inspect: jest.fn(async () => {
        events.push('preprocess');
        return [{ page: 1 }];
      })
    };
    const providers = {
      resolve: jest.fn(async () => {
        events.push('provider');
        return {
          provider: { name: 'mock' },
          config: {
            provider: 'mock',
            modelName: 'mock-ocr',
            timeoutMs: 1_000,
            maxConcurrency: 1,
            configSummary: { source: 'test' }
          }
        };
      })
    };
    const idempotency = {
      prepare: jest.fn(() => ({})),
      persistenceKey: jest.fn(() => 'idem-v1:test'),
      execute: jest.fn(async (_tx: unknown, _scope: unknown, _status: number, execute: () => Promise<unknown>) => execute())
    };
    const service = new OcrTasksService(
      prisma as any,
      files as any,
      preprocessor as any,
      providers as any,
      {} as any,
      {} as any,
      {} as any,
      idempotency as any,
      {} as any,
      config({})
    );
    jest.spyOn(service as any, 'createTaskWithinTransaction').mockResolvedValue({ id: 'ocr-test' });

    await expect(service.create(
      { rawFileId: 'raw-test', projectId: 'project-test', templateId: 'template-test' },
      { id: 'finance-test' } as any,
      {} as any
    )).resolves.toEqual({ id: 'ocr-test' });

    expect(events).toEqual(['provider', 'file', 'preprocess', 'transaction']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('round-trips allowed decimal boundaries without accepting JSON numbers or unsafe magnitudes', () => {
    const service = Object.create(OcrTasksService.prototype) as any;
    const moneyField = { fieldType: FieldType.money } as any;
    const numberField = { fieldType: FieldType.number } as any;
    const cases = [
      ['.01', '0.01'],
      ['.09', '0.09'],
      ['.99', '0.99'],
      ['99,999,999,999,999.99', '99999999999999.99'],
      ['-1,280.50', '-1280.5']
    ];
    for (const [source, expected] of cases) {
      expect(service.normalizeFieldValue(moneyField, source, 'raw-test')).toBe(expected);
    }
    expect(service.normalizeFieldValue(numberField, '42.0001', 'raw-test')).toBe('42.0001');
    expect(() => service.normalizeFieldValue(moneyField, 0.01, 'raw-test')).toThrow('字符串');
    expect(() => service.normalizeFieldValue(numberField, '9007199254740991', 'raw-test')).toThrow('超出允许范围');
    expect(() => service.normalizeFieldValue(numberField, '9007199254740993', 'raw-test')).toThrow('超出允许范围');
  });

  it('preserves conflicting OCR candidates instead of silently choosing one value', () => {
    const service = Object.create(OcrTasksService.prototype) as any;
    service.lowConfidenceThreshold = 0.8;
    const templateFields = [{
      fieldId: 'f-amount',
      isVisible: true,
      isRequired: true,
      field: {
        id: 'f-amount',
        fieldKey: 'amount',
        fieldName: 'Amount',
        fieldType: FieldType.money,
        semanticType: SemanticType.amount,
        aliases: [],
        isActive: true
      }
    }];
    const providerCandidates = [
      {
        targetFieldId: 'f-amount', sourceLabel: 'Amount', rawValue: '125.60', normalizedValue: '125.60',
        page: 1, confidence: 0.97, evidence: 'page one'
      },
      {
        targetFieldId: 'f-amount', sourceLabel: 'Amount', rawValue: '999.99', normalizedValue: '999.99',
        page: 2, confidence: 0.96, evidence: 'page two'
      }
    ];

    expect(service.canonicalizeCandidates(
      providerCandidates,
      templateFields,
      'raw-test',
      [['p1-b1'], ['p2-b1']]
    )).toEqual([expect.objectContaining({
      normalizedValue: '125.6',
      evidenceRefs: ['p1-b1'],
      valueSource: 'OCR_PROVIDER',
      evidenceConflict: true,
      lowConfidence: true,
      validationError: expect.stringContaining('冲突'),
      alternatives: [expect.objectContaining({
        page: 2,
        normalizedValue: '999.99',
        evidenceRefs: ['p2-b1']
      })]
    })]);
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
    const tooLongBuffer = Buffer.from(await tooLong.save());
    await expect(preprocessor.inspect(tooLongBuffer, 'application/pdf')).rejects.toThrow('请选择不超过 2 页');
    const selectedPages = await preprocessor.inspect(tooLongBuffer, 'application/pdf', { pageStart: 2, pageEnd: 3 });
    expect(selectedPages.map((page) => page.page)).toEqual([2, 3]);
    const prepared = await preprocessor.prepare(tooLongBuffer, 'application/pdf', { pageStart: 2, pageEnd: 3 });
    expect((await PDFDocument.load(prepared.buffer)).getPageCount()).toBe(2);
    expect(prepared.pages.map((page) => page.page)).toEqual([2, 3]);
    await expect(preprocessor.inspect(tooLongBuffer, 'application/pdf', { pageStart: 2 })).rejects
      .toThrow('必须同时提供');
    await expect(preprocessor.inspect(tooLongBuffer, 'application/pdf', { pageStart: 1, pageEnd: 3 })).rejects
      .toThrow('最多选择 2 页');
    await expect(preprocessor.inspect(Buffer.from('image'), 'image/jpeg', { pageStart: 1, pageEnd: 1 })).rejects
      .toThrow('图片 OCR 不支持');
    await expect(preprocessor.inspect(Buffer.from('%PDF-1.4\nbroken\n%%EOF'), 'application/pdf')).rejects.toBeInstanceOf(BadRequestException);
    await expect(preprocessor.inspect(Buffer.from('%PDF-1.4\n/Encrypt\n%%EOF'), 'application/pdf')).rejects.toThrow('受密码保护');
  });

  it('maps sliced PDF provider pages back to original page numbers', async () => {
    const payload = {
      documentId: 'ocr-test',
      extractedText: '金额：100',
      pages: [{ page: 1 }, { page: 2 }],
      textBlocks: [{ page: 1, text: '首页' }],
      tables: [{ page: 2, text: '表格' }],
      fieldCandidates: [{
        targetFieldKey: 'amount',
        sourceLabel: '金额',
        rawValue: '100',
        normalizedValue: '100',
        page: 2,
        confidence: 0.9,
        evidence: 'synthetic'
      }],
      rawResult: { provider: 'local_paddle' }
    };
    const http = {
      request: jest.fn(async () => new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }))
    };
    const outputValidator = { validate: jest.fn((_schema, value) => value) };
    const provider = new LocalPaddleOcrProvider(config({
      'ocr.model': 'PaddleOCR-VL',
      'ocr.modelVersion': 'v1',
      'ocr.baseUrl': 'http://127.0.0.1:8868',
      'ocr.apiKey': 'test-secret',
      'ocr.timeoutMs': 1000,
      'modelRuntime.ocrMaxConcurrency': 1,
      'ocr.maxResponseBytes': 1024 * 1024
    }), http as any, outputValidator as any);
    const slicedInput = {
      ...input(),
      pages: [
        { ...input().pages[0], page: 16 },
        { ...input().pages[0], page: 17 }
      ]
    };
    const result = await provider.recognize(slicedInput);

    expect(result.pages.map((page) => page.page)).toEqual([16, 17]);
    expect(result.textBlocks[0].page).toBe(16);
    expect(result.tables[0].page).toBe(17);
    expect(result.fieldCandidates[0].page).toBe(17);

    payload.fieldCandidates[0].page = 3;
    await expect(provider.recognize(slicedInput)).rejects.toThrow('超出所选页段');
  });
});
