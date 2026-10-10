import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/core/data';
import { newGame } from '../src/core/game';
import { arriveCandidates, capacity, dismiss, expireCandidates, hire, spawnCandidate } from '../src/core/recruit';
import { rngFor } from '../src/core/rng';
import type { GameState } from '../src/core/types';

const T = TUNING.game;

function bare(seed = 11): GameState {
  const s = newGame(seed);
  s.candidates = [];
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
    const s = bare();
    const [a, b] = s.adventurers;
    const gold = s.gold;
    b.status = 'away';
    expect(dismiss(s, b.id).ok).toBe(false);
    expect(dismiss(s, 'nobody').ok).toBe(false);
    expect(dismiss(s, a.id)).toEqual({ ok: true });
    expect(s.adventurers.some((x) => x.id === a.id)).toBe(false);
    expect(s.gold).toBe(gold);
  });
});
