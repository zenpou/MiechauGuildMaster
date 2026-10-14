'use strict';
// ビルドした画面(dist)を、インストール済みの Chrome で通して確かめる。npm run build の後に npm run test:browser で回す。
// 引数にシナリオ名(new tabs dispatch day60 day100 clear transfer pwa)を並べると、それだけを回す。
// 結果は artifacts/browser-check.json、画面は artifacts/screens/phase7-*.png。失敗が1つでもあれば終了コード1。
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ARTIFACTS = path.join(ROOT, 'artifacts');
const SCREENS = path.join(ARTIFACTS, 'screens');
const FIXTURES = path.join(ARTIFACTS, 'fixtures');
/** src/core/save.ts の SAVE_KEY */
const SAVE_KEY = 'miechau-guild-master.save.v1';
const TITLE = '見えちゃうギルドマスター';
const TABS = [
  ['home', '拠点'], ['inbox', '受信箱'], ['quests', '依頼'], ['dispatch', '派遣'], ['world', 'ワールド'],
  ['recruit', '募集'], ['base', '施設'], ['map', '地図'], ['log', 'ログ'], ['records', '記録'],
];
/** 隊の上限(PARTY_MAX)。派遣の通しは名簿にいる人数(初日はティナ1人)とこの数の小さい方で出す */
const PARTY = 4;
/** sim:dragon の bot が seed 1 で進めた途中のセーブ。clear は竜を倒した日で止まる */
const FIXTURE_DAYS = { day60: 60, day100: 100, clear: 200 };
const VIEWPORTS = [
  { name: 'desktop', base: '/', options: { viewport: { width: 1280, height: 900 } } },
  // GitHub Pages のプロジェクトサイト(/<リポジトリ>/)に置いた形
  { name: 'mobile', base: '/miechau/', options: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
/** scripts/pwa-plugin.ts が書く版の行。ここだけ変えた sw.js を配って「次のリリース」にする */
const SW_CACHE = /const CACHE = PREFIX \+ '([^']+)';/;
/** 1回(シナリオ×画面)の上限。アプリが固まると page.evaluate は返らない(タイムアウトが無い)ので、ここで打ち切る */
const RUN_LIMIT = 3 * 60_000;
/** ブラウザを閉じ終わるのを待つ上限 */
const CLOSE_LIMIT = 15_000;
/** 途中のセーブを sim:dragon で作るときの上限 */
const SIM_LIMIT = 5 * 60_000;

const SCENARIOS = [
  { id: 'new', title: '新規開始', run: newGame },
  { id: 'tabs', title: '全タブ巡回', run: newGameTabs },
  { id: 'dispatch', title: '派遣の通し', run: dispatchRoundTrip },
  { id: 'day60', title: '途中のセーブ(60日)', fixture: 'day60', run: (t) => midGame(t, 'day60') },
  { id: 'day100', title: '途中のセーブ(100日)', fixture: 'day100', run: (t) => midGame(t, 'day100') },
  { id: 'clear', title: '竜を倒したセーブ', fixture: 'clear', run: dragonCleared },
  { id: 'transfer', title: 'セーブの書き出しと読み込み', fixture: 'day60', run: saveTransfer },
  { id: 'pwa', title: 'PWA', run: pwa, skip: (env) => (env.files.has('/sw.js') ? null : '未実装(dist に sw.js が無い)') },
];
const RESULT_LABEL = { pass: '合格', fail: '不合格', skip: '飛ばした' };

function bail(msg) {
  console.error(msg);
  process.exit(1);
}

const relPath = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/** Playwright の例外は呼び出し履歴まで続くので、1行目と待っていた相手だけにする */
function brief(e) {
  const lines = String(e?.message ?? e).replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const waiting = lines.find((l) => l.startsWith('- waiting for'));
  return `${lines[0] ?? ''}${waiting ? `(${waiting.slice(2)})` : ''}`;
}

// このリポジトリの依存に Playwright を足さずに済むよう、前作の node_modules も探す
function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE || 'playwright', path.resolve(ROOT, '..', 'GuildQuest', 'node_modules', 'playwright')];
  for (const id of candidates) {
    try {
      return require(id);
    } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') throw e;
    }
  }
  return bail([
    `Playwright が見つかりません(探した所: ${candidates.join(' / ')})。次のどちらかで用意してください。`,
    '  npm install --no-save playwright',
    '  PLAYWRIGHT_MODULE=<playwright のフォルダ> npm run test:browser',
    'ブラウザはインストール済みの Chrome を使うので、npx playwright install は要りません。',
  ].join('\n'));
}

