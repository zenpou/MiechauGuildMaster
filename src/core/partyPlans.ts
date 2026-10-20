// 派遣編成の保存。ここでは出発を行わず、通常のダンジョン行動だけを再利用できる形で保持する。
import { DUNGEON, ENEMY, ITEM, POLICY, TUNING } from './data';
import { parseFloor } from './dungeon';
import { PARTY_MAX, type ActionKind, type DispatchOrder, type GameState, type PartyPlan, type Result } from './types';

const PLAN_MAX = 4;
const NAME_MAX = 24;
const NORMAL_ACTIONS: ActionKind[] = ['explore', 'gather', 'hunt', 'boss', 'survey'];
const TARGET_KEYS = new Set(['dungeon', 'floor', 'item', 'enemy']);

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const has = <V>(table: Record<string, V>, key: string) => Object.prototype.hasOwnProperty.call(table, key);

function normalName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || Array.from(name).length > NAME_MAX) return null;
  return name;
}

function cloneOrder(order: DispatchOrder): DispatchOrder {
  const target: DispatchOrder['target'] = { dungeon: order.target.dungeon, floor: order.target.floor };
  if (order.target.item !== undefined) target.item = order.target.item;
  if (order.target.enemy !== undefined) target.enemy = order.target.enemy;
  const items = Object.fromEntries(Object.entries(order.items ?? {}).map(([id, n]) => [id, n]));
  return {
    partyIds: [...order.partyIds],
    leaderId: order.leaderId,
    action: order.action,
    target,
    policy: order.policy,
    days: order.days,
    items,
    blessed: false,
  };
}

/** 保存対象の order を検証し、余分な状態(route/questId/祝福)を含まないコピーを返す。 */
export function normalizePartyOrder(
  value: unknown,
  roster?: GameState['adventurers'],
): { ok: true; order: DispatchOrder } | { ok: false; reason: string } {
  if (!isObject(value) || !Array.isArray(value.partyIds) || !isString(value.leaderId)) return fail('派遣編成が不正です');
  if (!NORMAL_ACTIONS.includes(value.action as ActionKind)) return fail('保存できるのは通常のダンジョン行動だけです');
  if (!isObject(value.target)) return fail('行き先の指定が不正です');
  if (Object.keys(value.target).some((key) => !TARGET_KEYS.has(key))) return fail('依頼や経路付きの派遣は保存できません');
  const target = value.target;
  if (!isString(target.dungeon) || !has(DUNGEON, target.dungeon)) return fail('行き先のダンジョンが不正です');
  const dungeon = DUNGEON[target.dungeon];
  const floor = target.floor ?? 'f1';
  if (!isString(floor) || !dungeon.floors.some((f) => f.id === floor)) return fail('行き先のフロアが不正です');
  if (!has(POLICY, String(value.policy))) return fail('方針が不正です');
  if (!Number.isInteger(value.days) || (value.days as number) < 1 || (value.days as number) > TUNING.game.daysMax) return fail('日数が不正です');

  const partyIds = value.partyIds;
  if (partyIds.length < 1 || partyIds.length > PARTY_MAX || partyIds.some((id) => !isString(id))) return fail(`隊員は1〜${PARTY_MAX}人で指定してください`);
  if (new Set(partyIds).size !== partyIds.length) return fail('同じ冒険者を重複して保存できません');
  if (!partyIds.includes(value.leaderId)) return fail('隊長は保存する隊員から選んでください');
  if (roster && partyIds.some((id) => !roster.some((a) => a.id === id))) return fail('名簿にいない冒険者は保存できません');

  if (value.action === 'gather') {
    if (!isString(target.item) || !has(ITEM, target.item)) return fail('採取する素材を指定してください');
    const grid = parseFloor(dungeon.floors.find((f) => f.id === floor)!);
    if (!grid.cells.some((c) => c.kind === 'gather' && c.item === target.item)) return fail('その素材はこのフロアでは採れません');
  } else if (target.item !== undefined) {
    return fail('素材指定は採取行動でだけ使えます');
  }
  if (value.action === 'hunt' && target.enemy !== undefined) {
    if (!isString(target.enemy) || !has(ENEMY, target.enemy)) return fail('討伐対象が不正です');
    const grid = parseFloor(dungeon.floors.find((f) => f.id === floor)!);
    if (!grid.cells.some((c) => (c.kind === 'nest' || c.kind === 'symbol' || c.kind === 'boss') && c.enemy === target.enemy)) {
      return fail('その敵はこのフロアにいません');
    }
  } else if (target.enemy !== undefined) {
    return fail('敵指定は討伐行動でだけ使えます');
  }
  if (target.item !== undefined && !isString(target.item)) return fail('素材指定が不正です');
  if (target.enemy !== undefined && !isString(target.enemy)) return fail('敵指定が不正です');

  const rawItems = value.items === undefined ? {} : value.items;
  if (!isObject(rawItems) || Object.entries(rawItems).some(([id, n]) => !has(ITEM, id) || !isCount(n))) return fail('持ち物の指定が不正です');
  const order: DispatchOrder = {
    partyIds: [...partyIds] as string[],
    leaderId: value.leaderId,
    action: value.action as ActionKind,
    target: { dungeon: target.dungeon, floor, ...(target.item !== undefined ? { item: target.item } : {}), ...(target.enemy !== undefined ? { enemy: target.enemy } : {}) },
    policy: String(value.policy),
    days: value.days as number,
    items: Object.fromEntries(Object.entries(rawItems).map(([id, n]) => [id, n as number])),
    blessed: false,
  };
  return { ok: true, order };
}

