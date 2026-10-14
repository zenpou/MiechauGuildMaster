import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TUNING } from '../src/core/data';
import { newGame } from '../src/core/game';
import { arriveCandidates, capacity, dismiss, expireCandidates, hire, spawnCandidate } from '../src/core/recruit';
import { rngFor } from '../src/core/rng';
import type { GameState } from '../src/core/types';
import { U_ALPHA, fullGame, registerUnique } from './helpers';

const T = TUNING.game;

/** 候補なし、募集が来はじめる日に立った状態 */
function bare(seed = 11): GameState {
  const s = newGame(seed);
  s.candidates = [];
  s.day = T.candidateFromDay;
  return s;
}

describe('候補者の到着', () => {
  it('評判Lv1は1〜2人、Lv3以上は2〜3人。到着日と期限(5日)が付く', () => {
    const counts = new Set<number>();
    for (let d = 0; d < 40; d++) {
      const s = bare();
      arriveCandidates(s, rngFor(1, 'recruit', d));
      counts.add(s.candidates.length);
      for (const c of s.candidates) expect(c).toMatchObject({ arrivedDay: s.day, expiresDay: s.day + T.candidateDays });
    }
    expect([...counts].sort()).toEqual([1, 2]);
    const hi = new Set<number>();
    for (let d = 0; d < 40; d++) {
      const s = bare();
      s.rep = 20;
      arriveCandidates(s, rngFor(1, 'recruit', d));
      hi.add(s.candidates.length);
    }
    expect([...hi].sort()).toEqual([2, 3]);
  });

  it(`保持は最大${T.candidateMax}人`, () => {
    const s = bare();
    s.rep = 60;
    for (let d = 0; d < 10; d++) arriveCandidates(s, rngFor(2, 'recruit', d));
    expect(s.candidates.length).toBe(T.candidateMax);
  });

  it('評判が高いほど候補者の質が上がる(成長率の平均)', () => {
    const avg = (rep: number) => {
      const s = bare();
      s.rep = rep;
      let t = 0;
      for (let i = 0; i < 60; i++) t += spawnCandidate(s, rngFor(3, 'q', i)).adv.growth;
      return t / 60;
    };
    expect(avg(60)).toBeGreaterThan(avg(0));
  });

  it('期限の日に消える', () => {
    const s = bare();
    arriveCandidates(s, rngFor(4, 'recruit', 0));
    const n = s.candidates.length;
    s.day += T.candidateDays - 1;
    expireCandidates(s);
    expect(s.candidates.length).toBe(n);
    s.day++;
    expireCandidates(s);
    expect(s.candidates.length).toBe(0);
  });

  it('同じ乱数なら同じ候補者', () => {
    const a = bare();
    const b = bare();
    arriveCandidates(a, rngFor(5, 'recruit', 3));
    arriveCandidates(b, rngFor(5, 'recruit', 3));
    expect(a.candidates).toEqual(b.candidates);
  });
});

