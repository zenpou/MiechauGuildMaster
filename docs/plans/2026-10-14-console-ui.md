# 本編UIのコンシューマーゲーム化 実装プラン

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 本編の画面を紙芝居プレイヤーと同じ JRPG ウィンドウ系(紺の半透明パネル・金の縁・背景絵・明朝の見出し)に揃える。設計は [2026-10-14-console-ui-design.md](2026-10-14-console-ui-design.md)。

**Architecture:** 枠組み(HUD・コマンド列/バー・窓)は `main.ts` と `home.ts` の DOM を少し変えて作る。各タブの中身は DOM を触らず CSS で塗り替える。色は `tokens.css` に集め、紙芝居の CSS もそこを参照する。見出し用の明朝は使う文字だけ抜いた woff2 を同梱する。

**Tech Stack:** 素の DOM(`dom.ts`)、CSS カスタムプロパティ、インライン SVG、`subset-font`(harfbuzz の wasm)、Vitest、Playwright(`npm run test:browser`)。

**並列の分担:** タスク A(CSS)・B(DOM と layout.css)・C(フォント)は触るファイルが重ならないので並列でよい。共通の土台 `src/ui/tabs.ts` は先に本体が置く。

| タスク | 触ってよいファイル |
|---|---|
| A | `src/ui/tokens.css`(新)、`src/ui/style.css`、`src/ui/storyPlayer.css`(先頭の変数8行だけ) |
| B | `src/ui/icons.ts`(新)、`src/ui/layout.css`(新)、`src/ui/main.ts`、`src/ui/home.ts`、`tests/icons.test.ts`(新) |
| C | `scripts/subset-font.cjs`(新)、`scripts/font-glyphs.txt`(新)、`src/ui/minchoText.ts`(新)、`tests/font-glyphs.test.ts`(新)、`index.html`、`package.json`(devDependency 1行)、`public/fonts/`(生成物) |

**残すもの(`scripts/browser-check.cjs` が見ている):** `h1` のタイトル文字列、`nav.tabs > button` 10個(各ボタンの最初の子がラベル文字)、`#app .tab-body`、`.hint`(文面に「派遣」)、`.toast` / `.toast.err`、`.modal.ending`、`.plots .plot(.built)`、`ul.synergies > li(.on)`、`.world-map`、`input[data-save-input]`、「次の日へ」「出発」「セーブを書き出す」のボタン名、拠点で「N日目」が見えること、どのタブでも `scrollWidth <= 表示幅`。

---

## 土台(本体が先に行う)

### Task 0: コマンドの定義を純粋モジュールに出す

**Files:**
- Create: `src/ui/tabs.ts`

```ts
// コマンド(タブ)の並びとラベル。main.ts の描画・icons.ts・フォントのサブセット検査が共有する。DOM に依存しない
import type { Tab } from './app';

export const TAB_DEFS: readonly { id: Tab; label: string }[] = [
  { id: 'home', label: '拠点' },
  { id: 'inbox', label: '受信箱' },
  { id: 'quests', label: '依頼' },
  { id: 'dispatch', label: '派遣' },
  { id: 'world', label: 'ワールド' },
  { id: 'recruit', label: '募集' },
  { id: 'base', label: '施設' },
  { id: 'map', label: '地図' },
  { id: 'log', label: 'ログ' },
  { id: 'records', label: '記録' },
];
```

---

## Task A: 色トークンと部品の塗り替え(CSS)

**Files:**
- Create: `src/ui/tokens.css`
- Modify: `src/ui/style.css`(全面)
- Modify: `src/ui/storyPlayer.css:16-23`(変数の値をトークン参照にする。他は触らない)

**Step 1: tokens.css を書く**

