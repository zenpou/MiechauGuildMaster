import { dispatch } from '../core/game';
import { DUNGEON, JOB, POLICIES, PERSONALITY } from '../core/data';
import { PARTY_MAX, PARTIES_MAX } from '../core/types';
import { commit, nameOf, render, state, statusText, toast, ui } from './app';
import { div, h, span } from './dom';

const DUNGEON_ID = 'forest_cave';
const FLOOR_ID = 'f1';
const DAY_CHOICES = [1, 2, 3, 4, 5];

const available = () => state.adventurers.filter((a) => a.status === 'idle' && a.injuryDays === 0);

function tidy() {
  const ok = new Set(available().map((a) => a.id));
  ui.d.members = ui.d.members.filter((id) => ok.has(id));
  if (!ui.d.leader || !ui.d.members.includes(ui.d.leader)) ui.d.leader = ui.d.members[0] ?? null;
  ui.d.potions = Math.min(ui.d.potions, state.inventory.potion ?? 0);
}

export function dispatchTab(): HTMLElement {
  tidy();
  const d = ui.d;
  const free = new Set(available().map((a) => a.id));
  const potionStock = state.inventory.potion ?? 0;
  const dungeon = DUNGEON[DUNGEON_ID];

  const memberRows = state.adventurers.map((a) => {
    const checked = d.members.includes(a.id);
    const can = free.has(a.id);
    return h('li', { class: can ? '' : 'dim' },
      h('label', null,
        h('input', {
          type: 'checkbox', checked: checked ? true : undefined, disabled: !can,
          onchange: (ev: Event) => toggleMember(a.id, (ev.target as HTMLInputElement).checked),
        }),
        ` ${a.name}`, span('dim small', ` ${JOB[a.job].name} Lv${a.level} / ${PERSONALITY[a.personality].name} / 疲労${a.fatigue}`),
        can ? null : span('small', ` (${statusText(a)})`),
      ),
      checked ? h('label', { class: 'leader' },
        h('input', { type: 'radio', name: 'leader', checked: d.leader === a.id ? true : undefined, onchange: () => { d.leader = a.id; render(); } }),
        ' 隊長') : null,
    );
  });

  return div('tab-body',
    h('h2', null, `行き先: ${dungeon.name}(${dungeon.floors.find((f) => f.id === FLOOR_ID)?.name ?? FLOOR_ID})`),
    div('dim small', dungeon.desc),
    h('h2', null, `隊員(${d.members.length}/${PARTY_MAX})`),
    h('ul', { class: 'plain members' }, ...memberRows),
    div('form',
      h('label', null, '方針 ',
        h('select', { onchange: (ev: Event) => { d.policy = (ev.target as HTMLSelectElement).value; render(); } },
          ...POLICIES.map((p) => h('option', { value: p.id, selected: p.id === d.policy ? true : undefined }, p.name))),
      ),
      h('label', null, '日数 ',
        h('select', { onchange: (ev: Event) => { d.days = Number((ev.target as HTMLSelectElement).value); render(); } },
          ...DAY_CHOICES.map((n) => h('option', { value: n, selected: n === d.days ? true : undefined }, `${n}日`))),
      ),
      h('label', null, `回復薬(在庫${potionStock}) `,
        h('select', { onchange: (ev: Event) => { d.potions = Number((ev.target as HTMLSelectElement).value); render(); } },
          ...Array.from({ length: potionStock + 1 }, (_, n) => h('option', { value: n, selected: n === d.potions ? true : undefined }, `${n}個`))),
      ),
    ),
    div('dim small', POLICIES.find((p) => p.id === d.policy)?.desc ?? ''),
    h('button', { class: 'primary wide', disabled: !d.members.length || !d.leader, onclick: depart }, '出発'),
    h('h2', null, `派遣中(${state.expeditions.length}/${PARTIES_MAX})`),
    state.expeditions.length
      ? h('ul', { class: 'plain' }, ...state.expeditions.map((e) => h('li', null,
        `${e.order.partyIds.map(nameOf).join('・')}`,
        span('dim small', ` 隊長 ${nameOf(e.order.leaderId)} / ${DUNGEON[e.order.target.dungeon ?? '']?.name ?? '?'} / ${e.startDay}日目出発 → `),
        span(null, `${e.returnDay}日目に帰還予定`),
      )))
      : div('dim', '派遣中の隊はありません'),
  );
}

function toggleMember(id: string, on: boolean) {
  const d = ui.d;
  if (on && !d.members.includes(id)) {
    if (d.members.length >= PARTY_MAX) { toast(`隊は${PARTY_MAX}人までです`, true); return; }
    d.members.push(id);
  }
  if (!on) d.members = d.members.filter((x) => x !== id);
  render();
}

function depart() {
  const d = ui.d;
  if (!d.leader) return toast('隊長を選んでください', true);
  const r = dispatch(state, {
    partyIds: [...d.members], leaderId: d.leader, action: 'explore',
    target: { dungeon: DUNGEON_ID, floor: FLOOR_ID },
    policy: d.policy, days: d.days, items: d.potions > 0 ? { potion: d.potions } : {},
  });
  if (!r.ok) return toast(r.reason, true);
  d.members = [];
  d.leader = null;
  d.potions = 0;
  commit();
  toast(`出発しました。${r.expedition.returnDay}日目に帰還します。`);
}
