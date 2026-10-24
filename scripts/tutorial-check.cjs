'use strict';
// ビルドとプレビュー起動後: node scripts/tutorial-check.cjs [URL] [label]
// PC/スマートフォン幅で新規開始から全解放までUIだけで進め、旧セーブの同条件と比較する。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
let pw;
for (const name of [process.env.PLAYWRIGHT_MODULE || 'playwright', path.resolve(ROOT, '../GuildQuest/node_modules/playwright')]) {
  try { pw = require(name); break; } catch {}
}
if (!pw) throw new Error('Playwright を用意するか、PLAYWRIGHT_MODULE に場所を指定してください。');
const url = process.argv[2] || 'http://127.0.0.1:4174/';
const label = process.argv[3] || 'local';
const OUT = path.join(ROOT, 'artifacts/tutorial');
const KEY = 'miechau-guild-master.save.v1';
fs.mkdirSync(OUT, { recursive: true });
const initial = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), '-e',
  'import {newGame} from "./src/core/game"; process.stdout.write(JSON.stringify(newGame(1)));'], { cwd: ROOT, encoding: 'utf8' }));
const report = { url, results: [], errors: [] };
let browser, page, prefix;
const button = name => page.getByRole('button', { name, exact: true });
const click = name => button(name).click();
const tab = name => page.locator('nav.tabs').getByRole('button', { name, exact: true });
const state = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
const stage = () => page.locator('[data-tutorial-stage]').getAttribute('data-tutorial-stage');
const guide = () => page.getByRole('region', { name: 'はじめの案内', exact: true });
async function shot(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.toast').waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(OUT, `${prefix}-${name}.png`) });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${name}: 横にはみ出さない`);
}
async function open(raw, mobile) {
  const context = await browser.newContext({ viewport: mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(([key, save]) => {
    if (!sessionStorage.getItem('tutorial-check')) {
      localStorage.setItem(key, JSON.stringify(save));
      sessionStorage.setItem('tutorial-check', '1');
    }
  }, [KEY, raw]);
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', e => report.errors.push(e.message));
  await page.goto(url);
  await page.locator('.hud-day').waitFor();
  await stories();
}
async function stories() {
  if (await page.locator('.vn-player').count()) await page.locator('.vn-player').getByRole('button', { name: /^スキップ/ }).click();
}
async function next() {
  await click('次の日へ');
  if (await button('観察を終える').count()) await click('観察を終える');
  await stories();
}
async function untilReturn() {
  let n = 0;
  while ((await state()).expeditions.length && n++ < 12) await next();
  assert.equal((await state()).expeditions.length, 0);
}
async function confirm(name, expected) {
  const before = (await state()).day;
  await guide().getByRole('button', { name, exact: true }).click();
  assert.equal((await state()).day, before, '確認操作で日数を消費しない');
  assert.equal(await stage(), expected);
}
function comparable(s) {
  return { day: s.day, gold: s.gold, rep: s.rep, inventory: s.inventory,
    roster: s.adventurers.map(a => ({ id: a.id, level: a.level, fatigue: a.fatigue, injury: a.injuryDays, loyalty: a.loyalty })),
    history: s.history.map(e => ({ order: e.order, result: e.result })),
    stories: Object.entries(s.flags).filter(([key]) => key.startsWith('story:')) };
}
async function guided(mobile) {
  prefix = `${label}-${mobile ? 'mobile' : 'desktop'}`;
  await open(initial, mobile);
  assert.equal(await stage(), 'dispatch');
  assert.equal(await page.locator('nav.tabs button:enabled').count(), 2);
  assert.equal(await button('次の日へ').isDisabled(), true);
  assert.equal(await button('回復薬を買う(30G)').count(), 0);
  await shot('start');
  await guide().getByRole('button', { name: '隊を出す', exact: true }).click();
  assert.equal(await page.locator('.party-plans').count(), 0);
  assert.equal(await page.locator('select').count(), 0);
  await shot('first-dispatch');
  await click('出発');
  assert.equal(await stage(), 'return');
  await untilReturn();
  assert.equal(await stage(), 'report');
  assert.equal((await state()).inventory.herb, 1);
  assert.equal(await button('この隊を組み直す').count(), 0);
  assert.equal(await button('次の日へ').isDisabled(), true);
  await shot('report');
  await confirm('報告を確認して、地図へ', 'map');
  assert.equal(await tab('地図').isEnabled(), true);
  assert.equal(await tab('依頼').isDisabled(), true);
  await page.reload();
  assert.equal(await stage(), 'map', '再読込でも確認済み段階が戻らない');
  await tab('地図').click();
  await shot('map');
  await confirm('地図を確認して、依頼へ', 'quests');
  assert.equal(await tab('依頼').isEnabled(), true);
  const travelRequests = page.locator('.quests li').filter({ has: page.locator('.badge', { hasText: /^(護衛|運搬)$/ }) });
  assert.equal(await travelRequests.getByRole('button', { name: '受注', exact: true }).filter({ visible: true }).count(),
    await travelRequests.locator('button:disabled').count(), '案内前の遠出依頼は受注できない');
  await shot('quests');
  await confirm('依頼を確認して、次の探索へ', 'second-dispatch');
  assert.equal(await page.locator('.members input:checked').count(), 2);
  assert.equal(await page.locator('select.wide').isDisabled(), true);
  assert.equal(await page.getByLabel('現地の日数', { exact: false }).isDisabled(), true);
  assert.equal(await page.getByLabel('現地の日数', { exact: false }).inputValue(), '1');
  assert.equal(await page.locator('input[name="action"]:enabled').count(), 0);
  assert.equal(await page.locator('input[name="action"]:checked').inputValue(), 'explore');
  assert.equal(await page.getByLabel('回復薬(在庫', { exact: false }).inputValue(), '2');
  await page.reload();
  await tab('派遣').click();
  assert.equal(await page.locator('.members input:checked').count(), 2, '編成は再読込後も準備可能');
  await click('見込みを見る');
  await shot('second-dispatch');
  await click('出発');
  assert.equal(await stage(), 'second-return');
  await untilReturn();
  assert.equal(await stage(), 'recruit');
  assert.equal(await tab('募集').isEnabled(), true);
  assert.equal(await tab('受信箱').isEnabled(), true);
  assert.equal(await tab('施設').isDisabled(), true);
  await tab('募集').click();
  await shot('recruit');
  await confirm('募集を確認して、施設へ', 'facilities');
  assert.equal(await tab('施設').isEnabled(), true);
  assert.equal(await tab('ワールド').isDisabled(), true);
  await shot('facilities');
  await confirm('施設を確認して、ワールドへ', 'overview');
  assert.equal(await tab('ワールド').getAttribute('aria-current'), 'page');
  await shot('overview');
  await click('案内を終えて、自由に遊ぶ');
  assert.equal(await guide().count(), 0);
  assert.equal(await page.locator('nav.tabs button:enabled').count(), 10);
  assert.equal(await button('次の日へ').isEnabled(), true);
  const result = await state();
  await page.reload();
  assert.equal(await guide().count(), 0);
  assert.equal(await page.locator('nav.tabs button:enabled').count(), 10);
  fs.writeFileSync(path.join(OUT, `${prefix}-save.json`), JSON.stringify(result));
  report.results.push({ mode: prefix, day: result.day, gold: result.gold, checks: '初回派遣・日送り・帰還報告・地図・依頼・再派遣・募集・受信箱・施設・ワールド・全解放・途中再開' });
  console.log(`${prefix}: ${result.day}日目までのチュートリアル完了`);
  await page.context().close();
  return result;
}
async function legacy() {
  prefix = `${label}-legacy`;
  const raw = structuredClone(initial);
  delete raw.flags['tutorial:version'];
  await open(raw, false);
  assert.equal(await guide().count(), 0);
  assert.equal(await page.locator('nav.tabs button:enabled').count(), 10);
  await tab('派遣').click();
  await click('出発');
  await untilReturn();
  await tab('拠点').click();
  await click('この隊を組み直す');
  await page.getByLabel('方針', { exact: false }).selectOption('safe');
  await page.getByLabel('現地の日数', { exact: false }).selectOption('1');
  await page.getByLabel('回復薬(在庫', { exact: false }).selectOption('2');
  await click('見込みを見る');
  await click('出発');
  await untilReturn();
  const result = await state();
  await page.context().close();
  return result;
}
async function skip() {
  prefix = `${label}-skip`;
  await open(initial, false);
  await click('案内を終了して全機能を開く');
  await page.reload();
  assert.equal(await guide().count(), 0);
  assert.equal(await page.locator('nav.tabs button:enabled').count(), 10);
  await page.context().close();
  report.results.push({ mode: prefix, checks: '任意終了と保存・再読込後の全解放' });
}
(async () => {
  browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
  try {
    const desktop = await guided(false);
    const mobile = await guided(true);
    assert.deepEqual(comparable(desktop), comparable(mobile));
    const old = await legacy();
    assert.deepEqual(comparable(desktop), comparable(old), '案内によって資金・素材・成長・遠征結果・物語の日付を変えない');
    report.results.push({ mode: `${label}-legacy`, checks: '旧セーブ全機能利用可。新規の案内あり/なしで同seed同操作の結果一致' });
    await skip();
    assert.deepEqual(report.errors, []);
    report.passed = true;
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.passed = false;
    report.failure = error.stack;
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(OUT, `${prefix}-failure.png`) }).catch(() => {});
      fs.writeFileSync(path.join(OUT, `${prefix}-failure.txt`), await page.locator('#app').innerText().catch(() => ''));
    }
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(OUT, `${label}-report.json`), JSON.stringify(report, null, 2));
    await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 10000))]);
    process.exit(process.exitCode || 0);
  }
})();