```css
/* 本編と紙芝居が共有する色・寸法。値を変えるのはここだけ。紙芝居の --vn-* はこれを参照する */
:root {
  --bg: #0e1719;
  --panel: #142326;
  --panel-strong: #1d3033;
  --line: #8e7650;
  --line-soft: #4a4634;
  --text: #f7f0df;
  --dim: #b7c0b7;
  --accent: #efc878;
  --focus: #f8dc95;
  --pos: #9ad89a;
  --neg: #ff8f80;
  --warn: #ffe08a;
  --danger: #a0463a;
  --font-display: "Shippori Mincho Subset", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif;
  --font-body: system-ui, -apple-system, "Segoe UI", sans-serif;
  --radius: 2px;
  --hud-h: 56px;
  --nav-w: 132px;
  --nav-bar-h: 104px;
}
```

**Step 2: storyPlayer.css の変数をトークン参照に替える**

16〜23行目の8行を次に置き換える(他の行は触らない):

```css
  --vn-bg: var(--bg);
  --vn-panel: var(--panel);
  --vn-panel-strong: var(--panel-strong);
  --vn-line: var(--line);
  --vn-text: var(--text);
  --vn-dim: var(--dim);
  --vn-accent: var(--accent);
  --vn-focus: var(--focus);
```

`storyPlayer.css` の先頭に `@import './tokens.css';` を足す(`style.css` でも読むが、二重に読んでも害はない)。

**Step 3: style.css を塗り替える**

先頭に `@import './tokens.css';`。既存のセレクタ名はすべて残し、値だけ替える。方針:

- `:root` の `font-family` は `var(--font-body)`。`body` は `background: var(--bg)`、`color: var(--text)`、`padding: 0`(余白は layout.css の HUD・窓が持つ)。`#app` の `max-width: 720px; margin: 0 auto` は**消す**(レイアウトは layout.css が決める)
- `h1`〜`h3`: `h1` は layout.css が決めるので `style.css` では触らない。`h2`/`h3` は `color: var(--accent)`、太字、`::before { content: '◆ '; font-size: 0.7em; }`、下に `border-bottom: 1px solid var(--line-soft)`
- `button`: `background: var(--panel-strong); border: 1px solid var(--line); border-radius: var(--radius); color: var(--text); min-height: 40px; padding: 6px 14px; box-shadow: inset 0 1px 0 #ffffff14`。`:hover` で `border-color: var(--accent)`、`:active` で `box-shadow: inset 0 2px 6px #0008`、`:focus-visible` で `outline: 2px solid var(--focus); outline-offset: 2px`。`button.small` は `min-height: 30px`。`.primary` は `background: linear-gradient(#f4d58a, #d9ad55); color: #1a1408; border-color: #f8e3a6; font-weight: bold`。`.danger` は `border-color: var(--danger); color: #ffb9ae`。`.link` は今のまま(`background: none; border: none; min-height: 0`)
- `select`, `input`: `background: var(--bg); color: var(--text); border: 1px solid var(--line-soft); border-radius: var(--radius); padding: 4px 6px`
- `table`: `border-collapse: collapse; width: 100%`。`th, td` の `border` を消し、`td` は `border-bottom: 1px solid #ffffff0d`。`th` は `color: var(--accent); font-size: 0.75rem; letter-spacing: 0.05em; background: none; border-bottom: 1px solid var(--line-soft)`。`tbody tr:nth-child(4n+1), tbody tr:nth-child(4n+2)`(名簿は2行で1人なので2行ずつ帯にする)に `background: #ffffff08`。`tr.sel td` は `background: #efc87822`
- `ul.plain li`: `border-bottom: 1px solid var(--line-soft)`、`padding-left: 1.1em`、`::before { content: '◆'; position: absolute; left: 0; color: var(--line); font-size: 0.7em; }`(`li` に `position: relative`)。`.reasons li` と `.inv li` と `.members li` は◆を出さない(`::before { content: none }`)
- `.badge`: `border-radius: var(--radius); border: 1px solid #ffffff22; padding: 0 6px; font-size: 0.75rem`。色の割り当て(撤退・全滅・未読・待機・grade-*・kind-*・rumor・unread)は今の色を残す
- `.detail`, `.trip`, `.warn`, `.hint`(`.hint` の枠だけ。中身は layout.css): `background: #0e171999; border: 1px solid var(--line-soft); border-radius: var(--radius)`
- `.toast`: `top: calc(var(--hud-h) + 8px); bottom: auto; background: #0e1719ee; border: 1px solid var(--accent); color: var(--text); border-radius: var(--radius); padding: 10px 18px; box-shadow: 0 8px 30px #000a`。`.toast.err` は `border-color: var(--neg)`
- `.modal-back`: `background: #05090acc`。`.modal`: `background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: 0 22px 90px #000b`
- `.tabs`(旧タブグリッド)の節は**丸ごと消す**(layout.css が `nav.tabs` を描く)
- `.map .cell.*`, `.world`, `.world-map`, `.lg.*`, `.plots .plot.*`: 色だけ新パレットに寄せる(未知 `#0b1213`、壁 `#4a4335`、既知 `#5d6b63`、踏んだ `#d8d2bd`、今回 `var(--accent)`、扉 `#8a5235`、開いた扉 `#3f8a6a`)。`.world` の `background: var(--panel); border-color: var(--line-soft)`
- `.bar`: `background: #0b1213; border: 1px solid var(--line-soft)`、`.bar-fill` は `background: linear-gradient(90deg, #c9a45a, var(--accent))`
- `.pwa-bar`: `max-width: none; margin: 0; padding: 6px 12px env(safe-area-inset-bottom, 0px); border-top: 1px solid var(--line-soft); font-size: 0.75rem; opacity: 0.8`
- 640px 以下の名簿カード化の `@media` 節は**そのまま残す**(`border-top` の色だけ `var(--line-soft)` に)

