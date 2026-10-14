import { describe, expect, it } from 'vitest';
import { effectiveStats } from '../src/core/adventurer';
import { FACILITY, JOB, TUNING } from '../src/core/data';
import { newGame } from '../src/core/game';
import { canChangeJob, changeJob, promotionCost, promotionOptions } from '../src/core/jobs';
import type { Adventurer, GameState, Result } from '../src/core/types';
import { fullGame } from './helpers';

const PROMO = TUNING.jobs.promotionGold;
const FLAT = { attacker: 50, tank: 50, healer: 50, gatherer: 50, scout: 50 };

const reasonOf = (r: Result) => (r.ok ? '' : r.reason);

/** 訓練所あり・資金十分・適性が平らな待機中の剣士Lv10 */
function setup(): { s: GameState; a: Adventurer } {
  const s = newGame(1);
  s.base.facilities.push({ id: 'training', level: 1, x: 0, y: 0, builtDay: 1, construction: null });
  s.gold = 10000;
  const a = s.adventurers[0];
  a.job = 'fighter';
  a.level = 10;
  a.apt = { ...FLAT };
  a.status = 'idle';
  return { s, a };
}

describe('転職: 下級⇄下級', () => {
  it('無料で、訓練所も要らない', () => {
    const s = newGame(1);
    s.gold = 0;
    const a = s.adventurers[0];
    a.job = 'fighter';
    a.status = 'idle';
    const ledgerLen = s.ledger.length;
    expect(changeJob(s, a.id, 'priest').ok).toBe(true);
    expect(a.job).toBe('priest');
    expect(changeJob(s, a.id, 'fighter').ok).toBe(true);
    expect(a.job).toBe('fighter');
    expect(s.gold).toBe(0);
    expect(s.ledger.length).toBe(ledgerLen);
    expect(s.flags['promoted:' + a.id]).toBeUndefined();
  });

  it('待機中でなければ断る', () => {
    for (const st of ['away', 'working', 'training'] as const) {
      const { s, a } = setup();
      a.status = st;
      expect(canChangeJob(s, a.id, 'priest').ok).toBe(false);
      expect(canChangeJob(s, a.id, 'warlord').ok).toBe(false);
      expect(changeJob(s, a.id, 'priest').ok).toBe(false);
      expect(a.job).toBe('fighter');
    }
  });

  it('同じ職・無い職・いない冒険者は断る', () => {
    const { s, a } = setup();
    expect(canChangeJob(s, a.id, 'fighter').ok).toBe(false);
    expect(canChangeJob(s, a.id, 'no_such_job').ok).toBe(false);
    expect(canChangeJob(s, 'nobody', 'priest').ok).toBe(false);
    expect(changeJob(s, a.id, 'fighter').ok).toBe(false);
  });
});

describe('転職: 昇格', () => {
  it('入口の職・Lv・訓練所・費用がそれぞれ別の理由で断る', () => {
    const entry = setup();
    entry.a.job = 'priest';
    const level = setup();
    level.a.level = JOB.warlord.requireLevel! - 1;
    const yard = setup();
    yard.s.base.facilities = yard.s.base.facilities.filter((f) => f.id !== 'training');
    const money = setup();
    money.s.gold = promotionCost(money.s) - 1;
    const reasons = [entry, level, yard, money].map(({ s, a }) => {
      const r = canChangeJob(s, a.id, 'warlord');
      expect(r.ok).toBe(false);
      return reasonOf(r);
    });
    expect(new Set(reasons).size).toBe(4);
    expect(reasons[1]).toMatch(/Lv/);
    expect(reasons[2]).toMatch(/訓練所/);
    expect(reasons[3]).toMatch(/費用/);

    const { s, a } = setup();
    expect(a.level).toBe(JOB.warlord.requireLevel);
    expect(canChangeJob(s, a.id, 'warlord').ok).toBe(true);
  });

  it('費用を引いて台帳に載せ、能力が上級の倍率になる。Lvは変えない', () => {
    const { s, a } = setup();
    const gold = s.gold;
    const exp = a.exp;
    expect(PROMO).toBe(300);
    expect(promotionCost(s)).toBe(PROMO);
    const upper = effectiveStats(a, 'warlord');
    expect(upper).not.toEqual(effectiveStats(a));
    expect(changeJob(s, a.id, 'warlord').ok).toBe(true);
    expect(a.job).toBe('warlord');
    expect(a.level).toBe(10);
    expect(a.exp).toBe(exp);
    expect(s.gold).toBe(gold - PROMO);
    expect(s.ledger[0]).toEqual({ day: s.day, label: `転職: ${a.name}→${JOB.warlord.name}`, amount: -PROMO });
    expect(effectiveStats(a)).toEqual(upper);
    expect(s.flags['promoted:' + a.id]).toBe(s.day);
  });

  it.skipIf(!FACILITY.library)('図書室があると費用が下がる', () => {
    const { s, a } = setup();
    s.base.facilities.push({ id: 'library', level: 1, x: 1, y: 0, builtDay: 1, construction: null });
    const discounted = Math.round(PROMO * (1 - FACILITY.library.effects[0].promoDiscount));
    expect(discounted).toBeLessThan(PROMO);
    expect(promotionCost(s)).toBe(discounted);
    s.gold = discounted;
    expect(changeJob(s, a.id, 'warlord').ok).toBe(true);
    expect(s.gold).toBe(0);
  });

  it('promotionOptions は今の下級職を入口に持つ上級職。上級職なら空', () => {
    const { a } = setup();
    expect(promotionOptions(a).map((j) => j.id).sort()).toEqual(['assassin', 'warlord']);
    a.job = 'priest';
    a.level = 1;
    expect(promotionOptions(a).map((j) => j.id).sort()).toEqual(['alchemist', 'paladin']);
    a.job = 'paladin';
    expect(promotionOptions(a)).toEqual([]);
  });
});

