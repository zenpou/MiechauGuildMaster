// 装備の付け外し(DESIGN 第5節)。装備は在庫のスタックで、個体差はない。
import { ITEM, JOB } from './data';
import type { Adventurer, EquipSlot, Equipment, GameState, Result } from './types';


const EQUIP_KINDS = ['weapon', 'armor', 'accessory'];

/** 旧セーブには equipment が無いので、無ければ空の枠を作る */
function slotsOf(a: Adventurer): Equipment {
  a.equipment ??= { weapon: null, armor: null, accessory: null };
  return a.equipment;
}

/** 着けられるか。GameState を受け取らないので在庫は equip 側で見る */
export function canEquip(a: Adventurer, itemId: string): Result {
  const it = ITEM[itemId];
  if (!it || !EQUIP_KINDS.includes(it.kind) || !it.equip) return { ok: false, reason: '装備品ではない' };
  if (a.status !== 'idle') return { ok: false, reason: `${a.name}は待機中ではない` };
  const cls = it.equip.armorClass;
  if (it.equip.slot === 'armor' && cls && !JOB[a.job].armor.includes(cls)) {
    return { ok: false, reason: `${JOB[a.job].name}は${it.name}を着られない` };
  }
  return { ok: true };
}

export function equip(s: GameState, advId: string, itemId: string): Result {
  const a = s.adventurers.find((x) => x.id === advId);
  if (!a) return { ok: false, reason: '冒険者がいない' };
  const can = canEquip(a, itemId);
  if (!can.ok) return can;
  if ((s.inventory[itemId] ?? 0) < 1) return { ok: false, reason: `${ITEM[itemId].name}の在庫がない` };
  const slot = ITEM[itemId].equip!.slot;
  const eq = slotsOf(a);
  const prev = eq[slot];
  s.inventory[itemId]--;
  if (s.inventory[itemId] === 0) delete s.inventory[itemId];
  if (prev) s.inventory[prev] = (s.inventory[prev] ?? 0) + 1;
  eq[slot] = itemId;
  return { ok: true };
}

export function unequip(s: GameState, advId: string, slot: EquipSlot): Result {
  const a = s.adventurers.find((x) => x.id === advId);
  if (!a) return { ok: false, reason: '冒険者がいない' };
  if (a.status !== 'idle') return { ok: false, reason: `${a.name}は待機中ではない` };
  const eq = slotsOf(a);
  const prev = eq[slot];
  if (!prev) return { ok: false, reason: 'その枠には何も着けていない' };
  s.inventory[prev] = (s.inventory[prev] ?? 0) + 1;
  eq[slot] = null;
  return { ok: true };
}