describe('雇用', () => {
  it('契約金=日給×4を払い、名簿に入り、雇用日とお知らせと台帳が付く', () => {
    const s = bare();
    const c = spawnCandidate(s, rngFor(6, 'c'));
    const gold = s.gold;
    expect(hire(s, c.adv.id)).toEqual({ ok: true });
    const fee = c.adv.salary * T.hireSalaryDays;
    expect(s.gold).toBe(gold - fee);
    expect(s.candidates).toEqual([]);
    const a = s.adventurers.find((x) => x.id === c.adv.id)!;
    expect(a.history.hiredDay).toBe(s.day);
    expect(a.status).toBe('idle');
    expect(s.ledger.some((l) => l.amount === -fee && l.label.includes('契約金'))).toBe(true);
    expect(s.notices[0].text).toContain(a.name);
  });

  it('才能ある者を雇うと hire_talent が積まれる', () => {
    const s = bare();
    const c = spawnCandidate(s, rngFor(7, 'c'));
    c.adv.growth = 1.3;
    hire(s, c.adv.id);
    expect(s.pendingTags).toContain('hire_talent');
    const s2 = bare();
    const c2 = spawnCandidate(s2, rngFor(7, 'c'));
    c2.adv.growth = 1;
    for (const k of Object.keys(c2.adv.apt) as (keyof typeof c2.adv.apt)[]) c2.adv.apt[k] = 50;
    hire(s2, c2.adv.id);
    expect(s2.pendingTags).not.toContain('hire_talent');
  });

  it('資金不足・上限・存在しない候補者は ok:false で状態を変えない', () => {
    const s = bare();
    const c = spawnCandidate(s, rngFor(8, 'c'));
    s.gold = c.adv.salary * T.hireSalaryDays - 1;
    let before = structuredClone(s);
    expect(hire(s, c.adv.id).ok).toBe(false);
    expect(s).toEqual(before);
    expect(hire(s, 'nobody').ok).toBe(false);
    s.gold = 10000;
    expect(capacity(s)).toBe(T.baseCapacity);
    while (s.adventurers.length < capacity(s)) s.adventurers.push({ ...structuredClone(s.adventurers[0]), id: `x${s.adventurers.length}` });
    before = structuredClone(s);
    expect(hire(s, c.adv.id).ok).toBe(false);
    expect(s).toEqual(before);
  });

  it('宿舎の capacity 効果で上限が増える(建設中は増えない)', () => {
    const s = bare();
    s.base.facilities.push({ id: 'dorm', level: 0, x: 0, y: 0, builtDay: 1, construction: { toLevel: 1, untilDay: 3 } });
    expect(capacity(s)).toBe(T.baseCapacity);
    s.base.facilities[0].level = 1;
    s.base.facilities[0].construction = null;
    expect(capacity(s)).toBe(T.baseCapacity + 2);
  });
});

describe('解雇', () => {
  it('待機中だけ解雇でき、費用は掛からない', () => {
    const s = fullGame(11);
    const [a, b] = s.adventurers.filter((x) => !x.unique);
    const gold = s.gold;
    b.status = 'away';
    expect(dismiss(s, b.id).ok).toBe(false);
    expect(dismiss(s, 'nobody').ok).toBe(false);
    expect(dismiss(s, a.id)).toEqual({ ok: true });
    expect(s.adventurers.some((x) => x.id === a.id)).toBe(false);
    expect(s.gold).toBe(gold);
  });
});

describe('ユニーク冒険者の出現', () => {
  let unregister: () => void;
  beforeEach(() => { unregister = registerUnique(U_ALPHA); });
  afterEach(() => unregister());
  it('10日目以降・評判8以上で一度だけ現れ、期限10日、契約金なしで雇える', () => {
    const uniques = (s: GameState) => s.candidates.filter((c) => c.adv.unique === 'u_alpha');
    const early = bare();
    early.day = 9;
    early.rep = 8;
    arriveCandidates(early, rngFor(1, 'recruit', 9));
    const lowRep = bare();
    lowRep.day = 10;
    lowRep.rep = 7;
    arriveCandidates(lowRep, rngFor(1, 'recruit', 10));
    expect(uniques(early)).toEqual([]);
    expect(uniques(lowRep)).toEqual([]);

    const s = bare();
    s.day = 10;
    s.rep = 8;
    arriveCandidates(s, rngFor(1, 'recruit', 10));
    const [c] = uniques(s);
    expect(c).toMatchObject({ arrivedDay: 10, expiresDay: 20 });
    expect(c.adv.skills).toEqual(['u_alpha_skill']);
    s.day = 11;
    arriveCandidates(s, rngFor(1, 'recruit', 11));
    expect(uniques(s)).toHaveLength(1);

    s.gold = 0;
    expect(hire(s, c.adv.id)).toEqual({ ok: true });
    expect(s.gold).toBe(0);
    expect(s.adventurers.find((a) => a.id === c.adv.id)?.unique).toBe('u_alpha');
    expect(s.flags['unique:u_alpha:hired']).toBe(11);
    s.day = 30;
    arriveCandidates(s, rngFor(1, 'recruit', 30));
    expect(uniques(s)).toEqual([]);
  });

  it('ユニークの出現は通常の候補者の乱数列を変えない', () => {
    const a = bare();
    const b = bare();
    b.day = 10;
    b.rep = 8;
    a.day = 10;
    a.rep = 8;
    a.flags['unique:u_alpha'] = true;
    arriveCandidates(a, rngFor(1, 'recruit', 10));
    arriveCandidates(b, rngFor(1, 'recruit', 10));
    expect(b.candidates.filter((c) => !c.adv.unique).map((c) => c.adv.name)).toEqual(a.candidates.map((c) => c.adv.name));
  });
});

