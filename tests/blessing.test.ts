import { describe, expect, it } from 'vitest';
import { blessingStatus, canBless, tickBlessing } from '../src/core/blessing';
import { TUNING } from '../src/core/data';
import { advanceDay, dispatch, newGame } from '../src/core/game';
import { migrate } from '../src/core/save';
import { markStorySeen } from '../src/core/story';
import { SAVE_VERSION, type DispatchOrder, type GameState } from '../src/core/types';
import { fullGame } from './helpers';

const B = TUNING.blessing;

/** 第一章を読み終えた状態(祝福が解禁される) */
function unlocked(seed = 1): GameState {
  const s = fullGame(seed);
  markStorySeen(s, 'prologue');
  s.day = 2;
  markStorySeen(s, 'ch1');
  return s;
}

function order(s: GameState, o: Partial<DispatchOrder> = {}): DispatchOrder {
  const ids = s.adventurers.filter((a) => a.status === 'idle').slice(0, 4).map((a) => a.id);
  return {
    partyIds: ids, leaderId: ids[0], action: 'explore',
    target: { dungeon: 'forest_cave', floor: 'f1' },
    policy: 'standard', days: 2, items: {},
    ...o,
  };
}

describe('アイリスの祝福: 溜まる・溢れる', () => {
  it('第一章を読むまでは解禁されず、溜まらない', () => {
    const s = fullGame(1);
    expect(blessingStatus(s).unlocked).toBe(false);
    expect(canBless(s)).toBe(false);
    for (let i = 0; i < 5; i++) advanceDay(s);
    expect(s.blessing.charges).toBe(0);
  });

  it('解禁後は日ごとに1つ溜まり、上限で止まる', () => {
    const s = unlocked();
    expect(s.blessing.charges).toBe(0);
    for (let i = 1; i <= B.max; i++) {
      advanceDay(s);
      expect(s.blessing.charges).toBe(i);
    }
    advanceDay(s);
    expect(s.blessing.charges).toBe(B.max);
    expect(canBless(s)).toBe(true);
  });

  it('上限のまま feverAfterDays 日経つと発熱し、feverDays 日は使えず、残りは0に戻る。熱が引けばまた溜まる', () => {
    const s = unlocked();
    for (let i = 0; i < B.max; i++) advanceDay(s);
    const fullDay = s.day;
    for (let i = 0; i < B.feverAfterDays - 1; i++) {
      advanceDay(s);
      expect(blessingStatus(s).fever).toBe(false);
    }
    const notices: string[] = [];
    const rep = advanceDay(s);
    notices.push(...rep.notices);
    expect(s.day).toBe(fullDay + B.feverAfterDays);
    expect(blessingStatus(s).fever).toBe(true);
    expect(s.blessing.charges).toBe(0);
    expect(canBless(s)).toBe(false);
    expect(notices.some((n) => n.includes('熱'))).toBe(true);
    for (let i = 0; i < B.feverDays; i++) {
      expect(blessingStatus(s).fever).toBe(true);
      advanceDay(s);
    }
    expect(blessingStatus(s).fever).toBe(false);
    expect(s.blessing.charges).toBe(1);
  });

  it('使えば満杯の日数は数え直す(毎日使っていれば発熱しない)', () => {
    const s = unlocked();
    for (let i = 0; i < 20; i++) {
      advanceDay(s);
      if (canBless(s)) expect(dispatch(s, order(s, { blessed: true })).ok).toBe(true);
      expect(blessingStatus(s).fever).toBe(false);
      for (const a of s.adventurers) { a.status = 'idle'; a.fatigue = 0; }
      s.expeditions = [];
    }
  });

  it('tickBlessing は決定論(同じ状態からは同じ結果)', () => {
    const run = () => {
      const s = unlocked();
      for (let i = 0; i < 9; i++) tickBlessing(s, []);
      return s.blessing;
    };
    expect(run()).toEqual(run());
  });
});

describe('アイリスの祝福: 派遣に掛ける', () => {
  it('残りが無い・発熱中・未解禁なら blessed の派遣は失敗し、状態を変えない', () => {
    const s = fullGame(1);
    const before = structuredClone(s);
    expect(dispatch(s, order(s, { blessed: true })).ok).toBe(false);
    expect(s).toEqual(before);
    const u = unlocked();
    expect(dispatch(u, order(u, { blessed: true })).ok).toBe(false);
  });

  it('掛けると残りが1減り、命令に blessed が残る', () => {
    const s = unlocked();
    advanceDay(s);
    advanceDay(s);
    expect(s.blessing.charges).toBe(2);
    const r = dispatch(s, order(s, { blessed: true }));
    expect(r.ok).toBe(true);
    expect(s.blessing.charges).toBe(1);
    if (r.ok) expect(r.expedition.order.blessed).toBe(true);
  });

  it('掛けた隊は同じ派遣でも疲労の増え方が小さい(往路・現地・復路すべて)', () => {
    const a = unlocked();
    advanceDay(a);
    const b = structuredClone(a);
    const ra = dispatch(a, order(a, { blessed: false }));
    const rb = dispatch(b, order(b, { blessed: true }));
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    const sum = (r: Record<string, number>) => Object.values(r).reduce((t, n) => t + n, 0);
    expect(sum(ra.expedition.result.fatigue)).toBeGreaterThan(0);
    expect(sum(rb.expedition.result.fatigue)).toBeLessThan(sum(ra.expedition.result.fatigue));
    // 疲労以外の結果(乱数の引き方)は変わらない
    expect(rb.expedition.result.log.map((l) => l.text)).toEqual(ra.expedition.result.log.map((l) => l.text));
  });
});

describe('セーブ互換(版2 → 版3)', () => {
  it('blessing の無いセーブは既定値で読め、版が上がる', () => {
    const old = JSON.parse(JSON.stringify(fullGame(5))) as Record<string, unknown>;
    delete old.blessing;
    old.version = 2;
    const s = migrate(old)!;
    expect(s.blessing).toEqual({ charges: 0, feverUntil: null, fullSince: null });
    expect(s.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(3);
  });

  it('すでにある値は上書きしない', () => {
    const s = unlocked();
    advanceDay(s);
    const back = migrate(JSON.parse(JSON.stringify(s)))!;
    expect(back.blessing).toEqual(s.blessing);
  });
});