**Step 4: 確認**

```sh
npm run build
```

Expected: エラー0。`npm run dev` で開いて、どのタブも文字が読め、ボタン・表・バッジ・トーストが新しい見た目になっている(B の layout.css が無い間は HUD・窓は旧配置のままでよい)。

**Step 5: Commit**

```sh
git add src/ui/tokens.css src/ui/style.css src/ui/storyPlayer.css
git commit -m "本編の部品(ボタン・表・リスト・バッジ・トースト)を紙芝居と同じ紺+金に塗り替える"
```

---

## Task B: HUD・コマンド・窓・ヒントの顔(DOM と layout.css)

**Files:**
- Create: `src/ui/icons.ts`
- Create: `src/ui/layout.css`
- Create: `tests/icons.test.ts`
- Modify: `src/ui/main.ts`
- Modify: `src/ui/home.ts:42-75, 132-140, 326`

**Step 1: 失敗するテストを書く(最初の3回のツール呼び出しのうちに)**

`tests/icons.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ICON_PATHS } from '../src/ui/icons';
import { TAB_DEFS } from '../src/ui/tabs';

describe('コマンドのアイコン', () => {
  it('10個のコマンドすべてに SVG のパスがあり、M で始まる', () => {
    for (const t of TAB_DEFS) expect(ICON_PATHS[t.id], t.label).toMatch(/^M/);
  });
  it('同じパスを2つのコマンドで使い回していない', () => {
    const paths = TAB_DEFS.map((t) => ICON_PATHS[t.id]);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
```

**Step 2: 失敗を確認**

```sh
npx vitest run tests/icons.test.ts
```

Expected: FAIL(`../src/ui/icons` が無い)

**Step 3: icons.ts を書く**

