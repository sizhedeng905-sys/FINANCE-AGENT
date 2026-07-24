import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ResilientHttpClientService } from '../model-runtime/resilient-http-client.service';
import { StructuredOutputValidatorService } from '../model-runtime/structured-output-validator.service';
import {
  OcrProvider,
  OcrProviderExecutionConfig,
  OcrProviderInput,
  OcrProviderResult,
  OcrProviderSnapshot
} from './ocr-provider';

@Injectable()
export class LocalPaddleOcrProvider implements OcrProvider {
  readonly name = 'local_paddle';
  private readonly modelName: string;
  private readonly modelVersion: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly maxResponseBytes: number;

  constructor(
    config: ConfigService,
    private readonly http: ResilientHttpClientService,
    private readonly outputValidator: StructuredOutputValidatorService
  ) {
    this.modelName = config.get<string>('ocr.model') ?? 'PaddleOCR-VL';
    this.modelVersion = config.get<string>('ocr.modelVersion') ?? 'unknown';
    this.baseUrl = (config.get<string>('ocr.baseUrl') ?? 'http://127.0.0.1:8868').replace(/\/+$/, '');
    this.apiKey = config.get<string>('ocr.apiKey') ?? '';
    this.timeoutMs = config.get<number>('ocr.timeoutMs') ?? 30000;
    this.maxConcurrency = config.get<number>('modelRuntime.ocrMaxConcurrency') ?? 1;
    this.maxResponseBytes = config.get<number>('ocr.maxResponseBytes') ?? 2 * 1024 * 1024;
  }

  snapshot(): OcrProviderSnapshot {
    return {
      provider: this.name,
      modelName: this.modelName,
      modelVersion: this.modelVersion,
      endpoint: this.baseUrl,
      secretRef: 'OCR_API_KEY',
      timeoutMs: this.timeoutMs,
      maxConcurrency: this.maxConcurrency,
      configSummary: { source: 'environment', transport: 'multipart' }
    };
  }

  async recognize(input: OcrProviderInput, config?: OcrProviderExecutionConfig): Promise<OcrProviderResult> {
    const endpoint = (config?.endpoint ?? this.baseUrl).replace(/\/+$/, '');
    const apiKey = config?.secret ?? this.apiKey;
    const timeoutMs = config?.timeoutMs ?? this.timeoutMs;
    const body = new FormData();
    body.set('file', new Blob([Uint8Array.from(input.buffer)], { type: input.mimeType }), input.fileName);
    body.set('documentId', input.documentId);
    body.set('templateFields', JSON.stringify(input.fields.map((field) => ({
      fieldId: field.id,
      fieldKey: field.fieldKey,
      fieldName: field.fieldName,
      fieldType: field.fieldType,
      semanticType: field.semanticType,
      aliases: field.aliases
    }))));

    let response: Response;
    try {
      response = await this.http.request(`${endpoint}/ocr`, {
        method: 'POST',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        body
      }, {
        circuitKey: `ocr:${endpoint}`,
        timeoutMs,
        signal: config?.signal
      });
    } catch {
      throw new BadGatewayException('本地 Paddle OCR 服务不可用');
    }
    if (!response.ok) throw new BadGatewayException(`本地 Paddle OCR 返回 ${response.status}`);

    const payload = this.outputValidator.validate(
      localPaddleResponseSchema,
      await this.readLimitedJson(response)
    ) as OcrProviderResult;
    if (payload.documentId !== input.documentId) throw new BadGatewayException('本地 Paddle OCR 返回了错误的 documentId');
    const pages = this.mapPages(payload.pages, input);
    return {
      documentId: input.documentId,
      extractedText: payload.extractedText,
      pages,
      textBlocks: this.mapRecordPages(Array.isArray(payload.textBlocks) ? payload.textBlocks : [], input),
      tables: this.mapRecordPages(Array.isArray(payload.tables) ? payload.tables : [], input),
      fieldCandidates: payload.fieldCandidates.map((candidate) => ({
        ...candidate,
        page: this.mapPage(candidate.page, input)
      })),
      rawResult: payload.rawResult && typeof payload.rawResult === 'object' ? payload.rawResult : payload as unknown as Record<string, unknown>,
      rawResultRef: payload.rawResultRef
    };
  }

