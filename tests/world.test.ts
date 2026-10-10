import { describe, expect, it } from 'vitest';
import { DUNGEON, EDGE, NODE, WORLD } from '../src/core/data';
import { rngFor } from '../src/core/rng';
import { edgeBetween, planSteps, route, simulateTravel, travelDays } from '../src/core/world';
import type { Adventurer, Stats } from '../src/core/types';

// テストリスト
// - [x] world.json: ノード12・道12、道ID は <a>__<b>、近道は hidden、噂のダンジョン、街の掲示板上限
// - [x] フェーズ6: 谷・遺跡・高山の関・寝床のノードと道4本。拠点→谷4日・遺跡3日・寝床3日
// - [x] travelDays: 既知の道だけで最短日数。hidden は found のときだけ
// - [x] route: hidden の有無で経路(通る道)が変わる
// - [x] edgeBetween: 2本ある区間は使える中で速い道
// - [x] planSteps: 日付が連続、days=0 の道は同日、帰着日 = 出発 + 往路 + 滞在 + 復路
// - [x] simulateTravel: 遭遇回数が danger に比例、斥候で×0.7、全滅で止まる、決定論

const known = { foundEdges: [] as string[] };
const withShort = { foundEdges: ['mountain_village__old_mine_short'] };

const stats = (v: Partial<Stats> = {}): Stats => ({ hp: 100, atk: 20, def: 10, mag: 10, spd: 10, dex: 10, scout: 10, gather: 10, ...v });

function adv(id: string, job: string, v: Partial<Stats> = {}): Adventurer {
  return {
    id, name: id, age: 20, level: 1, exp: 0, job, base: stats(v),
    apt: { attacker: 100, tank: 100, healer: 100, scout: 100, gatherer: 100 }, growth: 1,
    personality: 'cautious', traits: [], fatigue: 0, injuryDays: 0, salary: 10, loyalty: 50,
    status: 'idle', assignment: null, equipment: { weapon: null, armor: null, accessory: null }, skills: [],
    persona: { hobby: '', talent: '', likes: '', dislikes: '' },
    history: { hiredDay: 0, expeditions: 0, kills: 0, visits: {}, raisesRefused: 0, warnedDay: null },
  };
}

/** 道中の敵に負けない隊(遭遇回数だけを数えたいとき) */
const strong = (job = 'fighter') => [adv('s1', job, { hp: 2000, atk: 400, def: 200, spd: 60 })];
/** すぐ倒れる隊 */
const weak = () => [adv('w1', 'fighter', { hp: 20, atk: 3, def: 0, spd: 1 })];

