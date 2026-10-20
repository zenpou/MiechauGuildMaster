import { DUNGEON, DUNGEONS, ITEM, PERSONALITY } from '../core/data';
import { parseFloor, visibleFrom } from '../core/dungeon';
import { exploredRateOf } from '../core/game';
import { heldKeys } from '../core/ledger';
import { dungeonRate } from '../core/quests';
import type { CellDef } from '../core/types';
import { actionText, advById, nameOf, render, state, ui } from './app';
import { div, h, span } from './dom';
import { dungeonTheme, terrainCell } from './dungeonArt';

// 四捨五入だと 99.5% が「100%」に見えて踏破の表示と食い違うので切り捨てる(実績の判定と同じ)
const pct = (x: number) => Math.floor(x * 100 + 1e-9);
// 色見本と名前が別の行に分かれないよう、1組ずつまとめる
const legendItem = (cls: string, label: string) => span('lg-item', span(`lg ${cls}`, ''), label);

function cellTitle(c: CellDef): string | null {
  if (c.kind === 'door' && c.key) return `${ITEM[c.key]?.name ?? c.key}で開く扉`;
  if (c.kind === 'treasure' && c.item) return `${ITEM[c.item]?.name ?? c.item}の宝箱`;
  return null;
}

export function mapTab(): HTMLElement {
  const confirmed = DUNGEONS.filter((d) => state.dungeons[d.id]?.confirmed);
  if (!confirmed.some((d) => d.id === ui.mapDungeon)) ui.mapDungeon = confirmed[0]?.id ?? '';
  if (!ui.mapDungeon) return div('tab-body', div('dim', '入口を確認したダンジョンがありません'));
  const dungeonId = ui.mapDungeon;
  const dungeon = DUNGEON[dungeonId];
  if (!dungeon.floors.some((f) => f.id === ui.mapFloor)) ui.mapFloor = dungeon.floors[0].id;
  const floorId = ui.mapFloor;
  const floor = dungeon.floors.find((f) => f.id === floorId)!;
  const grid = parseFloor(floor);
  const theme = dungeonTheme(dungeonId);
  const prog = state.dungeons[dungeonId]?.floors[floorId] ?? { visited: [], hiddenFound: [] };
  const visited = new Set(prog.visited);
  const hiddenFound = new Set(prog.hiddenFound);
  const known = new Set<number>(visited);
  for (const v of visited) for (const n of visibleFrom(grid, v)) known.add(n);
  const keys = new Set(heldKeys(state));

  const last = state.history.find((e) => e.order.target.dungeon === dungeonId);
  const recent = new Set(last?.result.mapDeltas.filter((m) => m.floor === floorId).flatMap((m) => m.cells) ?? []);

  const cells = grid.cells.map((c, i) => {
    const el = terrainCell(theme, c, i, {
      known: known.has(i), visited: visited.has(i), hidden: hiddenFound.has(i),
      recent: recent.has(i), keys: [...keys],
    });
    const title = known.has(i) ? cellTitle(c) : null;
    if (title) el.title = title;
    return el;
  });

  const floorRates = dungeon.floors.map((f) => ({ f, rate: exploredRateOf(state, dungeonId, f.id) }));
  const rate = pct(exploredRateOf(state, dungeonId, floorId));
  const multi = dungeon.floors.length > 1;
  const cleared = floorRates.every((r) => r.rate >= 1);
  const leader = last ? advById(last.order.leaderId) : undefined;
  return div('tab-body',
    confirmed.length > 1 ? div('dungeon-pick', ...confirmed.map((d) =>
      h('button', { class: d.id === dungeonId ? 'on' : '', onclick: () => { ui.mapDungeon = d.id; ui.mapFloor = 'f1'; render(); } }, d.name))) : null,
    multi ? div('dungeon-pick floor-pick', ...floorRates.map(({ f, rate: r }) =>
      h('button', { class: f.id === floorId ? 'on' : '', onclick: () => { ui.mapFloor = f.id; render(); } }, `${f.name} ${pct(r)}%`))) : null,
    h('h2', null, `${dungeon.name} ${floor.name}`),
    div('dungeon-atmosphere', { style: `--terrain-accent:${theme.color}` }, theme.mood),
    div('summary',
      span('big', `探索率 ${rate}%`),
      multi ? span(null, `全体 ${pct(dungeonRate(state, dungeonId))}%`) : null,
      cleared ? span('big pos', '踏破') : null,
      span('dim', `踏んだマス ${visited.size}`)),
    div('map terrain-map', { style: `grid-template-columns: repeat(${grid.width}, 1fr)`, role: 'img', 'aria-label': `${dungeon.name} ${floor.name}の地図。探索率${rate}%` }, ...cells),
    div('legend small',
      legendItem('unknown', '未知'),
      legendItem('seen', '見えた'),
      legendItem('stepped', '踏んだ'),
      legendItem('recent', '前回の遠征で踏んだ'),
      legendItem('wall', '壁'),
      legendItem('door', '扉(鍵が要る)'),
      legendItem('door open', '扉(鍵を持っている)'),
    ),
    div('dim small', '入=入口 採=採取 巣=敵の巣 主=巣の主 宝=宝箱 鍵=鍵の宝箱 罠=罠 隠=隠し通路(発見済み) 扉=鍵の要る扉 下=下り階段 上=上り階段'),
    multi ? div('dim small', '全体は全フロアの通行できるマスに対する割合です。踏破は全フロアが100%のとき。') : null,
    last ? div('dim small', `強調: ${last.returnDay}日目に帰還した遠征(隊長 ${nameOf(last.order.leaderId)}`
      + `${leader ? `・${PERSONALITY[leader.personality]?.name ?? leader.personality}` : ''} / ${actionText(last.order)})`) : null,
  );
}
