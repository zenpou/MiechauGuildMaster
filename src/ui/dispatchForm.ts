import type { ExpeditionDraft } from '../core/expeditionPlan';
import type { PartyPlan } from '../core/types';
import { render, toast, ui } from './app';

/** 準備画面へ写すだけ。出発・消費・保存は各操作に任せる。 */
export function openDispatchDraft(draft: ExpeditionDraft, explanation: string, plan?: Pick<PartyPlan, 'id' | 'name'>) {
  if (!draft.ok) return toast(draft.reason, true);
  ui.partyPlanEditId = plan?.id ?? '';
  ui.partyPlanName = plan?.name ?? '';
  ui.partyPlanRemoveId = null;
  const o = draft.order;
  ui.d = {
    members: o.partyIds, leader: o.leaderId || null, policy: o.policy, days: o.days,
    potions: o.items?.potion ?? 0, blessed: false, dungeon: o.target.dungeon!, floor: o.target.floor ?? 'f1',
    questId: '', action: o.action, item: o.target.item ?? '', enemy: o.target.enemy ?? '',
  };
  ui.dispatchNotes = [explanation, ...draft.notes];
  ui.forecast = null;
  ui.tab = 'dispatch';
  render();
  document.getElementById('dispatch-preparation')?.scrollIntoView({ block: 'start' });
}