describe('world.json', () => {
  it('ノード12・道12本がプランの表どおり', () => {
    expect(WORLD.nodes.map((n) => n.id).sort()).toEqual([
      'academy_town', 'base', 'camp_north', 'dragon_lair', 'forest_cave', 'forge_town', 'frost_valley', 'high_pass',
      'mountain_village', 'old_mine', 'ruined_tower', 'sunken_ruins',
    ]);
    const e = (id: string) => [EDGE[id]?.days, EDGE[id]?.danger, EDGE[id]?.hidden ?? false];
    expect(e('base__forest_cave')).toEqual([0, 0.05, false]);
    expect(e('base__mountain_village')).toEqual([1, 0.15, false]);
    expect(e('mountain_village__old_mine')).toEqual([1, 0.25, false]);
    expect(e('base__forge_town')).toEqual([2, 0.2, false]);
    expect(e('forge_town__ruined_tower')).toEqual([1, 0.35, false]);
    expect(e('base__camp_north')).toEqual([1, 0.1, false]);
    expect(e('academy_town__camp_north')).toEqual([1, 0.1, false]);
    expect(e('mountain_village__old_mine_short')).toEqual([0, 0.3, true]);
    expect(e('academy_town__sunken_ruins')).toEqual([1, 0.3, false]);
    expect(e('academy_town__frost_valley')).toEqual([2, 0.35, false]);
    expect(e('high_pass__mountain_village')).toEqual([1, 0.3, false]);
    expect(e('dragon_lair__high_pass')).toEqual([1, 0.5, false]);
    expect(WORLD.edges).toHaveLength(12);
  });
  it('道の ID は両端をアルファベット順に並べたもの(近道は _short)、両端は実在するノード', () => {
    for (const e of WORLD.edges) {
      expect(NODE[e.a], e.id).toBeDefined();
      expect(NODE[e.b], e.id).toBeDefined();
      expect(e.a < e.b, e.id).toBe(true);
      expect(e.id.replace(/_short$/, '')).toBe(`${e.a}__${e.b}`);
    }
  });
  it('ダンジョンのノードはダンジョンを指し、森の洞窟以外は噂', () => {
    for (const n of WORLD.nodes.filter((x) => x.kind === 'dungeon')) {
      expect(DUNGEON[n.dungeon!], n.id).toBeDefined();
      expect(DUNGEON[n.dungeon!].node, n.id).toBe(n.id);
    }
    expect(NODE.forest_cave.dungeon).toBe('forest_cave');
    expect(NODE.forest_cave.rumored ?? false).toBe(false);
    for (const id of ['old_mine', 'ruined_tower', 'frost_valley', 'sunken_ruins', 'dragon_lair']) {
      expect(NODE[id].dungeon, id).toBe(id);
      expect(NODE[id].rumored, id).toBe(true);
    }
  });
  it('種類と座標', () => {
    const k = (id: string) => [NODE[id].kind, NODE[id].x, NODE[id].y];
    expect(k('base')).toEqual(['base', 5, 5]);
    expect(k('forest_cave')).toEqual(['dungeon', 5, 7]);
    expect(k('mountain_village')).toEqual(['village', 2, 5]);
    expect(k('old_mine')).toEqual(['dungeon', 1, 7]);
    expect(k('forge_town')).toEqual(['town', 8, 5]);
    expect(k('ruined_tower')).toEqual(['dungeon', 9, 2]);
    expect(k('camp_north')).toEqual(['waypoint', 5, 3]);
    expect(k('academy_town')).toEqual(['town', 5, 1]);
    expect(k('sunken_ruins')).toEqual(['dungeon', 3, 1]);
    expect(k('frost_valley')).toEqual(['dungeon', 7, 0]);
    expect(k('high_pass')).toEqual(['waypoint', 2, 3]);
    expect(k('dragon_lair')).toEqual(['dungeon', 2, 1]);
  });
  it('掲示板の上限は拠点4・街3・村2、依頼の重みを持つ', () => {
    expect(NODE.base.town!.boardMax).toBe(4);
    expect(NODE.forge_town.town!.boardMax).toBe(3);
    expect(NODE.academy_town.town!.boardMax).toBe(3);
    expect(NODE.mountain_village.town!.boardMax).toBe(2);
    expect(NODE.base.town!.questWeights.escort).toBeGreaterThan(0);
    expect(NODE.forge_town.town!.questWeights.hunt).toBeGreaterThan(0);
    expect(NODE.academy_town.town!.questWeights.explore).toBeGreaterThan(0);
    expect(NODE.mountain_village.town!.questWeights.transport).toBeGreaterThan(0);
    for (const id of ['forest_cave', 'old_mine', 'ruined_tower', 'camp_north', 'sunken_ruins', 'frost_valley', 'high_pass', 'dragon_lair']) {
      expect(NODE[id].town, id).toBeUndefined();
    }
  });
});

