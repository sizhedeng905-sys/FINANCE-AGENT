import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface CircuitState {
  failures: number;
  openedAt?: number;
}

export interface ResilientRequestOptions {
  circuitKey: string;
  timeoutMs: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

@Injectable()
export class ResilientHttpClientService {
  private readonly circuits = new Map<string, CircuitState>();
  private readonly defaultRetries: number;
  private readonly failureThreshold: number;
  private readonly resetMs: number;

  constructor(config: ConfigService) {
    this.defaultRetries = config.get<number>('modelRuntime.httpMaxRetries') ?? 1;
    this.failureThreshold = config.get<number>('modelRuntime.circuitFailureThreshold') ?? 3;
    this.resetMs = config.get<number>('modelRuntime.circuitResetMs') ?? 30000;
  }

  async request(url: string, init: RequestInit, options: ResilientRequestOptions): Promise<Response> {
    this.ensureCircuitAvailable(options.circuitKey);
    const retries = options.maxRetries ?? this.defaultRetries;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (options.signal?.aborted) throw new ServiceUnavailableException('模型执行租约已失效');
      try {
        const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
        const response = await fetch(url, {
          ...init,
          signal: options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal
        });
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) {
          this.recordSuccess(options.circuitKey);
          return response;
        }
        lastError = new Error(`模型服务 HTTP ${response.status}`);
        if (attempt === retries) {
          this.recordFailure(options.circuitKey);
          return response;
        }
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted) {
          throw new ServiceUnavailableException('模型执行租约已失效');
        }
        if (attempt === retries) {
          this.recordFailure(options.circuitKey);
          throw new ServiceUnavailableException('模型服务网络请求失败或超时');
        }
      }
      await this.delay(Math.min(1000, 100 * 2 ** attempt), options.signal);
    }

    this.recordFailure(options.circuitKey);
    throw lastError instanceof Error ? lastError : new ServiceUnavailableException('模型服务请求失败');
  }

  snapshot() {
    return Object.fromEntries([...this.circuits].map(([key, state]) => [key, {
      failures: state.failures,
      open: state.openedAt !== undefined && Date.now() - state.openedAt < this.resetMs
    }]));
  }

  private ensureCircuitAvailable(key: string) {
    const state = this.state(key);
    if (state.openedAt === undefined) return;
    if (Date.now() - state.openedAt >= this.resetMs) {
      state.failures = 0;
      state.openedAt = undefined;
      return;
    }
    throw new ServiceUnavailableException('模型服务熔断中，请稍后重试或转人工处理');
  }

  private recordSuccess(key: string) {
    const state = this.state(key);
    state.failures = 0;
    state.openedAt = undefined;
  }

  private recordFailure(key: string) {
    const state = this.state(key);
    state.failures += 1;
    if (state.failures >= this.failureThreshold) state.openedAt = Date.now();
  }

  private state(key: string) {
    let state = this.circuits.get(key);
    if (!state) {
      state = { failures: 0 };
      this.circuits.set(key, state);
    }
    return state;
  }

  private delay(ms: number, signal?: AbortSignal) {
    if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
    if (signal.aborted) return Promise.reject(new ServiceUnavailableException('模型执行租约已失效'));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new ServiceUnavailableException('模型执行租约已失效'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }
}
