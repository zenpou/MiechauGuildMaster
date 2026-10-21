import { describe, expect, it } from 'vitest';
import { DUNGEON } from '../src/core/data';
import { parseFloor, xy } from '../src/core/dungeon';
import { dispatch, advanceDay, newGame } from '../src/core/game';
import { runExploration, type ExploreInput } from '../src/core/explore';
import { getIntroExploration, isIntroExploration } from '../src/core/introExploration';
import { assessReadiness } from '../src/core/readiness';
import { rngFor } from '../src/core/rng';
import { deserialize, serialize } from '../src/core/save';
import { markStorySeen, storyDue } from '../src/core/story';
import type { DispatchOrder, GameState } from '../src/core/types';

function order(
  s: GameState,
  days = 7,
  uniques: ('tina' | 'sera')[] = ['tina'],
  leaderUnique: 'tina' | 'sera' = uniques[0],
  policy: DispatchOrder['policy'] = 'standard',
): DispatchOrder {
  const partyIds = uniques.map((unique) => s.adventurers.find((a) => a.unique === unique)!.id);
  return {
    partyIds, leaderId: s.adventurers.find((a) => a.unique === leaderUnique)!.id, action: 'explore',
    target: { dungeon: 'forest_cave', floor: 'f1' },
    policy, days, items: {},
  };
}

