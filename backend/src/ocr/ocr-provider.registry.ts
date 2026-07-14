import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ModelRuntimeService } from '../model-runtime/model-runtime.service';
import { LocalPaddleOcrProvider } from './local-paddle-ocr.provider';
import { MockOcrProvider } from './mock-ocr.provider';
import { OcrProvider } from './ocr-provider';

@Injectable()
export class OcrProviderRegistry {
  private readonly providerName: string;

  constructor(
    config: ConfigService,
    private readonly mock: MockOcrProvider,
    private readonly localPaddle: LocalPaddleOcrProvider,
    private readonly modelRuntime: ModelRuntimeService
  ) {
    this.providerName = config.get<string>('ocr.provider') ?? 'mock';
  }

  async current(): Promise<OcrProvider> {
    const route = await this.modelRuntime.resolve('ocr_document');
    return this.byName(route?.deployment.provider ?? this.providerName);
  }

  byName(name: string): OcrProvider {
    if (name === 'local_paddle') return this.localPaddle;
    if (name === 'mock') return this.mock;
    throw new Error(`不支持的 OCR Provider：${name}`);
  }
}
