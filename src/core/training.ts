// スキル訓練: 訓練所で待機中の冒険者に訓練スキルを覚えさせる。日数と費用は tuning.training(DESIGN 第6節)。
import { bonus, facilityLevel } from './base';
import { TRAINED_SKILL, TRAINED_SKILLS, TUNING, type TrainedSkillDef } from './data';
import { ledger } from './ledger';
import type { GameState, Result } from './types';

const T = TUNING.training;

const ok = (): Result => ({ ok: true });
const fail = (reason: string): Result => ({ ok: false, reason });

/** 訓練で覚えた数。固有スキルは上限に数えない */
const trainedCount = (skills: string[]) => skills.filter((id) => TRAINED_SKILLS.some((d) => d.id === id)).length;

export function canTrain(s: GameState, advId: string, skillId: string): Result {
  const a = s.adventurers.find((x) => x.id === advId);
  if (!a) return fail('その冒険者はいません');
  if (facilityLevel(s, 'training') < 1) return fail('訓練所がありません');
  const def = TRAINED_SKILLS.find((d) => d.id === skillId);
  if (!def) return fail('そのスキルは訓練できません');
  if (a.status !== 'idle') return fail(`${a.name}は待機中ではありません`);
  if (a.skills.includes(skillId)) return fail(`${a.name}は「${def.name}」を覚えています`);
  if (trainedCount(a.skills) >= T.maxSkills) return fail(`訓練で覚えられるのは${T.maxSkills}つまでです`);
  if (s.gold < T.gold) return fail(`費用が足りません(${T.gold}G必要)`);
  return ok();
}

/** 今その人が訓練できるスキル。訓練所が無い・上限なら空 */
export function trainableSkills(s: GameState, advId: string): TrainedSkillDef[] {
  const a = s.adventurers.find((x) => x.id === advId);
  if (!a || facilityLevel(s, 'training') < 1 || trainedCount(a.skills) >= T.maxSkills) return [];
  return TRAINED_SKILLS.filter((d) => !a.skills.includes(d.id));
}

/** 図書室と学び舎で縮む。UI の表示と訓練の期日で同じ日数を使う */
export function trainDays(s: GameState): number {
  return Math.max(1, T.days - bonus(s, 'trainDaysOff'));
}

export function trainSkill(s: GameState, advId: string, skillId: string): Result {
  const r = canTrain(s, advId, skillId);
  if (!r.ok) return r;
  const a = s.adventurers.find((x) => x.id === advId)!;
  s.gold -= T.gold;
  ledger(s, `訓練: ${a.name}「${TRAINED_SKILL[skillId].name}」`, -T.gold);
  a.status = 'training';
  a.assignment = { training: skillId, untilDay: s.day + trainDays(s) };
  return ok();
}

/** 日送りで呼ぶ。期日に達した訓練を終え、スキルを付けて待機に戻す */
export function completeTraining(s: GameState, notices: string[]) {
  for (const a of s.adventurers) {
    const as = a.assignment;
    if (a.status !== 'training' || !as || !('training' in as) || as.untilDay > s.day) continue;
    if (!a.skills.includes(as.training)) a.skills.push(as.training);
    a.status = 'idle';
    a.assignment = null;
    notices.push(`${a.name}が訓練を終え、「${TRAINED_SKILL[as.training].name}」を覚えた。`);
  }
}
