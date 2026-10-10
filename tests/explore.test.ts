import { describe, expect, it } from 'vitest';
import { carryCapacity, generateAdventurer } from '../src/core/adventurer';
import { DUNGEON, ITEM, JOB, PERSONALITY, RETURN_LINES, TUNING, type ReturnOutcome } from '../src/core/data';
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
    // 森の洞窟を隠し通路以外すべて踏んだ知識。シンボルまで片道25歩で、慎重(13歩/日)の3日では往復できない
    const all = GRID.cells.flatMap((c, i) => (c.kind !== 'wall' && c.kind !== 'hidden' ? [i] : []));
    for (const seed of SEEDS.slice(0, 5)) {
      const { result, trace } = runExploration(input(seed, {
        leader: 'cautious', progress: progressOf(all), days: 3, action: 'boss',
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