describe('酒場', () => {
  const put = (s: GameState, id: string, x: number, level = 1) => {
    s.base.facilities.push({ id, level, x, y: 0, builtDay: 1, construction: null });
  };

  it('毎日の来訪者が 酒場 Lv1 で+1、Lv2 で+2、宿舎と隣り合う(冒険者の宿)とさらに+1。上限は変わらない', () => {
    for (let d = 0; d < 12; d++) {
      const arrive = (setup: (s: GameState) => void) => {
        const s = bare();
        setup(s);
        return arriveCandidates(s, rngFor(3, 'arrive', d)).length;
      };
      const n0 = arrive(() => {});
      expect(arrive((s) => put(s, 'tavern', 0))).toBe(n0 + 1);
      expect(arrive((s) => put(s, 'tavern', 0, 2))).toBe(n0 + 2);
      expect(arrive((s) => { put(s, 'tavern', 0, 2); put(s, 'dorm', 1); })).toBe(n0 + 3);
      expect(arrive((s) => { put(s, 'tavern', 0, 2); put(s, 'dorm', 2); })).toBe(n0 + 2);
    }
    const full = bare();
    put(full, 'tavern', 0, 2);
    put(full, 'dorm', 1);
    for (let d = 0; d < 5; d++) arriveCandidates(full, rngFor(4, 'full', d));
    expect(full.candidates).toHaveLength(T.candidateMax);
  });

  it('候補者の質が上がる。同じ乱数なら能力は下がらず、合計は上がる', () => {
    let plain = 0;
    let boosted = 0;
    for (let i = 0; i < 30; i++) {
      const a = spawnCandidate(bare(), rngFor(5, 'quality', i)).adv;
      const s = bare();
      put(s, 'tavern', 0, 2);
      put(s, 'map_room', 1);
      const b = spawnCandidate(s, rngFor(5, 'quality', i)).adv;
      for (const k of ['hp', 'atk', 'def', 'mag', 'spd'] as const) expect(b.base[k], `${i} ${k}`).toBeGreaterThanOrEqual(a.base[k]);
      expect(b.growth).toBeGreaterThanOrEqual(a.growth);
      plain += a.base.hp + a.base.atk + a.base.def + a.base.mag + a.base.spd;
      boosted += b.base.hp + b.base.atk + b.base.def + b.base.mag + b.base.spd;
    }
    expect(boosted).toBeGreaterThan(plain);
  });
});

describe('募集が来はじめる日(candidateFromDay)', () => {
  it('その日より前は候補が来ず、当日から来る', () => {
    const keep = [T.candidateFromDay, T.startCandidates];
    T.candidateFromDay = 4;
    try {
      const s = newGame(1);
      s.candidates = [];
      s.day = 3;
      expect(arriveCandidates(s, rngFor(1, 'recruit', 3))).toEqual([]);
      s.day = 4;
      expect(arriveCandidates(s, rngFor(1, 'recruit', 4)).length).toBeGreaterThan(0);
    } finally {
      [T.candidateFromDay, T.startCandidates] = keep;
    }
  });

  it('初日の候補の人数は startCandidates', () => {
    expect(newGame(1).candidates).toHaveLength(T.startCandidates);
  });
});
