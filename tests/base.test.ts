import { describe, expect, it } from 'vitest';
import {
  activeSynergies, assignWorker, bonus, build, canBuild, canDemolish, completeConstructions, dailyProduction, demolish,
  demolishGold, facilityEffect, facilityLevel, listSynergies, synergyValue, unassignWorker, upgrade,
} from '../src/core/base';
import { effectiveStats, generateAdventurer } from '../src/core/adventurer';
import { FACILITIES, FACILITY, RECIPES, SYNERGIES, TUNING } from '../src/core/data';
import { advanceDay, newGame } from '../src/core/game';
import { accept, activeMax, activeQuests } from '../src/core/quests';
import { rngFor } from '../src/core/rng';
import { completeTraining, trainableSkills, trainDays, trainSkill } from '../src/core/training';
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

type Cost = [gold: number, materials: Record<string, number>, days: number];
/** プラン(docs/plans/2026-10-10-phase6.md「施設15種・シナジー13組」)の表の写し。JSON の打ち間違いをここで捕まえる */
const NEW_FACILITIES: Record<string, {
  category: string; upkeep: number; costs: [Cost, Cost]; effects: Record<string, number>[]; work?: [number, string];
}> = {
  sawmill: {
    category: 'production', upkeep: 8, costs: [[250, {}, 3], [500, { stone: 4 }, 4]],
    effects: [{ produceLumber: 1 }, { produceLumber: 2 }], work: [1, 'dex'],
  },
  quarry: {
    category: 'production', upkeep: 8, costs: [[250, {}, 3], [500, { lumber: 4 }, 4]],
    effects: [{ produceStone: 1 }, { produceStone: 2 }], work: [1, 'atk'],
  },
  library: {
    category: 'training', upkeep: 10, costs: [[300, { lumber: 6, stone: 2 }, 3], [600, { lumber: 8, stone: 4 }, 4]],
    effects: [{ promoDiscount: 0.3, trainDaysOff: 0 }, { promoDiscount: 0.5, trainDaysOff: 1 }],
  },
  bath: {
    category: 'recovery', upkeep: 9, costs: [[280, { stone: 6, lumber: 3 }, 3], [560, { stone: 8, lumber: 4 }, 4]],
    effects: [{ fatigueRecover: 8 }, { fatigueRecover: 14 }],
  },
  map_room: {
    category: 'info', upkeep: 9, costs: [[300, { lumber: 5, stone: 3 }, 3], [600, { lumber: 7, stone: 5 }, 4]],
    effects: [{ hiddenFind: 0.15 }, { hiddenFind: 0.25 }],
  },
  tavern: {
    category: 'info', upkeep: 12, costs: [[280, { lumber: 6, stone: 2 }, 3], [560, { lumber: 8, stone: 4 }, 4]],
    effects: [{ candidateBonus: 1, recruitQuality: 0.1 }, { candidateBonus: 2, recruitQuality: 0.2 }],
  },
  reception: {
    category: 'office', upkeep: 10, costs: [[300, { lumber: 5, stone: 3 }, 3], [600, { lumber: 7, stone: 5 }, 4]],
    effects: [{ questSlots: 1, boardBonus: 1 }, { questSlots: 2, boardBonus: 1 }],
  },
  market: {
    category: 'office', upkeep: 10, costs: [[300, { lumber: 4, stone: 4 }, 3], [600, { lumber: 6, stone: 6 }, 4]],
    effects: [{ sellMult: 0.1 }, { sellMult: 0.2 }],
  },
  watchtower: {
    category: 'office', upkeep: 8, costs: [[280, { lumber: 8, stone: 2 }, 3], [560, { lumber: 10, stone: 4 }, 4]],
    effects: [{ roadEncounterOff: 0.15, escortGoldMult: 0.1 }, { roadEncounterOff: 0.25, escortGoldMult: 0.2 }],
  },
  smithy: {
    category: 'production', upkeep: 10, costs: [[320, { stone: 6, iron_ore: 2 }, 4], [640, { stone: 8, iron_ore: 4 }, 5]],
    effects: [{ craftGoldOff: 0.15 }, { craftGoldOff: 0.3 }],
  },
};

