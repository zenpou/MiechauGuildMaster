import { DUNGEON, POLICY } from '../core/data';
import { memberUnavailableReason } from '../core/expeditionPlan';
import { deletePartyPlan, draftFromPartyPlan, savePartyPlan } from '../core/partyPlans';
import type { DispatchOrder, PartyPlan } from '../core/types';
import { actionText, commit, render, state, toast, ui } from './app';
import { openDispatchDraft } from './dispatchForm';
import { div, h, span } from './dom';
import { mapFace } from './mapFace';
import './operations.css';

export function partyPlansBlock(): HTMLElement {
  return h('section', { class: 'party-plans', 'aria-label': '保存した隊編成' },
    h('h2', null, `保存した隊編成（${state.partyPlans.length}/4）`),
    state.partyPlans.length
      ? div('party-plan-grid', ...state.partyPlans.map(planCard))
      : div('small dim', '隊員と行き先を選び、「この編成を保存」から探索隊や採集隊を登録できます。'),
  );
}

function planCard(plan: PartyPlan): HTMLElement {
  const o = plan.order;
  const members = o.partyIds.map((id) => state.adventurers.find((a) => a.id === id));
  const ready = members.filter((a) => a && !memberUnavailableReason(state, a)).length;
  const location = DUNGEON[o.target.dungeon ?? ''];
  const floor = location?.floors.find((f) => f.id === o.target.floor);
  const remove = ui.partyPlanRemoveId === plan.id;
  return h('article', { class: 'party-plan', 'aria-label': plan.name },
    h('h3', null, plan.name),
    div('small', `${location?.name ?? '行き先を確認'}${floor ? `・${floor.name}` : ''} / ${actionText(o)}`),
    div('small dim', `${POLICY[o.policy]?.name ?? o.policy} / 現地${o.days}日 / 回復薬${o.items.potion ?? 0}個`),
    div('party-plan-members', ...members.map((m) => div('party-plan-person',
      m ? mapFace(m) : null,
      span('small', m ? `${m.id === o.leaderId ? '隊長 ' : ''}${m.name}` : '離脱した仲間')))),
    div(ready === members.length ? 'small pos' : 'small', `出発できる仲間 ${ready}/${members.length}人`),
    ...members.flatMap((m) => {
      const reason = m ? memberUnavailableReason(state, m) : '名簿にいない仲間がいます';
      return reason ? [div('small dim', reason)] : [];
    }),
    div('row',
      h('button', { onclick: () => {
        openDispatchDraft(draftFromPartyPlan(state, plan.id),
          `「${plan.name}」をもとに準備しています。今日出せない仲間は外しています。隊員と持ち物を見直して出発してください。`, plan);
      } }, 'この編成で準備'),
      h('button', { class: remove ? 'small danger' : 'small', onclick: () => {
        if (!remove) { ui.partyPlanRemoveId = plan.id; render(); return; }
        const result = deletePartyPlan(state, plan.id);
        if (!result.ok) return toast(result.reason, true);
        if (ui.partyPlanEditId === plan.id) { ui.partyPlanEditId = ''; ui.partyPlanName = ''; }
        ui.partyPlanRemoveId = null;
        commit();
        toast(`「${plan.name}」の登録を解除しました`);
      } }, remove ? '登録解除を確定' : '登録解除'),
      remove ? h('button', { class: 'small', onclick: () => { ui.partyPlanRemoveId = null; render(); } }, '取り消す') : null,
    ),
  );
}

export function partyPlanEditor(order: DispatchOrder | null): HTMLElement | null {
  if (ui.d.questId) return null;
  if (ui.partyPlanEditId && !state.partyPlans.some((p) => p.id === ui.partyPlanEditId)) ui.partyPlanEditId = '';
  return h('details', {
    class: 'party-plan-editor', open: ui.partyPlanEditorOpen,
    ontoggle: (event: Event) => { ui.partyPlanEditorOpen = (event.currentTarget as HTMLDetailsElement).open; },
  },
  h('summary', null, 'この編成を保存'),
  div('small dim', '隊員・隊長・行き先・方針・日数・回復薬を保存します。祝福は出発のたびに選びます。'),
  div('form',
    h('label', null, '保存先 ',
      h('select', { 'aria-label': '編成の保存先', onchange: (event: Event) => {
        ui.partyPlanEditId = (event.target as HTMLSelectElement).value;
        ui.partyPlanName = state.partyPlans.find((p) => p.id === ui.partyPlanEditId)?.name ?? '';
        render();
      } }, h('option', { value: '', selected: !ui.partyPlanEditId }, '新しく登録'),
      ...state.partyPlans.map((p) => h('option', { value: p.id, selected: p.id === ui.partyPlanEditId }, p.name)))),
    h('label', null, '編成名 ',
      h('input', {
        type: 'text', maxlength: 24, 'aria-label': '編成名', value: ui.partyPlanName,
        placeholder: '例：森の採集隊',
        oninput: (event: Event) => { ui.partyPlanName = (event.target as HTMLInputElement).value; },
      })),
    h('button', { disabled: !order, onclick: () => {
      if (!order) return;
      const leader = state.adventurers.find((a) => a.id === order.leaderId);
      const name = ui.partyPlanName.trim() || `${leader?.name ?? '冒険者'}の${actionText(order)}隊`;
      const saved = savePartyPlan(state, name, order, ui.partyPlanEditId || undefined);
      if (!saved.ok) return toast(saved.reason, true);
      ui.partyPlanEditId = saved.plan.id; ui.partyPlanName = saved.plan.name;
      commit();
      toast(`「${saved.plan.name}」を保存しました`);
    } }, ui.partyPlanEditId ? '編成を更新' : '編成を保存'),
  ),
  !order ? div('small dim', '保存する隊員を選んでください。') : null,
  );
}
