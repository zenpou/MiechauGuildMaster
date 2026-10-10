// クラフト: 施設+素材+資金+日数 → 完成品を在庫へ。完成は advanceDay で doneDay を迎えたとき。
import { effectiveStats } from './adventurer';
import { bonus, facilityEffect, facilityLevel, synergyValue, workersOf } from './base';
import { FACILITY, ITEM, RECIPE, RECIPES, TUNING } from './data';
import { addInventory, ledger } from './ledger';
import { recipeUnlocked } from './quests';
import type { GameState, RecipeDef, Result } from './types';

const WORKER_STAT_MIN = TUNING.craft.workerStatMin;
/** 鍛冶場とシナジーを重ねても、製作費はこの割合までしか下げない(タダで作れる状態を作らない) */
const CRAFT_GOLD_OFF_MAX = 0.8;

const ok = (): Result => ({ ok: true });
const fail = (reason: string): Result => ({ ok: false, reason });
const has = <V>(table: Record<string, V>, key: string) => Object.prototype.hasOwnProperty.call(table, key);

export function availableRecipes(s: GameState): RecipeDef[] {
  return RECIPES.filter((r) => facilityLevel(s, r.facility) >= 1 && recipeUnlocked(s, r.id));
}

export function craftDays(s: GameState, recipeId: string): number {
  const r = RECIPE[recipeId];
  const stat = FACILITY[r.facility]?.workStat;
  const skilled = !!stat && workersOf(s, r.facility).some((a) => effectiveStats(a)[stat] >= WORKER_STAT_MIN);
  const off = facilityEffect(s, r.facility, 'craftDaysOff') + (skilled ? 1 : 0) + synergyValue(s, 'craftDaysOff');
  return Math.max(1, r.days - off);
}

/** 割引後の製作費。UI の表示と製作開始で同じ額を使う */
export function craftGold(s: GameState, recipeId: string): number {
  return Math.round(RECIPE[recipeId].gold * (1 - Math.min(CRAFT_GOLD_OFF_MAX, bonus(s, 'craftGoldOff'))));
}

export function canCraft(s: GameState, recipeId: string): Result {
  if (!has(RECIPE, recipeId)) return fail('そのレシピはありません');
  const r = RECIPE[recipeId];
  const facility = FACILITY[r.facility];
  if (facilityLevel(s, r.facility) < 1) return fail(`${facility?.name ?? r.facility}がありません`);
  if (!recipeUnlocked(s, recipeId)) return fail(`${r.name}の作り方をまだ知りません`);
  if (s.crafts.some((j) => RECIPE[j.recipeId]?.facility === r.facility)) return fail(`${facility.name}は他の品を作っています`);
  if (s.gold < craftGold(s, recipeId)) return fail('資金が足りません');
  for (const i of r.inputs) {
    if ((s.inventory[i.item] ?? 0) < i.n) return fail(`${ITEM[i.item]?.name ?? i.item}が足りません`);
  }
  return ok();
}

export function startCraft(s: GameState, recipeId: string): Result {
  const c = canCraft(s, recipeId);
  if (!c.ok) return c;
  const r = RECIPE[recipeId];
  const days = craftDays(s, recipeId);
  const gold = craftGold(s, recipeId);
  for (const i of r.inputs) addInventory(s, i.item, -i.n);
  s.gold -= gold;
  ledger(s, `製作: ${r.name}`, -gold);
  s.crafts.push({
    id: `c${s.counters.nextId++}`, recipeId, startDay: s.day, doneDay: s.day + days,
    workers: workersOf(s, r.facility).map((a) => a.id),
  });
  return ok();
}

/** advanceDay から呼ぶ。産出+1 は完成時の施設Lvで決める */
export function completeCrafts(s: GameState, notices: string[]) {
  const done = s.crafts.filter((j) => j.doneDay <= s.day);
  s.crafts = s.crafts.filter((j) => j.doneDay > s.day);
  for (const j of done) {
    const r = RECIPE[j.recipeId];
    if (!r) continue;
    const n = r.output.n + facilityEffect(s, r.facility, 'outputBonus');
    addInventory(s, r.output.item, n);
    notices.push(`${r.name}が${n}個できあがった。`);
  }
}
