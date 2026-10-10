import { describe, expect, it } from 'vitest';
import {
  activeSynergies, assignWorker, build, canBuild, facilityLevel, listSynergies, synergyValue, unassignWorker, upgrade,
} from '../src/core/base';
import { FACILITY } from '../src/core/data';
import { advanceDay, newGame } from '../src/core/game';
import type { GameState } from '../src/core/types';

function rich(seed = 5): GameState {
  const s = newGame(seed);
  s.gold = 5000;
  s.inventory = { ...s.inventory, moss_ore: 20, iron_ore: 20, slime_gel: 20, glow_moss: 20, herb: 20 };
  return s;
}

function place(s: GameState, id: string, x: number, y: number, level = 1) {
  s.base.facilities.push({ id, level, x, y, builtDay: 1, construction: null });
}

describe('build', () => {
  it('newGame は施設なし', () => {
    expect(newGame(1).base.facilities).toEqual([]);
  });

  it('空きマスにだけ建ち、資金(Lv1は建材なし)を引いて建設中(Lv0)になる', () => {
    const s = rich();
    const cost = FACILITY.dorm.costs[0];
    expect(cost.materials).toEqual({});
    expect(build(s, 'dorm', 2, 2).ok).toBe(true);
    expect(s.gold).toBe(5000 - cost.gold);
    expect(s.inventory.moss_ore).toBe(20);
    expect(facilityLevel(s, 'dorm')).toBe(0);
    expect(s.base.facilities[0].construction).toEqual({ toLevel: 1, untilDay: 1 + cost.days });
    expect(s.ledger[0]).toMatchObject({ amount: -cost.gold });
    expect(canBuild(s, 'clinic', 2, 2).ok).toBe(false);
    expect(canBuild(s, 'clinic', 5, 0).ok).toBe(false);
    expect(canBuild(s, 'clinic', -1, 0).ok).toBe(false);
    expect(canBuild(s, 'clinic', 0.5, 0).ok).toBe(false);
    expect(canBuild(s, 'dorm', 0, 0).ok).toBe(false);
    expect(canBuild(s, 'nope', 0, 0).ok).toBe(false);
    expect(canBuild(s, 'clinic', 0, 0).ok).toBe(true);
  });

  it('資金が足りなければ断り、状態を変えない。Lv2 は建材も要る', () => {
    const s = rich();
    s.gold = FACILITY.dorm.costs[0].gold - 1;
    const before = structuredClone(s);
    expect(build(s, 'dorm', 0, 0).ok).toBe(false);
    expect(s).toEqual(before);
    s.gold = 5000;
    place(s, 'dorm', 0, 0);
    const mat = Object.keys(FACILITY.dorm.costs[1].materials)[0];
    s.inventory[mat] = 0;
    const before2 = structuredClone(s);
    expect(upgrade(s, 'dorm').ok).toBe(false);
    expect(s).toEqual(before2);
  });

  it('完成日に Lv1 になる', () => {
    const s = rich();
    build(s, 'dorm', 0, 0);
    advanceDay(s);
    advanceDay(s);
    expect(facilityLevel(s, 'dorm')).toBe(0);
    advanceDay(s);
    expect(s.day).toBe(4);
    expect(facilityLevel(s, 'dorm')).toBe(1);
    expect(s.base.facilities[0].construction).toBeNull();
    expect(s.notices.some((n) => n.text.includes('宿舎'))).toBe(true);
  });

  it('upgrade は完成後だけ。建設中は前のLvで、完成で Lv2。最大Lvの先は不可', () => {
    const s = rich();
    build(s, 'workshop', 0, 0);
    expect(upgrade(s, 'workshop').ok).toBe(false);
    for (let i = 0; i < 3; i++) advanceDay(s);
    const gold = s.gold;
    expect(upgrade(s, 'workshop').ok).toBe(true);
    expect(s.gold).toBe(gold - 500);
    expect(s.inventory.iron_ore).toBe(16);
    expect(facilityLevel(s, 'workshop')).toBe(1);
    expect(upgrade(s, 'workshop').ok).toBe(false);
    for (let i = 0; i < 5; i++) advanceDay(s);
    expect(facilityLevel(s, 'workshop')).toBe(2);
    expect(upgrade(s, 'workshop').ok).toBe(false);
    expect(upgrade(s, 'dorm').ok).toBe(false);
  });
});

describe('シナジー', () => {
  it('上下左右に隣接した完成済みの組だけ立つ。斜めや建設中は立たない', () => {
    const s = rich();
    place(s, 'workshop', 1, 1);
    place(s, 'alchemy', 2, 2);
    expect(activeSynergies(s)).toEqual([]);
    s.base.facilities[1].x = 2;
    s.base.facilities[1].y = 1;
    expect(activeSynergies(s).map((x) => x.id)).toEqual(['craft_street']);
    expect(synergyValue(s, 'craftDaysOff')).toBe(1);
    s.base.facilities[1].level = 0;
    s.base.facilities[1].construction = { toLevel: 1, untilDay: 9 };
    expect(activeSynergies(s)).toEqual([]);
    expect(synergyValue(s, 'craftDaysOff')).toBe(0);
  });

  it('宿舎を挟んで治療所と訓練所なら2組', () => {
    const s = rich();
    place(s, 'dorm', 2, 2);
    place(s, 'clinic', 2, 1);
    place(s, 'training', 2, 3);
    expect(activeSynergies(s).map((x) => x.id).sort()).toEqual(['morning_drill', 'quiet_dorm']);
    expect(synergyValue(s, 'fatigueRecover')).toBe(10);
    expect(synergyValue(s, 'idleExp')).toBe(2);
  });

  it('listSynergies は全3組', () => {
    expect(listSynergies().map((x) => x.id)).toEqual(['craft_street', 'quiet_dorm', 'morning_drill']);
  });
});

describe('施設勤務', () => {
  it('待機中の者を完成済みの工房に1人だけ置け、外すと待機に戻る', () => {
    const s = rich();
    const [a, b] = s.adventurers;
    expect(assignWorker(s, a.id, 'workshop').ok).toBe(false);
    place(s, 'workshop', 0, 0);
    place(s, 'clinic', 1, 0);
    expect(assignWorker(s, a.id, 'clinic').ok).toBe(false);
    expect(assignWorker(s, a.id, 'workshop').ok).toBe(true);
    expect(a.status).toBe('working');
    expect(a.assignment).toEqual({ facility: 'workshop' });
    expect(assignWorker(s, b.id, 'workshop').ok).toBe(false);
    expect(assignWorker(s, a.id, 'workshop').ok).toBe(false);
    expect(unassignWorker(s, a.id).ok).toBe(true);
    expect(a.status).toBe('idle');
    expect(a.assignment).toBeNull();
    expect(unassignWorker(s, a.id).ok).toBe(false);
  });
});
