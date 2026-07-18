export type AppDataMode = 'mock' | 'api';

export interface RuntimeEnvironment {
  VITE_APP_DATA_MODE?: string;
  VITE_API_BASE_URL?: string;
  VITE_API_TIMEOUT_MS?: string;
}

function readDataMode(value: string | undefined): AppDataMode {
  const mode = value?.trim().toLowerCase();
  if (mode !== 'mock' && mode !== 'api') {
    throw new Error('VITE_APP_DATA_MODE 必须显式设置为 mock 或 api');
  }
  return mode;
}

function readApiBaseUrl(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate) {
    throw new Error('VITE_API_BASE_URL 必须显式设置');
  }
  if (/[\u0000-\u001f\u007f]/.test(value ?? '') || candidate.includes('\\') || /%5c/i.test(candidate)) {
    throw new Error('VITE_API_BASE_URL 包含不安全字符');
  }
  if (candidate.startsWith('//')) {
    throw new Error('VITE_API_BASE_URL 不允许协议相对地址');
  }

  let parsed: URL;
  const relative = candidate.startsWith('/');
  try {
    parsed = relative ? new URL(candidate, 'https://same-origin.invalid') : new URL(candidate);
  } catch {
    throw new Error('VITE_API_BASE_URL 不是合法 URL');
  }
  if ((!relative && !['http:', 'https:'].includes(parsed.protocol)) || parsed.username || parsed.password) {
    throw new Error('VITE_API_BASE_URL 只允许无凭据的 HTTP(S) 地址或同源绝对路径');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('VITE_API_BASE_URL 不允许查询参数或片段');
  }
  if (parsed.pathname.includes('//')) {
    throw new Error('VITE_API_BASE_URL 路径不允许连续斜杠');
  }

  const pathname = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '');
  return relative ? pathname : `${parsed.origin}${pathname === '/' ? '' : pathname}`;
}

function readTimeout(value: string | undefined): number {
  const timeout = Number(value ?? '15000');
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) {
    throw new Error('VITE_API_TIMEOUT_MS 必须是 1000 到 120000 之间的整数');
  }
  return timeout;
}

export function readRuntimeConfig(environment: RuntimeEnvironment) {
  return Object.freeze({
    dataMode: readDataMode(environment.VITE_APP_DATA_MODE),
    apiBaseUrl: readApiBaseUrl(environment.VITE_API_BASE_URL),
    apiTimeoutMs: readTimeout(environment.VITE_API_TIMEOUT_MS),
  });
}

export function buildApiUrl(baseUrl: string, requestPath: string): string {
  const normalizedBase = readApiBaseUrl(baseUrl);
  if (
    !requestPath.startsWith('/') ||
    requestPath.startsWith('//') ||
    requestPath.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(requestPath)
  ) {
    throw new Error('API 请求路径必须是安全的同源绝对路径');
  }

  let parsedPath: URL;
  try {
    parsedPath = new URL(requestPath, 'https://same-origin.invalid');
  } catch {
    throw new Error('API 请求路径不是合法 URL');
  }
  if (parsedPath.origin !== 'https://same-origin.invalid' || parsedPath.hash || parsedPath.pathname.includes('//')) {
    throw new Error('API 请求路径包含不允许的来源、片段或连续斜杠');
  }

  return normalizedBase === '/' ? requestPath : `${normalizedBase}${requestPath}`;
}
