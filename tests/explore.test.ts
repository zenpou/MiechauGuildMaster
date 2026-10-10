import { describe, expect, it } from 'vitest';
import { carryCapacity, generateAdventurer } from '../src/core/adventurer';
import { DUNGEON, ITEM, JOB, PERSONALITY, RETURN_LINES, TUNING, type ReturnOutcome } from '../src/core/data';
import { neighbors, parseFloor } from '../src/core/dungeon';
import { cellDepths, floorTransit, runExploration, simulateExploration, type ExploreInput } from '../src/core/explore';
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
    progress: progressOf(), days: 3, items: { potion: 1 }, relations: {}, startDay: 0, action: 'explore',
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

  it('1日の歩数は 基準歩数×隊長の速度係数 に収まる', () => {
    for (const leader of ['cautious', 'brave']) {
      const budget = Math.round(TUNING.explore.baseSteps * PERSONALITY[leader].explore.speed);
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
    expect(Math.round(TUNING.explore.baseSteps * PERSONALITY.brave.explore.speed)).toBeGreaterThan(Math.round(TUNING.explore.baseSteps * PERSONALITY.cautious.explore.speed));
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

  it('隠し通路は1マス見つけると、つながった隠しマスがまとめて開く', () => {
    const hidden = GRID.cells.flatMap((c, i) => (c.kind === 'hidden' ? [i] : []));
    let trips = 0;
    for (const seed of SEEDS) {
      const visited = new Set<number>();
      for (let trip = 0; trip < 6; trip++) {
        const { result } = runExploration(input(seed * 100 + trip, {
          members: party(seed, 'brave'), leaderId: 'm0', progress: progressOf([...visited]), days: 3,
        }));
        const delta = result.mapDeltas[0];
        if (delta.hidden.length > 0) {
          expect([...delta.hidden].sort((a, b) => a - b)).toEqual(hidden);
          trips++;
          break;
        }
        for (const i of delta.cells) visited.add(i);
      }
    }
    expect(trips).toBeGreaterThan(0);
  });

  it('強欲は既知の採取点に留まらず、地図を埋め続ける(3日×6回で平均55%以上)', () => {
    const rates = SEEDS.map((seed) => {
      const visited = new Set<number>();
      const known = new Set<number>();
      for (let trip = 0; trip < 6; trip++) {
        const { result } = runExploration(input(seed * 100 + trip, {
          members: party(seed, 'greedy'), leaderId: 'm0', progress: progressOf([...visited], [...known]), days: 3,
        }));
        for (const i of result.mapDeltas[0].cells) visited.add(i);
        for (const i of result.mapDeltas[0].hidden) known.add(i);
      }
      return visited.size / GRID.cells.filter((c) => c.kind !== 'wall').length;
    });
    expect(avg(rates)).toBeGreaterThanOrEqual(0.55);
  });

  it('result.daysSpent は実際に現地で過ごした日数(予定どおりなら days に等しい)', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const { result, trace } = runExploration(input(seed, { leader: 'cautious', days: 3 }));
      expect(result.daysSpent).toBe(trace.days.length);
      if (!result.wiped && !result.retreated) expect(result.daysSpent).toBe(3);
    }
  });

  it('result.maxDepth は今回入ったマスの最大深度(trace と同じ)', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const { result, trace } = runExploration(input(seed, { leader: 'brave', days: 3 }));
      expect(result.maxDepth).toBe(trace.maxDepth);
      expect(result.maxDepth).toBeGreaterThan(0);
    }
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
    expect(result.returnDialogue.map((d) => d.advId)).toEqual(['m0', 'm1', 'm2', 'm3']);
    if (!result.wiped) expect(result.relationDeltas.filter((r) => r.reason === '共に帰還した')).toHaveLength(6);
    expect(result.log[0].day).toBe(1);
    expect(result.log.some((l) => l.kind === 'map')).toBe(true);
  });
});

/** 通れるマスのうち、列 maxCol 以下を「前回までに踏んだ」とする */
function knownUpTo(d: DungeonDef, maxCol: number): number[] {
  const g = parseFloor(d.floors[0]);
  return g.cells.flatMap((c, i) => (c.kind !== 'wall' && i % g.width <= maxCol ? [i] : []));
}
const cellsOf = (d: DungeonDef, kind: string) =>
  parseFloor(d.floors[0]).cells.flatMap((c, i) => (c.kind === kind ? [i] : []));

