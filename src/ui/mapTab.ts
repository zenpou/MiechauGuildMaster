import { DUNGEON } from '../core/data';
import { parseFloor, visibleFrom } from '../core/dungeon';
import { exploredRateOf } from '../core/game';
import type { CellKind } from '../core/types';
import { state } from './app';
import { div, h, span } from './dom';

const DUNGEON_ID = 'forest_cave';
const FLOOR_ID = 'f1';

const MARK: Partial<Record<CellKind, string>> = {
  entrance: '入', gather: '採', nest: '巣', symbol: '主', boss: '主', treasure: '宝', trap: '罠', hidden: '隠',
};

export function mapTab(): HTMLElement {
  const dungeon = DUNGEON[DUNGEON_ID];
  const floor = dungeon.floors.find((f) => f.id === FLOOR_ID)!;
  const grid = parseFloor(floor);
  const prog = state.dungeons[DUNGEON_ID]?.floors[FLOOR_ID] ?? { visited: [], hiddenFound: [] };
  const visited = new Set(prog.visited);
  const hiddenFound = new Set(prog.hiddenFound);
  const known = new Set<number>(visited);
  for (const v of visited) for (const n of visibleFrom(grid, v)) known.add(n);

  const last = state.history.find((e) => e.order.target.dungeon === DUNGEON_ID);
  const recent = new Set(last?.result.mapDeltas.filter((m) => m.floor === FLOOR_ID).flatMap((m) => m.cells) ?? []);

  const cells = grid.cells.map((c, i) => {
    if (!known.has(i)) return div('cell unknown');
    // 未発見の隠し通路は、見えていても壁と同じ見た目にする(見つけるまで分からない)
    const looksWall = c.kind === 'wall' || (c.kind === 'hidden' && !hiddenFound.has(i));
    if (looksWall) return div('cell wall');
    const cls = ['cell', 'floor', visited.has(i) ? 'stepped' : 'seen', recent.has(i) ? 'recent' : ''].join(' ');
    return div(cls, MARK[c.kind] ?? '');
  });

  const rate = Math.round(exploredRateOf(state, DUNGEON_ID, FLOOR_ID) * 100);
  return div('tab-body',
    h('h2', null, `${dungeon.name} ${floor.name}`),
    div('summary', span('big', `探索率 ${rate}%`), span('dim', `踏んだマス ${visited.size}`)),
    div('map', { style: `grid-template-columns: repeat(${grid.width}, 1fr)` }, ...cells),
    div('legend small',
      span('lg unknown', ''), '未知 ',
      span('lg seen', ''), '見えた ',
      span('lg stepped', ''), '踏んだ ',
      span('lg recent', ''), '前回の遠征で踏んだ ',
      span('lg wall', ''), '壁',
    ),
    div('dim small', '入=入口 採=採取 巣=敵の巣 主=巣の主 宝=宝箱 罠=罠 隠=隠し通路(発見済み)'),
    last ? div('dim small', `強調: ${last.returnDay}日目に帰還した遠征`) : null,
  );
}
