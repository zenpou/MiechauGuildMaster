// 帰還報告・保存編成から作る「下書き」。出発・消費・結果の再計算は行わない。
import { DUNGEON, ITEM, POLICY, TUNING } from './data';
import { parseFloor } from './dungeon';
import { floorTransit } from './explore';
import { heldKeys } from './ledger';
import { dispatchBlock } from './mail';
import { type Adventurer, type ActionKind, type DispatchOrder, type Expedition, type GameState } from './types';

export interface ReturnPlanTarget {
  dungeon: string; floor: string; action: 'explore' | 'gather'; item?: string;
}
export type ExpeditionDraft =
  | { ok: true; order: DispatchOrder; notes: string[] }
  | { ok: false; reason: string };

const NORMAL_ACTIONS: ActionKind[] = ['explore', 'gather', 'hunt', 'boss', 'survey'];
const fail = (reason: string): ExpeditionDraft => ({ ok: false, reason });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 下書きで隊から外す理由。派遣の最終検証は game.dispatch が引き続き担当する。 */
export function memberUnavailableReason(s: GameState, a: Adventurer): string | null {
  if (a.injuryDays > 0) return `${a.name}は負傷（あと${a.injuryDays}日）`;
  if (a.status === 'away') return `${a.name}は派遣中`;
  if (a.status === 'working') return `${a.name}は施設勤務中`;
  if (a.status === 'training') return `${a.name}は訓練中`;
  return dispatchBlock(s, [a]);
}

function targetOf(order: DispatchOrder): DispatchOrder['target'] {
  const target: DispatchOrder['target'] = {
    dungeon: order.target?.dungeon,
    floor: order.target?.floor ?? 'f1',
  };
  if (order.target?.item !== undefined) target.item = order.target.item;
  if (order.target?.enemy !== undefined) target.enemy = order.target.enemy;
  return target;
}

function dungeonReady(s: GameState, order: DispatchOrder): { ok: true; action: ActionKind; target: DispatchOrder['target'] } | { ok: false; reason: string } {
  if (!NORMAL_ACTIONS.includes(order.action)) return { ok: false, reason: '通常のダンジョン行動だけを下書きできます' };
  const target = targetOf(order);
  const dungeonId = target.dungeon;
  const floorId = target.floor;
  const def = dungeonId ? DUNGEON[dungeonId] : undefined;
  const progress = dungeonId ? s.dungeons[dungeonId] : undefined;
  if (!def || !progress || !floorId || !def.floors.some((f) => f.id === floorId)) return { ok: false, reason: 'まだ派遣できない場所です。ワールドと地図を確認してください' };
  const transit = floorTransit(def, floorId, progress, heldKeys(s));
  // 噂の段階では survey を維持する。確認済みの survey は次の探索へ変換する。
  if (order.action === 'survey' && !progress.confirmed) {
    if (transit === null) return { ok: false, reason: 'まだ派遣できない場所です。ワールドと地図を確認してください' };
  } else {
    if (!progress.confirmed || transit === null) return { ok: false, reason: 'まだ派遣できない場所です。ワールドと地図を確認してください' };
  }

  const floor = def.floors.find((f) => f.id === floorId)!;
  const grid = parseFloor(floor);
  if (order.action === 'gather') {
    if (typeof target.item !== 'string' || !grid.cells.some((c) => c.kind === 'gather' && c.item === target.item)) {
      return { ok: false, reason: 'この素材の採取点をまだ発見していません' };
    }
  }
  if (order.action === 'hunt' && target.enemy !== undefined) {
    if (typeof target.enemy !== 'string' || !grid.cells.some((c) => ['nest', 'symbol', 'boss'].includes(c.kind) && c.enemy === target.enemy)) {
      return { ok: false, reason: 'その敵はこのフロアにいません' };
    }
  }
  const action = order.action === 'survey' && progress.confirmed ? 'explore' : order.action;
  return { ok: true, action, target };
}

