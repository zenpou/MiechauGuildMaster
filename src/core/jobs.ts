// 転職: 下級⇄下級は無料。下級→上級(昇格)は Lv・訓練所・費用が要る。上級からは入口の下級職へだけ無料で戻れる。費用は tuning.jobs。
import { jobAptitude } from './adventurer';
import { facilityEffect, facilityLevel } from './base';
import { ITEM, JOB, TUNING, upperJobsFrom } from './data';
import { unequip } from './equipment';
import { ledger } from './ledger';
import type { Adventurer, GameState, JobDef, Result } from './types';

const T = TUNING.jobs;
/** この適性差以上の転職は周りの目を引く(勘違いタグ job_change_big) */
const BIG_APT_GAP = 25;

const ok = (): Result => ({ ok: true });
const fail = (reason: string): Result => ({ ok: false, reason });
const has = <V>(table: Record<string, V>, key: string) => Object.prototype.hasOwnProperty.call(table, key);
const jobNames = (ids: string[] = []) => ids.map((id) => JOB[id]?.name ?? id).join('か');

/** 今の下級職を入口に持つ上級職。Lv・訓練所・費用で絞らないのは、UI が canChangeJob の理由で「あと何が要るか」を見せるため */
export function promotionOptions(a: Adventurer): JobDef[] {
  return upperJobsFrom(a.job);
}

/** 昇格の費用。図書室の promoDiscount で割り引く */
export function promotionCost(s: GameState): number {
  return Math.round(T.promotionGold * (1 - facilityEffect(s, 'library', 'promoDiscount')));
}

export function canChangeJob(s: GameState, advId: string, jobId: string): Result {
  const a = s.adventurers.find((x) => x.id === advId);
  if (!a) return fail('その冒険者はいません');
  if (!has(JOB, jobId)) return fail('その職はありません');
  const cur = JOB[a.job];
  const to = JOB[jobId];
  if (a.job === jobId) return fail(`${a.name}はすでに${to.name}です`);
  if (a.status !== 'idle') return fail(`${a.name}は待機中ではありません`);
  if (cur.tier === 'upper') {
    if (to.tier === 'upper') return fail('上級職から別の上級職へは転職できません');
    if (!cur.from?.includes(jobId)) return fail(`${cur.name}から戻れるのは${jobNames(cur.from)}だけです`);
    return ok();
  }
  if (to.tier === 'lower') return ok();
  if (!to.from?.includes(a.job)) return fail(`${to.name}になれるのは${jobNames(to.from)}だけです`);
  if (a.level < (to.requireLevel ?? 0)) return fail(`${to.name}になるにはLv${to.requireLevel}が必要です`);
  if (facilityLevel(s, 'training') < 1) return fail('訓練所がありません');
  const cost = promotionCost(s);
  if (s.gold < cost) return fail(`費用が足りません(${cost}G必要)`);
  return ok();
}

export function changeJob(s: GameState, advId: string, jobId: string): Result {
  const r = canChangeJob(s, advId, jobId);
  if (!r.ok) return r;
  const a = s.adventurers.find((x) => x.id === advId)!;
  const to = JOB[jobId];
  if (JOB[a.job].tier === 'lower' && to.tier === 'upper') {
    const cost = promotionCost(s);
    s.gold -= cost;
    ledger(s, `転職: ${a.name}→${to.name}`, -cost);
    s.flags['promoted:' + a.id] = s.day;
  }
  // 得意な職へ移る場合も、周りからは同じく大胆な配置換えに見えるので差の絶対値で見る
  if (Math.abs(jobAptitude(a, jobId) - jobAptitude(a, a.job)) >= BIG_APT_GAP && !s.pendingTags.includes('job_change_big')) {
    s.pendingTags.push('job_change_big');
  }
  a.job = jobId;
  // 着られない防具を着たままだと、僧侶が重鎧の守備を得てしまう。断る(二度手間)より、在庫に戻す方が失うものがない
  const worn = a.equipment?.armor ? ITEM[a.equipment.armor] : undefined;
  const cls = worn?.equip?.armorClass;
  if (worn && cls && !to.armor.includes(cls) && unequip(s, a.id, 'armor').ok) {
    s.notices.unshift({ day: s.day, text: `${a.name}は転職で${worn.name}を着けられなくなり、在庫に戻した。` });
  }
  return ok();
}