```ts
// コマンド10個の線画アイコン。24×24、stroke=currentColor なので色は CSS で変わる
import type { Tab } from './app';
import { sv } from './dom';

export const ICON_PATHS: Record<Tab, string> = {
  home: 'M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10',
  inbox: 'M3 6h18v12H3zM3 7l9 6 9-6',
  quests: 'M6 4h10a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2zM18 20a2 2 0 0 0 2-2v-2h-4M9 9h6M9 13h6',
  dispatch: 'M5 21V3M5 4h13l-3 4 3 4H5',
  world: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  recruit: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21c0-4 4-6 8-6s8 2 8 6',
  base: 'M3 21h18M4 21V10l4-3v14M8 21V7l4-3 4 3v14M16 21V10l4 3v8M11 12h2M11 16h2',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  log: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  records: 'M8 21h8M12 17v4M5 4h14v5a7 7 0 0 1-14 0zM5 6H2v2a3 3 0 0 0 3 3M19 6h3v2a3 3 0 0 1-3 3',
};

export function icon(id: Tab): SVGElement {
  return sv('svg', {
    class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, sv('path', { d: ICON_PATHS[id] }));
}
```

**Step 4: テストが通ることを確認**

```sh
npx vitest run tests/icons.test.ts
```

Expected: 2 passed

**Step 5: home.ts から HUD へ移す部分を外し、nextDay を export し、ヒントに顔を付ける**

- `homeTab()` の先頭から次を**消す**: 未読の `inbox-note` の行、`div('summary', ...)`(日数・G・支出)、`repBlock()` の呼び出し、`h('button', { class: 'primary wide', onclick: nextDay }, '次の日へ')`。`repBlock` 関数自体も消す(HUD が同じ内容を出す)。使わなくなった import(`REP_LEVELS`, `repLevel`, `dailyCost`, `unreadCount`)を外す
- `function nextDay()` を `export function nextDay()` にする
- `hintBlock()` を次にする(`artUrl` は `./storyPlayer` から import する):

```ts
/** 最初の数日の「次にやること」。受付のノエルが案内する体裁。赤字のヒントは状態で消えるので閉じるボタンを出さない */
function hintBlock(): HTMLElement | null {
  const hint = hintFor(state);
  if (!hint) return null;
  return div('hint', { role: 'note' },
    h('img', { class: 'hint-face', src: artUrl('faces/noel/worried.webp'), alt: '', width: 56, height: 56 }),
    div('hint-body',
      div('hint-name', 'ノエル(受付)'),
      div('hint-text', hint.text),
      div('row tight',
        hint.id === 'debt' ? null : h('button', { class: 'small', onclick: () => { dismissHint(state, hint.id); commit(); } }, '閉じる'),
        h('button', { class: 'link small', onclick: () => { hintsOff(state); commit(); } }, 'ヒントをすべて消す'),
      ),
    ),
  );
}
```

**Step 6: main.ts を HUD・コマンド・窓に組み替える**

`render()` の `body` を次にする(import に `dailyCost` from `'../core/game'`、`REP_LEVELS, repLevel` from `'../core/quests'`、`nextDay` from `'./home'`、`TAB_DEFS` from `'./tabs'`、`icon` from `'./icons'`、`import './layout.css'` を足す。`TABS` は `TAB_DEFS` にビューを合わせた配列にする):

```ts
import './style.css';
import './layout.css';
// ...既存の import...
import { dailyCost } from '../core/game';
import { REP_LEVELS, repLevel } from '../core/quests';
import { homeTab, nextDay } from './home';
import { icon } from './icons';
import { TAB_DEFS } from './tabs';

const VIEWS: Record<Tab, () => HTMLElement> = {
  home: homeTab, inbox: inboxTab, quests: questsTab, dispatch: dispatchTab, world: worldTab,
  recruit: recruitTab, base: baseTab, map: mapTab, log: logTab, records: recordsTab,
};
const TABS = TAB_DEFS.map((t) => ({ ...t, view: VIEWS[t.id] }));

/** 上部に固定の HUD。日数・資金・評判・未読と「次の日へ」をどのタブからでも見せる */
function hud(unread: number): HTMLElement {
  const s = state;
  const lv = repLevel(s.rep);
  const next = REP_LEVELS[lv];
  return h('header', { class: 'hud' },
    h('h1', null, '見えちゃうギルドマスター'),
    div('hud-stats',
      span('hud-day', `${s.day}日目`),
      span(s.gold < 0 ? 'hud-gold neg' : 'hud-gold', `${s.gold}G`, span('hud-sub', ` 1日 −${dailyCost(s)}G`)),
      span('hud-rep', { title: next === undefined ? '評判は最高段階' : `次の段階まで ${next - s.rep}` },
        `評判 Lv${lv}`,
        span('pips', ...REP_LEVELS.map((_, i) => span(i < lv ? 'pip on' : 'pip'))),
      ),
      unread ? h('button', { class: 'hud-unread', onclick: () => { ui.tab = 'inbox'; render(); } }, span('badge unread', `未読${unread}`)) : null,
    ),
    h('button', { class: 'primary hud-next', onclick: nextDay }, '次の日へ'),
  );
}
```

