import { readRuntimeConfig } from './runtime-config';

export type { AppDataMode } from './runtime-config';

export const runtimeConfig = readRuntimeConfig({
  VITE_APP_DATA_MODE: import.meta.env.VITE_APP_DATA_MODE,
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_API_TIMEOUT_MS: import.meta.env.VITE_API_TIMEOUT_MS,
});