function slotId(index: number): string { return `party-plan-${index}`; }

/** 旧セーブから編成だけを安全に取り出す。隊員IDは現名簿に無くても保持する。 */
export function normalizePartyPlans(raw: unknown): PartyPlan[] {
  if (!Array.isArray(raw)) return [];
  const used = new Set<string>();
  const out: PartyPlan[] = [];
  for (const entry of raw) {
    if (out.length >= PLAN_MAX) break;
    if (!isObject(entry)) continue;
    const name = normalName(entry.name);
    const normalized = normalizePartyOrder(entry.order);
    if (!name || !normalized.ok) continue;
    let id = typeof entry.id === 'string' && /^party-plan-[1-4]$/.test(entry.id) && !used.has(entry.id) ? entry.id : '';
    if (!id) {
      for (let i = 1; i <= PLAN_MAX; i++) if (!used.has(slotId(i))) { id = slotId(i); break; }
    }
    if (!id) break;
    used.add(id);
    out.push({ id, name, order: cloneOrder(normalized.order) });
  }
  return out;
}

export type SavePartyPlanResult = { ok: true; plan: PartyPlan } | { ok: false; reason: string };

/** 現在の名簿を確認して編成を保存する。保存時に在庫・祝福・カウンタは変えない。 */
export function savePartyPlan(s: GameState, nameValue: string, order: DispatchOrder, replaceId?: string): SavePartyPlanResult {
  const name = normalName(nameValue);
  if (!name) return fail('編成名は1〜24文字で入力してください');
  const normalized = normalizePartyOrder(order, s.adventurers);
  if (!normalized.ok) return normalized;
  if (!Array.isArray(s.partyPlans)) s.partyPlans = [];
  const current = s.partyPlans;
  let id: string;
  if (replaceId !== undefined) {
    if (!current.some((p) => p?.id === replaceId)) return fail('置き換える編成がありません');
    id = replaceId;
  } else {
    if (current.length >= PLAN_MAX) return fail(`保存できる編成は${PLAN_MAX}件までです`);
    id = '';
    for (let i = 1; i <= PLAN_MAX; i++) if (!current.some((p) => p?.id === slotId(i))) { id = slotId(i); break; }
    if (!id) return fail(`保存できる編成は${PLAN_MAX}件までです`);
  }
  const plan: PartyPlan = { id, name, order: cloneOrder(normalized.order) };
  if (replaceId !== undefined) {
    const index = current.findIndex((p) => p?.id === replaceId);
    s.partyPlans[index] = plan;
  } else {
    s.partyPlans.push(plan);
  }
  return { ok: true, plan };
}

export function deletePartyPlan(s: GameState, id: string): Result {
  const index = Array.isArray(s.partyPlans) ? s.partyPlans.findIndex((p) => p?.id === id) : -1;
  if (index < 0) return fail('その編成はありません');
  s.partyPlans.splice(index, 1);
  return { ok: true };
}

// 呼び出し側が module を選びやすいように、下書きAPIも同じ公開面から参照できるようにする。
export { draftFromPartyPlan } from './expeditionPlan';
