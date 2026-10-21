'use strict';
// build後、sim:dragon --seed 1 --dump artifacts/fixtures/story-fixes-clear.json の実勝利記録をUIで読む。
// 独立したブラウザ保存領域だけを使用。普段のセーブは変更しない。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function loadPlaywright() {
  for (const id of [process.env.PLAYWRIGHT_MODULE || 'playwright', path.resolve(root, '..', 'GuildQuest/node_modules/playwright')]) {
    try { return require(id); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
  throw new Error('Playwright が必要です。PLAYWRIGHT_MODULE にインストール先を指定してください。');
}
const { chromium } = loadPlaywright();
const out = path.join(root, 'artifacts/previews/story-fixes');
const key = 'miechau-guild-master.save.v1';
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'artifacts/fixtures/story-fixes-clear.json'), 'utf8'));
assert(fixture.dragonVictory?.combat.length, '現在のCoreで作った竜初勝利の記録が必要');
fs.mkdirSync(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.join(root, 'dist', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
const results = [];
const iconsOnly = process.argv.includes('--icons-only');
let browser;
const readSave = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
async function seed(context, state) {
  await context.addInitScript(([k, s]) => {
    if (sessionStorage.getItem('story-check-seeded')) return;
    localStorage.setItem(k, JSON.stringify(s));
    sessionStorage.setItem('story-check-seeded', '1');
  }, [key, state]);
}
async function readChapter(page, screenshot) {
  await page.locator('.vn-player').waitFor();
  const history = await page.locator('.vn-player-history-text').allTextContents();
  const speakers = await page.locator('.vn-player-history-speaker').allTextContents();
  const next = page.locator('[data-story-next]');
  for (let i = 0; i < history.length; i++) {
    await page.waitForFunction(n => document.querySelector('.vn-player-progress')?.textContent?.startsWith(`${n} / `), i + 1);
    if (await next.textContent() === '全文を表示') await next.click();
    await page.waitForFunction(() => document.querySelector('[data-story-next]')?.textContent !== '全文を表示');
    if (i === 0 && screenshot) await page.screenshot({ path: screenshot });
    assert.equal((await page.locator('.vn-player-line').textContent()).trim(), history[i].trim());
    await next.click();
  }
  return { history, speakers };
}
async function run(viewport) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const state = structuredClone(fixture);
  // simが既読にした終章を未読に戻し、加入が起きる瞬間から確認する。
  delete state.flags['story:epilogue'];
  state.flags['ending:seen'] = true;
  state.adventurers = state.adventurers.filter(a => a.unique !== 'aurelia');
  delete state.flags['unique:aurelia'];
  delete state.flags['unique:aurelia:hired'];
  await seed(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const label = viewport.width > 600 ? 'desktop' : 'mobile';
  const result = await readChapter(page, path.join(out, `epilogue-${label}.png`));
  const guildStart = result.history.findIndex(t => t.includes('ぐう……すやすや'));
  assert(guildStart > 0);
  const battleSpeakers = new Set(result.speakers.slice(0, guildStart).filter(x => x !== '物語'));
  assert.deepEqual(battleSpeakers, new Set([...state.dragonVictory.members.map(a => a.name), 'アウレリア']));
  assert(!result.history.slice(0, guildStart).join('\n').includes('アイリスの祝福'));
  let saved = await readSave(page);
  assert.equal(saved.adventurers.filter(a => a.unique === 'aurelia').length, 1);
  assert.equal(saved.adventurers.find(a => a.unique === 'aurelia').job, 'ancient_dragon');
  assert(saved.flags['story:epilogue']);
  await page.reload();
  await page.locator('nav.tabs').waitFor();
  assert.equal(await page.locator('.vn-player').count(), 0);
  await page.locator('nav.tabs button').filter({ hasText: '記録' }).click();
  await page.locator('.story-chapters li').filter({ hasText: '終章' }).getByRole('button', { name: '読み返す' }).click();
  const reread = await readChapter(page);
  assert.deepEqual(reread, result);
  saved = await readSave(page);
  assert.equal(saved.adventurers.filter(a => a.unique === 'aurelia').length, 1);
  await page.screenshot({ path: path.join(out, `records-${label}.png`), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  // 忠誠255の会話を、実際の保存→再読込→全行進行→読み返しで確かめる。
  // 本編読了日の個別会話は保留されるので、終章を読んだ翌日の状態で確認する。
  saved.day += 1;
  const tina = saved.adventurers.find(a => a.unique === 'tina');
  tina.loyalty = 255;
  tina.injuryDays = 0;
  tina.status = 'idle';
  saved.flags['story:loyalty:tina:50'] = 1;
  saved.flags['story:loyalty:tina:120'] = 1;
  delete saved.flags['story:loyalty:tina:255'];
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [key, saved]);
  await page.reload();
  const loyalty = await readChapter(page, path.join(out, `loyalty-${label}.png`));
  assert(loyalty.history.some(t => t.includes('適性通り')));
  const before = await readSave(page);
  assert(before.flags['story:loyalty:tina:255']);
  await page.locator('nav.tabs button').filter({ hasText: '記録' }).click();
  await page.locator('.story-chapters li').filter({ hasText: '守るための剣' }).getByRole('button', { name: '読み返す' }).click();
  assert.deepEqual(await readChapter(page), loyalty);
  const after = await readSave(page);
  assert.equal(after.flags['story:loyalty:tina:255'], before.flags['story:loyalty:tina:255']);
  assert.equal(after.adventurers.find(a => a.unique === 'tina').loyalty, 255);
  assert.deepEqual(errors, []);
  results.push({ viewport, epilogueLines: result.history.length, battleMembers: [...battleSpeakers], loyaltyLines: loyalty.history.length, errors });
  await context.close();
}
async function checkIcon(viewport) {
  const context = await browser.newContext({ viewport });
  const state = structuredClone(fixture);
  state.flags['ending:seen'] = true;
  await seed(context, state);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('nav.tabs button').filter({ hasText: '派遣' }).click();
  const members = page.locator('ul.members');
  while (await members.getByRole('checkbox', { checked: true }).count()) await members.getByRole('checkbox', { checked: true }).first().click();
  await members.locator('li').filter({ hasText: 'アウレリア' }).getByRole('checkbox').click();
  const face = page.locator('.map-face[aria-label="アウレリア"] img').first();
  await face.waitFor();
  await face.evaluate(img => img.decode());
  assert((await face.getAttribute('src')).includes('aurelia-v1.png'));
  const label = viewport.width > 600 ? 'desktop' : 'mobile';
  await page.locator('.leader-choices').screenshot({ path: path.join(out, `aurelia-map-${label}.png`) });
  results.push({ viewport, aureliaIcon: 'loaded', displayedSize: await face.locator('..').boundingBox() });
  await context.close();
}
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const check = iconsOnly ? checkIcon : run;
    await check({ width: 1280, height: 900 });
    await check({ width: 375, height: 812 });
    fs.writeFileSync(path.join(out, iconsOnly ? 'icons.json' : 'result.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { if (browser) await browser.close(); server.close(); }
})();
