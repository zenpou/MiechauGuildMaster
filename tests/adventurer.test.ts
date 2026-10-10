import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addExp, aptFactor, bestJob, carryCapacity, effectiveStats, equipEffect, equipResist, expToNext, fatigueFactor,
  generateAdventurer, jobAptitude, PENTAGON, rollAptitude, salaryOf,
} from '../src/core/adventurer';
import { ITEM, JOB, LOWER_JOBS, PERSONA, PERSONALITY, TRAIT } from '../src/core/data';
import { Rng, rngFor } from '../src/core/rng';
import { ROLE_IDS, type Adventurer, type RoleId } from '../src/core/types';

// テストリスト
// [x] 同seedで同じ冒険者が生まれる
// [x] 適性の形が3種類とも出て、比率がおよそ 50/35/15(seed 500人で ±8%)
// [x] 二山は隣り合う2役にだけ高い
// [x] jobAptitude は上級職で2役の平均
// [x] effectiveStats の戦闘系は適性で、非戦闘系は適性に影響されない
// [x] 疲労40以下は能力そのまま、100で約0.6倍
// [x] addExp でレベルが上がり、日給は変わらない
// [x] carryCapacity はギャザラー役で1.5倍
// [x] 日給は最低8G
// [x] 装備の mods が実効能力に加算される(atk/def が増え、spd−1 も効く)
// [x] equipResist は装備の合計で、各属性 0.8 が上限
// [x] equipEffect は gather / carry の合計。carry は積載に足される
// [x] equipment が無い旧データでも落ちない

/** 適性・能力を固定した冒険者。乱数を通さずに式だけを確かめる */
function fixture(over: Partial<Adventurer> = {}): Adventurer {
  return {
    id: 'a1', name: 'テスト', age: 20, level: 1, exp: 0, job: 'fighter',
    base: { hp: 60, atk: 10, def: 8, mag: 9, spd: 8, dex: 9, scout: 9, gather: 9 },
    apt: { attacker: 50, tank: 50, healer: 50, scout: 50, gatherer: 50 },
    growth: 1, personality: 'cautious', traits: [],
    fatigue: 0, injuryDays: 0, salary: 10, loyalty: 50, status: 'idle', assignment: null,
    equipment: { weapon: null, armor: null, accessory: null }, skills: [],
    persona: { hobby: '釣り', talent: '早起き', likes: '猫', dislikes: '虫' },
    history: { hiredDay: 0, expeditions: 0, kills: 0, visits: {}, raisesRefused: 0, warnedDay: null },
    ...over,
  };
}

describe('適性', () => {
  it('jobAptitude は上級職で2役の平均、下級職でその役の値', () => {
    const a = fixture({ apt: { attacker: 80, tank: 40, healer: 10, scout: 20, gatherer: 30 } });
    expect(jobAptitude(a, 'warlord')).toBe(60);
    expect(jobAptitude(a, 'fighter')).toBe(80);
  });
});

describe('実効能力', () => {
  it('戦闘系4能力は職の適性で伸び、非戦闘系は適性に影響されない', () => {
    const lo = effectiveStats(fixture({ apt: { attacker: 0, tank: 50, healer: 50, scout: 50, gatherer: 50 } }));
    const hi = effectiveStats(fixture({ apt: { attacker: 100, tank: 50, healer: 50, scout: 50, gatherer: 50 } }));
    for (const k of ['atk', 'def', 'mag', 'spd'] as const) expect(hi[k]).toBeGreaterThan(lo[k]);
    for (const k of ['hp', 'dex', 'scout', 'gather'] as const) expect(hi[k]).toBe(lo[k]);
  });
  it('適性係数は 0.65〜1.35', () => {
    expect(aptFactor(0)).toBeCloseTo(0.65);
    expect(aptFactor(100)).toBeCloseTo(1.35);
  });
  it('特性の加算が乗る', () => {
    const plain = effectiveStats(fixture());
    const strong = effectiveStats(fixture({ traits: [{ id: 'strongarm', revealed: true }] }));
    expect(strong.atk - plain.atk).toBe(3);
  });
  it('疲労40以下は能力そのまま、100で約0.6倍', () => {
    expect(fatigueFactor(0)).toBe(1);
    expect(fatigueFactor(40)).toBe(1);
    expect(fatigueFactor(100)).toBeCloseTo(0.6);
    const a = fixture({ base: { hp: 100, atk: 50, def: 50, mag: 50, spd: 50, dex: 50, scout: 50, gather: 50 } });
    const rested = effectiveStats({ ...a, fatigue: 40 });
    expect(rested).toEqual(effectiveStats(a));
    const tired = effectiveStats({ ...a, fatigue: 100 });
    expect(tired.hp / rested.hp).toBeCloseTo(0.6, 1);
    expect(effectiveStats({ ...a, fatigue: 100 }, a.job, false)).toEqual(rested);
  });
});