`body` の組み立て:

```ts
  const body = [
    hud(unread),
    h('nav', { class: 'tabs', 'aria-label': 'コマンド' }, ...TABS.map((t) =>
      h('button', { class: t.id === tab.id ? 'on' : '', 'aria-current': t.id === tab.id ? 'page' : undefined, onclick: () => { ui.tab = t.id; render(); } },
        t.label,
        icon(t.id),
        t.id === 'inbox' && unread ? span('badge unread', unread) : null))),
    h('main', { class: 'window' },
      div('window-title', tab.label),
      ui.saveWarning ? div('warn', ui.saveWarning) : null,
      tab.view(),
    ),
  ].filter((x): x is HTMLElement => !!x);
```

ラベルの文字をボタンの**最初の子**に置くこと(ブラウザ検証が `firstChild.textContent` で読む)。アイコンを上や左に見せる並び替えは CSS(`flex-direction: column-reverse` / `row-reverse`)で行う。`applyProps` は `undefined` を飛ばすので `aria-current: undefined` は属性が付かない。

**Step 7: layout.css を書く**

```css
/* 枠組み: 背景絵・HUD・コマンド列(広い画面)/バー(狭い画面)・窓。部品の色は style.css、値は tokens.css */
@import './tokens.css';

body {
  min-height: 100dvh;
  background: var(--bg) url('./art/backgrounds/guild-office-day-v1.webp') center / cover no-repeat fixed;
}
/* 絵の上の暗いビネット。中央は絵が見え、縁は文字が読める濃さ */
body::before {
  content: '';
  position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background: radial-gradient(ellipse at 50% 40%, #0e171988 0%, #0e1719d9 70%, #0e1719f2 100%);
}

.hud {
  position: sticky; top: 0; z-index: 2;
  display: flex; align-items: center; gap: 12px;
  min-height: var(--hud-h); padding: 6px 14px;
  background: #0e1719f0; border-bottom: 1px solid var(--line);
  box-shadow: 0 2px 12px #0008;
}
.hud h1 { margin: 0; font: 400 0.95rem/1.2 var(--font-display); color: var(--accent); letter-spacing: 0.08em; white-space: nowrap; }
.hud-stats { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; margin: 0 auto; font-family: var(--font-display); font-variant-numeric: tabular-nums; }
.hud-day { font-size: 1.15rem; font-weight: 700; }
.hud-gold { font-size: 1.1rem; }
.hud-gold.neg { color: var(--neg); }
.hud-sub { font-size: 0.75rem; color: var(--dim); font-family: var(--font-body); }
.hud-rep { font-size: 0.9rem; }
.pips { display: inline-flex; gap: 2px; margin-left: 6px; vertical-align: middle; }
.pip { width: 10px; height: 10px; border: 1px solid var(--line); transform: skewX(-12deg); background: transparent; }
.pip.on { background: var(--accent); }
.hud-unread { background: none; border: none; padding: 0; min-height: 0; }
.hud-next { min-width: 112px; }

nav.tabs { display: flex; gap: 2px; margin: 0; padding: 0; }
nav.tabs button {
  display: flex; align-items: center; gap: 8px; position: relative;
  background: none; border: none; border-radius: 0; color: var(--dim);
  font-family: var(--font-display); font-size: 0.95rem; letter-spacing: 0.06em; white-space: nowrap;
}
nav.tabs button .icon { width: 22px; height: 22px; flex: none; }
nav.tabs button:hover { color: var(--text); }
nav.tabs button.on { color: var(--accent); }
nav.tabs .badge { position: absolute; top: 2px; right: 6px; font-size: 0.65rem; }

.window {
  position: relative; display: block;
  margin: 14px; padding: 22px 14px 14px;
  border: 1px solid var(--line); border-radius: var(--radius);
  box-shadow: 0 0 0 3px #0e171999, 0 18px 60px #000a;
}
/* 四隅の飾り。背景の重ね描きで L 字を4つ描く(疑似要素は見出しに使うので空けておく) */
.window {
  --c: var(--accent);
  background:
    linear-gradient(var(--c), var(--c)) top left / 12px 2px,
    linear-gradient(var(--c), var(--c)) top left / 2px 12px,
    linear-gradient(var(--c), var(--c)) top right / 12px 2px,
    linear-gradient(var(--c), var(--c)) top right / 2px 12px,
    linear-gradient(var(--c), var(--c)) bottom left / 12px 2px,
    linear-gradient(var(--c), var(--c)) bottom left / 2px 12px,
    linear-gradient(var(--c), var(--c)) bottom right / 12px 2px,
    linear-gradient(var(--c), var(--c)) bottom right / 2px 12px,
    #142326e6;
  background-repeat: no-repeat;
}
.window-title {
  position: absolute; top: -12px; left: 18px;
  padding: 2px 12px; background: var(--bg); border: 1px solid var(--line);
  font-family: var(--font-display); color: var(--accent); font-size: 0.95rem; letter-spacing: 0.1em;
}

/* ヒント = 受付の案内 */
.hint { display: flex; gap: 12px; align-items: flex-start; border-left: 0; }
.hint-face { width: 56px; height: 56px; flex: none; object-fit: cover; border: 1px solid var(--line); border-radius: 50%; background: var(--bg); }
.hint-body { min-width: 0; flex: 1; }
.hint-name { font-family: var(--font-display); color: var(--accent); font-size: 0.85rem; margin-bottom: 2px; }

/* 広い画面: 左にコマンド列 */
@media (min-width: 900px) {
  #app { display: grid; grid-template-columns: var(--nav-w) 1fr; grid-template-rows: auto 1fr; }
  .hud { grid-column: 1 / -1; }
  nav.tabs { flex-direction: column; padding: 14px 0 14px 8px; align-self: start; position: sticky; top: var(--hud-h); }
  nav.tabs button { flex-direction: row-reverse; justify-content: flex-end; padding: 9px 10px; }
  nav.tabs button.on::before { content: '▶'; position: absolute; left: -6px; font-size: 0.7rem; }
  .window { margin: 18px 18px 18px 6px; }
}
/* 狭い画面: 下に 5×2 のコマンドバー */
@media (max-width: 899px) {
  .hud { flex-wrap: wrap; }
  .hud h1 { font-size: 0.8rem; }
  .hud-next { margin-left: auto; }
  .hud-stats { flex-basis: 100%; order: 3; gap: 2px 12px; }
  nav.tabs {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 2;
    display: grid; grid-template-columns: repeat(5, 1fr);
    padding: 4px 4px env(safe-area-inset-bottom, 0px);
    background: #0e1719f5; border-top: 1px solid var(--line);
  }
  nav.tabs button { flex-direction: column-reverse; gap: 2px; padding: 4px 0; min-height: 46px; font-size: 0.7rem; letter-spacing: 0; }
  nav.tabs button.on::after { content: ''; position: absolute; left: 20%; right: 20%; bottom: 0; height: 2px; background: var(--accent); }
  .window { margin: 16px 10px calc(var(--nav-bar-h) + 16px); padding: 20px 10px 12px; }
  #pwa { padding-bottom: var(--nav-bar-h); }
}
```

