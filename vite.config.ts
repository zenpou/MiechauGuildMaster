import { resolve } from 'node:path';
import { defineConfig } from 'vite';
// PWA プラグイン(scripts/pwa-plugin.ts)はフェーズ7で前作から持ち込む
export default defineConfig({
  base: './',
  resolve: { extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'] },
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html') } } },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
