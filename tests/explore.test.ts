import { describe, expect, it } from 'vitest';
import { carryCapacity, generateAdventurer } from '../src/core/adventurer';
import { DUNGEON, ITEM, JOB, PERSONALITY } from '../src/core/data';
import { parseFloor } from '../src/core/dungeon';
import { cellDepths, runExploration, simulateExploration, type ExploreInput } from '../src/core/explore';
import { rngFor } from '../src/core/rng';
import type { Adventurer, DungeonDef, DungeonProgress } from '../src/core/types';

const CAVE = DUNGEON.forest_cave;
const GRID = parseFloor(CAVE.floors[0]);
const DEPTH = cellDepths(GRID);
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/** 固定4人(剣士・戦士・僧侶・斥候)。先頭が隊長 */
function party(seed: number, leaderPersonality: string, jobs = ['fighter', 'warrior', 'priest', 'scout']): Adventurer[] {
  return jobs.map((job, i) => {
    const a = generateAdventurer(rngFor(seed, 't', i), { id: `m${i}` });
    a.job = job;
    for (const r of JOB[job].roles) a.apt[r] = Math.max(a.apt[r], 70);
    a.personality = i === 0 ? leaderPersonality : 'caring';
    return a;
  });
}

function progressOf(visited: number[] = [], hiddenFound: number[] = [], floor = 'f1'): DungeonProgress {
  return { confirmed: true, floors: { [floor]: { visited, hiddenFound } }, bossDefeated: 0, fullCleared: false };
}

function input(seed: number, o: Partial<ExploreInput> & { leader?: string; jobs?: string[] } = {}): ExploreInput {
  const members = o.members ?? party(seed, o.leader ?? 'brave', o.jobs);
  return {
    rng: rngFor(seed, 'explore-test'),
    dungeon: CAVE, floorId: 'f1',
    members, leaderId: members[0].id, policy: 'standard',
    progress: progressOf(), days: 3, items: { potion: 1 }, relations: {}, startDay: 0,
    ...o,
  };
}

const weightOf = (mats: Record<string, number>) => Object.entries(mats).reduce((s, [k, n]) => s + ITEM[k].weight * n, 0);
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** 隠し通路を閉じたまま入口から d 歩以内の通れるマス(前回までに踏んだ想定) */
function knownWithin(d: number): number[] {
  const out: number[] = [];
  GRID.cells.forEach((c, i) => {
    if (c.kind !== 'wall' && c.kind !== 'hidden' && DEPTH[i] >= 0 && DEPTH[i] <= d) out.push(i);
  });
  return out;
}

function corridor(name: string, rows: string[], o: Partial<DungeonDef> = {}): DungeonDef {
  return {
    id: name, name, desc: '', node: name,
    floors: [{
      id: 'f1', name: '1階', rows,
      legend: {
        '#': { kind: 'wall' }, '.': { kind: 'floor' }, E: { kind: 'entrance' },
        m: { kind: 'gather', item: 'moss_ore' }, h: { kind: 'gather', item: 'herb' },
        w: { kind: 'nest', enemy: 'wolf' }, B: { kind: 'symbol', enemy: 'goblin_chief' },
      },
    }],
    enemies: [{ id: 'wolf', weight: 1, group: [1, 1] }],
    recommended: 100, rescueCost: 77, encounterRate: 0, ...o,
  };
}