describe('travelDays / route', () => {
  it('最短日数(拠点から各地)', () => {
    expect(travelDays('base', 'base', known)).toBe(0);
    expect(travelDays('base', 'forest_cave', known)).toBe(0);
    expect(travelDays('base', 'mountain_village', known)).toBe(1);
    expect(travelDays('base', 'old_mine', known)).toBe(2);
    expect(travelDays('base', 'forge_town', known)).toBe(2);
    expect(travelDays('base', 'ruined_tower', known)).toBe(3);
    expect(travelDays('base', 'academy_town', known)).toBe(2);
    expect(travelDays('ruined_tower', 'academy_town', known)).toBe(5);
    expect(travelDays('base', 'frost_valley', known)).toBe(4);
    expect(travelDays('base', 'sunken_ruins', known)).toBe(3);
    expect(travelDays('base', 'dragon_lair', known)).toBe(3);
    expect(travelDays('base', 'high_pass', known)).toBe(2);
  });
  it('新しいダンジョンへの経路(谷・遺跡は学院の街、寝床は山村と高山の関を通る)', () => {
    expect(route('base', 'frost_valley', known)).toEqual(['base', 'camp_north', 'academy_town', 'frost_valley']);
    expect(route('base', 'sunken_ruins', known)).toEqual(['base', 'camp_north', 'academy_town', 'sunken_ruins']);
    expect(route('base', 'dragon_lair', known)).toEqual(['base', 'mountain_village', 'high_pass', 'dragon_lair']);
  });
  it('経路はノード列(両端を含む)', () => {
    expect(route('base', 'ruined_tower', known)).toEqual(['base', 'forge_town', 'ruined_tower']);
    expect(route('academy_town', 'old_mine', known)).toEqual(['academy_town', 'camp_north', 'base', 'mountain_village', 'old_mine']);
    expect(route('base', 'base', known)).toEqual(['base']);
  });
  it('存在しないノードは null', () => {
    expect(travelDays('base', 'nowhere', known)).toBeNull();
    expect(route('base', 'nowhere', known)).toBeNull();
  });
  it('隠し道は見つけたときだけ使い、経路(通る道)が変わる', () => {
    expect(travelDays('base', 'old_mine', withShort)).toBe(1);
    const r = route('base', 'old_mine', withShort)!;
    expect(r).toEqual(['base', 'mountain_village', 'old_mine']);
    expect(edgeBetween('mountain_village', 'old_mine', known)!.id).toBe('mountain_village__old_mine');
    expect(edgeBetween('mountain_village', 'old_mine', withShort)!.id).toBe('mountain_village__old_mine_short');
    const shortSteps = planSteps(r, 0, 1, withShort).filter((s) => s.phase === 'outbound').map((s) => s.edge);
    const longSteps = planSteps(r, 0, 1, known).filter((s) => s.phase === 'outbound').map((s) => s.edge);
    expect(shortSteps).toEqual(['base__mountain_village', 'mountain_village__old_mine_short']);
    expect(longSteps).toEqual(['base__mountain_village', 'mountain_village__old_mine']);
  });
  it('edgeBetween は向きを問わず、つながっていなければ null', () => {
    expect(edgeBetween('forge_town', 'base', known)!.id).toBe('base__forge_town');
    expect(edgeBetween('base', 'ruined_tower', known)).toBeNull();
  });
});

