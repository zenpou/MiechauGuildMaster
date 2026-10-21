'use strict';
// seed 1 の序盤18日をUIだけで再プレイする。先に build / preview を起動する。
// node scripts/early-story-check.cjs [URL=http://127.0.0.1:4173/] [label=after]
// 初期セーブ以外は書き換えない。旧セーブ確認だけは保存済みの before-day4.json を使う。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'early-play');
let playwright;
for (const modulePath of [process.env.PLAYWRIGHT_MODULE || 'playwright', path.resolve(ROOT, '..', 'GuildQuest/node_modules/playwright')]) {
  try { playwright = require(modulePath); break; } catch {}
}
if (!playwright) throw new Error('Playwright が必要です。PLAYWRIGHT_MODULE で場所を指定できます。');
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const label = process.argv[3] || 'after';
const key = 'miechau-guild-master.save.v1';
const initial = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), '-e',
  'import { newGame } from "./src/core/game"; process.stdout.write(JSON.stringify(newGame(1)));'], { cwd: ROOT, encoding: 'utf8' }));
fs.mkdirSync(OUT, { recursive: true });
const report = { url, label, stories: [], snapshots: [], checks: [], errors: [] };
let browser, page;
const state = () => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
const button = name => page.getByRole('button', { name, exact: true });
const click = name => button(name).click();
async function snapshot(name) {
  const s = await state();
  fs.writeFileSync(path.join(OUT, `${label}-${name}.json`), JSON.stringify(s));
  report.snapshots.push({ name, day: s.day, gold: s.gold, inventory: s.inventory, flags: s.flags,
    roster: s.adventurers.map(a => ({ name: a.name, level: a.level, fatigue: a.fatigue, injury: a.injuryDays })),
    expeditions: s.expeditions.map(e => ({ returnDay: e.returnDay, order: e.order })) });
  return s;
}
async function open(initialState, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(([k, s]) => {
    if (!sessionStorage.getItem('early-story-check')) {
      localStorage.setItem(k, JSON.stringify(s));
      sessionStorage.setItem('early-story-check', '1');
    }
  }, [key, initialState]);
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url);
  await page.locator('.hud-day').waitFor();
  return context;
}
async function story(expected) {
  assert.equal(await page.locator('.vn-player').count(), 1, `物語がある: ${expected}`);
  const title = await page.locator('.vn-player-title').textContent();
  const lines = await page.locator('.vn-player-history-text').allTextContents();
  const next = page.locator('[data-story-next]');
  for (let i = 0; i < lines.length; i++) {
    await page.waitForFunction(n => document.querySelector('.vn-player-progress')?.textContent?.startsWith(`${n} / `), i + 1);
    if (await next.textContent() === '全文を表示') await next.click();
    await page.waitForFunction(() => document.querySelector('[data-story-next]')?.textContent !== '全文を表示');
    await next.click();
  }
  const s = await state();
  assert.equal(s.flags[`story:${expected}`], s.day, expected);
  assert.equal(await page.locator('.vn-player').count(), 0, '同じ日に次の物語が重ならない');
  report.stories.push({ day: s.day, id: expected, title, lines });
  console.log(`${label}: ${s.day}日目 ${expected}`);
}
async function day(expected) {
  await click('次の日へ');
  const journey = button('観察を終える');
  if (await journey.count()) await journey.click();
  if (expected) await story(expected);
  else assert.equal(await page.locator('.vn-player').count(), 0, `${(await state()).day}日目に想定外の物語`);
}
async function prepare({ dungeon, days, members = [], blessed = false }) {
  await click('拠点');
  await click('この隊を組み直す');
  if (dungeon) await page.locator('select.wide').selectOption(dungeon);
  for (const name of members) await page.locator('.members li').filter({ hasText: name }).locator('input').check();
  await page.getByLabel('方針', { exact: false }).selectOption('safe');
  await page.getByLabel('現地の日数', { exact: false }).selectOption(String(days));
  await page.getByLabel('回復薬(在庫', { exact: false }).selectOption('2');
  if (blessed) await page.getByLabel('アイリスの祝福', { exact: false }).check();
  await click('見込みを見る');
  await click('出発');
}
const requestRow = name => page.locator('li').filter({ has: page.locator('.badge', { hasText: '仲間' }) }).filter({ hasText: name });
async function mainPlay() {
  await open(initial);
  await story('prologue');
  await click('依頼');
  assert.equal(await requestRow('ティナ').count(), 0);
  await click('派遣');
  assert.equal(await page.getByRole('region', { name: '初回の探索' }).count(), 1);
  await click('見込みを見る');
  await click('出発');
  await day('ch1');
  let s = await snapshot('day2');
  assert.equal(s.inventory.herb, 1);
  assert.equal(s.flags['sera:herb'], undefined);
  await prepare({ days: 2 });
  await day();
  await day();
  s = await snapshot('day4');
  assert.equal(s.inventory.fang, 6);
  assert.equal(s.inventory.herb, 2);
  assert.equal(s.flags['tina:step'], undefined);
  await click('募集');
  for (const name of ['ホルスト', 'ウィナ']) await page.locator('.cand').filter({ hasText: name }).getByRole('button', { name: '雇う' }).click();
  await day();
  await prepare({ dungeon: 'old_mine', days: 1, members: ['ホルスト', 'ウィナ'], blessed: true });
  for (let n = 6; n <= 10; n++) await day(n === 10 ? 'ch2' : undefined);
  await day('loyalty:tina:50');
  await click('依頼');
  assert.equal(await requestRow('ティナ').count(), 1);
  assert.equal(await requestRow('セラ').count(), 0);
  await day('loyalty:sera:50');
  await click('依頼');
  assert.equal(await requestRow('セラ').count(), 1);
  await snapshot('day12');
  await prepare({ dungeon: 'old_mine', days: 2, blessed: true });
  await click('拠点');
  await page.locator('.inv li').filter({ hasText: 'スライムの核' }).getByRole('button', { name: '全部売る' }).click();
  for (let n = 13; n <= 18; n++) await day(n === 17 ? 'loyalty:viola:50' : undefined);
  s = await snapshot('day18');
  assert.deepEqual(report.stories.map(x => [x.day, x.id]), [[1, 'prologue'], [2, 'ch1'], [10, 'ch2'], [11, 'loyalty:tina:50'], [12, 'loyalty:sera:50'], [17, 'loyalty:viola:50']]);
  const beforeFile = path.join(OUT, 'before-day18.json');
  if (fs.existsSync(beforeFile)) {
    const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
    assert.equal(s.gold, before.gold);
    assert.deepEqual(s.adventurers.map(a => [a.name, a.level, a.fatigue, a.injuryDays]), before.adventurers.map(a => [a.name, a.level, a.fatigue, a.injuryDays]));
    assert.equal(s.inventory.fang, before.inventory.fang + 5);
    assert.equal(s.inventory.herb, (before.inventory.herb || 0) + 2);
    report.checks.push('修正前と同じ18日間で資金・成長・負傷が一致し、勝手に消費されていた牙5・薬草2が残る');
  }
  await click('依頼');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.toast').waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(OUT, `${label}-requests-desktop.png`), fullPage: true });
  const fang = s.inventory.fang;
  await requestRow('ティナ').getByRole('button', { name: '受ける' }).click();
  assert.equal((await state()).inventory.fang, fang);
  await requestRow('ティナ').getByRole('button', { name: '渡す' }).click();
  s = await state();
  assert.equal(s.inventory.fang, fang - 5);
  assert.equal(s.flags['tina:step'], 1);
  assert.equal(s.flags['tina:accepted'], undefined);
  assert.equal(s.flags['tina:old_mine'] || 0, 0);
  await requestRow('ティナ').getByRole('button', { name: '受ける' }).click();
  await requestRow('セラ').getByRole('button', { name: '受ける' }).click();
  await requestRow('セラ').getByRole('button', { name: '渡す' }).click();
  await page.reload();
  await click('依頼');
  assert.match(await requestRow('ティナ').innerText(), /受注中/);
  assert.match(await requestRow('セラ').innerText(), /2\/5/);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(OUT, `${label}-requests-mobile.png`), fullPage: true });
  report.checks.push('受注と手動納品、次段階の未受注・既往訪問非加算、再読込、375px表示');
  await page.context().close();
}
async function idlePlay() {
  await open(initial);
  await story('prologue');
  for (let n = 2; n <= 8; n++) await day();
  await click('派遣');
  assert.equal(await page.getByRole('region', { name: '初回の探索' }).count(), 1);
  await page.screenshot({ path: path.join(OUT, `${label}-delayed-first-dispatch.png`) });
  await click('出発');
  await day('ch1');
  await day('loyalty:tina:50');
  await snapshot('idle-day10');
  report.checks.push('8日目まで待っても導入探索が残り、9日目初帰還で第一章、10日目ティナに分かれる');
  await page.context().close();
}
async function legacyPlay() {
  const file = path.join(OUT, 'before-day4.json');
  if (!fs.existsSync(file)) return;
  await open(JSON.parse(fs.readFileSync(file, 'utf8')));
  await click('依頼');
  assert.match(await requestRow('ティナ').innerText(), /坑道/);
  assert.match(await requestRow('セラ').innerText(), /2\/5/);
  await requestRow('セラ').getByRole('button', { name: '受ける' }).click();
  await page.reload();
  await click('依頼');
  assert.match(await requestRow('セラ').innerText(), /受注中/);
  report.checks.push('旧セーブで会話前の進行済み段階・納品数を保持し、受注後の再読込も継続');
  await page.context().close();
}
(async () => {
  browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  try {
    await mainPlay();
    await idlePlay();
    await legacyPlay();
    assert.deepEqual(report.errors, []);
    report.passed = true;
    console.log(JSON.stringify({ passed: true, checks: report.checks, stories: report.stories.map(({ day, id }) => ({ day, id })) }, null, 2));
  } catch (error) {
    report.passed = false;
    report.failure = error.stack;
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(OUT, `${label}-failure.png`) }).catch(() => {});
      fs.writeFileSync(path.join(OUT, `${label}-failure.txt`), await page.locator('#app').innerText().catch(() => ''));
    }
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(OUT, `${label}-report.json`), JSON.stringify(report, null, 2));
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10000))]);
    process.exit(process.exitCode || 0);
  }
})();