describe('成長と日給', () => {
  it('次のレベルまでの経験値は 40×Lv', () => {
    expect(expToNext(1)).toBe(40);
    expect(expToNext(5)).toBe(200);
  });
  it('addExp でレベルが上がり、日給は変わらない', () => {
    const a = fixture({ salary: 12 });
    expect(addExp(a, 40 + 80 + 5)).toBe(2);
    expect(a.level).toBe(3);
    expect(a.exp).toBe(5);
    expect(a.salary).toBe(12);
  });
  it('日給は最低8G', () => {
    const weak = fixture({ base: { hp: 1, atk: 1, def: 1, mag: 1, spd: 1, dex: 1, scout: 1, gather: 1 }, growth: 0.5 });
    expect(salaryOf(weak)).toBe(8);
  });
  it('日給は適性の最も高い下級職の戦力で決まる(今の職ではない)', () => {
    const apt = { attacker: 10, tank: 10, healer: 90, scout: 10, gatherer: 10 };
    expect(bestJob(fixture({ apt }))).toBe('priest');
    expect(salaryOf(fixture({ apt, job: 'fighter' }))).toBe(salaryOf(fixture({ apt, job: 'priest' })));
  });
  it('怠け癖は日給×0.85', () => {
    const strong = { hp: 120, atk: 40, def: 30, mag: 40, spd: 30, dex: 20, scout: 20, gather: 20 };
    const plain = salaryOf(fixture({ base: strong }));
    const lazy = salaryOf(fixture({ base: strong, traits: [{ id: 'lazy', revealed: false }] }));
    expect(plain).toBeGreaterThan(8);
    expect(lazy).toBeLessThan(plain);
  });
});

describe('積載', () => {
  it('10 + 実効腕力×0.5', () => {
    const a = fixture({ job: 'fighter' });
    expect(carryCapacity(a)).toBe(Math.round(10 + effectiveStats(a).atk * 0.5));
  });
  it('ギャザラー役のある職は1.5倍', () => {
    const a = fixture({ job: 'gatherer' });
    expect(carryCapacity(a)).toBe(Math.round((10 + effectiveStats(a).atk * 0.5) * 1.5));
    const th = fixture({ job: 'treasure_hunter' });
    expect(carryCapacity(th)).toBe(Math.round((10 + effectiveStats(th).atk * 0.5) * 1.5));
  });
});