/** 途中のセーブ。無いものだけ sim:dragon で作る(既にあれば作り直さない) */
function prepareFixtures(names) {
  const out = {};
  for (const name of names) {
    const file = path.join(FIXTURES, `${name}.json`);
    try {
      if (!fs.existsSync(file)) {
        console.log(`途中のセーブを作ります: ${relPath(file)}(seed 1・${FIXTURE_DAYS[name]}日)`);
        // npm は Windows では npm.cmd なので、シェルを通す execSync で呼ぶ
        execSync(`npm run sim:dragon -- --seed 1 ${FIXTURE_DAYS[name]} --dump ${relPath(file)}`,
          { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], timeout: SIM_LIMIT });
      }
      const raw = fs.readFileSync(file, 'utf8');
      const s = JSON.parse(raw);
      out[name] = { raw, seed: s.seed, day: s.day, dragon: !!s.dragonDefeated };
    } catch (e) {
      out[name] = { error: (e.stderr?.toString().trim() || brief(e)).split('\n').slice(-3).join(' ') };
    }
  }
  return out;
}

/** dist を最初に読み込んでおく。検証の途中で誰かが build し直しても、1回の実行の中では同じ版を配る */
function readTree(dir) {
  const files = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.set(`/${path.relative(dir, p).split(path.sep).join('/')}`, fs.readFileSync(p));
    }
  };
  walk(dir);
  return files;
}

