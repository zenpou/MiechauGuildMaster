import { previewEquipment } from '../core/equipment';
import { ELEMENT_IDS, ELEMENT_LABEL, STAT_KEYS, type Adventurer, type EquipSlot, type ItemDef } from '../core/types';
import { sign, STAT_LABEL } from './app';

const EFFECT_NAME: Record<string, string> = { gather: '採取量', carry: '積載' };

/** 名簿・在庫・工房で共通の装備効果。 */
export function equipText(def: ItemDef | undefined): string {
  const e = def?.equip;
  if (!e) return '';
  const parts = Object.entries(e.mods).map(([k, v]) => `${STAT_LABEL[k as keyof typeof STAT_LABEL] ?? k}${sign(v as number)}`);
  for (const k of ELEMENT_IDS) if (e.resist?.[k]) parts.push(`${ELEMENT_LABEL[k]}耐性${Math.round(e.resist[k]! * 100)}%`);
  for (const [k, v] of Object.entries(e.effects ?? {})) parts.push(`${EFFECT_NAME[k] ?? k}${sign(v)}`);
  return parts.join(' / ');
}

/** 実効能力だけでなく、付け替えて失う耐性・採取効果も見せる。 */
export function equipmentChangeText(a: Adventurer, slot: EquipSlot, itemId: string | null): string {
  const preview = previewEquipment(a, slot, itemId);
  if (!preview) return '今の職業では装備できません';
  const { before, after } = preview;
  const parts = STAT_KEYS.filter((k) => before.stats[k] !== after.stats[k])
    .map((k) => `${STAT_LABEL[k]} ${before.stats[k]}→${after.stats[k]}`);
  for (const k of ELEMENT_IDS) {
    const b = Math.round((before.resist[k] ?? 0) * 100);
    const n = Math.round((after.resist[k] ?? 0) * 100);
    if (b !== n) parts.push(`${ELEMENT_LABEL[k]}耐性 ${b}%→${n}%`);
  }
  if (before.gatherBonus !== after.gatherBonus) parts.push(`採取量の加算 ${sign(before.gatherBonus)}→${sign(after.gatherBonus)}`);
  if (before.capacity !== after.capacity) parts.push(`持てる重さ ${before.capacity}→${after.capacity}`);
  return parts.join(' / ') || '能力・耐性の変化なし';
}
