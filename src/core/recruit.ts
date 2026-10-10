// 募集: 候補者の到着・入れ替わり、雇用(契約金と上限)、解雇。仕組みは前作 GuildQuest のまま(DESIGN 第6節)。
import { generateAdventurer, isTalent } from './adventurer';
import { bonus, facilityEffect } from './base';
import { TUNING, UNIQUES } from './data';
import { uniqueAdventurer } from './events';
import { ledger } from './ledger';
import { repLevel } from './quests';
import type { Rng } from './rng';
import type { Candidate, GameState, Result } from './types';

const T = TUNING.game;
// sim で調整する値
/** この評判Lvから毎日の到着が1人増える */
const EXTRA_ARRIVAL_REP_LV = 3;
const EXTRA_ARRIVAL_CHANCE = 0.4;
/** 評判Lvごとの候補者の質の上がり幅と、Lv2で来る確率の上がり幅 */
const QUALITY_PER_LV = 0.2;
const LEVEL2_PER_LV = 0.2;
/** ユニークは一度きりなので、通常の候補者より長く待つ */
const UNIQUE_DAYS = 10;

const ok = (): Result => ({ ok: true });
const fail = (reason: string): Result => ({ ok: false, reason });

export const hireFee = (salary: number) => salary * T.hireSalaryDays;

export function capacity(s: GameState): number {
  return T.baseCapacity + facilityEffect(s, 'dorm', 'capacity');
}

/** 候補者を1人作って s.candidates に入れる。上限は見ない(呼び出し側で見る) */
export function spawnCandidate(s: GameState, rng: Rng): Candidate {
  const lv = repLevel(s.rep);
  // 自己退職した人は候補に二度と出さない。id は候補ごとに振り直すので名前で避ける
  const gone = Object.keys(s.flags).filter((k) => k.startsWith('goneName:')).map((k) => k.slice('goneName:'.length));
  const usedNames = new Set([...s.adventurers.map((a) => a.name), ...s.candidates.map((c) => c.adv.name), ...gone]);
  const level = rng.chance(LEVEL2_PER_LV * (lv - 1)) ? 2 : 1;
  const quality = (lv - 1) * QUALITY_PER_LV + bonus(s, 'recruitQuality');
  const adv = generateAdventurer(rng, { id: `a${s.counters.nextId++}`, quality, level, usedNames });
  const c: Candidate = { adv, arrivedDay: s.day, expiresDay: s.day + T.candidateDays };
  s.candidates.push(c);
  return c;
}

/** 日送りで呼ぶ。1 +(評判Lv3以上で+1)+(40%で+1)+(酒場とシナジー)人、保持の上限まで */
export function arriveCandidates(s: GameState, rng: Rng): Candidate[] {
  // 上限で打ち切っても到着数の抽選は先に済ませ、乱数の列を保持数に左右させない
  const extra = rng.chance(EXTRA_ARRIVAL_CHANCE) ? 1 : 0;
  const n = 1 + (repLevel(s.rep) >= EXTRA_ARRIVAL_REP_LV ? 1 : 0) + extra + bonus(s, 'candidateBonus');
  const out: Candidate[] = [];
  for (let i = 0; i < n && s.candidates.length < T.candidateMax; i++) out.push(spawnCandidate(s, rng));
  for (const u of UNIQUES) {
    if (s.flags[`unique:${u.id}`] || s.day < u.join.minDay || s.rep < u.join.minRep || s.candidates.length >= T.candidateMax) continue;
    s.flags[`unique:${u.id}`] = true;
    const c: Candidate = { adv: uniqueAdventurer(u, `a${s.counters.nextId++}`), arrivedDay: s.day, expiresDay: s.day + UNIQUE_DAYS };
    s.candidates.push(c);
    out.push(c);
  }
  return out;
}

export function expireCandidates(s: GameState) {
  s.candidates = s.candidates.filter((c) => c.expiresDay > s.day);
}

export function hire(s: GameState, candId: string): Result {
  const c = s.candidates.find((x) => x.adv.id === candId);
  if (!c) return fail('その候補者はもういません');
  if (s.adventurers.length >= capacity(s)) return fail(`雇えるのは${capacity(s)}人までです(宿舎で増やせます)`);
  const fee = c.adv.unique ? 0 : hireFee(c.adv.salary);
  if (s.gold < fee) return fail(`契約金が足りません(${fee}G必要)`);
  s.gold -= fee;
  ledger(s, `契約金: ${c.adv.name}`, -fee);
  s.candidates = s.candidates.filter((x) => x !== c);
  c.adv.history.hiredDay = s.day;
  s.adventurers.push(c.adv);
  s.notices.unshift({ day: s.day, text: `${c.adv.name}を雇った(契約金${fee}G、日給${c.adv.salary}G)。` });
  // 何もしなかった日(day_idle)の判定に使う
  s.flags.hiredDay = s.day;
  if (isTalent(c.adv) && !s.pendingTags.includes('hire_talent')) s.pendingTags.push('hire_talent');
  if (c.adv.unique) s.flags[`unique:${c.adv.unique}:hired`] = s.day;
  return ok();
}

/** 待機中の者だけ。費用は掛からない */
export function dismiss(s: GameState, advId: string): Result {
  const a = s.adventurers.find((x) => x.id === advId);
  if (!a) return fail('その冒険者はいません');
  if (a.status !== 'idle') return fail(`${a.name}は待機中ではないので解雇できません`);
  s.adventurers = s.adventurers.filter((x) => x !== a);
  return ok();
}