`url('./art/...')` は `layout.css` が `src/ui/` にあるので、Vite の `base: './'` でも解決できるよう `url('/art/backgrounds/guild-office-day-v1.webp')` にする(public の絶対パス)。ビルド後に `dist/assets/*.css` の中でその URL が相対に書き換わっていることを確認する。もし絶対のままなら、`body` の背景は `main.ts` で `document.body.style.backgroundImage = \`url(${artUrl('backgrounds/guild-office-day-v1.webp')})\`` と設定する方式に替える。

**Step 8: 確認**

```sh
npm test
npm run build
```

Expected: すべて緑。`npm run dev` で 1280 幅: HUD が上、コマンドが左縦、窓の見出しがタブ名。390 幅: 下に 5×2 のバー、窓が横にはみ出さない。拠点タブに「N日目」が HUD に見える。ヒントにノエルの顔。

**Step 9: Commit**

```sh
git add src/ui/icons.ts src/ui/layout.css src/ui/main.ts src/ui/home.ts tests/icons.test.ts
git commit -m "HUD・アイコン付きコマンド・窓枠を足し、日数と「次の日へ」をどのタブからでも使えるようにする"
```

---

## Task C: 見出し用の明朝のサブセット

**Files:**
- Create: `scripts/subset-font.cjs`
- Create: `scripts/font-glyphs.txt`
- Create: `src/ui/minchoText.ts`
- Create: `tests/font-glyphs.test.ts`
- Modify: `index.html`
- Modify: `package.json`(devDependencies に `subset-font`、scripts に `font:subset`)
- Generate: `public/fonts/shippori-mincho-subset.woff2`

