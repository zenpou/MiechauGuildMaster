import { describe, expect, it } from 'vitest';
import {
  exploredRate, frontier, idx, isPassable, looksLikeWall, neighbors, parseFloor, shortestPath, visibleFrom, xy,
} from '../src/core/dungeon';
import { DUNGEON, ITEM } from '../src/core/data';
import type { CellKind, FloorDef } from '../src/core/types';

// テストリスト
// - [x] は実装済み
// - [ ] parseFloor: 幅・高さ・入口index。行の長さ不揃いで例外
// - [ ] isPassable: wall不可 / door は鍵 / hidden は発見済み
// - [ ] neighbors: 上下左右の通れるマス
// - [ ] shortestPath: 既知マスだけを通る。未知を挟むと null
// - [ ] exploredRate: hidden を分母に含む。入口だけで 1/通行可能数
// - [ ] visibleFrom: 上下左右(壁含む)
// - [ ] frontier: 見たが踏んでいない通行可能マス
// - [ ] looksLikeWall: 未発見 hidden と wall
// - [ ] forest_cave: 通行可能 60〜75、全マス到達、hidden 閉でも symbol 到達、内訳

const legend: FloorDef['legend'] = {
  '#': { kind: 'wall' },
  '.': { kind: 'floor' },
  E: { kind: 'entrance' },
  D: { kind: 'door', key: 'rusty_key' },
  H: { kind: 'hidden' },
};
const floor = (rows: string[]): FloorDef => ({ id: 't', name: 'テスト', rows, legend });

describe('parseFloor', () => {
  it('幅・高さ・入口indexが取れる', () => {
    const g = parseFloor(floor(['#####', '#..D#', 'E.#H#', '#####']));
    expect(g.width).toBe(5);
    expect(g.height).toBe(4);
    expect(g.entrance).toBe(10);
    expect(g.cells[8].kind).toBe('door');
  });
  it('行の長さが揃っていなければ例外', () => {
    expect(() => parseFloor(floor(['###', '##']))).toThrow();
  });
});

// #####
// #..D#
// E.#H#
// #####
const small = () => parseFloor(floor(['#####', '#..D#', 'E.#H#', '#####']));
const none = { keys: [] as string[], hiddenFound: [] as number[] };

describe('idx / xy', () => {
  it('index = y * width + x で往復できる', () => {
    const g = small();
    expect(idx(g, 3, 2)).toBe(13);
    expect(xy(g, 13)).toEqual({ x: 3, y: 2 });
  });
});

describe('isPassable', () => {
  it('wall は通れず、floor と entrance は通れる', () => {
    const g = small();
    expect(isPassable(g, idx(g, 0, 0), none)).toBe(false);
    expect(isPassable(g, idx(g, 1, 1), none)).toBe(true);
    expect(isPassable(g, g.entrance, none)).toBe(true);
  });
  it('door は鍵を持っているときだけ通れる', () => {
    const g = small();
    const d = idx(g, 3, 1);
    expect(isPassable(g, d, none)).toBe(false);
    expect(isPassable(g, d, { keys: ['other'], hiddenFound: [] })).toBe(false);
    expect(isPassable(g, d, { keys: ['rusty_key'], hiddenFound: [] })).toBe(true);
  });
  it('hidden は見つけたときだけ通れる', () => {
    const g = small();
    const h = idx(g, 3, 2);
    expect(isPassable(g, h, none)).toBe(false);
    expect(isPassable(g, h, { keys: [], hiddenFound: [h] })).toBe(true);
  });
  it('範囲外は通れない', () => {
    const g = small();
    expect(isPassable(g, -1, none)).toBe(false);
    expect(isPassable(g, g.cells.length, none)).toBe(false);
  });
});

describe('neighbors', () => {
  it('上下左右の通れるマスだけを返す', () => {
    const g = small();
    expect(neighbors(g, idx(g, 1, 1), none).sort((a, b) => a - b)).toEqual([idx(g, 2, 1), idx(g, 1, 2)]);
  });
  it('左右の端で折り返さない', () => {
    const g = parseFloor(floor(['..E', '...']));
    // (2,0) の右隣は (0,1) ではない
    expect(neighbors(g, idx(g, 2, 0), none).sort((a, b) => a - b)).toEqual([idx(g, 1, 0), idx(g, 2, 1)]);
  });
});

