import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
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
});
