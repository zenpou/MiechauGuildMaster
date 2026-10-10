import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

export interface ServiceWorkerSourceOptions {
  files: string[];
  version: string;
}

function normalizeOutputPath(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\.\//, '');
}

async function listFiles(root: string, dir = root): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else files.push(normalizeOutputPath(relative(root, path)));
  }
  return files;
}

/**
 * 今回のリリースで生成したファイルと、今の public からコピーしたファイルだけを選ぶ。
 * 前回のハッシュ付きチャンクは、まだ再読み込みしていないタブのためにディスクへ残すが、
 * 新しい worker のキャッシュには決して入れない。
 */
export function selectPrecacheFiles(
  files: string[],
  generatedFiles: Iterable<string>,
  publicFiles: Iterable<string>,
): string[] {
  const current = new Set([
    ...Array.from(generatedFiles, normalizeOutputPath),
    ...Array.from(publicFiles, normalizeOutputPath),
  ]);
  return files
    .map(normalizeOutputPath)
    .filter(file => file !== 'sw.js' && current.has(file))
    .sort();
}

/**
 * 古いタブ用に残したファイルを除いて、出力先を読む。
 * Vite のフックから切り離しておくのは、ブラウザ向けのビルドを丸ごと回さずに、
 * 小さな一時フィクスチャでリリース境界を確かめられるようにするため。
 */
export async function collectCurrentReleaseFiles(
  output: string,
  generatedFiles: Iterable<string>,
  publicDir?: string,
): Promise<string[]> {
  const files = await listFiles(output);
  const publicFiles = publicDir ? await listFiles(publicDir) : [];
  return selectPrecacheFiles(files, generatedFiles, publicFiles);
}

/**
 * 生成する worker を純関数にしておくのは、キャッシュとナビゲーションの規則を
 * ブラウザを起動せずに回帰テストできるようにするため。
 */
export function renderServiceWorker({ files, version }: ServiceWorkerSourceOptions): string {
  return `
const ROOT = self.registration.scope;
const ROOT_URL = new URL(ROOT);
const PREFIX = 'miechau-guild-master-' + encodeURIComponent(ROOT) + '-';
const CACHE = PREFIX + '${version}';
const FILES = ${JSON.stringify(files)}.map(f => new URL(f, ROOT).href);
const PRECACHE_REQUESTS = FILES.map(url => new Request(url, { cache: 'reload' }));
const INDEX_URL = new URL('index.html', ROOT).href;
const SW_PATH = new URL('sw.js', ROOT).pathname;
const NAVIGATION_PAGES = new Map([
  [ROOT_URL.pathname, INDEX_URL],
  [new URL('index.html', ROOT).pathname, INDEX_URL],
]);
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE_REQUESTS))));
self.addEventListener('message', e => { if (e.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== ROOT_URL.origin || !url.pathname.startsWith(ROOT_URL.pathname)) return;
  // sw.js の更新確認に古いプリキャッシュで答えると、新しい版をいつまでも見つけられない
  if (url.pathname === SW_PATH) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (e.request.mode === 'navigate') {
      const page = NAVIGATION_PAGES.get(url.pathname);
      if (!page) return fetch(e.request);
      return await cache.match(page) || fetch(e.request);
    }
    return await cache.match(e.request, {ignoreSearch: true}) || fetch(e.request);
  })());
});
`;
}

/** 本番の出力(public の画像も含む)をそのまま、リリースごとのハッシュ付きでプリキャッシュする */
export function pwaPlugin(): Plugin {
  let output = '';
  let publicDir = '';
  let generatedFiles = new Set<string>();
  return {
    name: 'miechau-guild-master-offline', apply: 'build',
    // Vite がビルドの設定を確定する前に入れる。前に読み込んだタブが動いている間は、
    // 古いハッシュ付きチャンクを消さずに残しておくため
    config() {
      return { build: { emptyOutDir: false } };
    },
    configResolved(config) {
      output = resolve(config.root, config.build.outDir);
      publicDir = config.publicDir;
    },
    writeBundle(_options, bundle) {
      // Vite の HTML プラグインは generateBundle の後で入口のページを足すことがある。
      // index.html も確実にプリキャッシュするため、最後の writeBundle の bundle を使う
      generatedFiles = new Set(Object.keys(bundle).map(normalizeOutputPath));
    },
    async closeBundle() {
      const files = await collectCurrentReleaseFiles(output, generatedFiles, publicDir);
      const hash = createHash('sha256');
      for (const file of files) { hash.update(file); hash.update(await readFile(resolve(output, file))); }
      const version = hash.digest('hex').slice(0, 16);
      await writeFile(resolve(output, 'sw.js'), renderServiceWorker({ files, version }), 'utf8');
    },
  };
}