describe('転職: 上級から', () => {
  it('入口の下級職へだけ無料で戻れ、別の上級職へは行けない', () => {
    const { s, a } = setup();
    expect(changeJob(s, a.id, 'warlord').ok).toBe(true);
    s.gold = 0;
    s.base.facilities = s.base.facilities.filter((f) => f.id !== 'training');
    expect(canChangeJob(s, a.id, 'paladin').ok).toBe(false);
    expect(canChangeJob(s, a.id, 'priest').ok).toBe(false);
    expect(canChangeJob(s, a.id, 'warrior').ok).toBe(true);
    expect(changeJob(s, a.id, 'fighter').ok).toBe(true);
    expect(a.job).toBe('fighter');
    expect(s.gold).toBe(0);
  });
});

describe('転職: 勘違いタグ', () => {
  it('適性の差が25以上なら job_change_big が立つ', () => {
    const { s, a } = setup();
    a.apt = { ...FLAT, attacker: 80, healer: 55 };
    changeJob(s, a.id, 'priest');
    expect(s.pendingTags).toContain('job_change_big');
  });

  it('差が25未満なら立たない', () => {
    const { s, a } = setup();
    a.apt = { ...FLAT, attacker: 80, healer: 56 };
    changeJob(s, a.id, 'priest');
    expect(s.pendingTags).not.toContain('job_change_big');
  });

  it('適性の低い職から高い職へでも、昇格でも、差で立つ', () => {
    const up = setup();
    up.a.apt = { ...FLAT, attacker: 30, healer: 60 };
    changeJob(up.s, up.a.id, 'priest');
    expect(up.s.pendingTags).toContain('job_change_big');

    const promo = setup();
    promo.a.apt = { ...FLAT, attacker: 80, tank: 20 };
    expect(changeJob(promo.s, promo.a.id, 'warlord').ok).toBe(true);
    expect(promo.s.pendingTags).toContain('job_change_big');
  });

  it('断られた転職では立たない', () => {
    const { s, a } = setup();
    a.apt = { ...FLAT, attacker: 90, healer: 10 };
    a.status = 'away';
    changeJob(s, a.id, 'priest');
    expect(s.pendingTags).not.toContain('job_change_big');
  });
});

describe('転職: 決定論', () => {
  it('同じ操作なら同じ状態になる', () => {
    const run = () => {
      const { s, a } = setup();
      a.apt = { ...FLAT, attacker: 90, tank: 20 };
      changeJob(s, a.id, 'warlord');
      changeJob(s, a.id, 'warrior');
      changeJob(s, a.id, 'scout');
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});

describe('転職と防具', () => {
  const wear = (job: string, armor: string) => {
    const s = fullGame(2);
    const a = s.adventurers[1];
    a.job = job;
    a.status = 'idle';
    a.equipment.armor = armor;
    s.inventory[armor] = 0;
    return { s, a };
  };

  it('着られなくなる防具は外して在庫に戻し、お知らせに残す(重装の戦士→僧侶)', () => {
    const { s, a } = wear('warrior', 'iron_armor');
    expect(changeJob(s, a.id, 'priest').ok).toBe(true);
    expect(a.equipment.armor).toBeNull();
    expect(s.inventory.iron_armor).toBe(1);
    expect(s.notices.some((n) => n.text.includes(a.name) && n.text.includes('鉄の鎧'))).toBe(true);
  });

  it('着られる防具はそのまま(重装の戦士→剣士)', () => {
    const { s, a } = wear('warrior', 'iron_armor');
    expect(changeJob(s, a.id, 'fighter').ok).toBe(true);
    expect(a.equipment.armor).toBe('iron_armor');
    expect(s.inventory.iron_armor).toBe(0);
  });
});
