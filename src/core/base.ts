// 拠点の施設: 建設・増築・解体・隣接シナジー・施設勤務・毎日の産出。
import { effectiveStats } from './adventurer';
import { FACILITY, ITEM, RECIPE, SYNERGIES, TUNING } from './data';
import { addInventory, ledger } from './ledger';
import type { FacilityLevelCost, GameState, PlacedFacility, Result, SynergyDef } from './types';

const ok = (): Result => ({ ok: true });
const fail = (reason: string): Result => ({ ok: false, reason });
const has = <V>(table: Record<string, V>, key: string) => Object.prototype.hasOwnProperty.call(table, key);

const findFacility = (s: GameState, facilityId: string): PlacedFacility | undefined =>
  s.base.facilities.find((f) => f.id === facilityId);

/** 建設中は前のLv(新築なら0) */
export function facilityLevel(s: GameState, facilityId: string): number {
  return findFacility(s, facilityId)?.level ?? 0;
}

/** 今のLvでの effects[key]。施設が無い・未完成なら0 */
export function facilityEffect(s: GameState, facilityId: string, key: string): number {
  const lv = facilityLevel(s, facilityId);
  if (lv < 1 || !has(FACILITY, facilityId)) return 0;
  return FACILITY[facilityId].effects[lv - 1]?.[key] ?? 0;
}

/** 完成済み施設の日額維持費の合計 */
export function facilityUpkeep(s: GameState): number {
  const sum = s.base.facilities.reduce((t, f) => t + (f.level >= 1 && has(FACILITY, f.id) ? FACILITY[f.id].upkeep : 0), 0);
  return Math.round(sum * TUNING.game.facilityUpkeepScale);
}

function checkCost(s: GameState, cost: FacilityLevelCost): string | null {
  if (s.gold < cost.gold) return '資金が足りません';
  for (const [item, n] of Object.entries(cost.materials)) {
    if ((s.inventory[item] ?? 0) < n) return `${ITEM[item]?.name ?? item}が足りません`;
  }
  return null;
}

function payCost(s: GameState, cost: FacilityLevelCost, label: string) {
  s.gold -= cost.gold;
  ledger(s, label, -cost.gold);
  for (const [item, n] of Object.entries(cost.materials)) addInventory(s, item, -n);
}

export function canBuild(s: GameState, facilityId: string, x: number, y: number): Result {
  if (!has(FACILITY, facilityId)) return fail('その施設は建てられません');
  const def = FACILITY[facilityId];
  if (findFacility(s, facilityId)) return fail(`${def.name}はもう建っています`);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= s.base.width || y >= s.base.height) {
    return fail('拠点の外には建てられません');
  }
  if (s.base.facilities.some((f) => f.x === x && f.y === y)) return fail('そのマスは使われています');
  const err = checkCost(s, def.costs[0]);
  return err ? fail(err) : ok();
}

export function build(s: GameState, facilityId: string, x: number, y: number): Result {
  const r = canBuild(s, facilityId, x, y);
  if (!r.ok) return r;
  const def = FACILITY[facilityId];
  const cost = def.costs[0];
  payCost(s, cost, `建設: ${def.name}`);
  s.base.facilities.push({ id: facilityId, level: 0, x, y, builtDay: s.day, construction: { toLevel: 1, untilDay: s.day + cost.days } });
  return ok();
}

export function upgrade(s: GameState, facilityId: string): Result {
  const f = findFacility(s, facilityId);
  if (!f || !has(FACILITY, facilityId)) return fail('その施設はまだありません');
  const def = FACILITY[facilityId];
  if (f.construction) return fail(`${def.name}は工事中です`);
  if (f.level >= def.maxLevel) return fail(`${def.name}はこれ以上大きくできません`);
  const cost = def.costs[f.level];
  const err = checkCost(s, cost);
  if (err) return fail(err);
  payCost(s, cost, `増築: ${def.name}`);
  f.construction = { toLevel: f.level + 1, untilDay: s.day + cost.days };
  return ok();
}

/** 解体で戻る金額。払った建設費・増築費(今の Lv までの costs)の合計 × demolishRefund を四捨五入 */
export function demolishGold(s: GameState, facilityId: string): number {
  const f = findFacility(s, facilityId);
  if (!f || !has(FACILITY, facilityId)) return 0;
  const paid = FACILITY[facilityId].costs.slice(0, f.level).reduce((t, c) => t + c.gold, 0);
  return Math.round(paid * TUNING.game.demolishRefund);
}

/**
 * 施設を使っている仕掛かり。作りかけの品や訓練を打ち切って解体しないのは、
 * 払った費用と素材をどこまで戻すかを別に決めずに済ませるため(仕上がってから壊してもらう)
 */
function inUse(s: GameState, facilityId: string, name: string): string | null {
  const job = s.crafts.find((j) => RECIPE[j.recipeId]?.facility === facilityId);
  if (job) return `${name}では${RECIPE[job.recipeId].name}を作っています`;
  const trainee = facilityId === 'training' ? s.adventurers.find((a) => a.status === 'training') : undefined;
  if (trainee) return `${name}では${trainee.name}が訓練中です`;
  return null;
}