describe('初回の安全な導入探索', () => {
  it.each([
    ['safe', 1], ['safe', 7], ['standard', 1], ['standard', 7],
    ['explore', 1], ['explore', 7], ['reward', 1], ['reward', 7],
    ['avoid', 1], ['avoid', 7], ['hunt', 1], ['hunt', 7],
  ] as const)('方針%s・%s日指定でも安全な1日帰りになる', (policy, days) => {
    const s = newGame(days + policy.length);
    const o = { ...order(s, days), policy };
    const r = dispatch(s, o);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expedition.order.days).toBe(1);
    expect(r.expedition.returnDay).toBe(2);
    expect(r.expedition.result.wiped).toBe(false);
    expect(r.expedition.result.injuries).toEqual({});
    expect(r.expedition.result.materials).toEqual({ herb: 1 });
    while (s.expeditions.length > 0) advanceDay(s);
    expect(s.history.at(-1)?.result.materials).toEqual({ herb: 1 });
    expect(s.adventurers[0].injuryDays).toBe(0);
  });

  it('ティナとセラの二人でも隊長・全方針を問わず、100 seedで薬草1個を無傷で往復する', () => {
    const policies: DispatchOrder['policy'][] = ['safe', 'standard', 'explore', 'reward', 'avoid', 'hunt'];
    for (let seed = 1; seed <= 100; seed++) {
      for (const leader of ['tina', 'sera'] as const) {
        for (const policy of policies) {
          const s = newGame(seed);
          const o = order(s, 7, ['tina', 'sera'], leader, policy);
          expect(isIntroExploration(s, o)).toBe(true);
          const r = dispatch(s, o);
          expect(r.ok).toBe(true);
          if (!r.ok) continue;
          expect(r.expedition.order.days).toBe(1);
          expect(r.expedition.result.wiped).toBe(false);
          expect(r.expedition.result.injuries).toEqual({});
          expect(r.expedition.result.materials).toEqual({ herb: 1 });
          expect(r.expedition.result.log.some((line) => line.text.includes('セラが入口近くで薬草を1個採った'))).toBe(true);
          while (s.expeditions.length > 0) advanceDay(s);
          expect(s.adventurers.filter((a) => a.unique === 'tina' || a.unique === 'sera')
            .every((a) => a.injuryDays === 0)).toBe(true);
          expect(s.history.at(-1)?.result.materials).toEqual({ herb: 1 });
        }
      }
    }
  });

  it('セラ単独の初回行程も導入対象になる', () => {
    const s = newGame(17);
    const o = order(s, 7, ['sera'], 'sera', 'safe');
    expect(getIntroExploration(s, o)).not.toBeNull();
    const r = dispatch(s, o);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expedition.result.materials).toEqual({ herb: 1 });
    expect(r.expedition.result.injuries).toEqual({});
  });

  it('入口から最寄りの薬草までの隣接ルートを返し、計画だけでは状態を変えない', () => {
    const s = newGame(1);
    const o = order(s);
    const before = structuredClone(s);
    const plan = getIntroExploration(s, o);
    expect(plan).toMatchObject({ days: 1, description: expect.stringContaining('薬草') });
    expect(plan?.route.length).toBeGreaterThan(1);
    const grid = parseFloor(DUNGEON.forest_cave.floors[0]);
    const safe = new Set(['floor', 'entrance']);
    for (let i = 0; i < plan!.route.length; i++) {
      const cell = grid.cells[plan!.route[i]];
      expect(cell.kind === 'gather' ? cell.item === 'herb' : safe.has(cell.kind)).toBe(true);
      if (i > 0) {
        const a = xy(grid, plan!.route[i - 1]);
        const b = xy(grid, plan!.route[i]);
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
      }
    }
    expect(plan!.route[0]).toBe(grid.entrance);
    expect(grid.cells[plan!.route.at(-1)!]).toMatchObject({ kind: 'gather', item: 'herb' });
    expect(s).toEqual(before);
  });

  it('不正な初回派遣では消費せず、保存して読み直しても導入条件を保つ', () => {
    const s = newGame(2);
    const o = order(s);
    const before = structuredClone(s);
    expect(isIntroExploration(s, { ...o, days: 0 })).toBe(false);
    expect(dispatch(s, { ...o, days: 0 }).ok).toBe(false);
    expect(isIntroExploration(s, { ...o, days: 999 })).toBe(false);
    expect(dispatch(s, { ...o, days: 999 }).ok).toBe(false);
    expect(s).toEqual(before);
    const loaded = deserialize(serialize(s));
    expect(loaded).not.toBeNull();
    expect(getIntroExploration(loaded!, o)).toEqual(getIntroExploration(s, o));
  });

  it('100 seedで無傷・全滅なしの薬草採取と帰還を実際の探索処理で確認し、翌朝に第一章が解禁されてもセラは一人のまま', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = newGame(seed);
      // 第一章の前提だけを先に読ませ、導入探索の条件(ch1未読)は残す。
      markStorySeen(s, 'prologue');
      const o = order(s);
      const r = dispatch(s, o);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const e = r.expedition;
      expect(e.order.days).toBe(1);
      expect(e.returnDay).toBe(2);
      expect(e.result.wiped).toBe(false);
      expect(e.result.retreated).toBe(false);
      expect(e.result.injuries).toEqual({});
      expect(e.result.materials).toEqual({ herb: 1 });
      expect(e.result.log.some((line) => line.kind === 'combat')).toBe(false);
      expect(e.result.log.some((line) => line.text.includes('入口近くの薬草を採り帰路を確認する初回の行程'))).toBe(true);
      expect(e.result.log.some((line) => line.text.includes('入口周辺の確認を終えて帰還'))).toBe(true);
      expect(e.result.mapDeltas[0].cells.length).toBeGreaterThan(1);
      expect(s.dungeons.forest_cave.floors.f1.visited).toEqual([]);

      while (s.expeditions.length > 0) advanceDay(s);
      expect(s.day).toBe(2);
      expect(s.adventurers.find((a) => a.unique === 'tina')?.injuryDays).toBe(0);
      expect(s.history.at(-1)?.result.materials).toEqual({ herb: 1 });
      expect(s.history).toHaveLength(1);
      expect(s.dungeons.forest_cave.floors.f1.visited.length).toBe(e.result.mapDeltas[0].cells.length);
      expect(s.dungeons.forest_cave.floors.f1.visited.length).toBeLessThan(parseFloor(DUNGEON.forest_cave.floors[0]).cells.filter((cell) => cell.kind !== 'wall').length);
      expect(s.inventory.herb).toBe(1);
      expect(s.flags['sera:herb']).toBeUndefined();
      expect(s.notices.some((notice) => notice.text.includes('セラ') && notice.text.includes('薬草を1個'))).toBe(false);
      expect(storyDue(s).map((chapter) => chapter.id)).toContain('ch1');
      markStorySeen(s, 'ch1');
      expect(s.adventurers.filter((a) => a.unique === 'sera')).toHaveLength(1);
      expect(getIntroExploration(s, o)).toBeNull();
    }
  });

  it('見込みでも導入行程を危険扱いせず、試算で状態を変えない', () => {
    const s = newGame(3);
    const o = order(s, 7);
    const before = structuredClone(s);
    const r = assessReadiness(s, o, 10);
    expect(r.introductory).toBe(true);
    expect(r.grade).toBe('余裕');
    expect(r.uncertainty).toBe('低');
    expect(r.wipeRate).toBe(0);
    expect(r.avgInjuryDays).toBe(0);
    expect(r.avgFights).toBe(0);
    expect(r.avgSiteDays).toBe(1);
    expect(s).toEqual(before);
  });

  it('観察記録の有無で導入探索の結果・トレース・乱数を変えず、往復フレームが入口で終わる', () => {
    const s = newGame(88);
    const o = order(s, 7);
    const plan = getIntroExploration(s, o)!;
    const input = (observed: boolean): ExploreInput => ({
      rng: rngFor(88, 'intro-journey'),
      dungeon: DUNGEON.forest_cave,
      floorId: 'f1',
      members: [structuredClone(s.adventurers[0])],
      leaderId: s.adventurers[0].id,
      policy: o.policy,
      progress: structuredClone(s.dungeons.forest_cave),
      days: plan.days,
      items: {},
      relations: {},
      startDay: 1,
      action: 'explore',
      intro: { route: plan.route, item: 'herb' },
      ...(observed ? { journey: { expeditionStartDay: 1, outDays: 0 } } : {}),
    });
    const plainInput = input(false);
    const observedInput = input(true);
    const plain = runExploration(plainInput);
    const observed = runExploration(observedInput);
    expect(observed.result).toEqual(plain.result);
    expect(observed.trace).toEqual(plain.trace);
    expect(observedInput.rng.next()).toBe(plainInput.rng.next());

    const grid = parseFloor(DUNGEON.forest_cave.floors[0]);
    const journey = observed.journey!;
    const moveFrames = journey.frames.filter((frame) => frame.kind === 'move' && frame.cell !== null);
    let previous = grid.entrance;
    for (const frame of moveFrames) {
      const a = xy(grid, previous);
      const b = xy(grid, frame.cell!);
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
      previous = frame.cell!;
    }
    expect(moveFrames.some((frame) => frame.movement === 'explore')).toBe(true);
    expect(moveFrames.some((frame) => frame.movement === 'return')).toBe(true);
    expect(journey.end).toBe('done');
    expect(journey.finalCell).toBe(grid.entrance);
    expect(journey.frames.at(-1)).toMatchObject({ kind: 'end', cell: grid.entrance });
  });

  it('履歴を持たない旧セーブでも既派遣カウンター、章既読、探索済みなら再適用しない', () => {
    const base = newGame(91);
    const o = order(base);
    const raw = structuredClone(base) as unknown as Record<string, unknown>;
    delete raw.history;
    raw.counters = { ...base.counters, dispatches: 1 };
    const old = deserialize(JSON.stringify(raw));
    expect(old).not.toBeNull();
    expect(getIntroExploration(old!, o)).toBeNull();

    const read = newGame(92);
    markStorySeen(read, 'ch1');
    expect(getIntroExploration(read, order(read))).toBeNull();

    const explored = newGame(93);
    explored.dungeons.forest_cave.floors.f1.visited = [parseFloor(DUNGEON.forest_cave.floors[0]).entrance];
    expect(getIntroExploration(explored, order(explored))).toBeNull();
  });

  it('帰還後は通常探索へ戻り、導入ルートを再適用しない', () => {
    const s = newGame(4);
    const o = order(s);
    const first = dispatch(s, o);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    while (s.expeditions.length > 0) advanceDay(s);
    expect(isIntroExploration(s, o)).toBe(false);
    const normal = { ...o, days: 2 };
    const next = dispatch(s, normal);
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.expedition.order.days).toBe(2);
  });
});