describe('帰還のひとこと', () => {
  const outcomeOf = (r: { wiped: boolean; retreated: boolean; daysSpent: number }, days: number): ReturnOutcome =>
    r.wiped ? 'wipe' : r.retreated ? 'retreat' : r.daysSpent < days ? 'early' : 'success';

  it('結果の種類に応じた一言が全員分入る', () => {
    const lair = corridor('lair', ['#######', 'EhhhhB#', '#######']);
    const all = GRID.cells.flatMap((c, i) => (c.kind !== 'wall' && c.kind !== 'hidden' ? [i] : []));
    const runs = SEEDS.flatMap((seed) => [
      input(seed, { leader: ['brave', 'cautious', 'greedy', 'proud', 'timid', 'caring'][seed % 6] }),
      input(seed, { dungeon: lair, members: party(seed, 'brave', ['priest']), leaderId: 'm0', policy: 'hunt', items: {} }),
      input(seed, { leader: 'cautious', progress: progressOf(all), action: 'boss' }),
    ]);
    const seen = new Set<ReturnOutcome>();
    for (const inp of runs) {
      const result = simulateExploration(inp);
      const outcome = outcomeOf(result, inp.days);
      seen.add(outcome);
      expect(result.returnDialogue.map((d) => d.advId)).toEqual(inp.members.map((m) => m.id));
      for (const d of result.returnDialogue) {
        const m = inp.members.find((x) => x.id === d.advId)!;
        expect(d.name).toBe(m.name);
        expect(RETURN_LINES[m.personality][outcome]).toContain(d.text);
      }
    }
    expect(seen).toContain('success');
    expect(seen).toContain('wipe');
    expect(seen).toContain('early');
  });

  it('台詞は性格6種 × 結果4種すべてにある', () => {
    for (const p of Object.keys(PERSONALITY)) {
      for (const o of ['success', 'retreat', 'wipe', 'early'] as const) expect(RETURN_LINES[p][o].length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('行動種別', () => {
  it('今回の日数では届く目標しか無いときは、入口で日数を使い切らず初日に引き返す', () => {
    // 一本道の先にシンボル。片道が、慎重な隊長の3日分の歩数の半分を超えるので往復できない
    const days = 3;
    const budget = Math.round(TUNING.explore.baseSteps * PERSONALITY.cautious.explore.speed);
    const oneWay = Math.ceil((budget * days) / 2) + 5;
    const far = corridor('far', ['#'.repeat(oneWay + 2), `E${'.'.repeat(oneWay - 1)}B#`, '#'.repeat(oneWay + 2)]);
    const all = parseFloor(far.floors[0]).cells.flatMap((c, i) => (c.kind !== 'wall' && c.kind !== 'hidden' ? [i] : []));
    for (const seed of SEEDS.slice(0, 5)) {
      const { result, trace } = runExploration(input(seed, {
        dungeon: far, leader: 'cautious', progress: progressOf(all), days, action: 'boss',
      }));
      expect(trace.days[0].moves).toEqual([]);
      expect(result.daysSpent).toBe(1);
      expect(result.log.some((l) => l.text.includes('出直す'))).toBe(true);
    }
  });

  // 薬草2か所と、脇道の苔鉱石。列6以降は未踏
  const herbs = corridor('herbs', [
    '##########',
    'E.h..h.h.#',
    '#m########',
    '##########',
  ]);

  it('採集: 既知の対象素材の採取点だけを回り、未踏に入らず、早く帰る', () => {
    const known = knownUpTo(herbs, 5);
    const herbCells = cellsOf(herbs, 'gather').filter((i) => known.includes(i) && parseFloor(herbs.floors[0]).cells[i].item === 'herb');
    for (const seed of SEEDS) {
      const { result, trace } = runExploration(input(seed, {
        dungeon: herbs, progress: progressOf(known), days: 3, action: 'gather', target: { item: 'herb' },
      }));
      expect(result.mapDeltas[0].cells).toEqual([]);
      const gathered = trace.events.filter((e) => e.kind === 'gather').map((e) => e.cell).sort((a, b) => a - b);
      expect(gathered).toEqual(herbCells);
      expect(Object.keys(result.materials).every((k) => k === 'herb')).toBe(true);
      expect(result.daysSpent).toBeLessThan(3);
      expect(trace.finalCell).toBe(parseFloor(herbs.floors[0]).entrance);
      expect(result.log.some((l) => l.text.includes('採り尽くした'))).toBe(true);
    }
  });

  it('採集: 指定した素材は集中ボーナスで多く採れる', () => {
    const one = corridor('one', ['####', 'Eh.#', '####']);
    const known = knownUpTo(one, 2);
    let focused = 0;
    let plain = 0;
    for (const seed of SEEDS) {
      focused += runExploration(input(seed, { dungeon: one, progress: progressOf(known), action: 'gather', target: { item: 'herb' } })).result.materials.herb ?? 0;
      plain += runExploration(input(seed, { dungeon: one, progress: progressOf([parseFloor(one.floors[0]).entrance]), action: 'explore' })).result.materials.herb ?? 0;
    }
    expect(focused).toBeGreaterThan(plain);
  });

  it('討伐: 既知の巣を回り、未踏には入らない', () => {
    const den = corridor('den', ['##########', 'E.w..w..w#', '##########']);
    const known = knownUpTo(den, 6);
    const knownNests = cellsOf(den, 'nest').filter((i) => known.includes(i));
    let both = 0;
    for (const seed of SEEDS) {
      const { result, trace } = runExploration(input(seed, { dungeon: den, progress: progressOf(known), action: 'hunt' }));
      expect(result.mapDeltas[0].cells).toEqual([]);
      const nests = trace.events.filter((e) => e.kind === 'nest').map((e) => e.cell);
      for (const n of nests) expect(knownNests).toContain(n);
      if (nests.length === 2) {
        both++;
        expect(result.daysSpent).toBeLessThan(3);
      }
    }
    expect(both).toBeGreaterThan(0);
  });

  it('討伐: 対象モンスターを指定するとその巣だけを回る', () => {
    const den = corridor('den2', ['########', 'E.w....#', '#B######', '########']);
    const known = knownUpTo(den, 7);
    for (const seed of SEEDS) {
      const { trace } = runExploration(input(seed, { dungeon: den, progress: progressOf(known), action: 'hunt', target: { enemy: 'wolf' } }));
      expect(trace.events.some((e) => e.kind === 'symbol')).toBe(false);
      expect(trace.events.some((e) => e.kind === 'nest')).toBe(true);
    }
  });

  it('ボス: 踏んだことのあるシンボルへ直行して戦い、未踏に入らない', () => {
    const lair = corridor('lair2', ['###########', 'E...B.....#', '###########']);
    const known = knownUpTo(lair, 4);
    for (const seed of SEEDS) {
      const { result, trace } = runExploration(input(seed, { dungeon: lair, progress: progressOf(known), action: 'boss', days: 3 }));
      expect(trace.events.filter((e) => e.kind === 'symbol')).toHaveLength(1);
      expect(result.mapDeltas[0].cells).toEqual([]);
    }
  });

  it('knownOnly: 新しく踏むマスが0で、隠し通路も探さない', () => {
    const known = knownWithin(6);
    for (const seed of SEEDS) {
      const { result, trace } = runExploration(input(seed, { progress: progressOf(known), knownOnly: true }));
      expect(result.mapDeltas[0].cells).toEqual([]);
      expect(result.mapDeltas[0].hidden).toEqual([]);
      expect(trace.events.some((e) => e.kind === 'hidden')).toBe(false);
      expect(trace.days.flatMap((d) => d.moves).length).toBeGreaterThan(0);
    }
  });

  it('knownOnly: 既知の端まで歩く', () => {
    const known = knownWithin(6);
    const far = Math.max(...known.map((i) => DEPTH[i]));
    const reached = SEEDS.filter((seed) => runExploration(input(seed, { progress: progressOf(known), knownOnly: true })).trace.maxDepth === far);
    expect(reached.length).toBeGreaterThan(0);
  });
});

/** 鍵・扉・階段の試験用。floors は階ごとの rows。S は次の階への下り階段 */
function tower(name: string, floors: string[][], o: Partial<DungeonDef> = {}): DungeonDef {
  return corridor(name, [], {
    floors: floors.map((rows, n) => ({
      id: `f${n + 1}`, name: `${n + 1}階`, rows,
      legend: {
        '#': { kind: 'wall' }, '.': { kind: 'floor' }, E: { kind: 'entrance' },
        m: { kind: 'gather', item: 'moss_ore' },
        D: { kind: 'door', key: 'k' }, K: { kind: 'treasure', item: 'k' }, H: { kind: 'hidden' },
        S: { kind: 'stairs_down', to: { floor: `f${n + 2}`, x: 0, y: 1 } },
      },
    })),
    ...o,
  });
}
const floorsProgress = (floors: Record<string, number[]>): DungeonProgress => ({
  confirmed: true, bossDefeated: 0, fullCleared: false,
  floors: Object.fromEntries(Object.entries(floors).map(([id, visited]) => [id, { visited, hiddenFound: [] }])),
});
/** 2行目(y=1)の x=0..maxX のマス */
const row1 = (d: DungeonDef, floor: number, maxX: number) => {
  const g = parseFloor(d.floors[floor]);
  return Array.from({ length: maxX + 1 }, (_, x) => g.width + x);
};
const BRAVE_BUDGET = Math.round(TUNING.explore.baseSteps * PERSONALITY.brave.explore.speed);

describe('複数フロア・鍵・扉', () => {
  const long = tower('long', [['################################', 'E..............................#', '################################']]);
  const moveCost = (d: { moves: { cost: number }[] }) => d.moves.reduce((s, m) => s + m.cost, 0);

  it('transit: 初日の歩数予算から前の階の通り抜けを払う', () => {
    const day1 = (transit: number) => runExploration(input(1, { dungeon: long, days: 3, transit }));
    const a = day1(0);
    const b = day1(6);
    expect(b.trace.days[0].used).toBeLessThanOrEqual(BRAVE_BUDGET);
    expect(moveCost(b.trace.days[0])).toBeLessThanOrEqual(BRAVE_BUDGET - 6);
    expect(moveCost(b.trace.days[0])).toBe(moveCost(a.trace.days[0]) - 6);
    expect(b.result.log.some((l) => l.text.includes('前の階を抜けて6歩'))).toBe(true);
    expect(a.result.log.some((l) => l.text.includes('前の階'))).toBe(false);
  });

  it('transit: 1日で払いきれない分は翌日に繰り越す', () => {
    const { trace } = runExploration(input(1, { dungeon: long, days: 4, transit: BRAVE_BUDGET + 3 }));
    expect(trace.days[0].moves).toEqual([]);
    expect(trace.days[0].used).toBe(BRAVE_BUDGET);
    expect(moveCost(trace.days[1])).toBeLessThanOrEqual(BRAVE_BUDGET - 3);
    expect(trace.days[1].moves.length).toBeGreaterThan(0);
    for (const d of trace.days) expect(d.used).toBeLessThanOrEqual(BRAVE_BUDGET);
  });

  it('transit: 往復できない日数なら、前の階を抜けずに初日に出直す', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      // 往復だけで2日分の予算を使い切るので、1マスも往復できない
      const { result, trace } = runExploration(input(seed, { dungeon: long, days: 2, transit: BRAVE_BUDGET }));
      expect(trace.days[0].moves).toEqual([]);
      expect(trace.days[0].used).toBe(0);
      expect(result.daysSpent).toBe(1);
      expect(result.log.some((l) => l.text.includes('出直す'))).toBe(true);
      expect(result.log.some((l) => l.text.includes('前の階を抜けて'))).toBe(false);
    }
    expect(runExploration(input(1, { dungeon: long, days: 2 })).result.log.some((l) => l.text.includes('出直す'))).toBe(false);
  });

  it('transit: 最終日は 入口までの距離+transit を残して戻り、帰りにも前の階を抜ける', () => {
    const transit = 4;
    const width = parseFloor(long.floors[0]).width;
    for (const days of [1, 2]) {
      const { result, trace } = runExploration(input(1, { dungeon: long, days, transit }));
      const d = trace.days[days - 1];
      let left = d.budget - (days === 1 ? transit : 0);
      for (const m of d.moves) {
        left -= m.cost;
        // 一本道なので x が入口までの距離
        expect(left).toBeGreaterThanOrEqual(m.cell % width + transit);
      }
      expect(trace.finalCell).toBe(parseFloor(long.floors[0]).entrance);
      expect(trace.forcedReturn).toBe(false);
      expect(d.used).toBe(d.budget - left + transit);
      expect(result.log.some((l) => l.text.includes(`前の階を抜けて${transit}歩戻った`))).toBe(true);
    }
    const reach = (transit: number) => runExploration(input(1, { dungeon: long, days: 1, transit })).trace.maxDepth;
    expect(reach(transit)).toBeLessThan(reach(0));
  });

  const gate = tower('gate', [['########', 'E.D....#', '########']]);

  it('扉: 鍵を持たずに出ると奥へ行けず、持って出ると通れる', () => {
    const [door] = cellsOf(gate, 'door');
    const beyond = row1(gate, 0, 6).filter((i) => i > door);
    for (const seed of SEEDS.slice(0, 5)) {
      const locked = runExploration(input(seed, { dungeon: gate, days: 2 })).result.mapDeltas[0].cells;
      expect(locked).not.toContain(door);
      expect(locked.some((i) => beyond.includes(i))).toBe(false);
      const open = runExploration(input(seed, { dungeon: gate, days: 2, keys: ['k'] })).result.mapDeltas[0].cells;
      expect(open).toEqual(expect.arrayContaining([door, ...beyond]));
    }
  });

  it('cellDepths: 扉の奥のマスも深度を持つ(-1 を残さない)', () => {
    const g = parseFloor(gate.floors[0]);
    const depth = cellDepths(g);
    g.cells.forEach((c, i) => {
      if (c.kind !== 'wall') expect(depth[i]).toBeGreaterThanOrEqual(0);
    });
    expect(depth[g.width + 6]).toBe(6);
  });

  const vault = tower('vault', [['######', 'E.K..#', '######']]);

  it('鍵の宝箱: 金も罠も無く鍵が1個手に入り、持っていれば取らない', () => {
    const [chest] = cellsOf(vault, 'treasure');
    for (const seed of SEEDS.slice(0, 5)) {
      const got = runExploration(input(seed, { dungeon: vault, days: 1 }));
      expect(got.trace.events.filter((e) => e.kind === 'treasure').map((e) => e.cell)).toEqual([chest]);
      expect(got.result.items.k).toBe(1);
      expect(got.result.gold).toBe(0);
      expect(got.result.log.some((l) => l.text.includes('罠'))).toBe(false);
      expect(got.result.log.some((l) => l.text.includes('を手に入れた'))).toBe(true);

      const had = runExploration(input(seed, { dungeon: vault, days: 1, keys: ['k'] }));
      expect(had.trace.events.filter((e) => e.kind === 'treasure')).toHaveLength(1);
      expect(had.result.items.k).toBeUndefined();
      expect(had.result.gold).toBe(0);
      expect(had.result.log.some((l) => l.text.includes('もう持っている'))).toBe(true);
    }
  });

  it('下り階段に入るとログに残し、trace に stairs を1度だけ記録する', () => {
    const stairs = tower('stairs', [['######', 'E..S.#', '######'], ['###', 'E.#', '###']]);
    const [s] = cellsOf(stairs, 'stairs_down');
    for (const seed of SEEDS.slice(0, 5)) {
      const { result, trace } = runExploration(input(seed, { dungeon: stairs, days: 1 }));
      expect(trace.events.filter((e) => e.kind === 'stairs').map((e) => e.cell)).toEqual([s]);
      expect(result.log.filter((l) => l.text.includes('下り階段を見つけた'))).toHaveLength(1);
      expect(result.mapDeltas[0].cells).toContain(s);
    }
  });

  it('hiddenBonus: 隠し通路の発見率に足される', () => {
    // 既知の一本道の奥の採取点へ通う。発見した隠しマスへは寄り道しないので、試す回数は同じ
    const niches = tower('niches', [['#H#H#H#H##', 'E.......m#', '##########']]);
    const known = parseFloor(niches.floors[0]).cells.flatMap((c, i) => (c.kind === 'wall' || c.kind === 'hidden' ? [] : [i]));
    const found = (hiddenBonus: number) => SEEDS.reduce((s, seed) => s + runExploration(input(seed, {
      dungeon: niches, progress: progressOf(known), days: 1, action: 'gather', jobs: ['fighter'], hiddenBonus,
    })).result.mapDeltas[0].hidden.length, 0);
    const base = found(0);
    const boosted = found(0.5);
    expect(boosted).toBeGreaterThan(base);
    expect(boosted).toBeLessThanOrEqual(SEEDS.length * 4);
  });

  it('floorTransit: 1階は0、下の階は前の階の階段を踏んでいれば入口からの既知の歩数', () => {
    const stack = tower('stack', [
      ['#######', 'E....S#', '#######'],
      ['#######', 'E..S..#', '#######'],
      ['#######', 'E.....#', '#######'],
    ]);
    expect(floorTransit(stack, 'f1', floorsProgress({}))).toBe(0);
    expect(floorTransit(stack, 'f2', floorsProgress({}))).toBeNull();
    expect(floorTransit(stack, 'f2', floorsProgress({ f1: row1(stack, 0, 4) }))).toBeNull();
    expect(floorTransit(stack, 'f2', floorsProgress({ f1: row1(stack, 0, 5) }))).toBe(5);
    expect(floorTransit(stack, 'f3', floorsProgress({ f1: row1(stack, 0, 5) }))).toBeNull();
    expect(floorTransit(stack, 'f3', floorsProgress({ f1: row1(stack, 0, 5), f2: row1(stack, 1, 3) }))).toBe(8);
    expect(floorTransit(stack, 'f9', floorsProgress({}))).toBeNull();
  });

  it('floorTransit: 前の階の階段が扉の奥なら、鍵を持つときだけ通れる', () => {
    const locked = tower('locked', [['#######', 'E..D.S#', '#######'], ['###', 'E.#', '###']]);
    const progress = floorsProgress({ f1: row1(locked, 0, 5) });
    expect(floorTransit(locked, 'f2', progress)).toBeNull();
    expect(floorTransit(locked, 'f2', progress, ['k'])).toBe(5);
  });
});

describe('探索の細部', () => {
  it('分かれ道で迷う隊長でも、1日の歩数は予算を超えない', () => {
    for (const leader of ['timid', 'greedy', 'caring']) {
      for (const seed of SEEDS) {
        const { trace } = runExploration(input(seed, { leader, days: 3 }));
        for (const d of trace.days) expect(d.used, `${leader} seed${seed} ${d.day}日目`).toBeLessThanOrEqual(d.budget);
      }
    }
  });

  it('持っている鍵の宝箱には、強欲な隊長も寄り道しない(持っていなければ取りに行く)', () => {
    const vault2 = tower('vault2', [['########', 'E.K....#', '########']]);
    const progress = floorsProgress({ f1: row1(vault2, 0, 6) });
    for (const seed of SEEDS.slice(0, 5)) {
      const held = runExploration(input(seed, { dungeon: vault2, leader: 'greedy', days: 2, progress, keys: ['k'] }));
      expect(held.trace.events.filter((e) => e.kind === 'treasure')).toEqual([]);
      const none = runExploration(input(seed, { dungeon: vault2, leader: 'greedy', days: 2, progress, keys: [] }));
      expect(none.trace.events.some((e) => e.kind === 'treasure')).toBe(true);
    }
  });
});

describe('経験値の深さ補正', () => {
  const ref = TUNING.explore.expRefPower;
  const flat = (recommended: number) => tower('exp', [['##########', 'E........#', '##########']], { recommended });
  const gain = (recommended: number, seed = 3) => {
    const { result } = runExploration(input(seed, { dungeon: flat(recommended), days: 2, leader: 'brave' }));
    return result.expGain.m0;
  };

  it('探索と日数の経験値は、推奨戦力が基準(expRefPower)を超えるダンジョンほど多い(3倍の難度で約3倍)', () => {
    const base = gain(ref);
    expect(base).toBeGreaterThan(0);
    expect(gain(ref * 3) / base).toBeGreaterThan(2.7);
    expect(gain(ref * 3) / base).toBeLessThan(3.3);
  });

  it('基準以下のダンジョンでは増減しない(浅い森で減らさない)', () => {
    expect(gain(Math.floor(ref / 2))).toBe(gain(ref));
  });
});

describe('隠し通路の再調査', () => {
  // 一本道の途中に隠しマス。手前は踏み尽くしてあり、通りがかりの判定には外れた想定
  const blocked = tower('blocked', [['###########', 'E....H.K..#', '###########']]);
  const grid = parseFloor(blocked.floors[0]);
  const at = (x: number, y = 1) => y * grid.width + x;
  const walked = [0, 1, 2, 3, 4].map((x) => at(x));
  const run = (seed: number, o: Parameters<typeof input>[1] = {}) => runExploration(input(seed, {
    dungeon: blocked, progress: progressOf(walked), days: 3, jobs: ['scout', 'fighter', 'warrior', 'priest'], ...o,
  }));
  const moveCells = (trace: { days: { moves: { cell: number }[] }[] }) => trace.days.flatMap((d) => d.moves.map((m) => m.cell));

  it('歩き尽くしても、未発見の隠し通路に接するマスへ戻って発見を試みる', () => {
    const found = SEEDS.filter((seed) => run(seed, { hiddenBonus: 1 }).trace.events.some((e) => e.kind === 'hidden' && e.cell === at(5)));
    expect(found.length).toBeGreaterThanOrEqual(15);
  });

  it('見つけたら、その先の未踏のマスまで歩く', () => {
    const { result } = run(1, { hiddenBonus: 1, leader: 'brave' });
    expect(result.mapDeltas[0].hidden).toEqual([at(5)]);
    expect(result.mapDeltas[0].cells).toEqual(expect.arrayContaining([at(6), at(7)]));
  });

  it('戻った理由をログに残す', () => {
    const { result } = run(1, { hiddenBonus: 1 });
    expect(result.log.some((l) => l.text.includes('調べ直し'))).toBe(true);
  });

  it('見つからなかったら、同じ場所を繰り返さず1度で引き返す', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const { result, trace } = run(seed, { hiddenBonus: -1 });
      expect(result.mapDeltas[0].hidden).toEqual([]);
      expect(trace.end).toBe('mapFull');
      expect(moveCells(trace).filter((c) => c === at(4))).toHaveLength(1);
    }
  });

  it('knownOnly(見込み)では戻らない', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const { result, trace } = run(seed, { hiddenBonus: 1, knownOnly: true });
      expect(moveCells(trace)).toEqual([]);
      expect(result.mapDeltas[0].hidden).toEqual([]);
    }
  });

  it('未踏のマスが残っている間は、再調査より未踏を先に歩く', () => {
    // 入口の脇の袋小路(1,2)の先に隠しマス(1,3)。東に未踏の一本道が続く
    const spur = tower('spur', [['#########', 'E.......#', '#.#######', '#H#######', '#m#######', '#########']]);
    const g = parseFloor(spur.floors[0]);
    const cell = (x: number, y: number) => y * g.width + x;
    const known = [cell(0, 1), cell(1, 1), cell(1, 2)];
    for (const seed of SEEDS.slice(0, 8)) {
      const { trace } = runExploration(input(seed, {
        dungeon: spur, progress: progressOf(known), days: 3, hiddenBonus: 1, jobs: ['scout', 'fighter', 'warrior', 'priest'], leader: 'brave',
      }));
      const moves = moveCells(trace);
      const east = moves.indexOf(cell(7, 1));
      const back = moves.indexOf(cell(1, 2));
      expect(east).toBeGreaterThanOrEqual(0);
      expect(back).toBeGreaterThan(east);
    }
  });
});

