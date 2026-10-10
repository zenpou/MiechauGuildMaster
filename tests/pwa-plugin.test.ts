import { runInNewContext } from 'node:vm';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { collectCurrentReleaseFiles, pwaPlugin, renderServiceWorker, selectPrecacheFiles } from '../scripts/pwa-plugin';

type FakeRequestInit = { method?: string; mode?: string; cache?: string };

class FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  readonly cache: string | undefined;
  constructor(input: string | FakeRequest, init: FakeRequestInit = {}) {
    this.url = input instanceof FakeRequest ? input.url : input;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'cors';
    this.cache = init.cache;
  }
}

const SCOPE = 'https://example.test/miechau/';
const cacheNameOf = (version: string) => `miechau-guild-master-${encodeURIComponent(SCOPE)}-${version}`;

/** 生成した sw.js を vm で動かし、caches・fetch・self を記録用の偽物に差し替える */
function createWorkerHarness({ files = ['index.html', 'assets/main-new.js', 'icons/icon-192.png'], version = 'test-release' } = {}) {
  const handlers = new Map<string, (event: any) => void>();
  const stores = new Map<string, Map<string, unknown>>();
  const deleted: string[] = [];
  const fetched: string[] = [];
  const precacheRequests: FakeRequest[] = [];
  let claimed = false;
  let skipped = false;
  const cache = (name: string) => {
    let entries = stores.get(name);
    if (!entries) { entries = new Map(); stores.set(name, entries); }
    const store = entries;
    return {
      addAll(requests: FakeRequest[]) {
        precacheRequests.push(...requests);
        for (const request of requests) store.set(request.url, { from: 'cache', url: request.url });
        return Promise.resolve();
      },
      match(input: string | FakeRequest) {
        const url = input instanceof FakeRequest ? input.url : input;
        return Promise.resolve(store.get(url) ?? null);
      },
    };
  };
  const cachesApi = {
    open(name: string) { return Promise.resolve(cache(name)); },
    keys() { return Promise.resolve([...stores.keys()]); },
    delete(name: string) { deleted.push(name); stores.delete(name); return Promise.resolve(true); },
  };
  runInNewContext(renderServiceWorker({ files, version }), {
    URL,
    Map,
    Promise,
    JSON,
    Request: FakeRequest,
    caches: cachesApi,
    fetch: (request: FakeRequest) => {
      fetched.push(request.url);
      return Promise.resolve({ from: 'network', url: request.url });
    },
    self: {
      registration: { scope: SCOPE },
      clients: { claim: () => { claimed = true; return Promise.resolve(); } },
      skipWaiting: () => { skipped = true; },
      addEventListener: (name: string, handler: (event: any) => void) => handlers.set(name, handler),
    },
  });
  return { handlers, stores, deleted, fetched, precacheRequests, get claimed() { return claimed; }, get skipped() { return skipped; } };
}

type WorkerHarness = ReturnType<typeof createWorkerHarness>;

async function runLifecycle(harness: WorkerHarness, name: 'install' | 'activate') {
  let done: Promise<void> | undefined;
  harness.handlers.get(name)!({ waitUntil(value: Promise<void>) { done = value; } });
  await done;
}

/** respondWith されなければ undefined を返す(ブラウザ既定のネットワーク取得に任せたことになる) */
async function dispatchFetch(harness: WorkerHarness, path: string, init: FakeRequestInit = {}) {
  const request = new FakeRequest(new URL(path, SCOPE).href, { mode: 'navigate', ...init });
  let response: Promise<unknown> | undefined;
  harness.handlers.get('fetch')!({ request, respondWith(value: Promise<unknown>) { response = value; } });
  return response ? await response : undefined;
}