/** その施設が無かったときの名簿の定員。recruit.ts の capacity と同じ式(あちらは base を読むので、循環を避けてここで再計算する) */
function capacityWithout(s: GameState, facilityId: string): number {
  return TUNING.game.baseCapacity
    + s.base.facilities.filter((f) => f.id !== facilityId).reduce((t, f) => t + facilityEffect(s, f.id, 'capacity'), 0);
}

export function canDemolish(s: GameState, facilityId: string): Result {
  const f = findFacility(s, facilityId);
  if (!f || !has(FACILITY, facilityId)) return fail('その施設はありません');
  const def = FACILITY[facilityId];
  if (f.construction) return fail(`${def.name}は工事中です`);
  const busy = inUse(s, facilityId, def.name);
  if (busy) return fail(busy);
  // 名簿を定員より多い状態に置かない。壊したあとに誰かを追い出す・雇えないまま残す、のどちらも選ばせない
  const cap = capacityWithout(s, facilityId);
  if (s.adventurers.length > cap) return fail(`${def.name}を壊すと定員が${cap}人になり、いまの${s.adventurers.length}人が住めません`);
  return ok();
}

/** 施設を取り壊して区画を空ける。勤務者は待機に戻り、demolishGold を資金に戻す */
export function demolish(s: GameState, facilityId: string): Result {
  const r = canDemolish(s, facilityId);
  if (!r.ok) return r;
  const def = FACILITY[facilityId];
  for (const a of workersOf(s, facilityId)) {
    a.status = 'idle';
    a.assignment = null;
  }
  const gold = demolishGold(s, facilityId);
  s.gold += gold;
  ledger(s, `解体: ${def.name}`, gold);
  s.base.facilities = s.base.facilities.filter((f) => f.id !== facilityId);
  return ok();
}

/** advanceDay から呼ぶ。untilDay を迎えた工事を仕上げる */
export function completeConstructions(s: GameState, notices: string[]) {
  for (const f of s.base.facilities) {
    if (!f.construction || f.construction.untilDay > s.day) continue;
    f.level = f.construction.toLevel;
    f.construction = null;
    notices.push(`${FACILITY[f.id]?.name ?? f.id}がLv${f.level}になった。`);
  }
}

export function listSynergies(): SynergyDef[] {
  return SYNERGIES;
}

export function activeSynergies(s: GameState): SynergyDef[] {
  return SYNERGIES.filter((syn) => {
    const a = findFacility(s, syn.a);
    const b = findFacility(s, syn.b);
    if (!a || !b || a.level < 1 || b.level < 1) return false;
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  });
}

export function synergyValue(s: GameState, key: string): number {
  return activeSynergies(s).reduce((t, syn) => t + (syn.effect[key] ?? 0), 0);
}

/** 施設の効果はここで読む。同じ効果を複数の施設とシナジーが持つので、施設を名指しせず合計する */
export function bonus(s: GameState, key: string): number {
  return s.base.facilities.reduce((t, f) => t + facilityEffect(s, f.id, key), 0) + synergyValue(s, key);
}

const PRODUCTION = [
  { facility: 'sawmill', key: 'produceLumber', item: 'lumber' },
  { facility: 'quarry', key: 'produceStone', item: 'stone' },
];

/**
 * advanceDay から呼ぶ。製材所・石切場が建材を在庫に足す。勤務者の基準は工房と同じ(tuning.craft.workerStatMin)。
 * 建材は売り買いしないので台帳に載せず、毎日のことなのでお知らせも出さない(notices は他の日送り処理と形をそろえるため)
 */
export function dailyProduction(s: GameState, notices: string[]) {
  for (const p of PRODUCTION) {
    if (facilityLevel(s, p.facility) < 1) continue;
    const stat = FACILITY[p.facility].workStat;
    const skilled = !!stat && workersOf(s, p.facility).some((a) => effectiveStats(a)[stat] >= TUNING.craft.workerStatMin);
    const n = bonus(s, p.key) + (skilled ? 1 : 0);
    if (n > 0) addInventory(s, p.item, n);
  }
}

/** その施設で勤務中の冒険者 */
export function workersOf(s: GameState, facilityId: string) {
  return s.adventurers.filter((a) => a.status === 'working' && a.assignment && 'facility' in a.assignment && a.assignment.facility === facilityId);
}

export function assignWorker(s: GameState, advId: string, facilityId: string): Result {
  const a = s.adventurers.find((x) => x.id === advId);
  if (!a) return fail('その冒険者はいません');
  if (a.status !== 'idle') return fail(`${a.name}は手が空いていません`);
  const def = has(FACILITY, facilityId) ? FACILITY[facilityId] : undefined;
  if (!def || !def.workSlots) return fail('その施設には勤務できません');
  if (facilityLevel(s, facilityId) < 1) return fail(`${def.name}はまだ完成していません`);
  if (workersOf(s, facilityId).length >= def.workSlots) return fail(`${def.name}の勤務枠は埋まっています`);
  a.status = 'working';
  a.assignment = { facility: facilityId };
  return ok();
}

export function unassignWorker(s: GameState, advId: string): Result {
  const a = s.adventurers.find((x) => x.id === advId);
  if (!a || a.status !== 'working') return fail('その冒険者は勤務していません');
  a.status = 'idle';
  a.assignment = null;
  return ok();
}