  private mapPages(value: unknown, input: OcrProviderInput) {
    if (!Array.isArray(value) || value.length !== input.pages.length) {
      throw new BadGatewayException('Local Paddle OCR returned an invalid page count');
    }
    const mapped = new Map<number, OcrProviderResult['pages'][number]>();
    for (const rawPage of value) {
      if (!rawPage || typeof rawPage !== 'object' || Array.isArray(rawPage)) {
        throw new BadGatewayException('Local Paddle OCR returned invalid page metadata');
      }
      const page = rawPage as Record<string, unknown>;
      const ordinal = this.providerPageOrdinal(page.page, input);
      if (mapped.has(ordinal)) {
        throw new BadGatewayException('Local Paddle OCR returned duplicate page metadata');
      }
      const sourcePage = input.pages[ordinal - 1];
      mapped.set(ordinal, {
        ...sourcePage,
        page: sourcePage.page,
        width: this.pageDimension(page.width),
        height: this.pageDimension(page.height),
        preprocessing: { ...sourcePage.preprocessing }
      });
    }
    return input.pages.map((_page, index) => {
      const page = mapped.get(index + 1);
      if (!page) throw new BadGatewayException('Local Paddle OCR omitted page metadata');
      return page;
    });
  }

  private mapRecordPages(items: Array<Record<string, unknown>>, input: OcrProviderInput) {
    return items.map((item) => ({
      ...item,
      ...(typeof item.page === 'number' ? { page: this.mapPage(item.page, input) } : {})
    }));
  }

  private mapPage(value: number, input: OcrProviderInput) {
    const ordinal = this.providerPageOrdinal(value, input);
    return input.pages[ordinal - 1].page;
  }

  private providerPageOrdinal(value: unknown, input: OcrProviderInput) {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > input.pages.length) {
      throw new BadGatewayException('本地 Paddle OCR 返回了超出所选页段的页码');
    }
    return Number(value);
  }

  private pageDimension(value: unknown) {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 200_000) {
      throw new BadGatewayException('Local Paddle OCR returned invalid page dimensions');
    }
    return Number(value);
  }

  private async readLimitedJson(response: Response) {
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      throw new BadGatewayException('本地 Paddle OCR 响应超过安全上限');
    }
    if (!response.body) throw new BadGatewayException('本地 Paddle OCR 返回空响应');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxResponseBytes) {
        await reader.cancel();
        throw new BadGatewayException('本地 Paddle OCR 响应超过安全上限');
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new BadGatewayException('本地 Paddle OCR 返回无效 JSON');
    }
  }
}

const localPaddleResponseSchema = {
  type: 'object',
  properties: {
    documentId: { type: 'string', minLength: 1, maxLength: 100 },
    extractedText: { type: 'string', maxLength: 100000 },
    pages: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, maximum: 200 },
          width: { type: 'integer', minimum: 1, maximum: 200000 },
          height: { type: 'integer', minimum: 1, maximum: 200000 },
          preprocessing: {
            type: 'object',
            properties: {
              rotationReserved: { type: 'boolean' },
              compressionReserved: { type: 'boolean' },
              scalingReserved: { type: 'boolean' },
              renderingReserved: { type: 'boolean' }
            },
            required: ['rotationReserved', 'compressionReserved', 'scalingReserved', 'renderingReserved'],
            additionalProperties: false
          }
        },
        required: ['page', 'width', 'height', 'preprocessing'],
        additionalProperties: false
      }
    },
    textBlocks: { type: 'array', maxItems: 5000, items: { type: 'object', additionalProperties: true }, nullable: true },
    tables: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: true }, nullable: true },
    fieldCandidates: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        properties: {
          targetFieldId: { type: 'string', maxLength: 100, nullable: true },
          targetFieldKey: { type: 'string', maxLength: 128, nullable: true },
          sourceLabel: { type: 'string', maxLength: 256 },
          rawValue: {},
          normalizedValue: {},
          page: { type: 'integer' },
          boundingBox: { type: 'object', additionalProperties: true, nullable: true },
          confidence: { type: 'number' },
          evidence: { type: 'string', maxLength: 2000 }
        },
        required: ['sourceLabel', 'rawValue', 'normalizedValue', 'page', 'confidence', 'evidence'],
        additionalProperties: false
      }
    },
    rawResult: { type: 'object', additionalProperties: true, nullable: true },
    rawResultRef: { type: 'string', maxLength: 500, nullable: true }
  },
  required: ['documentId', 'extractedText', 'pages', 'fieldCandidates'],
  additionalProperties: false
} as any;