describe('リリース境界: sw.js に入れるファイル', () => {
  it('実際の Vite ビルドで、前回の古いチャンクは dist に残しつつ、sw.js の FILES には今回の成果物だけを入れる', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miechau-pwa-'));
    const output = join(root, 'dist');
    try {
      await mkdir(join(output, 'assets'), { recursive: true });
      await writeFile(join(output, 'assets', 'main-old.js'), 'old release');
      await writeFile(join(root, 'index.html'), '<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>');
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src', 'main.js'), 'document.body.dataset.release = "current";');

      await build({
        root,
        base: './',
        configFile: false,
        logLevel: 'silent',
        plugins: [pwaPlugin()],
        build: {
          outDir: 'dist',
          emptyOutDir: true,
          write: true,
          rollupOptions: { input: resolve(root, 'index.html') },
        },
      });

      const currentAsset = (await readdir(join(output, 'assets'))).find(file => file !== 'main-old.js');
      expect(currentAsset).toBeDefined();
      expect(await readFile(join(output, 'assets', 'main-old.js'), 'utf8')).toBe('old release');
      const worker = await readFile(join(output, 'sw.js'), 'utf8');
      const precache = JSON.parse(worker.match(/const FILES = (\[[^\n]*\])\.map/)![1]) as string[];
      expect(precache).toContain(`assets/${currentAsset}`);
      expect(precache).toContain('index.html');
      expect(precache).not.toContain('assets/main-old.js');
      expect(precache).not.toContain('sw.js');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('出力先の一覧から、今回の生成物と public のファイルだけを拾う(public が無くても落ちない)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'miechau-pwa-'));
    const output = join(root, 'dist');
    const publicDir = join(root, 'public');
    try {
      await mkdir(join(output, 'assets'), { recursive: true });
      await mkdir(join(output, 'icons'), { recursive: true });
      await mkdir(join(publicDir, 'icons'), { recursive: true });
      for (const file of ['index.html', 'sw.js', 'assets/main-old.js', 'assets/main-new.js', 'icons/icon-192.png']) {
        await writeFile(join(output, file), file);
      }
      await writeFile(join(publicDir, 'icons', 'icon-192.png'), 'icon');

      expect(await collectCurrentReleaseFiles(output, ['index.html', 'assets/main-new.js'], publicDir))
        .toEqual(['assets/main-new.js', 'icons/icon-192.png', 'index.html']);
      expect(await collectCurrentReleaseFiles(output, ['index.html'], join(root, 'missing-public')))
        .toEqual(['index.html']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('Windows の区切り文字のパスでも、前回の古いチャンクを除く', () => {
    expect(selectPrecacheFiles(
      ['assets\\main-old.js', 'assets\\main-new.js'],
      ['assets/main-new.js'],
      [],
    )).toEqual(['assets/main-new.js']);
  });

  it('今回の成果物に sw.js が混ざっても、sw.js 自身はキャッシュに入れない', () => {
    expect(selectPrecacheFiles(['index.html', 'sw.js'], ['index.html'], ['sw.js'])).toEqual(['index.html']);
  });
});

describe('生成する sw.js のふるまい', () => {
  it('キャッシュ名は接頭辞 miechau-guild-master- とスコープと版からなり、版ごとに別になる', async () => {
    const a = createWorkerHarness({ version: 'release-a' });
    const b = createWorkerHarness({ version: 'release-b' });
    await runLifecycle(a, 'install');
    await runLifecycle(b, 'install');
    expect([...a.stores.keys()]).toEqual([cacheNameOf('release-a')]);
    expect([...b.stores.keys()]).toEqual([cacheNameOf('release-b')]);
  });

  it('インストール時に、今回の全ファイルを HTTP キャッシュを通さずに取り直す', async () => {
    const harness = createWorkerHarness();
    await runLifecycle(harness, 'install');
    expect(harness.precacheRequests.map(request => request.url)).toEqual([
      `${SCOPE}index.html`,
      `${SCOPE}assets/main-new.js`,
      `${SCOPE}icons/icon-192.png`,
    ]);
    expect(harness.precacheRequests.every(request => request.cache === 'reload')).toBe(true);
  });

  it('ナビゲーションは、ルートでも index.html でも、キャッシュした index.html を返す', async () => {
    const harness = createWorkerHarness();
    await runLifecycle(harness, 'install');
    expect(await dispatchFetch(harness, '/miechau/')).toEqual({ from: 'cache', url: `${SCOPE}index.html` });
    expect(await dispatchFetch(harness, '/miechau/index.html')).toEqual({ from: 'cache', url: `${SCOPE}index.html` });
    expect(harness.fetched).toEqual([]);
  });

  it('知らないページへのナビゲーションは index.html にすり替えず、ネットワークに回す', async () => {
    const harness = createWorkerHarness();
    await runLifecycle(harness, 'install');
    expect(await dispatchFetch(harness, '/miechau/missing.html')).toEqual({ from: 'network', url: `${SCOPE}missing.html` });
  });

  it('キャッシュにある資産はキャッシュから返し、無いものはネットワークから取る', async () => {
    const harness = createWorkerHarness();
    await runLifecycle(harness, 'install');
    expect(await dispatchFetch(harness, '/miechau/assets/main-new.js', { mode: 'no-cors' })).toEqual({ from: 'cache', url: `${SCOPE}assets/main-new.js` });
    expect(await dispatchFetch(harness, '/miechau/assets/other.js', { mode: 'no-cors' })).toEqual({ from: 'network', url: `${SCOPE}assets/other.js` });
  });

  it('sw.js の取得は、キャッシュにあっても常にネットワークに任せる', async () => {
    const harness = createWorkerHarness({ files: ['index.html', 'sw.js'] });
    await runLifecycle(harness, 'install');
    expect(await dispatchFetch(harness, '/miechau/sw.js', { mode: 'same-origin' })).toBeUndefined();
    expect(await dispatchFetch(harness, '/miechau/sw.js')).toBeUndefined();
  });

  it('GET 以外の要求とスコープの外の要求には手を出さない', async () => {
    const harness = createWorkerHarness();
    await runLifecycle(harness, 'install');
    expect(await dispatchFetch(harness, '/miechau/index.html', { method: 'POST' })).toBeUndefined();
    expect(await dispatchFetch(harness, '/other/index.html')).toBeUndefined();
    expect(await dispatchFetch(harness, 'https://cdn.example.test/miechau/index.html')).toBeUndefined();
  });

  it('有効化のときに自分の古い版のキャッシュだけを消し、接頭辞の違うキャッシュ(同じオリジンの前作など)は残す', async () => {
    const harness = createWorkerHarness();
    await runLifecycle(harness, 'install');
    harness.stores.set(cacheNameOf('old-release'), new Map());
    harness.stores.set(`guildquest-${encodeURIComponent(SCOPE)}-old-release`, new Map());
    await runLifecycle(harness, 'activate');
    expect(harness.deleted).toEqual([cacheNameOf('old-release')]);
    expect(harness.claimed).toBe(true);
  });

  it('新しい版は ACTIVATE_UPDATE を受けるまで待機し、受けたら有効になる', () => {
    const harness = createWorkerHarness();
    harness.handlers.get('message')!({ data: 'something-else' });
    expect(harness.skipped).toBe(false);
    harness.handlers.get('message')!({ data: 'ACTIVATE_UPDATE' });
    expect(harness.skipped).toBe(true);
  });
});

class FakeEventTarget {
  readonly listeners = new Map<string, Array<(...args: any[]) => void>>();
  addEventListener(type: string, listener: (...args: any[]) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener); this.listeners.set(type, list);
  }
  dispatchEvent(type: string, event: any = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** pwa.ts が触る window・document・navigator.serviceWorker・location を記録用の偽物にする */
function createPwaClientHarness(controller: object | null) {
  const window = new FakeEventTarget() as FakeEventTarget & { isSecureContext: boolean };
  window.isSecureContext = true;
  const document = new FakeEventTarget() as FakeEventTarget & {
    visibilityState: string;
    getElementById(id: string): any;
    createElement(tag: string): any;
  };
  document.visibilityState = 'visible';
  const pwa = {
    children: [] as any[],
    className: '',
    replaceChildren(...children: any[]) { this.children = children; },
    append(...children: any[]) { this.children.push(...children); },
  };
  document.getElementById = () => pwa;
  document.createElement = () => ({ textContent: '', className: '', disabled: false, onclick: null as (() => void) | null });
  const serviceWorker = new FakeEventTarget() as FakeEventTarget & {
    controller: object | null;
    ready: Promise<any>;
    register: ReturnType<typeof vi.fn>;
  };
  serviceWorker.controller = controller;
  const registration = new FakeEventTarget() as FakeEventTarget & {
    waiting: any;
    installing: any;
    update: ReturnType<typeof vi.fn>;
  };
  registration.waiting = null;
  registration.installing = null;
  registration.update = vi.fn(() => Promise.resolve());
  serviceWorker.register = vi.fn(() => Promise.resolve(registration));
  serviceWorker.ready = Promise.resolve(registration);
  const location = { reload: vi.fn() };
  const matchMedia = () => ({ matches: false });
  return { window, document, pwa, serviceWorker, registration, location, matchMedia };
}

type PwaClientHarness = ReturnType<typeof createPwaClientHarness>;

async function importPwaClient(harness: PwaClientHarness, { prod = true } = {}) {
  vi.resetModules();
  vi.stubEnv('PROD', prod);
  vi.stubGlobal('window', harness.window);
  vi.stubGlobal('document', harness.document);
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: harness.serviceWorker });
  vi.stubGlobal('location', harness.location);
  vi.stubGlobal('matchMedia', harness.matchMedia);
  const module = await import('../src/ui/pwa');
  module.initPwa();
  await Promise.resolve();
  await Promise.resolve();
  return module;
}

const textsOf = (harness: PwaClientHarness) => harness.pwa.children.map((child: any) => child.textContent);
const updateButtonOf = (harness: PwaClientHarness) =>
  harness.pwa.children.find((child: any) => ['更新して再起動', '更新を適用中…'].includes(child.textContent));

describe('更新ボタンと再読み込み(src/ui/pwa.ts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('開発中(PROD でない)は Service Worker を登録せず、開発プレビューと表示する', async () => {
    const harness = createPwaClientHarness(null);
    await importPwaClient(harness, { prod: false });
    expect(harness.serviceWorker.register).not.toHaveBeenCalled();
    expect(textsOf(harness)).toContain('開発プレビュー · 自動保存');
  });

  it('初めてのインストールの claim では再読み込みせず、次の版への切り替えで1回だけ再読み込みする', async () => {
    const harness = createPwaClientHarness(null);
    await importPwaClient(harness);
    harness.serviceWorker.dispatchEvent('controllerchange');
    expect(harness.location.reload).not.toHaveBeenCalled();
    harness.serviceWorker.controller = {};
    harness.serviceWorker.dispatchEvent('controllerchange');
    harness.serviceWorker.dispatchEvent('controllerchange');
    expect(harness.location.reload).toHaveBeenCalledTimes(1);
  });

  it('待機中の版があれば「更新して再起動」を出し、押すと ACTIVATE_UPDATE を1回だけ送って押せなくする', async () => {
    const harness = createPwaClientHarness({});
    const worker = { postMessage: vi.fn() };
    harness.registration.waiting = worker;
    await importPwaClient(harness);
    expect(updateButtonOf(harness).textContent).toBe('更新して再起動');
    updateButtonOf(harness).onclick();
    expect(worker.postMessage).toHaveBeenCalledWith('ACTIVATE_UPDATE');
    expect(updateButtonOf(harness).textContent).toBe('更新を適用中…');
    expect(updateButtonOf(harness).disabled).toBe(true);
    updateButtonOf(harness).onclick();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });

  it('別のタブが更新を適用したときも再読み込みし、waiting が消えても再読み込みは1回だけ', async () => {
    const harness = createPwaClientHarness({});
    const worker = { postMessage: vi.fn(() => { harness.registration.waiting = null; }) };
    harness.registration.waiting = worker;
    await importPwaClient(harness);
    updateButtonOf(harness).onclick();
    expect(worker.postMessage).toHaveBeenCalledWith('ACTIVATE_UPDATE');
    harness.serviceWorker.controller = {};
    // 別のタブから有効化が始まった場合を表す。このタブの registration.waiting はもう null でも再読み込みする
    harness.serviceWorker.dispatchEvent('controllerchange');
    harness.serviceWorker.dispatchEvent('controllerchange');
    expect(harness.location.reload).toHaveBeenCalledTimes(1);
  });
});