function noteItemName(id: string): string { return ITEM[id]?.name ?? id; }

/** order を共通に下書きへ変換する。呼び出し元の state/order は変更しない。 */
export function draftFromOrder(s: GameState, source: DispatchOrder): ExpeditionDraft {
  if (!source || typeof source !== 'object' || !source.target) return fail('派遣内容が不正です');
  const ready = dungeonReady(s, source);
  if (!ready.ok) return ready;
  if (!POLICY[source.policy]) return fail('方針が不正です');

  const notes: string[] = [];
  const members: Adventurer[] = [];
  for (const id of Array.isArray(source.partyIds) ? source.partyIds : []) {
    const member = s.adventurers.find((a) => a.id === id);
    if (!member) {
      notes.push('名簿にいない隊員は外しました。');
      continue;
    }
    const reason = memberUnavailableReason(s, member);
    if (reason) {
      notes.push(`${reason}。隊から外しました。`);
      continue;
    }
    members.push(member);
  }
  const partyIds = members.map((m) => m.id);
  const pairBlock = dispatchBlock(s, members);
  if (pairBlock) notes.push(`${pairBlock}。隊の組み合わせを確認してください。`);

  const requestedItems = source.items && typeof source.items === 'object' ? source.items : {};
  const items: Record<string, number> = {};
  for (const [id, requested] of Object.entries(requestedItems)) {
    if (!ITEM[id] || !Number.isInteger(requested) || requested < 0) {
      notes.push(`${id}は持ち物から外しました。`);
      continue;
    }
    const available = Math.max(0, Math.min(requested, s.inventory[id] ?? 0));
    if (available < requested) notes.push(`${noteItemName(id)}は在庫の${available}個に合わせました。`);
    if (available > 0) items[id] = available;
  }
  if (!members.length) notes.push('出発できる隊員を選んでください。');

  return {
    ok: true,
    notes,
    order: {
      partyIds,
      leaderId: partyIds.includes(source.leaderId) ? source.leaderId : partyIds[0] ?? '',
      action: ready.action,
      target: ready.target,
      policy: source.policy,
      days: clamp(Number.isInteger(source.days) ? source.days : 1, 1, TUNING.game.daysMax),
      items,
      blessed: false,
    },
  };
}

export function draftFromPartyPlan(s: GameState, id: string): ExpeditionDraft {
  const plan = s.partyPlans?.find((p) => p?.id === id);
  if (!plan) return fail('その編成はありません');
  return draftFromOrder(s, plan.order);
}

function discoveredGather(s: GameState, dungeonId: string, floorId: string, item: string): boolean {
  const def = DUNGEON[dungeonId];
  const progress = s.dungeons[dungeonId];
  const floor = def?.floors.find((f) => f.id === floorId);
  if (!def || !progress || !floor) return false;
  const grid = parseFloor(floor);
  return (progress.floors[floorId]?.visited ?? []).some((i) => grid.cells[i]?.kind === 'gather' && grid.cells[i]?.item === item);
}

export function draftFromExpedition(s: GameState, e: Expedition, target?: ReturnPlanTarget): ExpeditionDraft {
  if (!e.claimed) return fail('帰還した隊の報告から準備できます');
  const dungeon = target?.dungeon ?? e.order.target.dungeon;
  const floor = target?.floor ?? e.order.target.floor ?? 'f1';
  const action = target?.action ?? e.order.action;
  const source: DispatchOrder = {
    ...e.order,
    action,
    target: target
      ? { dungeon, floor, ...(target.item ? { item: target.item } : {}) }
      : { ...e.order.target, dungeon, floor },
  };
  if (target?.action === 'gather' && (!target.item || !discoveredGather(s, dungeon ?? '', floor, target.item))) {
    return fail('この素材の採取点をまだ発見していません');
  }
  return draftFromOrder(s, source);
}
