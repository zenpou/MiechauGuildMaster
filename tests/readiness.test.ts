import { describe, expect, it } from 'vitest';
import { DUNGEON } from '../src/core/data';
import { parseFloor } from '../src/core/dungeon';
import { assessReadiness, gradeOf, uncertaintyOf } from '../src/core/readiness';
import type { DispatchOrder, GameState } from '../src/core/types';
import { fullGame } from './helpers';

function order(s: GameState, o: Partial<DispatchOrder> = {}): DispatchOrder {
  const ids = s.adventurers.map((a) => a.id);
  return {
    partyIds: ids, leaderId: ids[0], action: 'explore',
    target: { dungeon: 'forest_cave', floor: 'f1' },
    policy: 'standard', days: 3, items: { potion: 1 },
    ...o,
  };
}

const grid = parseFloor(DUNGEON.forest_cave.floors[0]);
const all = grid.cells.flatMap((c, i) => (c.kind !== 'wall' && c.kind !== 'hidden' ? [i] : []));

describe('見込み', () => {
  it('同じ条件なら同じ値で、状態を変えない', () => {
    const s = fullGame(5);
    s.dungeons.forest_cave.floors.f1.visited = all.slice(0, 30);
    const before = structuredClone(s);
    const a = assessReadiness(s, order(s));
    expect(assessReadiness(s, order(s))).toEqual(a);
    expect(s).toEqual(before);
    expect(a.runs).toBe(40);
  });

  it('探索率0なら戦闘0回・不確かさ「高」', () => {
    const s = fullGame(5);
    const r = assessReadiness(s, order(s), 10);
    expect(r.avgFights).toBe(0);
    expect(r.wipeRate).toBe(0);
    expect(r.uncertainty).toBe('高');
  });

  it('既知のマスが多いと戦闘が見込まれ、不確かさが下がる', () => {
    const s = fullGame(5);
    s.dungeons.forest_cave.floors.f1.visited = all;
    const r = assessReadiness(s, order(s, { action: 'hunt' }), 10);
    expect(r.avgFights).toBeGreaterThan(0);
    expect(r.uncertainty).toBe('低');
    expect(r.avgInjuryDays).toBeGreaterThanOrEqual(0);
  });

  it('戦力比で4段階', () => {
    expect(gradeOf(1.5)).toBe('余裕');
    expect(gradeOf(1.3)).toBe('余裕');
    expect(gradeOf(1.1)).toBe('適正');
    expect(gradeOf(0.9)).toBe('厳しい');
    expect(gradeOf(0.5)).toBe('危険');
    expect(uncertaintyOf(0.8)).toBe('低');
    expect(uncertaintyOf(0.5)).toBe('中');
    expect(uncertaintyOf(0.1)).toBe('高');
  });

  it('隊が弱いと戦力比と評価が下がる', () => {
    const s = fullGame(5);
    const full = assessReadiness(s, order(s), 2);
    const ids = s.adventurers.map((a) => a.id);
    const solo = assessReadiness(s, order(s, { partyIds: [ids[0]], leaderId: ids[0] }), 2);
    expect(solo.powerRatio).toBeLessThan(full.powerRatio);
    const order4 = ['余裕', '適正', '厳しい', '危険'];
    expect(order4.indexOf(solo.grade)).toBeGreaterThanOrEqual(order4.indexOf(full.grade));
  });
});