describe('shortestPath', () => {
  // E....
  // .###.
  // .....
  const loop = () => parseFloor(floor(['E....', '.###.', '.....']));
  const all = (g: ReturnType<typeof loop>) => new Set(g.cells.map((_, i) => i));

  it('from と to を含む最短の index 列を返す', () => {
    const g = loop();
    const p = shortestPath(g, g.entrance, idx(g, 4, 0), all(g), none);
    expect(p).toEqual([0, 1, 2, 3, 4]);
  });
  it('from === to なら [from]', () => {
    const g = loop();
    expect(shortestPath(g, 0, 0, all(g), none)).toEqual([0]);
  });
  it('既知マスだけを通り、遠回りでも既知の道を選ぶ', () => {
    const g = loop();
    // 上の通路 (2,0) を未知にすると、下を回るしかない
    const known = all(g);
    known.delete(idx(g, 2, 0));
    const p = shortestPath(g, g.entrance, idx(g, 4, 0), known, none)!;
    expect(p).toHaveLength(9);
    expect(p.every((i) => known.has(i))).toBe(true);
  });
  it('未知を挟むと null', () => {
    const g = loop();
    const known = all(g);
    known.delete(idx(g, 2, 0));
    known.delete(idx(g, 2, 2));
    expect(shortestPath(g, g.entrance, idx(g, 4, 0), known, none)).toBeNull();
  });
  it('to が既知でなければ null', () => {
    const g = loop();
    const known = all(g);
    known.delete(idx(g, 4, 0));
    expect(shortestPath(g, g.entrance, idx(g, 4, 0), known, none)).toBeNull();
  });
  it('未発見の hidden は通らず、発見済みなら通る', () => {
    // E.H.E 相当: 入口から右端へは hidden を通るしかない
    const g = parseFloor(floor(['E.H..']));
    const known = new Set([0, 1, 2, 3, 4]);
    expect(shortestPath(g, 0, 4, known, none)).toBeNull();
    expect(shortestPath(g, 0, 4, known, { keys: [], hiddenFound: [2] })).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('exploredRate', () => {
  it('入口だけ踏んだ状態で 1/通行可能数。hidden と door は分母に含み、wall は除く', () => {
    const g = small(); // 通行可能: (1,1)(2,1)D(0,2)(1,2)H = 6
    expect(exploredRate(g, [g.entrance])).toBeCloseTo(1 / 6);
  });
  it('全部踏めば 1。重複と wall は数えない', () => {
    const g = small();
    const open = g.cells.map((c, i) => (c.kind === 'wall' ? -1 : i)).filter((i) => i >= 0);
    expect(exploredRate(g, [...open, ...open, 0])).toBe(1);
  });
  it('何も踏んでいなければ 0', () => {
    expect(exploredRate(small(), [])).toBe(0);
  });
});

describe('visibleFrom', () => {
  it('上下左右の隣接マスを壁も含めて返す', () => {
    const g = small();
    expect(visibleFrom(g, idx(g, 1, 1)).sort((a, b) => a - b)).toEqual(
      [idx(g, 1, 0), idx(g, 0, 1), idx(g, 2, 1), idx(g, 1, 2)].sort((a, b) => a - b),
    );
  });
  it('端では範囲外を含めない', () => {
    const g = small();
    expect(visibleFrom(g, g.entrance).sort((a, b) => a - b)).toEqual([idx(g, 0, 1), idx(g, 1, 2), idx(g, 0, 3)]);
  });
});

describe('looksLikeWall', () => {
  it('wall と未発見の hidden は壁に見え、発見済み hidden と床は見えない', () => {
    const g = small();
    const h = idx(g, 3, 2);
    expect(looksLikeWall(g, 0, [])).toBe(true);
    expect(looksLikeWall(g, h, [])).toBe(true);
    expect(looksLikeWall(g, h, [h])).toBe(false);
    expect(looksLikeWall(g, idx(g, 1, 1), [])).toBe(false);
  });
});

describe('frontier', () => {
  it('見たが踏んでいない通行可能マスだけ', () => {
    const g = small();
    const visited = new Set([g.entrance, idx(g, 1, 2)]);
    const seen = new Set([...visited, ...visibleFrom(g, g.entrance), ...visibleFrom(g, idx(g, 1, 2))]);
    expect(frontier(g, visited, seen, none)).toEqual([idx(g, 1, 1)]);
  });
  it('鍵の無い door と未発見の hidden はフロンティアにならない', () => {
    const g = small();
    const d = idx(g, 3, 1), h = idx(g, 3, 2);
    const visited = new Set([idx(g, 2, 1)]);
    const seen = new Set([d, h, idx(g, 1, 1)]);
    expect(frontier(g, visited, seen, none)).toEqual([idx(g, 1, 1)]);
    expect(frontier(g, visited, seen, { keys: ['rusty_key'], hiddenFound: [h] }).sort((a, b) => a - b))
      .toEqual([idx(g, 1, 1), d, h].sort((a, b) => a - b));
  });
});

describe('forest_cave', () => {
  const dungeon = () => DUNGEON.forest_cave;
  const grid = () => parseFloor(dungeon().floors[0]);
  const ofKind = (g: ReturnType<typeof grid>, kind: CellKind) =>
    g.cells.map((c, i) => (c.kind === kind ? i : -1)).filter((i) => i >= 0);
  const openCells = (g: ReturnType<typeof grid>) =>
    g.cells.map((c, i) => (c.kind === 'wall' ? -1 : i)).filter((i) => i >= 0);
  const allFound = (g: ReturnType<typeof grid>) => ({ keys: [], hiddenFound: ofKind(g, 'hidden') });
  const everything = (g: ReturnType<typeof grid>) => new Set(g.cells.map((_, i) => i));

  it('フロア f1 が1枚、12×12', () => {
    expect(dungeon().floors.map((f) => f.id)).toEqual(['f1']);
    const g = grid();
    expect([g.width, g.height]).toEqual([12, 12]);
  });
  it('入口は左端の中央あたり', () => {
    const g = grid();
    const { x, y } = xy(g, g.entrance);
    expect(x).toBe(0);
    expect(y).toBeGreaterThanOrEqual(4);
    expect(y).toBeLessThanOrEqual(7);
  });
  it('通行可能マスは60〜75', () => {
    const n = openCells(grid()).length;
    expect(n).toBeGreaterThanOrEqual(60);
    expect(n).toBeLessThanOrEqual(75);
  });
  it('マスの内訳がプラン通り', () => {
    const g = grid();
    const count = (kind: CellKind) => ofKind(g, kind).length;
    expect(count('entrance')).toBe(1);
    expect(count('gather')).toBe(4);
    expect(count('nest')).toBe(2);
    expect(count('symbol')).toBe(1);
    expect(count('treasure')).toBe(2);
    expect(count('trap')).toBe(2);
    expect(count('hidden')).toBe(3);
    const items = ofKind(g, 'gather').map((i) => g.cells[i].item).sort();
    expect(items).toEqual(['herb', 'herb', 'moss_ore', 'slime_gel']);
    expect(ofKind(g, 'nest').map((i) => g.cells[i].enemy).sort()).toEqual(['goblin', 'wolf']);
    expect(g.cells[ofKind(g, 'symbol')[0]].enemy).toBe('goblin_chief');
    expect(ofKind(g, 'trap').every((i) => g.cells[i].trap === 'spike')).toBe(true);
  });
  it('採取点の素材は items.json にある', () => {
    const g = grid();
    for (const i of ofKind(g, 'gather')) expect(ITEM[g.cells[i].item!]).toBeDefined();
  });
  it('隠し通路を開けた状態で、入口から全通行可能マスへ到達できる', () => {
    const g = grid();
    const known = everything(g);
    for (const i of openCells(g)) expect(shortestPath(g, g.entrance, i, known, allFound(g)), `${i}`).not.toBeNull();
  });
  it('隠し通路を閉じた状態でも symbol へ到達できる', () => {
    const g = grid();
    expect(shortestPath(g, g.entrance, ofKind(g, 'symbol')[0], everything(g), none)).not.toBeNull();
  });
  it('隠し通路は symbol への近道になる', () => {
    const g = grid();
    const sym = ofKind(g, 'symbol')[0];
    const closed = shortestPath(g, g.entrance, sym, everything(g), none)!;
    const open = shortestPath(g, g.entrance, sym, everything(g), allFound(g))!;
    expect(open.length).toBeLessThan(closed.length);
    expect(open.some((i) => g.cells[i].kind === 'hidden')).toBe(true);
  });
  it('入口から最初の分かれ道で3方向に分かれる', () => {
    const g = grid();
    const know = allFound(g);
    let prev = -1, cur = g.entrance;
    while (neighbors(g, cur, know).length <= 2) {
      const next = neighbors(g, cur, know).find((n) => n !== prev);
      if (next === undefined) throw new Error('分かれ道が無い');
      prev = cur; cur = next;
    }
    expect(neighbors(g, cur, know).filter((n) => n !== prev)).toHaveLength(3);
  });
  it('行き止まり(入口以外で隣接1マス)が2本', () => {
    const g = grid();
    const know = allFound(g);
    const ends = openCells(g).filter((i) => i !== g.entrance && neighbors(g, i, know).length === 1);
    expect(ends).toHaveLength(2);
  });
  it('出現敵・推奨戦力・救助費用', () => {
    const d = dungeon();
    expect(d.node).toBe('forest_cave');
    expect(d.enemies).toEqual([
      { id: 'goblin', weight: 5, group: [1, 3] },
      { id: 'wolf', weight: 3, group: [1, 2] },
      { id: 'slime', weight: 3, group: [1, 2] },
    ]);
    expect(d.recommended).toBe(180);
    expect(d.rescueCost).toBe(120);
  });
});

describe('items.json', () => {
  it('素材4種と回復薬', () => {
    const pick = (id: string) => {
      const it = ITEM[id];
      return it && [it.kind, it.price, it.weight];
    };
    expect(pick('herb')).toEqual(['material', 12, 1]);
    expect(pick('fang')).toEqual(['material', 18, 1]);
    expect(pick('slime_gel')).toEqual(['material', 22, 1]);
    expect(pick('moss_ore')).toEqual(['material', 30, 2]);
    expect(pick('potion')).toEqual(['consumable', 30, 1]);
    expect(ITEM.herb.source).toBe('forest_cave');
    expect(ITEM.potion.consumable).toEqual({ effect: 'heal', params: { ratio: 0.45 } });
  });
});