const NEW_SYNERGIES: Record<string, [a: string, b: string, effect: Record<string, number>]> = {
  stockyard: ['sawmill', 'quarry', { produceLumber: 1, produceStone: 1 }],
  study_hall: ['library', 'training', { expMult: 0.1, trainDaysOff: 1 }],
  hot_spring: ['bath', 'clinic', { injuryDays: -1 }],
  warm_dorm: ['bath', 'dorm', { fatigueRecover: 8 }],
  info_den: ['map_room', 'tavern', { hiddenFind: 0.1, recruitQuality: 0.1 }],
  adventurers_inn: ['tavern', 'dorm', { candidateBonus: 1 }],
  ledger_desk: ['reception', 'market', { questSlots: 1 }],
  forge_works: ['smithy', 'workshop', { craftGoldOff: 0.1 }],
  trade_post: ['market', 'smithy', { sellMult: 0.1 }],
  escort_office: ['watchtower', 'reception', { escortGoldMult: 0.15, roadEncounterOff: 0.1 }],
};

/** 建材も足りる状態 */
function stocked(seed = 5): GameState {
  const s = rich(seed);
  s.gold = 100000;
  s.inventory = { ...s.inventory, lumber: 100, stone: 100, iron_ore: 100 };
  return s;
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

  it('listSynergies は全13組', () => {
    expect(listSynergies().map((x) => x.id)).toEqual([
      'craft_street', 'quiet_dorm', 'morning_drill', ...Object.keys(NEW_SYNERGIES),
    ]);
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

describe('新しい10施設', () => {
  it('定義はプランの表どおり(区分・費用・維持費・Lvごとの効果・勤務)。既存5施設の後ろに並ぶ', () => {
    expect(FACILITIES.map((f) => f.id)).toEqual(['dorm', 'workshop', 'alchemy', 'clinic', 'training', ...Object.keys(NEW_FACILITIES)]);
    for (const [id, d] of Object.entries(NEW_FACILITIES)) {
      const def = FACILITY[id];
      expect(def.category, id).toBe(d.category);
      expect(def.maxLevel, id).toBe(2);
      expect(def.upkeep, id).toBe(d.upkeep);
      expect(def.costs.map((c) => [c.gold, c.materials, c.days]), id).toEqual(d.costs);
      expect(def.effects, id).toEqual(d.effects);
      expect(def.effectText, id).toHaveLength(2);
      expect(def.name.length * def.desc.length, id).toBeGreaterThan(0);
      expect(def.workSlots ? [def.workSlots, def.workStat] : undefined, id).toEqual(d.work);
    }
  });

  it('建てると建設中(効果なし)、完成日に Lv1、増築中は Lv1 の効果のまま、完成で Lv2 の効果', () => {
    for (const [id, d] of Object.entries(NEW_FACILITIES)) {
      const s = stocked();
      const before: Record<string, number> = { gold: s.gold, ...s.inventory };
      expect(build(s, id, 2, 2), id).toEqual({ ok: true });
      expect(s.gold, id).toBe(before.gold - d.costs[0][0]);
      for (const [item, n] of Object.entries(d.costs[0][1])) expect(s.inventory[item], `${id} ${item}`).toBe(before[item] - n);
      for (const key of Object.keys(d.effects[0])) expect(facilityEffect(s, id, key), id).toBe(0);
      s.day += d.costs[0][2] - 1;
      completeConstructions(s, []);
      expect(facilityLevel(s, id), id).toBe(0);
      s.day++;
      completeConstructions(s, []);
      expect(facilityLevel(s, id), id).toBe(1);
      for (const [key, v] of Object.entries(d.effects[0])) expect(facilityEffect(s, id, key), `${id} ${key}`).toBe(v);
      expect(upgrade(s, id), id).toEqual({ ok: true });
      for (const [key, v] of Object.entries(d.effects[0])) expect(facilityEffect(s, id, key), `${id} ${key}`).toBe(v);
      s.day += d.costs[1][2];
      completeConstructions(s, []);
      expect(facilityLevel(s, id), id).toBe(2);
      for (const [key, v] of Object.entries(d.effects[1])) expect(facilityEffect(s, id, key), `${id} ${key}`).toBe(v);
      expect(upgrade(s, id).ok, id).toBe(false);
    }
  });

  it('建材が足りなければ断り、状態を変えない。製材所と石切場の Lv1 は建材なしで建つ', () => {
    const s = rich();
    s.inventory = { ...s.inventory, lumber: 5, stone: 10 };
    const gold = s.gold;
    expect(canBuild(s, 'library', 0, 0)).toEqual({ ok: false, reason: '木材が足りません' });
    expect(build(s, 'library', 0, 0).ok).toBe(false);
    expect(s.base.facilities).toEqual([]);
    expect([s.gold, s.inventory.lumber, s.inventory.stone]).toEqual([gold, 5, 10]);
    s.inventory.stone = 1;
    expect(canBuild(s, 'smithy', 0, 0)).toEqual({ ok: false, reason: '石材が足りません' });
    s.inventory = { ...s.inventory, lumber: 0, stone: 0 };
    expect(build(s, 'sawmill', 0, 0)).toEqual({ ok: true });
    expect(build(s, 'quarry', 1, 0)).toEqual({ ok: true });
    s.day += 3;
    completeConstructions(s, []);
    // 製材所の増築には石材、石切場の増築には木材が要る
    expect(upgrade(s, 'sawmill')).toEqual({ ok: false, reason: '石材が足りません' });
    expect(upgrade(s, 'quarry')).toEqual({ ok: false, reason: '木材が足りません' });
  });

  it('15施設すべてを5×5の区画に重ならず建てられる', () => {
    const s = stocked();
    expect(FACILITIES).toHaveLength(15);
    expect([s.base.width, s.base.height]).toEqual([5, 5]);
    FACILITIES.forEach((f, i) => {
      const [x, y] = [i % 5, Math.floor(i / 5)];
      expect(canBuild(s, f.id, x, y), f.id).toEqual({ ok: true });
      expect(build(s, f.id, x, y), f.id).toEqual({ ok: true });
    });
    expect(s.base.facilities).toHaveLength(15);
  });

  it('配置例: 15施設で12組が同時に立つ(浴場・治療所・宿舎の3組は三角形なので、格子では13組を同時には立てられない)', () => {
    const s = rich();
    const layout = [
      ['library', 'clinic', 'sawmill', 'quarry', null],
      ['training', 'dorm', 'bath', null, null],
      ['map_room', 'tavern', null, null, null],
      ['watchtower', 'reception', 'market', 'smithy', 'workshop'],
      [null, null, null, null, 'alchemy'],
    ];
    layout.forEach((row, y) => row.forEach((id, x) => { if (id) place(s, id, x, y); }));
    expect(s.base.facilities.map((f) => f.id).sort()).toEqual(FACILITIES.map((f) => f.id).sort());
    expect(activeSynergies(s).map((x) => x.id).sort()).toEqual(SYNERGIES.map((x) => x.id).filter((id) => id !== 'hot_spring').sort());
  });
});

describe('13組のシナジー', () => {
  it('新しい10組はプランの組み合わせと効果どおりで、どちらの施設も実在する', () => {
    for (const [id, [a, b, effect]] of Object.entries(NEW_SYNERGIES)) {
      const syn = SYNERGIES.find((x) => x.id === id);
      expect(syn && [syn.a, syn.b, syn.effect], id).toEqual([a, b, effect]);
      expect(syn!.name.length * syn!.desc.length, id).toBeGreaterThan(0);
    }
    for (const syn of SYNERGIES) {
      expect(FACILITY[syn.a], syn.id).toBeDefined();
      expect(FACILITY[syn.b], syn.id).toBeDefined();
    }
    expect(SYNERGIES).toHaveLength(13);
    expect(new Set(SYNERGIES.map((x) => [x.a, x.b].sort().join('+'))).size).toBe(13);
  });

  it('どの組も上下左右に隣り合わせたときだけ立ち、1マス離すか斜めだと立たない', () => {
    const spots: [number, number, boolean][] = [[3, 2, true], [2, 3, true], [1, 2, true], [4, 2, false], [3, 3, false], [2, 0, false]];
    for (const syn of SYNERGIES) {
      for (const [bx, by, on] of spots) {
        const s = rich();
        place(s, syn.a, 2, 2);
        place(s, syn.b, bx, by);
        expect(activeSynergies(s).map((x) => x.id), `${syn.id} ${bx},${by}`).toEqual(on ? [syn.id] : []);
        for (const [key, v] of Object.entries(syn.effect)) expect(synergyValue(s, key), `${syn.id} ${key}`).toBe(on ? v : 0);
      }
    }
  });
});

describe('bonus', () => {
  it('完成済み施設の効果と成立したシナジーの合計。建設中の新築は数えず、増築中は前のLvで数える', () => {
    const s = rich();
    expect(bonus(s, 'fatigueRecover')).toBe(0);
    place(s, 'bath', 2, 2, 2);
    place(s, 'clinic', 2, 1);
    place(s, 'dorm', 3, 2);
    // 浴場と治療所(湯治)、浴場と宿舎(大浴場つきの寮)。治療所と宿舎は斜めなので静かな寮は立たない
    expect(activeSynergies(s).map((x) => x.id).sort()).toEqual(['hot_spring', 'warm_dorm']);
    expect(bonus(s, 'fatigueRecover')).toBe(14 + 5 + 8);
    expect(bonus(s, 'injuryDays')).toBe(-1 - 1);
    expect(bonus(s, 'capacity')).toBe(2);
    expect(bonus(s, 'nothing')).toBe(0);
    s.base.facilities[1].construction = { toLevel: 2, untilDay: 99 };
    expect(bonus(s, 'fatigueRecover')).toBe(14 + 5 + 8);
    s.base.facilities.push({ id: 'map_room', level: 0, x: 0, y: 0, builtDay: 1, construction: { toLevel: 1, untilDay: 9 } });
    place(s, 'tavern', 1, 0);
    expect(bonus(s, 'hiddenFind')).toBe(0);
    expect(bonus(s, 'recruitQuality')).toBe(0.1);
    s.base.facilities[3] = { ...s.base.facilities[3], level: 1, construction: null };
    expect(bonus(s, 'hiddenFind')).toBeCloseTo(0.15 + 0.1, 10);
    expect(bonus(s, 'recruitQuality')).toBeCloseTo(0.1 + 0.1, 10);
  });

  it('既存5施設だけなら、これまでの facilityEffect + synergyValue と同じ値になる', () => {
    const s = rich();
    place(s, 'training', 2, 2, 2);
    place(s, 'dorm', 2, 3);
    place(s, 'clinic', 1, 3, 2);
    place(s, 'workshop', 0, 0, 2);
    place(s, 'alchemy', 1, 0);
    expect(bonus(s, 'expMult')).toBe(facilityEffect(s, 'training', 'expMult'));
    expect(bonus(s, 'injuryDays')).toBe(facilityEffect(s, 'clinic', 'injuryDays'));
    expect(bonus(s, 'fatigueRecover')).toBe(facilityEffect(s, 'clinic', 'fatigueRecover') + synergyValue(s, 'fatigueRecover'));
    expect(bonus(s, 'idleExp')).toBe(synergyValue(s, 'idleExp'));
    expect(bonus(s, 'capacity')).toBe(facilityEffect(s, 'dorm', 'capacity'));
  });
});

describe('毎日の産出', () => {
  it('製材所は Lv1 で木材+1、Lv2 で+2。石切場は石材。無い・建設中なら産まない。台帳とお知らせには出さない', () => {
    const s = rich();
    const notices: string[] = [];
    const ledgerSize = s.ledger.length;
    dailyProduction(s, notices);
    expect(s.inventory.lumber ?? 0).toBe(0);
    s.base.facilities.push({ id: 'sawmill', level: 0, x: 0, y: 0, builtDay: 1, construction: { toLevel: 1, untilDay: 9 } });
    dailyProduction(s, notices);
    expect(s.inventory.lumber ?? 0).toBe(0);
    s.base.facilities[0] = { ...s.base.facilities[0], level: 1, construction: null };
    dailyProduction(s, notices);
    expect(s.inventory.lumber).toBe(1);
    s.base.facilities[0].level = 2;
    dailyProduction(s, notices);
    expect(s.inventory.lumber).toBe(3);
    place(s, 'quarry', 4, 4);
    dailyProduction(s, notices);
    expect([s.inventory.lumber, s.inventory.stone]).toEqual([5, 1]);
    expect(notices).toEqual([]);
    expect(s.ledger.length).toBe(ledgerSize);
  });

  it('勤務者の能力が基準(12)以上ならさらに+1。製材所は器用、石切場は攻撃を見る', () => {
    const s = rich();
    place(s, 'sawmill', 0, 0);
    place(s, 'quarry', 4, 4);
    const [a, b] = s.adventurers;
    const min = TUNING.craft.workerStatMin;
    expect(min).toBe(12);
    a.base.dex = 1;
    b.base = { ...b.base, atk: 1, dex: 60 };
    expect(effectiveStats(a).dex).toBeLessThan(min);
    expect(effectiveStats(b).atk).toBeLessThan(min);
    expect(assignWorker(s, a.id, 'sawmill').ok).toBe(true);
    expect(assignWorker(s, b.id, 'quarry').ok).toBe(true);
    dailyProduction(s, []);
    expect([s.inventory.lumber, s.inventory.stone]).toEqual([1, 1]);
    a.base.dex = 60;
    b.base.atk = 60;
    expect(effectiveStats(a).dex).toBeGreaterThanOrEqual(min);
    expect(effectiveStats(b).atk).toBeGreaterThanOrEqual(min);
    dailyProduction(s, []);
    expect([s.inventory.lumber, s.inventory.stone]).toEqual([3, 3]);
    expect(unassignWorker(s, a.id).ok).toBe(true);
    dailyProduction(s, []);
    expect([s.inventory.lumber, s.inventory.stone]).toEqual([4, 5]);
  });

  it('製材所と石切場が隣り合うと(資材置き場)どちらも+1', () => {
    const s = rich();
    place(s, 'sawmill', 1, 1, 2);
    place(s, 'quarry', 2, 1);
    dailyProduction(s, []);
    expect([s.inventory.lumber, s.inventory.stone]).toEqual([3, 2]);
  });
});

describe('解体', () => {
  it('返金の割合の既定は0.5', () => {
    expect(TUNING.game.demolishRefund).toBe(0.5);
  });

  it('払った建設費と増築費の合計 × demolishRefund を資金に戻し、台帳に「解体: 施設名」で載せ、区画から消す。シナジーも消える', () => {
    const s = rich();
    place(s, 'dorm', 2, 2, 2);
    place(s, 'clinic', 2, 1);
    expect(activeSynergies(s).map((x) => x.id)).toEqual(['quiet_dorm']);
    const paid = FACILITY.dorm.costs[0].gold + FACILITY.dorm.costs[1].gold;
    expect(paid * TUNING.game.demolishRefund).toBe(300);
    expect(demolishGold(s, 'dorm')).toBe(300);
    expect(demolish(s, 'dorm')).toEqual({ ok: true });
    expect(s.gold).toBe(5000 + 300);
    expect(s.ledger[0]).toEqual({ day: s.day, label: '解体: 宿舎', amount: 300 });
    expect(s.base.facilities.map((f) => f.id)).toEqual(['clinic']);
    expect(facilityLevel(s, 'dorm')).toBe(0);
    expect(activeSynergies(s)).toEqual([]);
    expect(canBuild(s, 'dorm', 2, 2)).toEqual({ ok: true });
  });

  it('Lv1 なら建設費だけがもとになる。端数は四捨五入', () => {
    const s = rich();
    place(s, 'workshop', 0, 0);
    expect(demolish(s, 'workshop')).toEqual({ ok: true });
    expect(s.gold).toBe(5000 + 125);
    const rate = TUNING.game.demolishRefund;
    try {
      TUNING.game.demolishRefund = 0.25;
      place(s, 'workshop', 0, 0);
      expect(demolish(s, 'workshop')).toEqual({ ok: true });
      expect(s.gold).toBe(5000 + 125 + 63);
    } finally {
      TUNING.game.demolishRefund = rate;
    }
  });

  it('勤務中の冒険者は待機に戻り、ほかの施設の勤務者はそのまま', () => {
    const s = rich();
    place(s, 'sawmill', 0, 0);
    place(s, 'quarry', 1, 0);
    const [a, b] = s.adventurers;
    expect(assignWorker(s, a.id, 'sawmill').ok).toBe(true);
    expect(assignWorker(s, b.id, 'quarry').ok).toBe(true);
    expect(demolish(s, 'sawmill')).toEqual({ ok: true });
    expect([a.status, a.assignment]).toEqual(['idle', null]);
    expect([b.status, b.assignment]).toEqual(['working', { facility: 'quarry' }]);
  });

  it('工事中(新築・増築とも)は断り、状態を変えない', () => {
    const s = stocked();
    expect(build(s, 'dorm', 0, 0).ok).toBe(true);
    const before = structuredClone(s);
    expect(demolish(s, 'dorm')).toEqual({ ok: false, reason: '宿舎は工事中です' });
    expect(s).toEqual(before);
    s.day += FACILITY.dorm.costs[0].days;
    completeConstructions(s, []);
    expect(upgrade(s, 'dorm').ok).toBe(true);
    expect(demolish(s, 'dorm')).toEqual({ ok: false, reason: '宿舎は工事中です' });
  });

  it('作りかけの品がある工房は断る。品の無い調合所は解体できる', () => {
    const s = rich();
    place(s, 'workshop', 0, 0);
    place(s, 'alchemy', 1, 0);
    const r = RECIPES.find((x) => x.facility === 'workshop')!;
    s.crafts.push({ id: 'c1', recipeId: r.id, startDay: 1, doneDay: 5, workers: [] });
    const before = structuredClone(s);
    expect(demolish(s, 'workshop')).toEqual({ ok: false, reason: `工房では${r.name}を作っています` });
    expect(s).toEqual(before);
    expect(demolish(s, 'alchemy')).toEqual({ ok: true });
    s.crafts = [];
    expect(demolish(s, 'workshop')).toEqual({ ok: true });
  });

  it('訓練中の人がいる訓練所は断り、訓練が終われば解体できる', () => {
    const s = rich();
    place(s, 'training', 0, 0);
    const a = s.adventurers[0];
    const [skill] = trainableSkills(s, a.id);
    expect(trainSkill(s, a.id, skill.id).ok).toBe(true);
    const before = structuredClone(s);
    expect(demolish(s, 'training')).toEqual({ ok: false, reason: `訓練所では${a.name}が訓練中です` });
    expect(s).toEqual(before);
    s.day += trainDays(s);
    completeTraining(s, []);
    expect(demolish(s, 'training')).toEqual({ ok: true });
  });

  it('建っていない施設・知らない施設は断る。戻る金額は0', () => {
    const s = rich();
    const before = structuredClone(s);
    expect(demolish(s, 'dorm')).toEqual({ ok: false, reason: 'その施設はありません' });
    expect(demolish(s, 'nope')).toEqual({ ok: false, reason: 'その施設はありません' });
    expect(s).toEqual(before);
    expect([demolishGold(s, 'dorm'), demolishGold(s, 'nope')]).toEqual([0, 0]);
  });

  it('canDemolish は状態を変えずに、demolish と同じ可否と理由を返す', () => {
    const s = rich();
    place(s, 'workshop', 0, 0);
    const r = RECIPES.find((x) => x.facility === 'workshop')!;
    s.crafts.push({ id: 'c1', recipeId: r.id, startDay: 1, doneDay: 5, workers: [] });
    const before = structuredClone(s);
    expect(canDemolish(s, 'workshop')).toEqual({ ok: false, reason: `工房では${r.name}を作っています` });
    expect(canDemolish(s, 'dorm')).toEqual({ ok: false, reason: 'その施設はありません' });
    expect(s).toEqual(before);
    s.crafts = [];
    expect(canDemolish(s, 'workshop')).toEqual({ ok: true });
    expect(s.base.facilities).toEqual(before.base.facilities);
  });

  it('宿舎を壊すと名簿が定員を超えるときは断る。収まる人数なら壊せる', () => {
    const s = rich();
    place(s, 'dorm', 0, 0);
    const base = TUNING.game.baseCapacity;
    while (s.adventurers.length < base + 1) s.adventurers.push(generateAdventurer(rngFor(1, 'extra', s.adventurers.length), { id: `x${s.adventurers.length}` }));
    const before = structuredClone(s);
    const r = demolish(s, 'dorm');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toContain('定員');
    expect(s).toEqual(before);
    expect(canDemolish(s, 'dorm').ok).toBe(false);
    s.adventurers.length = base;
    expect(canDemolish(s, 'dorm')).toEqual({ ok: true });
    expect(demolish(s, 'dorm')).toEqual({ ok: true });
  });

  it('宿舎以外は、名簿が定員いっぱいでも壊せる', () => {
    const s = rich();
    place(s, 'dorm', 0, 0);
    place(s, 'workshop', 1, 0);
    while (s.adventurers.length < base(s)) s.adventurers.push(generateAdventurer(rngFor(1, 'extra', s.adventurers.length), { id: `x${s.adventurers.length}` }));
    expect(demolish(s, 'workshop')).toEqual({ ok: true });
  });

  it('受付を壊しても、受けている依頼は消えない。枠が減るので新しい依頼は受けられない', () => {
    const s = rich();
    place(s, 'reception', 0, 0);
    const quest = (id: string, status: 'accepted' | 'posted') => ({
      id, templateId: null, type: 'deliver' as const, town: null, name: id, desc: '', target: {}, rewardGold: 10, rewardRep: 1,
      postedDay: s.day, acceptBy: null, dueDay: null, departDay: null, status, progress: 0, unlocks: [],
    });
    const open = activeMax(s);
    s.quests = [...Array.from({ length: open }, (_, i) => quest(`a${i}`, 'accepted')), quest('p1', 'posted')];
    expect(demolish(s, 'reception')).toEqual({ ok: true });
    expect(activeMax(s)).toBeLessThan(open);
    expect(activeQuests(s)).toHaveLength(open);
    expect(accept(s, 'p1').ok).toBe(false);
  });
});

/** その時点の名簿の定員(基本 + 宿舎) */
const base = (s: GameState) => TUNING.game.baseCapacity + facilityEffect(s, 'dorm', 'capacity');