describe('探索シミュレーション', () => {
  it('同じ入力なら同じ結果(決定論)', () => {
    const a = runExploration(input(7));
    const b = runExploration(input(7));
    expect(a).toEqual(b);
    expect(simulateExploration(input(7))).toEqual(a.result);
  });

  it('progress 引数は書き換えない', () => {
    const progress = progressOf(knownWithin(10), []);
    const before = structuredClone(progress);
    for (const seed of SEEDS.slice(0, 5)) runExploration(input(seed, { progress }));
    expect(progress).toEqual(before);
  });

  it('1日の歩数は 12×隊長の速度係数 に収まる', () => {
    for (const leader of ['cautious', 'brave']) {
      const budget = Math.round(12 * PERSONALITY[leader].explore.speed);
      for (const seed of SEEDS.slice(0, 8)) {
        const { trace } = runExploration(input(seed, { leader, days: 3 }));
        for (const d of trace.days) {
          expect(d.budget).toBe(budget);
          expect(d.used).toBeLessThanOrEqual(budget);
          expect(d.moves.reduce((s, m) => s + m.cost, 0)).toBeLessThanOrEqual(d.used);
          // 未踏は2歩なので、1日に新しく踏めるのは予算の半分まで
          expect(d.moves.filter((m) => m.cost === 2).length).toBeLessThanOrEqual(Math.floor(budget / 2));
        }
      }
    }
    expect(Math.round(12 * PERSONALITY.brave.explore.speed)).toBeGreaterThan(Math.round(12 * PERSONALITY.cautious.explore.speed));
  });

  it('未踏マスへの移動は2歩、既踏マスへは1歩', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const prior = knownWithin(8);
      const { trace } = runExploration(input(seed, { progress: progressOf(prior), days: 3 }));
      const stepped = new Set(prior);
      stepped.add(GRID.entrance);
      for (const d of trace.days) {
        for (const m of d.moves) {
          expect(m.cost).toBe(stepped.has(m.cell) ? 1 : 2);
          stepped.add(m.cell);
        }
      }
    }
  });

  it('地図を知っている方が同じ日数で奥へ届く', () => {
    const deep = (progress: DungeonProgress) =>
      avg(SEEDS.map((seed) => runExploration(input(seed, { progress, days: 2 })).trace.maxDepth));
    expect(deep(progressOf(knownWithin(14)))).toBeGreaterThan(deep(progressOf()));
  });

  it('最終日は入口に戻って終わる(全滅以外)', () => {
    for (const seed of SEEDS) {
      for (const days of [1, 2, 4]) {
        for (const leader of ['cautious', 'brave', 'timid', 'proud']) {
          const { result, trace } = runExploration(input(seed, { leader, days }));
          expect(trace.forcedReturn).toBe(false);
          if (!result.wiped) expect(trace.finalCell).toBe(GRID.entrance);
        }
      }
    }
  });

  it('慎重の隊長は勇敢より入口近くから埋める(新しく踏んだマスの平均深度が浅い)', () => {
    const meanDepth = (leader: string) =>
      avg(SEEDS.map((seed) => avg(runExploration(input(seed, { leader, days: 3 })).result.mapDeltas[0].cells.map((i) => DEPTH[i]))));
    expect(meanDepth('cautious')).toBeLessThan(meanDepth('brave'));
  });

  it('勇敢は既知の巣に寄り道する(地図を埋め終えても巣へ向かう)', () => {
    const all = GRID.cells.flatMap((c, i) => (c.kind !== 'wall' && c.kind !== 'hidden' ? [i] : []));
    const nestFights = (leader: string) =>
      SEEDS.filter((seed) => runExploration(input(seed, { leader, progress: progressOf(all), days: 3 }))
        .trace.events.some((e) => e.kind === 'nest' || e.kind === 'symbol')).length;
    expect(nestFights('brave')).toBeGreaterThan(nestFights('cautious'));
  });

  it('臆病は他の道があれば巣を踏まない', () => {
    const loop = corridor('loop', [
      '#########',
      '#...w...#',
      'E.#####.#',
      '#.......#',
      '#########',
    ]);
    const nest = parseFloor(loop.floors[0]).cells.findIndex((c) => c.kind === 'nest');
    let braveHits = 0;
    for (const seed of SEEDS) {
      const timid = runExploration(input(seed, { dungeon: loop, leader: 'timid', days: 5 }));
      expect(timid.trace.days.flatMap((d) => d.moves.map((m) => m.cell))).not.toContain(nest);
      expect(timid.result.mapDeltas[0].cells.length).toBeGreaterThan(10);
      const brave = runExploration(input(seed, { dungeon: loop, leader: 'brave', days: 5 }));
      if (brave.trace.days.some((d) => d.moves.some((m) => m.cell === nest))) braveHits++;
    }
    expect(braveHits).toBeGreaterThan(0);
  });

  it('全滅すると素材を失い、救助費用が付き、全員負傷する', () => {
    const lair = corridor('lair', ['#######', 'EhhhhB#', '#######']);
    let wipes = 0;
    let lost = 0;
    for (const seed of SEEDS) {
      const members = party(seed, 'brave', ['priest']);
      const { result, trace } = runExploration(input(seed, { dungeon: lair, members, leaderId: 'm0', policy: 'hunt', days: 3, items: {} }));
      if (!result.wiped) continue;
      wipes++;
      expect(result.success).toBe(false);
      expect(result.materials).toEqual({});
      expect(result.rescueCost).toBe(77);
      expect(trace.end).toBe('wipe');
      for (const m of members) expect(result.injuries[m.id]).toBeGreaterThanOrEqual(2);
      if (Object.keys(result.lostMaterials).length) lost++;
    }
    expect(wipes).toBeGreaterThan(0);
    expect(lost).toBeGreaterThan(0);
  });

  it('隠し通路は見つけると mapDeltas.hidden に載り、見つけた後だけ通れる', () => {
    const hidden = GRID.cells.flatMap((c, i) => (c.kind === 'hidden' ? [i] : []));
    let found = 0;
    let walked = 0;
    for (const seed of SEEDS.slice(0, 10)) {
      // 帰還ごとに地図をマージして続けて派遣する(game.ts と同じ流れ)
      const visited = new Set<number>();
      const known = new Set<number>();
      for (let trip = 0; trip < 8; trip++) {
        const { result, trace } = runExploration(input(seed * 100 + trip, {
          members: party(seed, 'brave'), leaderId: 'm0', progress: progressOf([...visited], [...known]), days: 3,
        }));
        const delta = result.mapDeltas[0];
        for (const h of delta.hidden) {
          expect(hidden).toContain(h);
          expect(known.has(h)).toBe(false);
        }
        found += delta.hidden.length;
        const usable = new Set([...known, ...delta.hidden]);
        for (const d of trace.days) {
          for (const m of d.moves) {
            if (!hidden.includes(m.cell)) continue;
            expect(usable.has(m.cell)).toBe(true);
            walked++;
          }
        }
        for (const i of delta.cells) visited.add(i);
        for (const i of delta.hidden) known.add(i);
      }
    }
    expect(found).toBeGreaterThan(0);
    expect(walked).toBeGreaterThan(0);
  });

  it('前回までに見つけた隠し通路は最初から通れ、新発見には数えない', () => {
    const hidden = GRID.cells.flatMap((c, i) => (c.kind === 'hidden' ? [i] : []));
    const prior = [...knownWithin(14), ...hidden];
    let walked = 0;
    for (const seed of SEEDS) {
      const { result, trace } = runExploration(input(seed, { progress: progressOf(prior, hidden), days: 3 }));
      expect(result.mapDeltas[0].hidden).toEqual([]);
      if (trace.days.some((d) => d.moves.some((m) => hidden.includes(m.cell)))) walked++;
    }
    expect(walked).toBeGreaterThan(0);
  });

  it('積載を超えた素材は持ち帰れない', () => {
    const mine = corridor('mine', ['####################', 'Emmmmmmmmmmmmmmmmmm#', '####################']);
    let overflow = 0;
    for (const seed of SEEDS) {
      const members = party(seed, 'brave', ['fighter']);
      const { result } = runExploration(input(seed, { dungeon: mine, members, leaderId: 'm0', days: 4 }));
      expect(weightOf(result.materials)).toBeLessThanOrEqual(carryCapacity(members[0]));
      if (result.log.some((l) => l.text.includes('置いて'))) overflow++;
    }
    expect(overflow).toBeGreaterThan(0);
  });

  it('帰還時の集計: mapDeltas・経験値・疲労・関係値が埋まる', () => {
    const { result } = runExploration(input(3, { days: 3 }));
    expect(result.mapDeltas).toHaveLength(1);
    expect(result.mapDeltas[0]).toMatchObject({ dungeon: 'forest_cave', floor: 'f1' });
    expect(result.mapDeltas[0].cells).toContain(GRID.entrance);
    expect(result.success).toBe(!result.retreated && !result.wiped);
    for (const id of ['m0', 'm1', 'm2', 'm3']) {
      expect(result.expGain[id]).toBeGreaterThan(0);
      expect(typeof result.fatigue[id]).toBe('number');
    }
    expect(result.repGain).toBe(0);
    expect(result.questProgress).toEqual({});
    expect(result.returnDialogue).toEqual([]);
    if (!result.wiped) expect(result.relationDeltas.filter((r) => r.reason === '共に帰還した')).toHaveLength(6);
    expect(result.log[0].day).toBe(1);
    expect(result.log.some((l) => l.kind === 'map')).toBe(true);
  });
});
