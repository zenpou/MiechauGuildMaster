import { describe, expect, it } from 'vitest';
import {
  exploredRate, frontier, idx, isPassable, looksLikeWall, neighbors, parseFloor, shortestPath, visibleFrom, xy,
} from '../src/core/dungeon';
import { DUNGEON, ENEMY, ITEM, PERSONALITIES } from '../src/core/data';
import type { CellKind, FloorDef } from '../src/core/types';
import type { PassKnowledge } from '../src/core/dungeon';

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
// - [ ] old_mine: 14×14、通行可能 80〜100、全マス到達、hidden 閉でも symbol 到達、symbol まで 閉28〜34/開20〜24歩
// - [ ] ruined_tower: 16×16×2フロア、内訳、到達性、階段の to が相互参照、敵と素材
// - [ ] ruined_tower f1: 3マスの隠し通路の奥に ruin_key の宝箱
// - [ ] frost_valley: 16×16、通行可能 110〜130、内訳、隠し通路を閉じても symbol へ、symbol まで 30〜36歩
// - [ ] sunken_ruins: f1 100〜120 / f2 80〜100、f1 の扉(ruin_key)の奥に階段、f2 の守護像のすぐ奥に dragon_crest
// - [ ] dragon_lair: f1 90〜110 / f2 70〜90、f1 の扉(dragon_crest)の奥に階段、f2 の最奥に竜(28〜34歩)
// - [ ] フェーズ6の敵12・素材9・鍵2・建材2

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

