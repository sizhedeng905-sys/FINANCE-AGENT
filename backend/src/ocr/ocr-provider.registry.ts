import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

import { modelExecutionSnapshot } from '../model-runtime/model-deployment-config';
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
        routeId: route.id,
        taskType: route.taskType,
        deployment: modelExecutionSnapshot(route.deployment)
      },
      secret: this.modelRuntime.resolveSecret(route.deployment.secretRef)
    } : { ...base };
    assertSafeConfigSummary(snapshot.configSummary);
    snapshot.configHash = hashOcrProviderConfig(snapshot);
    return { provider, config: snapshot };
  }

  fromSnapshot(source: unknown, expectedHash?: string | null): ResolvedOcrProvider {
    const snapshot = parseOcrProviderSnapshot(source);
    const configHash = hashOcrProviderConfig(snapshot);
    if ((snapshot.configHash && snapshot.configHash !== configHash) || (expectedHash && expectedHash !== configHash)) {
      throw new Error('OCR provider configuration snapshot hash does not match');
    }
    const config: OcrProviderExecutionConfig = {
      ...snapshot,
      configHash,
      secret: this.modelRuntime.resolveSecret(snapshot.secretRef)
    };
    return { provider: this.byName(config.provider), config };
  }

  byName(name: string): OcrProvider {
    if (name === 'local_paddle') return this.localPaddle;
    if (name === 'mock') return this.mock;
    throw new Error(`不支持的 OCR Provider：${name}`);
  }
}

export function hashOcrProviderConfig(snapshot: OcrProviderExecutionConfig) {
  return createHash('sha256').update(JSON.stringify(canonicalize({
    provider: snapshot.provider,
    modelName: snapshot.modelName,
    modelVersion: snapshot.modelVersion ?? null,
    endpoint: snapshot.endpoint?.replace(/\/+$/, '') ?? null,
    secretRef: snapshot.secretRef ?? null,
    timeoutMs: snapshot.timeoutMs,
    maxConcurrency: snapshot.maxConcurrency,
    configSummary: snapshot.configSummary
  }))).digest('hex');
}

function parseOcrProviderSnapshot(source: unknown): OcrProviderExecutionConfig {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('OCR provider configuration snapshot is invalid');
  }
  const value = source as Record<string, unknown>;
  if ('secret' in value) throw new Error('OCR provider configuration snapshot must not contain a secret value');
  const provider = requiredString(value.provider, 'provider');
  const modelName = requiredString(value.modelName, 'modelName');
  const timeoutMs = positiveInteger(value.timeoutMs, 'timeoutMs');
  const maxConcurrency = positiveInteger(value.maxConcurrency, 'maxConcurrency');
  const configSummary = value.configSummary;
  if (!configSummary || typeof configSummary !== 'object' || Array.isArray(configSummary)) {
    throw new Error('OCR provider configuration snapshot configSummary is invalid');
  }
  assertSafeConfigSummary(configSummary);
  const endpoint = optionalString(value.endpoint, 'endpoint')?.replace(/\/+$/, '');
  if (endpoint) {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('OCR provider configuration endpoint is invalid');
    }
  }
  const secretRef = optionalString(value.secretRef, 'secretRef');
  if (secretRef && !/^[A-Z][A-Z0-9_]*$/.test(secretRef)) {
    throw new Error('OCR provider configuration secretRef is invalid');
  }
  return {
    provider,
    modelName,
    modelVersion: optionalString(value.modelVersion, 'modelVersion'),
    endpoint,
    secretRef,
    timeoutMs,
    maxConcurrency,
    configSummary: configSummary as Record<string, unknown>,
    configHash: optionalString(value.configHash, 'configHash')
  };
}

function assertSafeConfigSummary(value: unknown, path = 'configSummary'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeConfigSummary(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /\bBearer\s+\S+/i.test(value)) {
      throw new Error(`OCR provider configuration ${path} contains a credential`);
    }
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[-_]/g, '').toLowerCase();
    if (['secret', 'apikey', 'password', 'authorization', 'accesstoken', 'refreshtoken', 'credential'].includes(normalized)) {
      throw new Error(`OCR provider configuration ${path}.${key} must not contain a credential`);
    }
    assertSafeConfigSummary(item, `${path}.${key}`);
  }
}

function requiredString(value: unknown, field: string) {
  const parsed = optionalString(value, field);
  if (!parsed) throw new Error(`OCR provider configuration ${field} is required`);
  return parsed;
}

function optionalString(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`OCR provider configuration ${field} is invalid`);
  return value.trim() || undefined;
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`OCR provider configuration ${field} is invalid`);
  }
  return Number(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  );
}
