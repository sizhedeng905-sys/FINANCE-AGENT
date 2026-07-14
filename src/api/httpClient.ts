import { runtimeConfig } from '@/config/runtime';
import { clearAccessToken, createRequestId, getAccessToken, getCsrfToken, notifySessionExpired } from './authSession';

export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'business' | 'protocol';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: number;
  readonly data?: unknown;
  readonly requestId: string;

  constructor(
    message: string,
    options: {
      kind: ApiErrorKind;
      requestId: string;
      status?: number;
      code?: number;
      data?: unknown;
      cause?: unknown;
    },
  ) {
    super(`${message}（请求编号：${options.requestId}）`);
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
    this.name = 'ApiError';
    this.kind = options.kind;
    this.requestId = options.requestId;
    this.status = options.status;
    this.code = options.code;
    this.data = options.data;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeoutMs?: number;
}

export interface BinaryResponse {
  blob: Blob;
  fileName?: string;
  mimeType: string;
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'number' &&
    typeof (value as { message?: unknown }).message === 'string' &&
    'data' in value
  );
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const requestId = createRequestId();
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? runtimeConfig.apiTimeoutMs;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const token = getAccessToken();
  const headers = new Headers(options.headers);
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  headers.set('Accept', 'application/json');
  headers.set('X-Request-Id', requestId);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const method = (options.method ?? 'GET').toUpperCase();
  const csrfToken = getCsrfToken();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  if (options.body !== undefined && !isFormData) headers.set('Content-Type', 'application/json');

  try {
    const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, {
      ...options,
      body: options.body === undefined
        ? undefined
        : isFormData
          ? options.body as FormData
          : JSON.stringify(options.body),
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
    const responseRequestId = response.headers.get('x-request-id') ?? requestId;
    const payload = await parseJson(response);
    const envelope = isEnvelope(payload) ? payload : undefined;

    if (!response.ok) {
      if (response.status === 401) {
        clearAccessToken();
        notifySessionExpired();
      }
      throw new ApiError(envelope?.message ?? `请求失败（HTTP ${response.status}）`, {
        kind: 'http',
        requestId: responseRequestId,
        status: response.status,
        code: envelope?.code,
        data: envelope?.data,
      });
    }

    if (!envelope) {
      throw new ApiError('服务端响应格式不正确', {
        kind: 'protocol',
        requestId: responseRequestId,
        status: response.status,
      });
    }
    if (envelope.code !== 0) {
      throw new ApiError(envelope.message || '业务处理失败', {
        kind: 'business',
        requestId: responseRequestId,
        status: response.status,
        code: envelope.code,
        data: envelope.data,
      });
    }
    return envelope.data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(`请求超时（${timeoutMs}ms）`, {
        kind: 'timeout',
        requestId,
        cause: error,
      });
    }
    throw new ApiError('无法连接后端服务', {
      kind: 'network',
      requestId,
      cause: error,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function responseFileName(contentDisposition: string | null): string | undefined {
  if (!contentDisposition) return undefined;
  const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return contentDisposition.match(/filename="?([^";]+)"?/i)?.[1];
}

async function requestBinary(path: string, options: Omit<RequestOptions, 'body'> = {}): Promise<BinaryResponse> {
  const requestId = createRequestId();
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? runtimeConfig.apiTimeoutMs;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(options.headers);
  const token = getAccessToken();
  headers.set('Accept', 'application/octet-stream, application/pdf, image/*');
  headers.set('X-Request-Id', requestId);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  try {
    const response = await fetch(`${runtimeConfig.apiBaseUrl}${path}`, {
      ...options,
      method: options.method ?? 'GET',
      headers,
      credentials: 'include',
      signal: controller.signal,
    });
    const responseRequestId = response.headers.get('x-request-id') ?? requestId;
    if (!response.ok) {
      const payload = await parseJson(response);
      const envelope = isEnvelope(payload) ? payload : undefined;
      if (response.status === 401) {
        clearAccessToken();
        notifySessionExpired();
      }
      throw new ApiError(envelope?.message ?? `请求失败（HTTP ${response.status}）`, {
        kind: 'http',
        requestId: responseRequestId,
        status: response.status,
        code: envelope?.code,
        data: envelope?.data,
      });
    }
    return {
      blob: await response.blob(),
      fileName: responseFileName(response.headers.get('content-disposition')),
      mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(`请求超时（${timeoutMs}ms）`, {
        kind: 'timeout',
        requestId,
        cause: error,
      });
    }
    throw new ApiError('无法连接后端服务', {
      kind: 'network',
      requestId,
      cause: error,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const httpClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
  binary: (path: string, options?: Omit<RequestOptions, 'body'>) => requestBinary(path, options),
};
