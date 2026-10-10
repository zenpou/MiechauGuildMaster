import { ITEM, JOB, LOWER_JOBS, NAMES, PERSONA, PERSONALITIES, ROLE_SKILL, TRAINED_SKILL, TRAIT, TRAITS, TUNING } from './data';
import type { Rng } from './rng';
import {
  ROLE_IDS, STAT_KEYS,
  type Adventurer, type Aptitude, type ItemDef, type Persona, type Resist, type RoleId, type Stats, type TraitDef,
  type TraitInstance,
} from './types';

const LEVEL_GAIN: Stats = { hp: 8, atk: 1.2, def: 1.0, mag: 1.2, spd: 0.8, dex: 0.8, scout: 0.8, gather: 0.8 };
const COMBAT_STATS = ['atk', 'def', 'mag', 'spd'] as const;

/** 適性値(0-100) → 戦闘能力係数 0.65〜1.35 */
export function aptFactor(apt: number): number {
  return 0.65 + 0.7 * (apt / 100);
}

/** その職の役割の適性の平均(下級は1役、上級は2役) */
export function jobAptitude(a: Adventurer, jobId: string): number {
  const roles = JOB[jobId].roles;
  return roles.reduce((s, r) => s + a.apt[r], 0) / roles.length;
}

export function traitDefs(a: Adventurer): TraitDef[] {
  return a.traits.map((t) => TRAIT[t.id]);
}

/** 着けている装備の定義。旧セーブには equipment が無い */
export function equippedDefs(a: Adventurer): NonNullable<ItemDef['equip']>[] {
  const e = a.equipment;
  return [e?.weapon, e?.armor, e?.accessory].flatMap((id) => (id && ITEM[id]?.equip ? [ITEM[id].equip!] : []));
}

/** 装備の耐性の合計。属性ごとに上限で頭打ち(負=弱点は下限なし) */
export function equipResist(a: Adventurer): Resist {
  const out: Resist = {};
  for (const eq of equippedDefs(a)) {
    for (const [k, v] of Object.entries(eq.resist ?? {}) as [keyof Resist, number][]) {
      out[k] = Math.min(TUNING.equipment.resistCap, (out[k] ?? 0) + v);
    }
  }
  return out;
}

/** 装備の effects の合計(gather=採取量+N / carry=積載+N) */
export function equipEffect(a: Adventurer, key: 'gather' | 'carry'): number {
  return equippedDefs(a).reduce((s, eq) => s + (eq.effects?.[key] ?? 0), 0);
}

export function fatigueFactor(fatigue: number): number {
  return 1 - Math.max(0, fatigue - 40) / 150;
}

/** 実効能力。job を指定すると「その職業に就いた場合」を計算できる(転職プレビュー用)。 */
export function effectiveStats(a: Adventurer, job: string = a.job, withFatigue = true): Stats {
  const j = JOB[job];
  const apt = aptFactor(jobAptitude(a, job));
  const ff = withFatigue ? fatigueFactor(a.fatigue) : 1;
  const equipped = equippedDefs(a);
  const out = {} as Stats;
  for (const k of STAT_KEYS) {
    let v = (a.base[k] + (a.level - 1) * LEVEL_GAIN[k] * a.growth) * j.statMult[k];
    if ((COMBAT_STATS as readonly string[]).includes(k)) v *= apt;
    for (const t of traitDefs(a)) v += t.mods[k] ?? 0;
    for (const id of a.skills) v += TRAINED_SKILL[id]?.mods[k] ?? 0;
    for (const eq of equipped) v += eq.mods[k] ?? 0;
    out[k] = Math.max(1, Math.round(v * ff));
  }
  return out;
}

export function expToNext(level: number): number {
  return TUNING.growth.expPerLevel * level;
}

export function rankOf(v: number): string {
  return v >= 90 ? 'S' : v >= 75 ? 'A' : v >= 60 ? 'B' : v >= 45 ? 'C' : v >= 30 ? 'D' : 'E';
}
export function growthRank(g: number): string {
  return g >= 1.35 ? 'S' : g >= 1.2 ? 'A' : g >= 1.0 ? 'B' : g >= 0.85 ? 'C' : 'D';
}

export function traitNum(a: Adventurer, key: 'luck' | 'lostBias' | 'fatigueRate' | 'expRate' | 'salaryMult', def = 0): number {
  let v = def;
  for (const t of traitDefs(a)) if (t[key] !== undefined) v = key.endsWith('Rate') || key === 'salaryMult' ? v * t[key]! : v + t[key]!;
  return v;
}

export function attackOf(stats: Stats, job: string): number {
  return stats[JOB[job].attackStat];
}

/** 1人あたりの戦力目安 */
export function powerOf(a: Adventurer, job: string = a.job, withFatigue = true): number {
  const s = effectiveStats(a, job, withFatigue);
  return Math.round(s.hp / 4 + attackOf(s, job) * 1.5 + s.def + s.spd * 0.5 + s.scout * 0.2 + s.gather * 0.1);
}

/** 適性が最も高い下級職。上級は転職条件があるので、素質の目安には入れない */
export function bestJob(a: Adventurer): string {
  return LOWER_JOBS.reduce((best, j) => (jobAptitude(a, j.id) > jobAptitude(a, best.id) ? j : best)).id;
}

/** 日給は適職での戦力(疲労を除く)に比例する。 */
export function salaryOf(a: Adventurer): number {
  const p = powerOf(a, bestJob(a), false);
  const raw = 10 + (p - 50) * 0.6 + (a.growth - 1) * 14;
  return Math.max(8, Math.round(raw * traitNum(a, 'salaryMult', 1)));
}

