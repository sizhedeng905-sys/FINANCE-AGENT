import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readRuntimeConfig } from './src/config/runtime-config';

export default defineConfig(({ mode }) => {
  const loaded = loadEnv(mode, process.cwd(), '');
  const runtime = readRuntimeConfig({
    VITE_APP_DATA_MODE: process.env.VITE_APP_DATA_MODE ?? loaded.VITE_APP_DATA_MODE,
    VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? loaded.VITE_API_BASE_URL,
    VITE_API_TIMEOUT_MS: process.env.VITE_API_TIMEOUT_MS ?? loaded.VITE_API_TIMEOUT_MS,
  });

  return {
    plugins: [
      react(),
      {
        name: 'finance-agent-runtime-manifest',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'runtime-config.json',
            source: `${JSON.stringify(runtime, null, 2)}\n`,
          });
        },
      },
    ],
    define: {
      'import.meta.env.VITE_APP_DATA_MODE': JSON.stringify(runtime.dataMode),
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(runtime.apiBaseUrl),
      'import.meta.env.VITE_API_TIMEOUT_MS': JSON.stringify(String(runtime.apiTimeoutMs)),
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            const normalized = id.replace(/\\/g, '/');
            if (/node_modules\/react(?:-dom)?\//.test(normalized) || normalized.includes('node_modules/react-router')) {
              return 'react-vendor';
            }
            if (
              normalized.includes('node_modules/rc-') ||
              normalized.includes('node_modules/@rc-component/') ||
              normalized.includes('node_modules/@ant-design/icons') ||
              normalized.includes('node_modules/@ant-design/cssinjs')
            ) {
              return 'antd-runtime';
            }
            if (normalized.includes('node_modules/dayjs')) return 'dayjs';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  };
});