// デスクトップ(/)とサブディレクトリ(/miechau/)はポートを分ける。1つのサーバーで両方に答えると、
// サブディレクトリの画面が /assets/… のような絶対パスを引いても見つかってしまい、Pages での 404 を見逃す
async function startSite(files, base) {
  const site = { base, url: '', release: 0, missing: [], server: null };
  site.server = http.createServer((req, res) => {
    let pathname = '';
    try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { /* 読めないURLは404 */ }
    let key = pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : null;
    if (key?.endsWith('/')) key += 'index.html';
    let body = key ? files.get(key) : undefined;
    if (!body) {
      site.missing.push(pathname);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    if (key === '/sw.js' && site.release) {
      body = Buffer.from(body.toString('utf8').replace(SW_CACHE, (_, v) => `const CACHE = PREFIX + '${v}-browser-check${site.release}';`));
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(key)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  });
  await new Promise((resolve, reject) => {
    site.server.once('error', reject);
    site.server.listen(0, '127.0.0.1', resolve);
  });
  site.url = `http://127.0.0.1:${site.server.address().port}${base}`;
  return site;
}

function makeTester(run, page, context, vp, env, site) {
  const errors = [];
  let seen404 = site.missing.length;
  // 打ち切った後も裏で動き続けるシナリオが、確定した結果に書き足さないようにする
  let sealed = false;
  const push = (list, msg) => { if (!sealed) list.push(msg); };
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).split('\n')[0]}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const at = m.location()?.url;
    errors.push(`console.error: ${m.text()}${at ? `(${at})` : ''}`);
  });
  return {
    page, context, vp, env, site,
    fail: (msg) => push(run.failures, msg),
    warn: (msg) => push(run.warnings, msg),
    note: (msg) => push(run.notes, msg),
    check: (ok, msg) => { if (!ok) push(run.failures, msg); return !!ok; },
    seal: () => { sealed = true; },
    /** ここまでに出たエラーと 404 を、どこで出たかを添えて失敗にする */
    flush(where) {
      for (const e of errors.splice(0)) push(run.failures, `${where}: ${e}`);
      for (const p of site.missing.slice(seen404)) push(run.failures, `${where}: 404 ${p}`);
      seen404 = site.missing.length;
    },
    async shot(name) {
      const file = path.join(SCREENS, `phase7-${name}-${vp.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      push(run.screenshots, relPath(file));
    },
    fixture(name) {
      const fx = env.fixtures[name];
      if (fx && !fx.error) return fx;
      push(run.failures, `途中のセーブ ${name} を用意できない: ${fx?.error ?? '不明'}`);
      return null;
    },
    async open(fixture) {
      if (fixture) {
        await context.addInitScript(([key, raw]) => {
          // 読み込みのたびに入れ直すと「再読込しても残る・二度と出ない」を確かめられないので、このタブで最初の1回だけ入れる
          try {
            if (sessionStorage.getItem('browser-check:seeded')) return;
            localStorage.setItem(key, raw);
            sessionStorage.setItem('browser-check:seeded', '1');
          } catch { /* about:blank では Storage に触れない。本来のページでもう一度呼ばれる */ }
        }, [SAVE_KEY, fixture.raw]);
      }
      await page.goto(site.url);
      await waitApp(page);
    },
    /** セーブの要点。セーブ全体(数百KB)を毎回運ばない */
    save: () => page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return {
        seed: s.seed, day: s.day, expeditions: s.expeditions?.length ?? 0, history: s.history?.length ?? 0,
        returnDay: s.expeditions?.[0]?.returnDay ?? null, plots: s.base ? s.base.width * s.base.height : 0,
        dragon: !!s.dragonDefeated, endingSeen: !!s.flags?.['ending:seen'],
      };
    }, SAVE_KEY),
  };
}

// エンディングの間は後ろが inert になり role では引けないことがあるので、見出しは CSS で待つ
const waitApp = (page) => page.locator('h1', { hasText: TITLE }).waitFor();

// モバイルの表示では、中身がはみ出すと innerWidth もそれに合わせて広がる(375 → 415 など)ので、innerWidth と比べるだけでは見逃す
const widths = (page) => page.evaluate(() => {
  const d = document.documentElement;
  return { scroll: d.scrollWidth, width: Math.min(window.innerWidth, d.clientWidth) };
});

async function openTab(page, label) {
  await page.locator('nav.tabs').getByRole('button', { name: new RegExp(`^${label}`) }).click({ timeout: 5000 });
  await page.locator('nav.tabs button.on', { hasText: label }).waitFor({ timeout: 5000 });
}

/**
 * 物語(紙芝居)が出ていればスキップで閉じ、閉じた本数を返す。出ていなければ何もしない。
 * shot を渡すと、最初の1本の画面を残し、横のはみ出しも確かめる
 */
async function skipStories(t, where, shot) {
  const { page } = t;
  for (let n = 0; n < 20; n++) {
    const player = page.locator('.vn-player:visible').first();
    if (!(await player.count())) return n;
    if (n === 0 && shot) {
      await t.shot(shot);
      const w = await widths(page);
      t.check(w.scroll <= w.width, `${where}: 物語が横にはみ出す(scrollWidth ${w.scroll} > 表示幅 ${w.width})`);
    }
    const skip = player.getByRole('button', { name: /^スキップ/ }).first();
    if (!(await skip.count())) throw new Error(`${where}: 物語が出ているが「スキップ」のボタンが無い`);
    const el = await player.elementHandle();
    try {
      const title = await el.evaluate((e) => e.querySelector('.vn-player-title')?.textContent ?? null);
      try {
        await skip.click({ timeout: 5000 });
      } catch (e) {
        const w = await widths(page);
        const wide = w.scroll > w.width ? `。画面が横にはみ出していて(scrollWidth ${w.scroll} > 表示幅 ${w.width})、物語の枠も画面の外まで広がっている` : '';
        throw new Error(`${where}: 物語の「スキップ」を押せない${wide}: ${brief(e)}`);
      }
      // 章ごとに作り直す実装でも、同じ枠で次の章へ進む実装でも抜けられるよう、消えるか題が変わるのを待つ
      await page.waitForFunction(([e, before]) => !e.isConnected || !e.checkVisibility()
        || (e.querySelector('.vn-player-title')?.textContent ?? null) !== before, [el, title], { timeout: 5000 })
        .catch(() => { throw new Error(`${where}: 「スキップ」を押しても物語が閉じない`); });
    } finally {
      await el.dispose();
    }
  }
  throw new Error(`${where}: 物語を20回スキップしても終わらない`);
}

async function nextDay(t) {
  const before = (await t.save()).day;
  await t.page.getByRole('button', { name: '次の日へ', exact: true }).click();
  await t.page.waitForFunction(([key, day]) => JSON.parse(localStorage.getItem(key)).day > day, [SAVE_KEY, before]);
  await skipStories(t, `${before + 1}日目`);
}

/**
 * ワールド地図の文字(ノード名・道のラベル・隊の名前)と、ノードの円の重なり。描いた後の実測(getBBox)で見る。
 * 道のラベルが重なると、距離と危険度という判断材料が読めなくなる
 */
const worldClashes = (page) => page.evaluate(() => {
  const svg = document.querySelector('.world-map');
  if (!svg) return null;
  const items = [...svg.querySelectorAll('text, circle')].map((el) => {
    const b = el.getBBox();
    return { kind: el.tagName === 'circle' ? '円' : el.getAttribute('class'), text: el.textContent || '', x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height };
  });
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.kind === '円' && b.kind === '円') continue;
      const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
      const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
      if (w > 0.3 && h > 0.3) out.push(`${a.kind}「${a.text}」と${b.kind}「${b.text}」(${w.toFixed(1)}×${h.toFixed(1)})`);
    }
  }
  return out;
});

/** 10個のタブを順に開き、描画・エラー・横のはみ出しを確かめて画面を残す */
async function tour(t, name) {
  for (const [id, label] of TABS) {
    try {
      await openTab(t.page, label);
      await t.page.locator('#app .tab-body').waitFor({ timeout: 5000 });
      const w = await widths(t.page);
      t.check(w.scroll <= w.width, `タブ「${label}」が横にはみ出す(scrollWidth ${w.scroll} > 表示幅 ${w.width})`);
      if (id === 'world') {
        const clashes = await worldClashes(t.page);
        t.check(clashes !== null && clashes.length === 0, `ワールド地図の文字が重なる: ${(clashes ?? ['地図が無い']).join(' / ')}`);
      }
      await t.shot(`${name}-${id}`);
    } catch (e) {
      t.fail(`タブ「${label}」を開けない: ${brief(e)}`);
    }
    t.flush(`タブ「${label}」`);
  }
}

async function newGame(t) {
  const { page } = t;
  await t.open();
  const stories = await skipStories(t, '開いた直後', 'new-story');
  if (stories) t.note(`開いた直後の物語を${stories}本スキップした`);
  t.check(await page.getByRole('heading', { level: 1, name: TITLE }).count() === 1, `見出し「${TITLE}」が無い`);
  const labels = await page.locator('nav.tabs > button').evaluateAll((bs) => bs.map((b) => b.firstChild?.textContent?.trim() ?? ''));
  const want = TABS.map(([, label]) => label);
  t.check(labels.join('・') === want.join('・'), `タブが ${want.join('・')} の10個でない: ${labels.join('・') || 'なし'}`);
  const hint = page.locator('.hint');
  if (!(await hint.count())) {
    t.warn('拠点に最初のヒント(.hint)が出ない(未実装なら後で入る)');
  } else {
    const text = (await hint.first().innerText()).trim();
    t.check(await hint.first().isVisible(), '最初のヒントが見えていない');
    t.check(text.includes('派遣'), `最初のヒントに「派遣」が無い: ${text}`);
  }
  await t.shot('new-home');
  t.flush('新規開始');
}

async function newGameTabs(t) {
  await t.open();
  await skipStories(t, '開いた直後');
  await tour(t, 'tabs');
}

async function dispatchRoundTrip(t) {
  const { page } = t;
  await t.open();
  await skipStories(t, '開いた直後');
  const start = await t.save();
  if (!t.check(start && start.expeditions === 0 && start.history === 0, `新規開始のセーブが想定と違う: ${JSON.stringify(start)}`)) return;
  await openTab(page, '派遣');
  await page.locator('select', { has: page.locator('option', { hasText: '森の洞窟' }) }).selectOption({ label: '森の洞窟' });
  // check() は押した後に同じ要素の状態を確かめるが、この UI は押すたびに画面を作り直すので、押してから新しい要素を待つ
  const explore = page.getByRole('radio', { name: '探索', exact: true });
  if (!(await explore.isChecked())) {
    await explore.click();
    await page.getByRole('radio', { name: '探索', exact: true, checked: true }).waitFor();
  }
  const members = Math.min(PARTY, await page.getByRole('checkbox', { checked: false, disabled: false }).count());
  if (!t.check(members >= 1, '派遣に出せる隊員が1人もいない')) return;
  for (let n = 1; n <= members; n++) {
    await page.getByRole('checkbox', { checked: false, disabled: false }).first().click();
    await page.getByRole('checkbox', { checked: true }).nth(n - 1).waitFor();
  }
  t.note(`${members}人で出す`);
  await t.shot('dispatch-form');
  await page.getByRole('button', { name: '出発', exact: true }).click();
  try {
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key))?.expeditions?.length === 1, SAVE_KEY, { timeout: 5000 });
  } catch {
    const toast = await page.locator('.toast').allInnerTexts();
    t.fail(`「出発」を押しても隊が出ない${toast.length ? `(${toast.join(' / ')})` : ''}`);
    return;
  }
  const out = await t.save();
  t.note(`${out.day}日目に出発、${out.returnDay}日目に帰還予定`);
  await openTab(page, '拠点');
  for (let i = 0; i < 30 && (await t.save()).expeditions > 0; i++) await nextDay(t);
  const back = await t.save();
  t.check(back.expeditions === 0 && back.history === 1, `帰還の後のセーブが想定と違う(派遣中 ${back.expeditions}・履歴 ${back.history})`);
  t.note(`${back.day}日目に帰還`);
  await t.shot('dispatch-return');
  t.flush('出発から帰還まで');
  await page.reload();
  await waitApp(page);
  await skipStories(t, '再読込の後');
  const again = await t.save();
  t.check(again && again.seed === back.seed && again.day === back.day && again.expeditions === 0 && again.history === 1,
    `再読込でセーブが変わった: ${JSON.stringify(again)}`);
  t.check(await page.getByText(`${back.day}日目`, { exact: true }).first().isVisible(), `再読込の後、拠点に「${back.day}日目」と出ない`);
  t.flush('再読込');
}

async function midGame(t, name) {
  const fx = t.fixture(name);
  if (!fx) return;
  await t.open(fx);
  const s = await t.save();
  if (!t.check(s && s.seed === fx.seed && s.day === fx.day, `途中のセーブ(${fx.day}日目)を読めず、別の状態で始まった: ${JSON.stringify(s)}`)) return;
  const stories = await skipStories(t, '開いた直後');
  if (stories) t.note(`開いた直後の物語を${stories}本スキップした`);
  t.flush('開いた直後');
  await tour(t, name);
  if (name === 'day100') await day100Details(t, s);
}

/** 100日目なら見えているはずのもの: 実績・区画図とシナジー・2階建てのダンジョンの階の選択 */
async function day100Details(t, s) {
  const { page } = t;
  await openTab(page, '記録');
  const head = (await page.getByRole('heading', { name: /^実績\(/ }).first().textContent().catch(() => '')) ?? '';
  const m = /\((\d+)\/(\d+)\)/.exec(head);
  if (t.check(m && Number(m[1]) > 0, `記録タブに達成した実績が出ない: ${head || '見出しなし'}`)) {
    const badges = await page.getByText('達成', { exact: true }).count();
    t.check(badges === Number(m[1]), `実績の見出しは${m[1]}件なのに、達成の印は${badges}件`);
    t.note(`実績 ${m[1]}/${m[2]}`);
  }

  await openTab(page, '施設');
  t.check(await page.getByRole('heading', { name: '区画図', exact: true }).count() === 1, '施設タブに区画図の見出しが無い');
  const plots = await page.locator('.plots .plot').count();
  const built = await page.locator('.plots .plot.built').count();
  t.check(plots === s.plots, `区画図のマスが${plots}個(セーブでは${s.plots}個)`);
  t.check(built > 0, '区画図に建った施設が1つも無い');
  t.check(await page.getByRole('heading', { name: /^シナジー/ }).count() === 1, '施設タブにシナジーの見出しが無い');
  const synergies = await page.locator('ul.synergies > li').count();
  const active = await page.locator('ul.synergies > li.on').count();
  t.check(synergies > 0, 'シナジーの一覧が空');
  t.note(`区画図 ${plots}マス(建設済み ${built})・シナジー ${synergies}組(成立中 ${active})`);
  await t.shot('day100-base-detail');

  await openTab(page, '派遣');
  const dest = page.locator('select', { has: page.locator('option', { hasText: '廃れた塔' }) });
  if (!t.check(await dest.count() === 1, '派遣の行き先に廃れた塔が無い')) return;
  await dest.selectOption({ label: '廃れた塔' });
  try {
    await page.getByRole('heading', { name: '階', exact: true }).waitFor({ timeout: 5000 });
  } catch {
    t.fail('廃れた塔(2階建て)を選んでも、階の選択が出ない');
    return;
  }
  const floors = await page.getByRole('radio', { name: /^\d+階$/ }).count();
  t.check(floors === 2, `廃れた塔の階の選択肢が${floors}個(2階建て)`);
  const upper = await page.getByRole('radio', { name: '2階', exact: true }).isEnabled().catch(() => false);
  t.note(`廃れた塔の2階は${upper ? '選べる' : 'まだ選べない'}`);
  await t.shot('day100-dispatch-tower');
  t.flush('100日目の詳しい確認');
}

/** 書き出したファイルで、日を進めたあとの進行を元に戻せる。セーブでないファイルは読み込まず、今の進行に触らない */
async function saveTransfer(t) {
  const { page } = t;
  const fx = t.fixture('day60');
  if (!fx) return;
  await t.open(fx);
  await skipStories(t, '開いた直後');
  await openTab(page, '拠点');

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    page.getByRole('button', { name: 'セーブを書き出す', exact: true }).click(),
  ]);
  const name = download.suggestedFilename();
  t.check(/^miechau-save-day\d+\.json$/.test(name), `書き出したファイル名が想定と違う: ${name}`);
  const file = path.join(os.tmpdir(), `mgm-check-${process.pid}-${name}`);
  await download.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  const here = await t.save();
  t.check(exported.seed === here.seed && exported.day === here.day, `書き出した内容が今のセーブと違う(${exported.day}日目 / ${here.day}日目)`);
  t.flush('書き出し');

  await nextDay(t);
  const later = await t.save();
  if (!t.check(later.day === here.day + 1, `日が進まない(${later.day}日目)`)) return;

  // 書き出したファイルを読み込むと、進める前の日に戻る(置き換えの確認に答える)
  const asked = [];
  page.on('dialog', (d) => { asked.push(d.message()); void d.accept(); });
  await page.locator('input[data-save-input]').setInputFiles(file);
  await page.waitForFunction(([key, day]) => JSON.parse(localStorage.getItem(key))?.day === day, [SAVE_KEY, here.day], { timeout: 10_000 })
    .catch(() => t.fail(`書き出したセーブを読み込んでも${here.day}日目に戻らない(今 ${here.day + 1}日目のまま?)`));
  t.check(asked.length === 1 && asked[0].includes(`${here.day + 1}日目`) && asked[0].includes(`${here.day}日目`),
    `置き換えの確認が想定と違う: ${JSON.stringify(asked)}`);
  t.flush('読み込み');

  // セーブでないファイルは読み込まず、確認も出さない
  asked.length = 0;
  const bad = path.join(os.tmpdir(), `mgm-check-${process.pid}-bad.json`);
  fs.writeFileSync(bad, '{"これは": "セーブではない"}');
  await page.locator('input[data-save-input]').setInputFiles(bad);
  await page.locator('.toast.err', { hasText: 'セーブとして読めません' }).waitFor({ timeout: 5000 })
    .catch(() => t.fail('セーブでないファイルを読んでも、読めなかったという知らせが出ない'));
  const kept = await t.save();
  t.check(kept.day === here.day && asked.length === 0, `セーブでないファイルで進行が変わった/確認が出た(${kept.day}日目、確認 ${asked.length}回)`);
  await t.shot('transfer');
  t.flush('壊れたファイル');
  fs.rmSync(file, { force: true });
  fs.rmSync(bad, { force: true });
}

async function dragonCleared(t) {
  const { page } = t;
  const fx = t.fixture('clear');
  if (!fx) return;
  if (!t.check(fx.dragon, `clear のセーブで竜が倒れていない(seed 1 の bot が ${fx.day}日目までに届かなかった)`)) return;
  await t.open(fx);
  const dialog = page.locator('.modal.ending');
  try {
    await dialog.waitFor({ timeout: 5000 });
  } catch {
    t.fail('竜を倒したセーブを開いても、エンディング(.modal.ending)が出ない');
    return;
  }
  await t.shot('clear-ending');
  let pages = 1;
  for (; pages < 20; pages++) {
    const next = dialog.getByRole('button', { name: '次へ', exact: true });
    if (!(await next.count())) break;
    const before = await dialog.innerText();
    await next.click();
    await page.waitForFunction((b) => document.querySelector('.modal.ending')?.innerText !== b, before);
  }
  const done = dialog.getByRole('button', { name: '続ける', exact: true });
  if (!t.check(await done.count() === 1, `エンディングの${pages}ページ目に「続ける」が無い`)) return;
  t.note(`エンディング ${pages}ページ`);
  await done.click();
  try {
    await dialog.waitFor({ state: 'detached', timeout: 5000 });
  } catch {
    t.fail('「続ける」を押してもエンディングが閉じない');
    return;
  }
  t.check((await t.save()).endingSeen, '「続ける」で閉じても、エンディングを見た印がセーブに残らない');
  const stories = await skipStories(t, 'エンディングの後', 'clear-story');
  if (stories) t.note(`エンディングの後の物語を${stories}本スキップした`);
  await t.shot('clear-after');
  t.flush('エンディング');
  await page.reload();
  await waitApp(page);
  t.check(await page.locator('.modal.ending').count() === 0, '再読込するとエンディングがまた出る');
  const again = await skipStories(t, '再読込の後');
  t.check(again === 0, `再読込すると物語がまた出る(${again}本)`);
  t.flush('再読込');
}

async function pwa(t) {
  const { page, context, env, site } = t;
  await t.open();
  await skipStories(t, '開いた直後');
  try {
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 });
  } catch {
    t.fail('サービスワーカーが登録されず、controller にならない');
    t.flush('サービスワーカー');
    return;
  }
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? null);
  t.check(scope === site.url, `サービスワーカーの scope が配置先と違う: ${scope}(配置先 ${site.url})`);
  const m = await page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    if (!link) return { error: 'link[rel=manifest] が無い' };
    const res = await fetch(link.href);
    if (!res.ok) return { error: `manifest が ${res.status}` };
    const json = await res.json();
    const icons = await Promise.all((json.icons ?? []).map(async (i) => ({ src: i.src, status: (await fetch(new URL(i.src, link.href))).status })));
    return { display: json.display, icons };
  });
  if (t.check(!m.error, `manifest を読めない: ${m.error}`)) {
    t.check(m.display === 'standalone', `manifest の display が standalone でない: ${m.display}`);
    t.check(m.icons.length === 3, `manifest のアイコンが3つでない: ${m.icons.length}`);
    for (const i of m.icons.filter((x) => x.status !== 200)) t.fail(`アイコン ${i.src} が ${i.status}`);
  }
  t.flush('サービスワーカーと manifest');

  // 新規のままだと、再読込で作り直されたのか残ったのかが日付で見分けられないので、1日進めてから切る
  await nextDay(t);
  const before = await t.save();
  await context.setOffline(true);
  let offline = true;
  try {
    await page.reload();
    await waitApp(page);
    await page.getByRole('button', { name: '次の日へ', exact: true }).waitFor();
    const after = await t.save();
    t.check(after && after.seed === before.seed && after.day === before.day,
      `オフラインで再読込するとセーブが変わる: ${before.day}日目 → ${after ? `${after.day}日目` : 'セーブなし'}`);
    await t.shot('pwa-offline');
  } catch (e) {
    t.fail(`オフラインで再読込すると拠点が出ない: ${brief(e)}`);
    offline = false;
  }
  await context.setOffline(false);
  t.flush('オフライン');
  // 続く更新の検査ができるよう、オンラインで開き直す
  if (!offline) {
    await page.goto(site.url);
    await waitApp(page);
  }

  // 更新: 版の行だけ変えた sw.js を配り、「更新して再起動」で入れ替えてもセーブが残るか
  if (!SW_CACHE.test(env.files.get('/sw.js').toString('utf8'))) {
    t.warn('sw.js に版の行(const CACHE = PREFIX + …)が見つからないので、更新の検査を飛ばした');
    return;
  }
  const saved = await t.save();
  site.release++;
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
  const update = page.getByRole('button', { name: '更新して再起動' });
  try {
    await update.waitFor({ timeout: 15000 });
  } catch {
    t.fail('新しい sw.js を配っても「更新して再起動」が出ない');
    t.flush('更新');
    return;
  }
  // 押す前から待ち始めないと、再読込が速いと load を取り逃がす。押すのに失敗したときは、この待ちを捨てる
  const reloaded = page.waitForEvent('load', { timeout: 15000 });
  reloaded.catch(() => {});
  await update.click();
  await reloaded;
  await waitApp(page);
  const after = await t.save();
  t.check(after && after.seed === saved.seed && after.day === saved.day, `更新の後でセーブが変わる: ${saved.day}日目 → ${after?.day}日目`);
  t.check(await page.getByRole('button', { name: '更新して再起動' }).count() === 0, '更新の後も「更新して再起動」が残る');
  t.flush('更新');
}

async function launch(chromium) {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    return bail(`インストール済みの Chrome を起動できません: ${brief(e)}`);
  }
}

/** 閉じ終わらないときは待たずに先へ進み、false を返す(片付けは裏で続き、%TEMP% に一時プロファイルが残ることがある) */
async function closeBrowser(browser) {
  let timer;
  const closed = await Promise.race([
    browser.close().then(() => true, () => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), CLOSE_LIMIT); }),
  ]);
  clearTimeout(timer);
  return closed;
}

async function runOne(chromium, sc, vp, env, site) {
  const run = { scenario: sc.id, title: sc.title, viewport: vp.name, result: 'pass', failures: [], warnings: [], notes: [], screenshots: [], ms: 0 };
  const started = Date.now();
  const skipped = sc.skip?.(env);
  if (skipped) {
    run.result = 'skip';
    run.skipped = skipped;
    return run;
  }
  // ブラウザも1回ごとに立ち上げ直す(1回0.3秒ほど)。この環境では Chrome を1分ほど開いたままにすると、
  // 閉じたあとに Playwright が一時プロファイルを消し終えず、10分近く返らなくなる(30秒なら起きない)
  const browser = await launch(chromium);
  let t = null;
  try {
    const context = await browser.newContext(vp.options);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(20_000);
    t = makeTester(run, page, context, vp, env, site);
    let timer;
    const limit = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), RUN_LIMIT); });
    const outcome = await Promise.race([sc.run(t).then(() => 'done', (e) => e), limit]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      t.fail(`${RUN_LIMIT / 60_000}分たっても終わらないので打ち切った(画面が固まった?)`);
    } else if (outcome !== 'done') {
      t.fail(`途中で止まった: ${brief(outcome)}`);
      await t.shot(`${sc.id}-failed`).catch(() => {});
    }
    t.flush('終了時');
  } finally {
    t?.seal();
    if (!(await closeBrowser(browser))) {
      run.warnings.push(`Chrome の後片付けが${CLOSE_LIMIT / 1000}秒で終わらないので待たずに進んだ(%TEMP% に playwright_chromiumdev_profile-* が残ることがある)`);
      env.abandoned = true;
    }
  }
  run.result = run.failures.length ? 'fail' : 'pass';
  run.ms = Date.now() - started;
  return run;
}

function report(runs, ms, files, only) {
  const count = (r) => runs.filter((x) => x.result === r).length;
  const out = {
    date: new Date().toISOString(),
    seconds: Math.round(ms / 100) / 10,
    only: only.length ? only : undefined,
    dist: { files: files.size, serviceWorker: files.has('/sw.js'), manifest: files.has('/manifest.webmanifest') },
    summary: { pass: count('pass'), fail: count('fail'), skip: count('skip') },
    runs,
  };
  fs.writeFileSync(path.join(ARTIFACTS, 'browser-check.json'), `${JSON.stringify(out, null, 2)}\n`);
  console.log('\n結果(シナリオ × 画面)');
  for (const sc of SCENARIOS) {
    const row = runs.filter((r) => r.scenario === sc.id);
    if (row.length) console.log(`  ${sc.title}: ${row.map((r) => `${r.viewport} ${RESULT_LABEL[r.result]}${r.skipped ? `(${r.skipped})` : ''}`).join(' / ')}`);
  }
  for (const r of runs.filter((x) => x.failures.length)) {
    console.log(`\n不合格: ${r.title} / ${r.viewport}`);
    for (const f of r.failures) console.log(`  - ${f}`);
  }
  for (const r of runs.filter((x) => x.warnings.length)) {
    console.log(`\n警告: ${r.title} / ${r.viewport}`);
    for (const w of r.warnings) console.log(`  - ${w}`);
  }
  console.log(`\n${out.summary.pass}合格・${out.summary.fail}不合格・${out.summary.skip}飛ばした(${out.seconds}秒)。結果は artifacts/browser-check.json、画面は artifacts/screens/`);
  if (out.summary.fail) process.exitCode = 1;
}

async function main() {
  const started = Date.now();
  const only = process.argv.slice(2);
  const unknown = only.filter((id) => !SCENARIOS.some((s) => s.id === id));
  if (unknown.length) bail(`知らないシナリオ: ${unknown.join(' ')}(使えるのは ${SCENARIOS.map((s) => s.id).join(' ')})`);
  if (!fs.existsSync(path.join(DIST, 'index.html'))) bail('dist/index.html がありません。先に npm run build を実行してください。');
  const { chromium } = loadPlaywright();
  const scenarios = SCENARIOS.filter((s) => !only.length || only.includes(s.id));
  const fixtures = prepareFixtures(scenarios.flatMap((s) => (s.fixture ? [s.fixture] : [])));
  const files = readTree(DIST);
  fs.mkdirSync(SCREENS, { recursive: true });
  const sites = {};
  for (const vp of VIEWPORTS) sites[vp.name] = await startSite(files, vp.base);
  const env = { files, fixtures, abandoned: false };
  const runs = [];
  try {
    for (const sc of scenarios) {
      for (const vp of VIEWPORTS) {
        const run = await runOne(chromium, sc, vp, env, sites[vp.name]);
        runs.push(run);
        console.log(`${RESULT_LABEL[run.result]}: ${sc.title} / ${vp.name}${run.skipped ? `(${run.skipped})` : ` ${(run.ms / 1000).toFixed(1)}秒`}`);
      }
    }
  } finally {
    for (const site of Object.values(sites)) {
      site.server.closeAllConnections();
      site.server.close();
    }
  }
  report(runs, Date.now() - started, files, only);
  // 見切った後片付けが裏で続いていると、プロセスがその分だけ終わらない
  if (env.abandoned) process.stdout.write('', () => process.exit());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