**Step 1: 失敗するテストを書く(最初の3回のツール呼び出しのうちに)**

`tests/font-glyphs.test.ts`:

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MINCHO_TEXT } from '../src/ui/minchoText';
import { TAB_DEFS } from '../src/ui/tabs';

const GLYPHS = 'scripts/font-glyphs.txt';
const WOFF2 = 'public/fonts/shippori-mincho-subset.woff2';

describe('見出し用の明朝のサブセット', () => {
  it('明朝で描く文字(題・コマンド名・HUD の語・数字)はすべて font-glyphs.txt にある', () => {
    const have = new Set(readFileSync(GLYPHS, 'utf8').split('\n').filter((l) => !l.startsWith('#')).join(''));
    const need = [...new Set([...MINCHO_TEXT, ...TAB_DEFS.map((t) => t.label)].join(''))].filter((c) => c.trim());
    expect(need.filter((c) => !have.has(c))).toEqual([]);
  });
  it.skipIf(!existsSync(WOFF2))('生成した woff2 は 100KB 以下', () => {
    expect(statSync(WOFF2).size).toBeLessThanOrEqual(100 * 1024);
  });
});
```

**Step 2: 失敗を確認**

```sh
npx vitest run tests/font-glyphs.test.ts
```

Expected: FAIL(`minchoText` が無い)

**Step 3: minchoText.ts と font-glyphs.txt を書く**

`src/ui/minchoText.ts`:

```ts
// 明朝(Shippori Mincho のサブセット)で描く固定の文字列。コマンド名は tabs.ts。ここに無い文字は端末の明朝で代替される
export const MINCHO_TEXT: readonly string[] = [
  '見えちゃうギルドマスター',
  '日目', '評判', 'Lv', '未読', '次の日へ', '1日', 'G',
  '0123456789', '−-+,.%/:()',
];
```

`scripts/font-glyphs.txt`:

```
# 明朝(Shippori Mincho)で描く文字。src/ui/minchoText.ts と src/ui/tabs.ts の文字がすべて入っていることを tests/font-glyphs.test.ts が検査する
見えちゃうギルドマスター
拠点受信箱依頼派遣ワールド募集施設地図ログ記録
日目評判未読次の日へ支出
0123456789GLv
−-+,.%/:()
```

**Step 4: テストの1つ目が通ることを確認**

```sh
npx vitest run tests/font-glyphs.test.ts
```

Expected: 1 passed, 1 skipped(woff2 がまだ無い)

**Step 5: サブセットのスクリプトと npm script**

```sh
npm install --save-dev subset-font
```

`scripts/subset-font.cjs`:

```js
// 見出し用の明朝を、font-glyphs.txt の文字だけに絞って woff2 にする。
// 元の TTF(Google Fonts の ShipporiMincho-Regular.ttf、OFL)は artifacts/fonts/ に手元で置く(git は無視)。出力の woff2 は git に入れる。
const fs = require('node:fs');
const path = require('node:path');
const subsetFont = require('subset-font');

