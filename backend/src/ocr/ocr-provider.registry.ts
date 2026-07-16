import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import { ModelRuntimeService } from '../model-runtime/model-runtime.service';
import { LocalPaddleOcrProvider } from './local-paddle-ocr.provider';
import { MockOcrProvider } from './mock-ocr.provider';
import { OcrProvider, OcrProviderExecutionConfig } from './ocr-provider';

export interface ResolvedOcrProvider {
  provider: OcrProvider;
  config: OcrProviderExecutionConfig;
}

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
    return (await this.resolve()).provider;
  }

  async resolve(): Promise<ResolvedOcrProvider> {
    const route = await this.modelRuntime.resolve('ocr_document');
    const provider = this.byName(route?.deployment.provider ?? this.providerName);
    const base = provider.snapshot();
    const snapshot: OcrProviderExecutionConfig = route ? {
      provider: route.deployment.provider,
      modelName: route.deployment.modelName,
      modelVersion: route.deployment.modelVersion,
      endpoint: route.deployment.endpoint,
      secretRef: route.deployment.secretRef,
      timeoutMs: route.deployment.timeoutMs,
      maxConcurrency: route.deployment.maxConcurrency,
      configSummary: {
        source: 'database_route',
        deploymentKey: route.deployment.key,
        routeId: route.id,
        taskType: route.taskType,
        isLocal: route.deployment.isLocal
      },
      secret: this.modelRuntime.resolveSecret(route.deployment.secretRef)
    } : { ...base };
    snapshot.configHash = createHash('sha256').update(JSON.stringify({
      provider: snapshot.provider,
      modelName: snapshot.modelName,
      modelVersion: snapshot.modelVersion ?? null,
      endpoint: snapshot.endpoint ?? null,
      secretRef: snapshot.secretRef ?? null,
      timeoutMs: snapshot.timeoutMs,
      maxConcurrency: snapshot.maxConcurrency,
      configSummary: snapshot.configSummary
    })).digest('hex');
    return { provider, config: snapshot };
  }

  byName(name: string): OcrProvider {
    if (name === 'local_paddle') return this.localPaddle;
    if (name === 'mock') return this.mock;
    throw new Error(`不支持的 OCR Provider：${name}`);
  }
}
