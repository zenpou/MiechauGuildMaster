// ダンジョンのグリッド(固定の手作りマップ)。決定論的な幾何だけを扱い、乱数は使わない。
// index = y * width + x(MapDelta と同じ)。
import type { CellDef, FloorDef } from './types';

export interface Grid {
  width: number; height: number;
  /** index = y * width + x */
  cells: CellDef[];
  /** kind 'entrance' のindex */
  entrance: number;
}

export function parseFloor(def: FloorDef): Grid {
  const height = def.rows.length;
  const width = height > 0 ? def.rows[0].length : 0;
  const cells: CellDef[] = [];
  let entrance = -1;
  def.rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`${def.id}: ${y}行目の長さが ${row.length}(期待値 ${width})`);
    for (const ch of row) {
      const cell = def.legend[ch];
      if (!cell) throw new Error(`${def.id}: legend に無い文字 '${ch}'`);
      if (cell.kind === 'entrance' && entrance < 0) entrance = cells.length;
      cells.push(cell);
    }
  });
  if (entrance < 0) throw new Error(`${def.id}: 入口が無い`);
  return { width, height, cells, entrance };
}

export const idx = (grid: Grid, x: number, y: number) => y * grid.width + x;
export const xy = (grid: Grid, i: number) => ({ x: i % grid.width, y: Math.floor(i / grid.width) });

/** 通行判定に使う隊の知識 */
export interface PassKnowledge { keys: string[]; hiddenFound: number[] }

/** 通れるマス(wall 以外)。door は keys に鍵があるとき、hidden は hiddenFound に入っているときだけ通れる */
export function isPassable(grid: Grid, i: number, know: PassKnowledge): boolean {
  const cell = grid.cells[i];
  if (!cell) return false;
  switch (cell.kind) {
    case 'wall': return false;
    case 'door': return cell.key !== undefined && know.keys.includes(cell.key);
    case 'hidden': return know.hiddenFound.includes(i);
    default: return true;
  }
}

/** 上下左右の隣接マス(通れるかは問わない)。左右の端で折り返さない */
function adjacent(grid: Grid, i: number): number[] {
  const { x, y } = xy(grid, i);
  const out: number[] = [];
  if (y > 0) out.push(i - grid.width);
  if (y < grid.height - 1) out.push(i + grid.width);
  if (x > 0) out.push(i - 1);
  if (x < grid.width - 1) out.push(i + 1);
  return out;
}

/** 上下左右の通れる隣接マス */
export function neighbors(grid: Grid, i: number, know: PassKnowledge): number[] {
  return adjacent(grid, i).filter((n) => isPassable(grid, n, know));
}

/** known(既知=踏んだ or 見た)のマスだけを通る最短経路(BFS)。from と to を含む index 列。無ければ null */
export function shortestPath(
  grid: Grid, from: number, to: number, known: Set<number>, know: PassKnowledge,
): number[] | null {
  if (!known.has(to) || !isPassable(grid, to, know)) return null;
  if (from === to) return [from];
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const n of neighbors(grid, cur, know)) {
      if (prev.has(n) || !known.has(n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        for (let p = cur; p !== -1; p = prev.get(p)!) path.push(p);
        return path.reverse();
      }
      queue.push(n);
    }
  }
  return null;
}

/** 探索率 0〜1 = visited ∩ 通行可能 / 通行可能マス総数(hidden も含む、wall は除く) */
export function exploredRate(grid: Grid, visited: number[]): number {
  const total = grid.cells.filter((c) => c.kind !== 'wall').length;
  if (total === 0) return 0;
  const stepped = new Set(visited.filter((i) => grid.cells[i] && grid.cells[i].kind !== 'wall'));
  return stepped.size / total;
}

/** 立っているマスから「見える」マス = 上下左右の隣接(壁も含めて見える) */
export function visibleFrom(grid: Grid, i: number): number[] {
  return adjacent(grid, i);
}

/** 既知だが未踏のマスのうち、通れるもの(フロンティア) */
export function frontier(grid: Grid, visited: Set<number>, seen: Set<number>, know: PassKnowledge): number[] {
  return [...seen].filter((i) => !visited.has(i) && isPassable(grid, i, know)).sort((a, b) => a - b);
}

/** 未発見の hidden マスは「壁に見える」。この判定を1か所に */
export function looksLikeWall(grid: Grid, i: number, hiddenFound: number[]): boolean {
  const kind = grid.cells[i]?.kind;
  return kind === 'wall' || (kind === 'hidden' && !hiddenFound.includes(i));
}
