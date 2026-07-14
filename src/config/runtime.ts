export type AppDataMode = 'mock' | 'api';

function readDataMode(value: string | undefined): AppDataMode {
  const mode = (value ?? 'mock').trim().toLowerCase();
  if (mode !== 'mock' && mode !== 'api') {
    throw new Error('VITE_APP_DATA_MODE 只能是 mock 或 api');
  }
  return mode;
}

function readApiBaseUrl(value: string | undefined): string {
  const candidate = (value ?? 'http://127.0.0.1:3001/api').trim().replace(/\/+$/, '');
  const parsed = new URL(candidate);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('VITE_API_BASE_URL 必须是 HTTP(S) 地址');
  }
  return candidate;
}

function readTimeout(value: string | undefined): number {
  const timeout = Number(value ?? '15000');
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) {
    throw new Error('VITE_API_TIMEOUT_MS 必须是 1000 到 120000 之间的整数');
  }
  return timeout;
}

export const runtimeConfig = Object.freeze({
  dataMode: readDataMode(import.meta.env.VITE_APP_DATA_MODE),
  apiBaseUrl: readApiBaseUrl(import.meta.env.VITE_API_BASE_URL),
  apiTimeoutMs: readTimeout(import.meta.env.VITE_API_TIMEOUT_MS),
});
