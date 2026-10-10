import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { pwaPlugin } from './scripts/pwa-plugin.ts';
export default defineConfig({
  base: './',
  resolve: { extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'] },
  plugins: [pwaPlugin()],
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html') } } },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