describe('装備', () => {
  const eq = (weapon: string | null, armor: string | null, accessory: string | null) => ({ weapon, armor, accessory });
  // 上限と carry を確かめるための試験用の装備。実データには無い値
  beforeAll(() => {
    ITEM.test_res_armor = { id: 'test_res_armor', name: '試験鎧', desc: '', kind: 'armor', price: 0, weight: 1,
      equip: { slot: 'armor', armorClass: 'light', mods: {}, resist: { fire: 0.6 } } };
    ITEM.test_res_charm = { id: 'test_res_charm', name: '試験飾り', desc: '', kind: 'accessory', price: 0, weight: 1,
      equip: { slot: 'accessory', mods: {}, resist: { fire: 0.5 }, effects: { carry: 4 } } };
  });
  afterAll(() => {
    delete ITEM.test_res_armor;
    delete ITEM.test_res_charm;
  });

  it('武器と防具で atk/def が mods の分だけ増える', () => {
    const bare = effectiveStats(fixture());
    const geared = effectiveStats(fixture({ equipment: eq('iron_sword', 'leather_armor', 'fang_necklace') }));
    expect(geared.atk).toBe(bare.atk + 5 + 1);
    expect(geared.def).toBe(bare.def + 3);
    expect(geared.hp).toBe(bare.hp);
  });

  it('鉄の鎧は def+6 と spd−1', () => {
    const bare = effectiveStats(fixture());
    const geared = effectiveStats(fixture({ equipment: eq(null, 'iron_armor', null) }));
    expect(geared.def).toBe(bare.def + 6);
    expect(geared.spd).toBe(bare.spd - 1);
  });

  it('equipResist は装備の resist の合計', () => {
    expect(equipResist(fixture())).toEqual({});
    expect(equipResist(fixture({ equipment: eq(null, 'iron_armor', 'moss_charm') }))).toEqual({ earth: 0.2, dark: 0.3 });
  });

  it('equipResist は各属性 0.8 で頭打ち', () => {
    const a = fixture({ equipment: eq(null, 'test_res_armor', 'test_res_charm') });
    expect(equipResist(a).fire).toBe(0.8);
  });

  it('equipEffect は gather / carry の合計。carry は積載に足される', () => {
    const bare = fixture();
    const neck = fixture({ equipment: eq(null, null, 'fang_necklace') });
    expect(equipEffect(bare, 'gather')).toBe(0);
    expect(equipEffect(neck, 'gather')).toBe(1);
    expect(equipEffect(neck, 'carry')).toBe(0);
    const pack = fixture({ equipment: eq(null, null, 'test_res_charm') });
    expect(equipEffect(pack, 'carry')).toBe(4);
    expect(carryCapacity(pack)).toBe(carryCapacity(bare) + 4);
  });

  it('equipment が無い旧データでも落ちない', () => {
    const old = fixture();
    delete (old as Partial<Adventurer>).equipment;
    expect(() => effectiveStats(old)).not.toThrow();
    expect(equipResist(old)).toEqual({});
    expect(equipEffect(old, 'gather')).toBe(0);
    expect(carryCapacity(old)).toBe(carryCapacity(fixture()));
  });
});

describe('適性の生成(第6節)', () => {
  const N = 500;
  const rolls = Array.from({ length: N }, (_, i) => rollAptitude(rngFor(1, 'apt', i), 0));

  it('3つの形が 50/35/15 前後で出る', () => {
    const count = (s: string) => rolls.filter((r) => r.shape === s).length / N;
    expect(Math.abs(count('peak') - 0.5)).toBeLessThanOrEqual(0.08);
    expect(Math.abs(count('twin') - 0.35)).toBeLessThanOrEqual(0.08);
    expect(Math.abs(count('flat') - 0.15)).toBeLessThanOrEqual(0.08);
  });
  it('尖りは1役だけが62以上、他は62未満', () => {
    for (const r of rolls.filter((x) => x.shape === 'peak')) {
      expect(r.peaks).toHaveLength(1);
      expect(r.apt[r.peaks[0]]).toBeGreaterThanOrEqual(62);
      for (const k of ROLE_IDS) if (k !== r.peaks[0]) expect(r.apt[k]).toBeLessThanOrEqual(62);
    }
  });
  it('二山は五角形で隣り合う2役にだけ高い', () => {
    for (const r of rolls.filter((x) => x.shape === 'twin')) {
      expect(r.peaks).toHaveLength(2);
      const [i, j] = r.peaks.map((p) => PENTAGON.indexOf(p));
      expect([1, 4]).toContain(Math.abs(i - j));
      for (const p of r.peaks) expect(r.apt[p]).toBeGreaterThanOrEqual(55);
      for (const k of ROLE_IDS) if (!r.peaks.includes(k)) expect(r.apt[k]).toBeLessThanOrEqual(50);
    }
  });
  it('平らは全役 40〜65', () => {
    for (const r of rolls.filter((x) => x.shape === 'flat')) {
      for (const k of ROLE_IDS) {
        expect(r.apt[k]).toBeGreaterThanOrEqual(40);
        expect(r.apt[k]).toBeLessThanOrEqual(65);
      }
    }
  });
  it('五角形の順は 剣士→戦士→僧侶→採取士→斥候 の役割', () => {
    expect(PENTAGON).toEqual(['fighter', 'warrior', 'priest', 'gatherer', 'scout'].map((j) => JOB[j].roles[0]));
  });
  it('quality が高くても 0〜100 に収まる', () => {
    for (let i = 0; i < 200; i++) {
      const r = rollAptitude(rngFor(2, 'apt', i), 1);
      for (const k of ROLE_IDS) {
        expect(r.apt[k]).toBeGreaterThanOrEqual(0);
        expect(r.apt[k]).toBeLessThanOrEqual(100);
        expect(Number.isInteger(r.apt[k])).toBe(true);
      }
    }
  });
});