const SRC = path.resolve(__dirname, '../artifacts/fonts/ShipporiMincho-Regular.ttf');
const GLYPHS = path.resolve(__dirname, 'font-glyphs.txt');
const OUT = path.resolve(__dirname, '../public/fonts/shippori-mincho-subset.woff2');

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`元のフォントが無い: ${SRC}\nGoogle Fonts の ShipporiMincho-Regular.ttf を置いてから実行する`);
    process.exit(1);
  }
  const text = fs.readFileSync(GLYPHS, 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('');
  const chars = [...new Set([...text])].filter((c) => c.trim()).join('');
  const out = await subsetFont(fs.readFileSync(SRC), chars, { targetFormat: 'woff2' });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.log(`${chars.length}文字 → ${path.relative(process.cwd(), OUT)} (${(out.length / 1024).toFixed(1)}KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

`package.json` の scripts に `"font:subset": "node scripts/subset-font.cjs"` を足す。

**Step 6: index.html に @font-face と preload**

`<link rel="stylesheet" href="/src/ui/style.css" />` の前に:

```html
<link rel="preload" href="./fonts/shippori-mincho-subset.woff2" as="font" type="font/woff2" crossorigin />
<style>
  @font-face {
    font-family: "Shippori Mincho Subset";
    src: url("./fonts/shippori-mincho-subset.woff2") format("woff2");
    font-weight: 400;
    font-display: swap;
  }
</style>
```

**Step 7: 生成(元の TTF がある場合)**

```sh
npm run font:subset
npx vitest run tests/font-glyphs.test.ts
```

Expected: `約60文字 → public/fonts/shippori-mincho-subset.woff2 (xx.xKB)`、テスト 2 passed。TTF が無ければ生成を飛ばし、報告に書く(CSS は端末の明朝へフォールバックするので画面は壊れない)。

**Step 8: 確認**

```sh
npm test
npm run build
```

Expected: 緑。`dist/fonts/shippori-mincho-subset.woff2` があり、`dist/sw.js` の FILES に含まれる(生成した場合)。

**Step 9: Commit**

```sh
git add scripts/subset-font.cjs scripts/font-glyphs.txt src/ui/minchoText.ts tests/font-glyphs.test.ts index.html package.json package-lock.json public/fonts
git commit -m "見出し用の明朝を、使う文字だけ抜いた woff2 で同梱する"
```

---

## 受け取り(本体)

1. `npm test`・`npm run build`・`npm run test:browser` を本体で再実行。14件すべて緑であること
2. `git diff` を読む。特に `main.ts` のボタンの子の順(ラベル→アイコン)と `.hint` の文面
3. `artifacts/screens/` の前後(作業前の画面は `artifacts/screens-before/` に退避しておく)を見比べ、PC 1280×800 とスマホ 390×844 を `docs/VERIFICATION.md` に記録
4. コントラスト: 窓の上の `.dim` の文字が読めるか。読めなければ `--dim` を明るくするかビネットを濃くする