describe('塔f1の遺跡の鍵(隠し通路の奥)', () => {
  const TOWER = DUNGEON.ruined_tower;
  const grid = parseFloor(TOWER.floors[0]);
  const keyCell = grid.cells.findIndex((c) => c.kind === 'treasure' && c.item === 'ruin_key');
  // 隠し通路を閉じたまま入口から歩いて届くマス(これを全部踏んだ状態 = 歩き尽くした)
  const closed = { keys: [] as string[], hiddenFound: [] as number[] };
  const walked: number[] = [grid.entrance];
  for (let head = 0; head < walked.length; head++) {
    for (const n of neighbors(grid, walked[head], closed)) if (!walked.includes(n)) walked.push(n);
  }

  it('鍵の宝箱は隠し通路の奥にあり、隠し通路を閉じたままでは届かない', () => {
    expect(keyCell).toBeGreaterThanOrEqual(0);
    expect(walked).not.toContain(keyCell);
  });

  it('歩き尽くしていても、探索を重ねれば全 seed で鍵の宝箱に届く(1回の判定に外れても詰まない)', () => {
    for (const seed of SEEDS) {
      let progress = progressOf(walked);
      let reached = -1;
      for (let trip = 1; trip <= 10 && reached < 0; trip++) {
        // 塔の敵に撤退させられない強さの隊(この試験は隠し通路の調べ直しだけを見る)
        const members = party(seed, 'brave').map((a) => ({ ...a, level: 40 }));
        const { result } = runExploration(input(seed, { dungeon: TOWER, progress, days: 3, members }));
        const delta = result.mapDeltas[0];
        const fl = progress.floors.f1;
        progress = progressOf([...fl.visited, ...delta.cells], [...new Set([...fl.hiddenFound, ...delta.hidden])]);
        if (progress.floors.f1.visited.includes(keyCell)) reached = trip;
      }
      expect(reached, `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});