describe('planSteps', () => {
  const contiguous = (days: number[]) => days.every((d, i) => i === 0 || d - days[i - 1] === 0 || d - days[i - 1] === 1);

  it('塔: 往路3日・滞在3日・復路3日。日付が連続し、最後は拠点に帰着', () => {
    const steps = planSteps(route('base', 'ruined_tower', known)!, 3, 10, known);
    expect(steps.map((s) => s.day)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(steps.map((s) => s.phase)).toEqual([
      'outbound', 'outbound', 'outbound', 'stay', 'stay', 'stay', 'return', 'return', 'return', 'return',
    ]);
    expect(steps.map((s) => s.edge ?? s.node)).toEqual([
      'base__forge_town', 'base__forge_town', 'forge_town__ruined_tower',
      'ruined_tower', 'ruined_tower', 'ruined_tower',
      'forge_town__ruined_tower', 'base__forge_town', 'base__forge_town', 'base',
    ]);
    for (const s of steps) expect((s.node === null) !== (s.edge === null)).toBe(true);
    expect(steps.at(-1)!.day).toBe(10 + 3 + 3 + 3);
  });
  it('days=0 の道は同日。森の洞窟は出発日から滞在', () => {
    const steps = planSteps(['base', 'forest_cave'], 3, 10, known);
    expect(steps.map((s) => [s.day, s.edge ?? s.node, s.phase])).toEqual([
      [10, 'base__forest_cave', 'outbound'],
      [10, 'forest_cave', 'stay'],
      [11, 'forest_cave', 'stay'],
      [12, 'forest_cave', 'stay'],
      [13, 'base__forest_cave', 'return'],
      [13, 'base', 'return'],
    ]);
    expect(contiguous(steps.map((s) => s.day))).toBe(true);
  });
  it('近道(0日)を挟んでも日付が連続する', () => {
    const steps = planSteps(['base', 'mountain_village', 'old_mine'], 2, 5, withShort);
    expect(contiguous(steps.map((s) => s.day))).toBe(true);
    expect(steps[0].day).toBe(5);
    expect(steps.at(-1)!.day).toBe(5 + 1 + 2 + 1);
  });
  it('移動しない経路は帰着だけ', () => {
    expect(planSteps(['base'], 0, 3, known)).toEqual([{ day: 3, node: 'base', edge: null, phase: 'return' }]);
  });
});

describe('simulateTravel', () => {
  const count = (path: string[], members: Adventurer[], n: number, tag: string) => {
    let total = 0;
    for (let i = 0; i < n; i++) total += simulateTravel(rngFor(7, tag, i), members, path, 'outbound', known).encounters;
    return total;
  };

  it('1日ごとの遭遇は danger に比例する(固定seed・1000回)', () => {
    const low = count(['base', 'camp_north'], strong(), 1000, 'low'); // 0.1
    const mid = count(['base', 'mountain_village'], strong(), 1000, 'mid'); // 0.15
    const high = count(['forge_town', 'ruined_tower'], strong(), 1000, 'high'); // 0.35
    expect(low).toBeGreaterThan(70);
    expect(low).toBeLessThan(130);
    expect(mid).toBeGreaterThan(115);
    expect(mid).toBeLessThan(185);
    expect(high).toBeGreaterThan(310);
    expect(high).toBeLessThan(390);
  });
  it('2日の道は1日ごとに引く', () => {
    const two = count(['base', 'forge_town'], strong(), 1000, 'two'); // 0.2 × 2日
    expect(two).toBeGreaterThan(350);
    expect(two).toBeLessThan(450);
  });
  it('days=0 の道では遭遇しない', () => {
    expect(count(['base', 'forest_cave'], strong(), 200, 'zero')).toBe(0);
  });
  it('斥候役がいると遭遇が ×0.7', () => {
    const plain = count(['forge_town', 'ruined_tower'], strong(), 1000, 'sc');
    const scouted = count(['forge_town', 'ruined_tower'], strong('scout'), 1000, 'sc');
    expect(scouted / plain).toBeGreaterThan(0.6);
    expect(scouted / plain).toBeLessThan(0.8);
  });
  it('遭遇した道中の戦闘はログに「道中」として載り、kills を数える', () => {
    for (let i = 0; i < 50; i++) {
      const r = simulateTravel(rngFor(3, 'log', i), strong(), ['forge_town', 'ruined_tower'], 'outbound', known);
      if (r.encounters === 0) continue;
      expect(r.log.some((l) => l.text.includes('道中'))).toBe(true);
      expect(Object.values(r.kills).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
      // 塔の隣の道は塔の敵が出る
      for (const k of Object.keys(r.kills)) expect(DUNGEON.ruined_tower.enemies.map((e) => e.id)).toContain(k);
      return;
    }
    throw new Error('遭遇が1回も無かった');
  });
  it('ダンジョンに接しない道は goblin / wolf', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const r = simulateTravel(rngFor(4, 'def', i), strong(), ['base', 'forge_town'], 'outbound', known);
      for (const k of Object.keys(r.kills)) seen.add(k);
    }
    expect([...seen].sort()).toEqual(['goblin', 'wolf']);
  });
  it('全滅したらそこで止まり、負傷・救助費用(50×道の日数)・素材は持ち帰れない', () => {
    for (let i = 0; i < 300; i++) {
      const r = simulateTravel(rngFor(5, 'wipe', i), weak(), ['base', 'forge_town', 'ruined_tower'], 'outbound', known);
      if (!r.wiped) continue;
      expect(r.wipedAt).not.toBeNull();
      const { edge, day } = r.wipedAt!;
      expect(r.rescueCost).toBe(50 * EDGE[edge].days);
      expect(r.log.every((l) => l.day <= day)).toBe(true);
      expect(r.materials).toEqual({});
      expect(r.injuries.w1).toBeGreaterThan(0);
      expect(r.downed).toContain('w1');
      return;
    }
    throw new Error('全滅が起きなかった');
  });
  it('全滅しなければ wipedAt は null、救助費用 0', () => {
    const r = simulateTravel(rngFor(1, 'safe'), strong(), ['base', 'camp_north', 'academy_town'], 'outbound', known);
    expect(r.wiped).toBe(false);
    expect(r.wipedAt).toBeNull();
    expect(r.rescueCost).toBe(0);
    expect(r.fatigue.s1).toBeGreaterThan(0);
  });
  it('復路は経路を逆にたどる(塔→鍛冶の街の道が1日目)', () => {
    for (let i = 0; i < 100; i++) {
      const r = simulateTravel(rngFor(6, 'ret', i), strong(), ['base', 'forge_town', 'ruined_tower'], 'return', known);
      const first = r.log.find((l) => l.text.includes('道中'));
      if (!first || first.day !== 1) continue;
      expect(first.text).toContain('廃れた塔');
      return;
    }
    throw new Error('1日目の遭遇が無かった');
  });
  it('同じ seed なら同じ結果', () => {
    const a = simulateTravel(rngFor(9, 'det'), strong(), ['base', 'forge_town', 'ruined_tower'], 'outbound', known);
    const b = simulateTravel(rngFor(9, 'det'), strong(), ['base', 'forge_town', 'ruined_tower'], 'outbound', known);
    expect(a).toEqual(b);
  });
});

describe('simulateTravel の遭遇倍率(見張り台)', () => {
  const path = ['base', 'forge_town', 'ruined_tower'];

  it('省くと1と同じ結果。0なら一度も遭遇しない', () => {
    for (let i = 0; i < 20; i++) {
      const plain = simulateTravel(rngFor(21, 'mult', i), strong(), path, 'outbound', known);
      expect(simulateTravel(rngFor(21, 'mult', i), strong(), path, 'outbound', known, 1)).toEqual(plain);
      expect(simulateTravel(rngFor(21, 'mult', i), strong(), path, 'outbound', known, 0).encounters).toBe(0);
    }
  });

  it('倍率を下げると遭遇がおおむねその割合に減る(固定seed)', () => {
    let full = 0;
    let half = 0;
    for (let i = 0; i < 300; i++) {
      full += simulateTravel(rngFor(22, 'mult', i), strong(), path, 'outbound', known).encounters;
      half += simulateTravel(rngFor(22, 'mult', i), strong(), path, 'outbound', known, 0.5).encounters;
    }
    expect(full).toBeGreaterThan(50);
    expect(half / full).toBeGreaterThan(0.35);
    expect(half / full).toBeLessThan(0.65);
  });
});