describe('generateAdventurer', () => {
  const gen = (seed: number, i: number) => generateAdventurer(rngFor(seed, 'gen', i), { id: `a${i}` });

  it('同seedで同じ冒険者が生まれる', () => {
    expect(gen(7, 3)).toEqual(gen(7, 3));
    expect(gen(7, 3)).not.toEqual(gen(8, 3));
  });
  it('Adventurer の全項目が初期値で埋まる', () => {
    const a = generateAdventurer(new Rng(11), { id: 'x', level: 3 });
    expect(a.id).toBe('x');
    expect(a.level).toBe(3);
    expect(a.exp).toBe(0);
    expect(Object.keys(a.apt).sort()).toEqual([...ROLE_IDS].sort());
    expect(LOWER_JOBS.map((j) => j.id)).toContain(a.job);
    expect(PERSONALITY[a.personality]).toBeDefined();
    for (const t of a.traits) expect(TRAIT[t.id]).toBeDefined();
    expect(a.loyalty).toBeGreaterThanOrEqual(40);
    expect(a.loyalty).toBeLessThanOrEqual(60);
    expect(a.status).toBe('idle');
    expect(a.assignment).toBeNull();
    expect(a.equipment).toEqual({ weapon: null, armor: null, accessory: null });
    expect(a.skills).toEqual([]);
    expect(a.history).toEqual({ hiredDay: 0, expeditions: 0, kills: 0, visits: {}, raisesRefused: 0, warnedDay: null });
    expect(a.salary).toBe(salaryOf(a));
    expect(a.unique).toBeUndefined();
  });
  it('persona は語彙から1語ずつで、好きと嫌いは別の語', () => {
    for (let i = 0; i < 200; i++) {
      const p = gen(5, i).persona;
      expect(PERSONA.hobby).toContain(p.hobby);
      expect(PERSONA.talent).toContain(p.talent);
      expect(PERSONA.likes).toContain(p.likes);
      expect(PERSONA.dislikes).toContain(p.dislikes);
      expect(p.likes).not.toBe(p.dislikes);
    }
  });
  it('usedNames にある名前を避ける', () => {
    const used = new Set<string>();
    const names = Array.from({ length: 30 }, (_, i) => generateAdventurer(rngFor(3, 'n', i), { id: `n${i}`, usedNames: used }).name);
    expect(new Set(names).size).toBe(30);
  });
  it('尖りの初期職は6割前後がその役の下級職', () => {
    let peaked = 0, matched = 0;
    for (let i = 0; i < 500; i++) {
      const a = gen(9, i);
      const top = ROLE_IDS.filter((k) => a.apt[k] >= 62);
      if (top.length !== 1 || ROLE_IDS.some((k) => k !== top[0] && a.apt[k] > 50)) continue;
      peaked++;
      if (JOB[a.job].roles[0] === (top[0] as RoleId)) matched++;
    }
    expect(peaked).toBeGreaterThan(100);
    expect(Math.abs(matched / peaked - 0.6)).toBeLessThanOrEqual(0.1);
  });
});