/** 経験値加算。レベルアップした回数を返す。 */
export function addExp(a: Adventurer, exp: number): number {
  a.exp += exp;
  let ups = 0;
  while (a.exp >= expToNext(a.level)) {
    a.exp -= expToNext(a.level);
    a.level++;
    ups++;
  }
  // 前作のように日給を再計算しないのは、新作では昇給要望メールの承認で上げるため(第6節)
  return ups;
}

export function isTalent(a: Adventurer): boolean {
  return a.growth >= 1.2 || Math.max(...Object.values(a.apt)) >= 90;
}

/** 持ち帰れる荷の重さ。ギャザラー役は荷造り(pack)の倍率で増える。装備の carry は倍率の外で足す */
export function carryCapacity(a: Adventurer): number {
  const base = 10 + effectiveStats(a).atk * 0.5;
  return Math.round(JOB[a.job].roles.includes('gatherer') ? base * ROLE_SKILL.pack.params.carryMult : base) + equipEffect(a, 'carry');
}

/** 五角形の並び(剣士→戦士→僧侶→採取士→斥候)を役割で。隣同士が上級職の組になる */
export const PENTAGON: RoleId[] = ['attacker', 'tank', 'healer', 'gatherer', 'scout'];

export type AptitudeShape = 'peak' | 'twin' | 'flat';
export interface AptitudeRoll { apt: Aptitude; shape: AptitudeShape; peaks: RoleId[] }

const clampApt = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** 適性の形(第6節): 尖り50% / 二山35% / 平ら15% */
export function rollAptitude(rng: Rng, quality = 0): AptitudeRoll {
  const r = rng.next();
  const apt = {} as Aptitude;
  if (r < 0.5) {
    const peak = rng.pick(PENTAGON);
    for (const k of ROLE_IDS) apt[k] = clampApt(k === peak ? rng.range(62, 98) + quality * 2 : rng.bell(10, 62));
    return { apt, shape: 'peak', peaks: [peak] };
  }
  if (r < 0.85) {
    const i = rng.int(0, PENTAGON.length - 1);
    const peaks = [PENTAGON[i], PENTAGON[(i + 1) % PENTAGON.length]];
    for (const k of ROLE_IDS) apt[k] = clampApt(peaks.includes(k) ? rng.range(55, 85) + quality * 2 : rng.bell(10, 50));
    return { apt, shape: 'twin', peaks };
  }
  for (const k of ROLE_IDS) apt[k] = clampApt(rng.bell(40, 65) + quality * 2);
  return { apt, shape: 'flat', peaks: [] };
}

const lowerJobOf = (role: RoleId) => LOWER_JOBS.find((j) => j.roles[0] === role)!.id;

export interface GenOptions { id: string; quality?: number; level?: number; usedNames?: Set<string> }

export function generateAdventurer(rng: Rng, o: GenOptions): Adventurer {
  const q = o.quality ?? 0; // 0..1
  const level = o.level ?? 1;
  const base: Stats = {
    hp: Math.round(rng.bell(48, 78) + q * 8),
    atk: Math.round(rng.bell(6, 14) + q * 3),
    def: Math.round(rng.bell(5, 12) + q * 3),
    mag: Math.round(rng.bell(5, 14) + q * 3),
    spd: Math.round(rng.bell(4, 12) + q * 2),
    dex: Math.round(rng.bell(5, 14)),
    scout: Math.round(rng.bell(4, 14)),
    gather: Math.round(rng.bell(4, 14)),
  };
  const { apt, shape, peaks } = rollAptitude(rng, q);
  let job: string;
  if (shape === 'peak') {
    const native = lowerJobOf(peaks[0]);
    job = rng.chance(0.6) ? native : rng.pick(LOWER_JOBS.filter((j) => j.id !== native)).id;
  } else {
    job = rng.pick(LOWER_JOBS).id;
  }
  const growth = Math.round((rng.bell(0.7, 1.35) + q * 0.15) * 100) / 100;

  const traits: TraitInstance[] = [];
  const nTraits = rng.chance(0.55) ? 1 : rng.chance(0.2) ? 2 : 0;
  for (const t of rng.shuffle(TRAITS).slice(0, nTraits)) traits.push({ id: t.id, revealed: !rng.chance(t.hiddenChance) });

  let name = rng.pick(NAMES.given);
  for (let i = 0; i < 20 && o.usedNames?.has(name); i++) name = rng.pick(NAMES.given);
  o.usedNames?.add(name);

  const likes = rng.pick(PERSONA.likes);
  const persona: Persona = {
    hobby: rng.pick(PERSONA.hobby),
    talent: rng.pick(PERSONA.talent),
    likes,
    dislikes: rng.pick(PERSONA.dislikes.filter((w) => w !== likes)),
  };

  const a: Adventurer = {
    id: o.id, name, age: rng.int(16, 38), level, exp: 0, job, base, apt, growth,
    personality: rng.pick(PERSONALITIES).id, traits,
    fatigue: 0, injuryDays: 0, salary: 0, loyalty: rng.int(40, 60), status: 'idle',
    assignment: null,
    equipment: { weapon: null, armor: null, accessory: null },
    skills: [],
    persona,
    history: { hiredDay: 0, expeditions: 0, kills: 0, visits: {}, raisesRefused: 0, warnedDay: null },
  };
  a.salary = salaryOf(a);
  return a;
}