describe('old_mine', () => {
  const dungeon = () => DUNGEON.old_mine;
  const grid = () => parseFloor(dungeon().floors[0]);
  const ofKind = (g: ReturnType<typeof grid>, kind: CellKind) =>
    g.cells.map((c, i) => (c.kind === kind ? i : -1)).filter((i) => i >= 0);
  const openCells = (g: ReturnType<typeof grid>) =>
    g.cells.map((c, i) => (c.kind === 'wall' ? -1 : i)).filter((i) => i >= 0);
  const allFound = (g: ReturnType<typeof grid>) => ({ keys: [], hiddenFound: ofKind(g, 'hidden') });
  const everything = (g: ReturnType<typeof grid>) => new Set(g.cells.map((_, i) => i));
  const stepsToSymbol = (g: ReturnType<typeof grid>, know: PassKnowledge) =>
    shortestPath(g, g.entrance, ofKind(g, 'symbol')[0], everything(g), know)!.length - 1;

  it('フロア f1 が1枚、14×14', () => {
    expect(dungeon().floors.map((f) => f.id)).toEqual(['f1']);
    const g = grid();
    expect([g.width, g.height]).toEqual([14, 14]);
  });
  it('入口は上端の中央', () => {
    const g = grid();
    const { x, y } = xy(g, g.entrance);
    expect(y).toBe(0);
    expect(x).toBeGreaterThanOrEqual(6);
    expect(x).toBeLessThanOrEqual(7);
  });
  it('通行可能マスは80〜100', () => {
    const n = openCells(grid()).length;
    expect(n).toBeGreaterThanOrEqual(80);
    expect(n).toBeLessThanOrEqual(100);
  });
  it('マスの内訳がプラン通り', () => {
    const g = grid();
    const count = (kind: CellKind) => ofKind(g, kind).length;
    expect(count('entrance')).toBe(1);
    expect(count('gather')).toBe(5);
    expect(count('nest')).toBe(3);
    expect(count('symbol')).toBe(1);
    expect(count('treasure')).toBe(2);
    expect(count('trap')).toBe(3);
    expect(count('hidden')).toBeGreaterThanOrEqual(3);
    expect(count('hidden')).toBeLessThanOrEqual(4);
    const items = ofKind(g, 'gather').map((i) => g.cells[i].item).sort();
    expect(items).toEqual(['glow_moss', 'glow_moss', 'iron_ore', 'iron_ore', 'moss_ore']);
    expect(ofKind(g, 'nest').map((i) => g.cells[i].enemy).sort()).toEqual(['cave_bat', 'skeleton', 'skeleton']);
    expect(g.cells[ofKind(g, 'symbol')[0]].enemy).toBe('golem');
    expect(ofKind(g, 'trap').every((i) => g.cells[i].trap === 'rockfall')).toBe(true);
  });
  it('採取点の素材は items.json に、巣とシンボルの敵は enemies.json にある', () => {
    const g = grid();
    for (const i of ofKind(g, 'gather')) expect(ITEM[g.cells[i].item!]).toBeDefined();
    for (const i of [...ofKind(g, 'nest'), ...ofKind(g, 'symbol')]) expect(ENEMY[g.cells[i].enemy!]).toBeDefined();
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
  it('symbol までの最短歩数は 閉28〜34 / 開20〜24', () => {
    const g = grid();
    const closed = stepsToSymbol(g, none);
    const open = stepsToSymbol(g, allFound(g));
    expect(closed).toBeGreaterThanOrEqual(28);
    expect(closed).toBeLessThanOrEqual(34);
    expect(open).toBeGreaterThanOrEqual(20);
    expect(open).toBeLessThanOrEqual(24);
  });
  it('隠し通路は1本につながっていて、symbol への近道に使われる', () => {
    const g = grid();
    const hidden = ofKind(g, 'hidden');
    const path = shortestPath(g, g.entrance, ofKind(g, 'symbol')[0], everything(g), allFound(g))!;
    expect(hidden.every((h) => path.includes(h))).toBe(true);
  });
  it('行き止まり(入口以外で隣接1マス)が3本', () => {
    const g = grid();
    const know = allFound(g);
    const ends = openCells(g).filter((i) => i !== g.entrance && neighbors(g, i, know).length === 1);
    expect(ends).toHaveLength(3);
  });
  it('出現敵・推奨戦力・救助費用・遭遇率', () => {
    const d = dungeon();
    expect(d.node).toBe('old_mine');
    expect(d.enemies).toEqual([
      { id: 'skeleton', weight: 4, group: [1, 2] },
      { id: 'cave_bat', weight: 4, group: [3, 5] },
      { id: 'slime', weight: 2, group: [1, 2] },
    ]);
    expect(d.recommended).toBe(320);
    expect(d.rescueCost).toBe(260);
    expect(d.encounterRate).toBe(0.05);
  });
});

describe('古い坑道の敵と素材', () => {
  it('敵3種がプランの表どおり', () => {
    const pick = (id: string) => {
      const e = ENEMY[id];
      return e && [e.hp, e.atk, e.def, e.mag, e.spd, e.exp, e.ai];
    };
    // 2026-10-10 守備係数1.0に合わせて攻撃を上げ、装備なしの坑道が失敗率35%になる値(VERIFICATION 参照)
    expect(pick('skeleton')).toEqual([80, 38, 10, 0, 8, 11, 'random']);
    expect(pick('cave_bat')).toEqual([20, 16, 2, 0, 18, 4, 'weakest']);
    expect(pick('golem')).toEqual([480, 40, 18, 0, 4, 70, 'strongest']);
    expect(ENEMY.skeleton.loot).toEqual([{ item: 'bone_shard', chance: 0.6 }]);
    expect(ENEMY.cave_bat.loot).toEqual([{ item: 'glow_moss', chance: 0.2 }]);
    expect(ENEMY.golem.loot).toEqual([{ item: 'golem_core', chance: 1 }, { item: 'iron_ore', chance: 1 }]);
    expect(ENEMY.golem.symbol).toBe(true);
    expect(ENEMY.golem.skill).toEqual({ name: '岩砕き', mult: 1.4, cd: 3, aoe: true });
  });
  it('素材4種がプランの表どおり', () => {
    const pick = (id: string) => {
      const it = ITEM[id];
      return it && [it.kind, it.price, it.weight, it.source];
    };
    expect(pick('iron_ore')).toEqual(['material', 36, 2, 'old_mine']);
    expect(pick('glow_moss')).toEqual(['material', 20, 1, 'old_mine']);
    expect(pick('bone_shard')).toEqual(['material', 15, 1, undefined]);
    expect(pick('golem_core')).toEqual(['material', 240, 3, undefined]);
  });
});

describe('personalities.json', () => {
  it('全性格に exploreDesc(隊長のときの埋まり方)がある', () => {
    for (const p of PERSONALITIES) expect(p.exploreDesc, p.id).toMatch(/\S/);
  });
});

describe('ruined_tower', () => {
  const dungeon = () => DUNGEON.ruined_tower;
  const floorOf = (id: string) => parseFloor(dungeon().floors.find((f) => f.id === id)!);
  const ofKind = (g: ReturnType<typeof floorOf>, kind: CellKind) =>
    g.cells.map((c, i) => (c.kind === kind ? i : -1)).filter((i) => i >= 0);
  const openCells = (g: ReturnType<typeof floorOf>) =>
    g.cells.map((c, i) => (c.kind === 'wall' ? -1 : i)).filter((i) => i >= 0);
  const allFound = (g: ReturnType<typeof floorOf>) => ({ keys: [], hiddenFound: ofKind(g, 'hidden') });
  const everything = (g: ReturnType<typeof floorOf>) => new Set(g.cells.map((_, i) => i));
  const kinds = (g: ReturnType<typeof floorOf>, kind: CellKind, key: 'item' | 'enemy') =>
    ofKind(g, kind).map((i) => g.cells[i][key]).sort();

  it('フロア f1 / f2、どちらも 16×16', () => {
    expect(dungeon().floors.map((f) => f.id)).toEqual(['f1', 'f2']);
    for (const id of ['f1', 'f2']) {
      const g = floorOf(id);
      expect([g.width, g.height], id).toEqual([16, 16]);
    }
  });
  it('通行可能マスは f1 90〜110 / f2 70〜90', () => {
    const n1 = openCells(floorOf('f1')).length;
    const n2 = openCells(floorOf('f2')).length;
    expect(n1).toBeGreaterThanOrEqual(90);
    expect(n1).toBeLessThanOrEqual(110);
    expect(n2).toBeGreaterThanOrEqual(70);
    expect(n2).toBeLessThanOrEqual(90);
  });
  it('f1 のマスの内訳がプラン通り', () => {
    const g = floorOf('f1');
    const count = (kind: CellKind) => ofKind(g, kind).length;
    expect(count('entrance')).toBe(1);
    expect(count('stairs_down')).toBe(1);
    expect(count('stairs_up')).toBe(0);
    expect(count('gather')).toBe(4);
    expect(count('nest')).toBe(3);
    expect(count('symbol')).toBe(0);
    expect(count('treasure')).toBe(3);
    expect(count('trap')).toBe(2);
    expect(count('hidden')).toBe(5);
    expect(kinds(g, 'gather', 'item')).toEqual(['ancient_cloth', 'ancient_cloth', 'crystal', 'crystal']);
    expect(kinds(g, 'nest', 'enemy')).toEqual(['gargoyle', 'ghoul', 'ghoul']);
    expect(kinds(g, 'treasure', 'item')).toEqual(['ruin_key', undefined, undefined]);
    expect(ofKind(g, 'trap').every((i) => g.cells[i].trap === 'glyph')).toBe(true);
  });
  it('ruin_key の宝箱は3マスの隠し通路の奥にあり、隠し通路を見つけないと届かない', () => {
    const g = floorOf('f1');
    const key = ofKind(g, 'treasure').find((i) => g.cells[i].item === 'ruin_key')!;
    expect(shortestPath(g, g.entrance, key, everything(g), none)).toBeNull();
    const path = shortestPath(g, g.entrance, key, everything(g), allFound(g))!;
    expect(path.filter((i) => g.cells[i].kind === 'hidden')).toHaveLength(3);
    // 近道の隠し通路(下り階段の手前)とは別の枝
    const stairs = ofKind(g, 'stairs_down')[0];
    const toStairs = shortestPath(g, g.entrance, stairs, everything(g), allFound(g))!;
    expect(path.filter((i) => g.cells[i].kind === 'hidden').some((h) => toStairs.includes(h))).toBe(false);
  });
  it('f2 のマスの内訳がプラン通り', () => {
    const g = floorOf('f2');
    const count = (kind: CellKind) => ofKind(g, kind).length;
    expect(count('entrance')).toBe(1);
    expect(count('stairs_up')).toBe(1);
    expect(count('stairs_down')).toBe(0);
    expect(count('gather')).toBe(3);
    expect(count('nest')).toBe(2);
    expect(count('symbol')).toBe(1);
    expect(count('treasure')).toBe(1);
    expect(count('trap')).toBe(2);
    expect(kinds(g, 'gather', 'item')).toEqual(['crystal', 'crystal', 'wisp_ember']);
    expect(kinds(g, 'nest', 'enemy')).toEqual(['wisp', 'wisp']);
    expect(kinds(g, 'symbol', 'enemy')).toEqual(['tower_keeper']);
    expect(ofKind(g, 'trap').every((i) => g.cells[i].trap === 'glyph')).toBe(true);
  });
  it('f1 は隠し通路を開ければ全マスへ、閉じていても下り階段へ到達できる', () => {
    const g = floorOf('f1');
    for (const i of openCells(g)) expect(shortestPath(g, g.entrance, i, everything(g), allFound(g)), `${i}`).not.toBeNull();
    expect(shortestPath(g, g.entrance, ofKind(g, 'stairs_down')[0], everything(g), none)).not.toBeNull();
  });
  it('隠し通路は下り階段への近道になる', () => {
    const g = floorOf('f1');
    const stairs = ofKind(g, 'stairs_down')[0];
    const closed = shortestPath(g, g.entrance, stairs, everything(g), none)!.length;
    const open = shortestPath(g, g.entrance, stairs, everything(g), allFound(g))!.length;
    expect(open).toBeLessThan(closed);
  });
  it('下り階段は f1 の最奥(入口から最も遠い通行可能マスの近く)', () => {
    const g = floorOf('f1');
    const dist = (i: number) => shortestPath(g, g.entrance, i, everything(g), none)?.length ?? 0;
    const far = Math.max(...openCells(g).map(dist));
    expect(dist(ofKind(g, 'stairs_down')[0])).toBeGreaterThanOrEqual(far - 4);
  });
  it('f2 は入口(上り階段の位置)から全マスへ到達できる', () => {
    const g = floorOf('f2');
    for (const i of openCells(g)) expect(shortestPath(g, g.entrance, i, everything(g), allFound(g)), `${i}`).not.toBeNull();
  });
  it('階段の to が互いを指す', () => {
    const f1 = floorOf('f1');
    const f2 = floorOf('f2');
    const down = ofKind(f1, 'stairs_down')[0];
    const up = ofKind(f2, 'stairs_up')[0];
    expect(f1.cells[down].to).toEqual({ floor: 'f2', ...xy(f2, up) });
    expect(f2.cells[up].to).toEqual({ floor: 'f1', ...xy(f1, down) });
    // f2 は上り階段を降りた位置から始まる(入口は上り階段の隣)
    expect(neighbors(f2, up, none)).toContain(f2.entrance);
  });
  it('出現敵・推奨戦力・救助費用・遭遇率', () => {
    const d = dungeon();
    expect(d.node).toBe('ruined_tower');
    expect(d.enemies).toEqual([
      { id: 'ghoul', weight: 4, group: [1, 2] },
      { id: 'gargoyle', weight: 3, group: [1, 1] },
      { id: 'wisp', weight: 3, group: [2, 3] },
    ]);
    expect(d.recommended).toBe(480);
    expect(d.rescueCost).toBe(400);
    expect(d.encounterRate).toBe(0.05);
  });
});

describe('廃れた塔の敵と素材', () => {
  it('敵4種がプランの表どおり', () => {
    const pick = (id: string) => {
      const e = ENEMY[id];
      return e && [e.name, e.hp, e.atk, e.def, e.mag, e.spd, e.exp, e.ai];
    };
    expect(pick('ghoul')).toEqual(['グール', 90, 40, 12, 0, 7, 14, 'weakest']);
    expect(pick('gargoyle')).toEqual(['ガーゴイル', 140, 46, 22, 0, 6, 22, 'strongest']);
    expect(pick('wisp')).toEqual(['鬼火', 40, 36, 4, 0, 20, 10, 'random']);
    expect(pick('tower_keeper')).toEqual(['塔の番人', 700, 52, 26, 0, 8, 120, 'strongest']);
    expect(ENEMY.ghoul.loot).toEqual([{ item: 'ancient_cloth', chance: 0.5 }]);
    expect(ENEMY.gargoyle.loot).toEqual([{ item: 'crystal', chance: 0.3 }]);
    expect(ENEMY.gargoyle.resist).toEqual({ thunder: 0.5, earth: 0.5 });
    expect(ENEMY.wisp.element).toBe('fire');
    expect(ENEMY.wisp.loot).toEqual([{ item: 'wisp_ember', chance: 0.6 }]);
    expect(ENEMY.wisp.resist).toEqual({ fire: 0.8, ice: -0.5 });
    expect(ENEMY.tower_keeper.symbol).toBe(true);
    expect(ENEMY.tower_keeper.element).toBe('earth');
    expect(ENEMY.tower_keeper.resist).toEqual({ earth: 0.5 });
    expect(ENEMY.tower_keeper.loot).toEqual([{ item: 'crystal', chance: 1 }, { item: 'ancient_cloth', chance: 1 }]);
    expect(ENEMY.tower_keeper.skill).toEqual({ name: '崩落', mult: 1.3, cd: 3, aoe: true });
  });
  it('素材3種がプランの表どおり', () => {
    const pick = (id: string) => {
      const it = ITEM[id];
      return it && [it.name, it.kind, it.price, it.weight, it.source];
    };
    expect(pick('ancient_cloth')).toEqual(['古布', 'material', 28, 1, 'ruined_tower']);
    expect(pick('crystal')).toEqual(['水晶', 'material', 60, 2, 'ruined_tower']);
    expect(pick('wisp_ember')).toEqual(['鬼火の残り火', 'material', 45, 1, undefined]);
  });
});

// ヘルパを中に閉じるのは、並行して足される他の describe と名前がぶつからないように
describe('フェーズ6のダンジョン', () => {
  type Grid = ReturnType<typeof parseFloor>;
  const gridOf = (dungeonId: string, floorId: string) =>
    parseFloor(DUNGEON[dungeonId].floors.find((f) => f.id === floorId)!);
  const cellsOf = (g: Grid, kind: CellKind) => g.cells.map((c, i) => (c.kind === kind ? i : -1)).filter((i) => i >= 0);
  const passable = (g: Grid) => g.cells.map((c, i) => (c.kind === 'wall' ? -1 : i)).filter((i) => i >= 0);
  const allKnown = (g: Grid) => new Set(g.cells.map((_, i) => i));
  const know = (g: Grid, keys: string[], hidden: boolean): PassKnowledge =>
    ({ keys, hiddenFound: hidden ? cellsOf(g, 'hidden') : [] });
  const stepsTo = (g: Grid, to: number, k: PassKnowledge) => {
    const p = shortestPath(g, g.entrance, to, allKnown(g), k);
    return p ? p.length - 1 : null;
  };
  const tally = (g: Grid, kind: CellKind, key: 'item' | 'enemy' | 'trap' | 'key') =>
    cellsOf(g, kind).map((i) => g.cells[i][key]).sort();
  function reachableAvoiding(g: Grid, avoid: number, k: PassKnowledge): Set<number> {
    const seen = new Set([g.entrance]);
    const queue = [g.entrance];
    while (queue.length > 0) {
      for (const n of neighbors(g, queue.shift()!, k)) {
        if (n === avoid || seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    return seen;
  }
  function expectLinkedStairs(dungeonId: string) {
    const f1 = gridOf(dungeonId, 'f1');
    const f2 = gridOf(dungeonId, 'f2');
    const down = cellsOf(f1, 'stairs_down')[0];
    const up = cellsOf(f2, 'stairs_up')[0];
    expect(f1.cells[down].to).toEqual({ floor: 'f2', ...xy(f2, up) });
    expect(f2.cells[up].to).toEqual({ floor: 'f1', ...xy(f1, down) });
    expect(neighbors(f2, up, none)).toContain(f2.entrance);
  }
  function expectBetween(n: number | null, lo: number, hi: number, label: string) {
    expect(n, label).not.toBeNull();
    expect(n!, label).toBeGreaterThanOrEqual(lo);
    expect(n!, label).toBeLessThanOrEqual(hi);
  }

  describe('frost_valley', () => {
    const g = () => gridOf('frost_valley', 'f1');

    it('フロア f1 が1枚、16×16、通行可能マスは110〜130', () => {
      expect(DUNGEON.frost_valley.floors.map((f) => f.id)).toEqual(['f1']);
      expect([g().width, g().height]).toEqual([16, 16]);
      expectBetween(passable(g()).length, 110, 130, '通行可能');
    });
    it('マスの内訳がプラン通り', () => {
      const count = (kind: CellKind) => cellsOf(g(), kind).length;
      expect(count('entrance')).toBe(1);
      expect(count('stairs_down') + count('stairs_up') + count('door') + count('boss')).toBe(0);
      expect(tally(g(), 'nest', 'enemy')).toEqual(['frost_wolf', 'frost_wolf', 'ice_imp', 'snow_beast']);
      expect(tally(g(), 'gather', 'item')).toEqual(['frost_iron', 'frost_iron', 'ice_shard', 'ice_shard', 'snow_pelt']);
      expect(tally(g(), 'symbol', 'enemy')).toEqual(['frost_giant']);
      expect(tally(g(), 'treasure', 'item')).toEqual([undefined, undefined]);
      expect(tally(g(), 'trap', 'trap')).toEqual(['ice', 'ice', 'ice']);
      expect(count('hidden')).toBe(3);
    });
    it('隠し通路を開ければ全マスへ、閉じていても symbol へ到達できる', () => {
      for (const i of passable(g())) expect(stepsTo(g(), i, know(g(), [], true)), `${i}`).not.toBeNull();
      expect(stepsTo(g(), cellsOf(g(), 'symbol')[0], know(g(), [], false))).not.toBeNull();
    });
    it('入口から symbol まで 30〜36歩。隠し通路(3マス一続き)はその近道', () => {
      const symbol = cellsOf(g(), 'symbol')[0];
      const closed = stepsTo(g(), symbol, know(g(), [], false));
      expectBetween(closed, 30, 36, '閉');
      const path = shortestPath(g(), g().entrance, symbol, allKnown(g()), know(g(), [], true))!;
      expect(path.length - 1).toBeLessThan(closed!);
      expect(cellsOf(g(), 'hidden').every((h) => path.includes(h))).toBe(true);
    });
    it('出現敵・推奨戦力・救助費用・遭遇率', () => {
      const d = DUNGEON.frost_valley;
      expect(d.node).toBe('frost_valley');
      expect(d.enemies.map((e) => e.id)).toEqual(['frost_wolf', 'ice_imp', 'snow_beast']);
      expect([d.recommended, d.rescueCost, d.encounterRate]).toEqual([640, 600, 0.05]);
    });
  });

  describe('sunken_ruins', () => {
    const f1 = () => gridOf('sunken_ruins', 'f1');
    const f2 = () => gridOf('sunken_ruins', 'f2');
    const withKey = (g: Grid) => know(g, ['ruin_key'], true);

    it('フロア f1 / f2、どちらも 16×16。通行可能マスは f1 100〜120 / f2 80〜100', () => {
      expect(DUNGEON.sunken_ruins.floors.map((f) => f.id)).toEqual(['f1', 'f2']);
      for (const g of [f1(), f2()]) expect([g.width, g.height]).toEqual([16, 16]);
      expectBetween(passable(f1()).length, 100, 120, 'f1');
      expectBetween(passable(f2()).length, 80, 100, 'f2');
    });
    it('f1 のマスの内訳がプラン通り', () => {
      const g = f1();
      const count = (kind: CellKind) => cellsOf(g, kind).length;
      expect(count('entrance')).toBe(1);
      expect(count('stairs_down')).toBe(1);
      expect(count('stairs_up') + count('symbol') + count('boss') + count('hidden')).toBe(0);
      expect(tally(g, 'door', 'key')).toEqual(['ruin_key']);
      expect(tally(g, 'nest', 'enemy')).toEqual(['drowned', 'drowned', 'wraith']);
      expect(tally(g, 'gather', 'item')).toEqual(['moon_stone', 'old_coin', 'relic_shard', 'relic_shard']);
      expect(tally(g, 'treasure', 'item')).toEqual([undefined, undefined]);
      expect(tally(g, 'trap', 'trap')).toEqual(['flood', 'flood', 'flood']);
    });
    it('f1: 鍵が無いと下り階段に届かず、ruin_key があれば全マスへ届く', () => {
      const g = f1();
      expect(stepsTo(g, cellsOf(g, 'stairs_down')[0], know(g, [], true))).toBeNull();
      for (const i of passable(g)) expect(stepsTo(g, i, withKey(g)), `${i}`).not.toBeNull();
    });
    it('f1: 扉は入口から階段へ行く途中の中ほど。鍵が無くても手前の5〜8割は歩ける', () => {
      const g = f1();
      const door = cellsOf(g, 'door')[0];
      const stairs = cellsOf(g, 'stairs_down')[0];
      const path = shortestPath(g, g.entrance, stairs, allKnown(g), withKey(g))!;
      expect(path).toContain(door);
      const ratio = path.indexOf(door) / (path.length - 1);
      expect(ratio).toBeGreaterThanOrEqual(0.3);
      expect(ratio).toBeLessThanOrEqual(0.7);
      const front = passable(g).filter((i) => stepsTo(g, i, know(g, [], true)) !== null).length;
      expectBetween(front / passable(g).length, 0.5, 0.8, '手前の割合');
    });
    it('f2 のマスの内訳がプラン通り', () => {
      const g = f2();
      const count = (kind: CellKind) => cellsOf(g, kind).length;
      expect(count('entrance')).toBe(1);
      expect(count('stairs_up')).toBe(1);
      expect(count('stairs_down') + count('door') + count('boss') + count('hidden')).toBe(0);
      expect(tally(g, 'nest', 'enemy')).toEqual(['stone_sentinel', 'stone_sentinel', 'wraith']);
      expect(tally(g, 'gather', 'item')).toEqual(['moon_stone', 'old_coin', 'relic_shard']);
      expect(tally(g, 'symbol', 'enemy')).toEqual(['ruin_warden']);
      expect(tally(g, 'treasure', 'item')).toEqual(['dragon_crest']);
      expect(tally(g, 'trap', 'trap')).toEqual(['flood', 'flood']);
    });
    it('f2: 入口から全マスへ届き、dragon_crest は守護像を越えたすぐ奥(守護像を避けると届かない)', () => {
      const g = f2();
      for (const i of passable(g)) expect(stepsTo(g, i, none), `${i}`).not.toBeNull();
      const symbol = cellsOf(g, 'symbol')[0];
      const crest = cellsOf(g, 'treasure')[0];
      expect(reachableAvoiding(g, symbol, none).has(crest)).toBe(false);
      expectBetween(stepsTo(g, crest, none)! - stepsTo(g, symbol, none)!, 1, 3, '守護像から紋章');
    });
    it('階段の to が互いを指し、f2 の入口は上り階段の隣', () => {
      expectLinkedStairs('sunken_ruins');
    });
    it('出現敵・推奨戦力・救助費用・遭遇率', () => {
      const d = DUNGEON.sunken_ruins;
      expect(d.node).toBe('sunken_ruins');
      expect(d.enemies.map((e) => e.id)).toEqual(['drowned', 'stone_sentinel', 'wraith']);
      expect([d.recommended, d.rescueCost, d.encounterRate]).toEqual([780, 800, 0.05]);
    });
  });

  describe('dragon_lair', () => {
    const f1 = () => gridOf('dragon_lair', 'f1');
    const f2 = () => gridOf('dragon_lair', 'f2');

    it('フロア f1 / f2、どちらも 16×16。通行可能マスは f1 90〜110 / f2 70〜90', () => {
      expect(DUNGEON.dragon_lair.floors.map((f) => f.id)).toEqual(['f1', 'f2']);
      for (const g of [f1(), f2()]) expect([g.width, g.height]).toEqual([16, 16]);
      expectBetween(passable(f1()).length, 90, 110, 'f1');
      expectBetween(passable(f2()).length, 70, 90, 'f2');
    });
    it('f1 のマスの内訳がプラン通り', () => {
      const g = f1();
      const count = (kind: CellKind) => cellsOf(g, kind).length;
      expect(count('entrance')).toBe(1);
      expect(count('stairs_down')).toBe(1);
      expect(count('stairs_up') + count('symbol') + count('boss') + count('hidden') + count('treasure')).toBe(0);
      expect(tally(g, 'door', 'key')).toEqual(['dragon_crest']);
      expect(tally(g, 'nest', 'enemy')).toEqual(['drake', 'fire_imp', 'fire_imp', 'magma_slug']);
      expect(tally(g, 'gather', 'item')).toEqual(['ember_fang', 'ember_fang', 'magma_core', 'magma_core']);
      expect(tally(g, 'trap', 'trap')).toEqual(['flame', 'flame', 'flame']);
    });
    it('f1: 鍵が無いと下り階段に届かず、dragon_crest があれば全マスへ届く。扉は階段への途中', () => {
      const g = f1();
      const stairs = cellsOf(g, 'stairs_down')[0];
      expect(stepsTo(g, stairs, none)).toBeNull();
      const withKey = know(g, ['dragon_crest'], true);
      for (const i of passable(g)) expect(stepsTo(g, i, withKey), `${i}`).not.toBeNull();
      expect(shortestPath(g, g.entrance, stairs, allKnown(g), withKey)).toContain(cellsOf(g, 'door')[0]);
    });
    it('f2 のマスの内訳がプラン通り', () => {
      const g = f2();
      const count = (kind: CellKind) => cellsOf(g, kind).length;
      expect(count('entrance')).toBe(1);
      expect(count('stairs_up')).toBe(1);
      expect(count('stairs_down') + count('door') + count('symbol') + count('hidden') + count('gather') + count('trap')).toBe(0);
      expect(tally(g, 'nest', 'enemy')).toEqual(['drake', 'fire_imp', 'magma_slug']);
      expect(tally(g, 'boss', 'enemy')).toEqual(['dragon']);
      expect(tally(g, 'treasure', 'item')).toEqual([undefined]);
    });
    it('f2: 入口から全マスへ届き、竜は最奥で 28〜34歩', () => {
      const g = f2();
      const dist = passable(g).map((i) => stepsTo(g, i, none));
      expect(dist.every((d) => d !== null)).toBe(true);
      const boss = stepsTo(g, cellsOf(g, 'boss')[0], none);
      expectBetween(boss, 28, 34, '竜まで');
      expect(boss).toBe(Math.max(...(dist as number[])));
    });
    it('階段の to が互いを指し、f2 の入口は上り階段の隣', () => {
      expectLinkedStairs('dragon_lair');
    });
    it('出現敵・推奨戦力・救助費用・遭遇率', () => {
      const d = DUNGEON.dragon_lair;
      expect(d.node).toBe('dragon_lair');
      expect(d.enemies.map((e) => e.id)).toEqual(['fire_imp', 'magma_slug', 'drake']);
      expect([d.recommended, d.rescueCost, d.encounterRate]).toEqual([1100, 1500, 0.05]);
    });
  });
});

describe('フェーズ6の敵と素材', () => {
  const pick = (id: string) => {
    const e = ENEMY[id];
    return e && [e.name, e.hp, e.atk, e.def, e.mag, e.spd, e.ai, e.element];
  };
  it('敵12体の能力値と属性がプランの表どおり', () => {
    expect(pick('frost_wolf')).toEqual(['霜狼', 130, 52, 14, 0, 16, 'weakest', 'ice']);
    expect(pick('ice_imp')).toEqual(['氷の小鬼', 80, 48, 8, 0, 18, 'random', 'ice']);
    expect(pick('snow_beast')).toEqual(['雪獣', 220, 58, 20, 0, 8, 'strongest', 'ice']);
    expect(pick('frost_giant')).toEqual(['霜の巨人', 950, 66, 30, 0, 7, 'strongest', 'ice']);
    expect(pick('drowned')).toEqual(['溺れた亡者', 160, 56, 12, 0, 6, 'random', 'dark']);
    expect(pick('stone_sentinel')).toEqual(['石の歩哨', 260, 60, 32, 0, 5, 'strongest', 'earth']);
    expect(pick('wraith')).toEqual(['水霊', 110, 64, 6, 0, 20, 'weakest', 'dark']);
    // 2026-10-10 ボス戦の計測(scripts/boss.ts)で、基準の隊が G4 装備で勝率70%に届く Lv が 13 になる値
    expect(pick('ruin_warden')).toEqual(['遺跡の守護像', 1050, 70, 32, 0, 8, 'strongest', 'earth']);
    expect(pick('drake')).toEqual(['幼竜', 380, 78, 26, 0, 14, 'strongest', 'fire']);
    expect(pick('fire_imp')).toEqual(['火の小鬼', 120, 70, 10, 0, 22, 'random', 'fire']);
    expect(pick('magma_slug')).toEqual(['溶岩ナメクジ', 300, 62, 28, 0, 4, 'random', 'fire']);
    // 同じく G4 装備で Lv18(G3 で 21、装備の弱い G2 では 27 = 火耐性の装備が実質必須)
    expect(pick('dragon')).toEqual(['竜', 2200, 84, 32, 0, 12, 'strongest', 'fire']);
  });
  it('耐性・技・シンボルとボス', () => {
    expect(ENEMY.frost_giant.resist).toEqual({ ice: 0.8, fire: -0.4 });
    expect(ENEMY.stone_sentinel.resist).toEqual({ earth: 0.5 });
    expect(ENEMY.wraith.resist).toEqual({ dark: 0.6, ice: 0.3 });
    expect(ENEMY.drake.resist).toEqual({ fire: 0.7, ice: -0.3 });
    expect(ENEMY.fire_imp.resist).toEqual({ fire: 0.8 });
    expect(ENEMY.dragon.resist).toEqual({ fire: 0.9, ice: -0.3 });
    expect(ENEMY.frost_giant.skill).toEqual({ name: '氷塊投げ', mult: 1.4, cd: 3, aoe: true });
    expect(ENEMY.ruin_warden.skill).toEqual({ name: '崩落', mult: 1.4, cd: 3, aoe: true });
    expect(ENEMY.dragon.skill).toEqual({ name: '灼熱のブレス', mult: 1.5, cd: 3, aoe: true });
    expect([ENEMY.frost_giant.symbol, ENEMY.ruin_warden.symbol, ENEMY.dragon.boss]).toEqual([true, true, true]);
    expect(ENEMY.dragon.symbol ?? false).toBe(false);
    expect(ENEMY.dragon.loot).toEqual([{ item: 'dragon_scale', chance: 1 }]);
  });
  it('雑魚の落とし物はそのダンジョンの素材', () => {
    const drops = (id: string) => ENEMY[id].loot.map((l) => l.item);
    expect(drops('frost_wolf')).toEqual(['snow_pelt']);
    expect(drops('ice_imp')).toEqual(['ice_shard']);
    expect(drops('snow_beast')).toEqual(['snow_pelt', 'frost_iron']);
    expect(drops('drowned')).toEqual(['old_coin']);
    expect(drops('stone_sentinel')).toEqual(['relic_shard']);
    expect(drops('wraith')).toEqual(['moon_stone']);
    expect(drops('drake')).toEqual(['ember_fang']);
    expect(drops('magma_slug')).toEqual(['magma_core']);
    for (const id of ['frost_giant', 'ruin_warden']) expect(ENEMY[id].loot.every((l) => l.chance === 1), id).toBe(true);
  });
  it('素材9種・鍵2種・建材2種がプランの表どおり', () => {
    const item = (id: string) => {
      const it = ITEM[id];
      return it && [it.name, it.kind, it.price, it.weight, it.source];
    };
    expect(item('frost_iron')).toEqual(['霜鉄', 'material', 70, 2, 'frost_valley']);
    expect(item('ice_shard')).toEqual(['氷片', 'material', 45, 1, 'frost_valley']);
    expect(item('snow_pelt')).toEqual(['雪獣の毛皮', 'material', 55, 1, 'frost_valley']);
    expect(item('relic_shard')).toEqual(['遺物の欠片', 'material', 90, 1, 'sunken_ruins']);
    expect(item('old_coin')).toEqual(['古銭', 'material', 70, 1, 'sunken_ruins']);
    expect(item('moon_stone')).toEqual(['月長石', 'material', 120, 1, 'sunken_ruins']);
    expect(item('ember_fang')).toEqual(['熾火の牙', 'material', 95, 1, 'dragon_lair']);
    expect(item('magma_core')).toEqual(['溶岩核', 'material', 140, 2, 'dragon_lair']);
    expect(item('dragon_scale')).toEqual(['竜の鱗', 'material', 400, 2, undefined]);
    expect(item('ruin_key')).toEqual(['遺跡の鍵', 'key', 0, 0, undefined]);
    expect(item('dragon_crest')).toEqual(['竜の紋章', 'key', 0, 0, undefined]);
    expect(item('lumber')).toEqual(['木材', 'building', 0, 0, undefined]);
    expect(item('stone')).toEqual(['石材', 'building', 0, 0, undefined]);
  });
});
