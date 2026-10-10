import { DUNGEON, DUNGEONS, ENEMY, ITEM, JOB, POLICIES, PERSONALITY } from '../core/data';
import { parseFloor } from '../core/dungeon';
import { dispatch, exploredRateOf } from '../core/game';
import { assessReadiness, type Readiness } from '../core/readiness';
import { PARTY_MAX, PARTIES_MAX, type ActionKind, type DispatchOrder } from '../core/types';
import { ACTION_NAME, actionText, advById, commit, nameOf, render, state, statusText, toast, ui } from './app';
import { div, h, span } from './dom';

const FLOOR_ID = 'f1';
const DAY_CHOICES = [1, 2, 3, 4, 5];
const ACTIONS: ActionKind[] = ['explore', 'gather', 'hunt', 'boss', 'survey'];
const BOSS_KINDS = ['symbol', 'boss'];
const FORECAST_RUNS = 40;

const available = () => state.adventurers.filter((a) => a.status === 'idle' && a.injuryDays === 0);
const dungeonIds = () => DUNGEONS.map((d) => d.id).filter((id) => state.dungeons[id]);
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const val = (ev: Event) => (ev.target as HTMLSelectElement).value;

/** 行き先ごとの選択肢。可否の最終判断は dispatch の戻りに任せ、ここは出発前に見せるための再現 */
function choicesFor(dungeonId: string) {
  const def = DUNGEON[dungeonId];
  const prog = state.dungeons[dungeonId];
  const grid = parseFloor(def.floors.find((f) => f.id === FLOOR_ID)!);
  const visited = prog?.floors[FLOOR_ID]?.visited ?? [];
  const confirmed = !!prog?.confirmed;
  const full = confirmed && exploredRateOf(state, dungeonId, FLOOR_ID) >= 1;
  const items = uniq(grid.cells.filter((c) => c.kind === 'gather' && c.item).map((c) => c.item!));
  const enemies = uniq(grid.cells.filter((c) => (c.kind === 'nest' || BOSS_KINDS.includes(c.kind)) && c.enemy).map((c) => c.enemy!));
  const reason: Partial<Record<ActionKind, string>> = {};
  if (confirmed) reason.survey = '確認済みのダンジョンには不要';
  else for (const a of ACTIONS) if (a !== 'survey') reason[a] = '噂だけのダンジョン。先に踏査が要る';
  if (confirmed && !items.length) reason.gather = 'このフロアに採取点が無い';
  if (confirmed && !visited.some((i) => BOSS_KINDS.includes(grid.cells[i]?.kind))) reason.boss = 'まだ巣の主の部屋に着いていない';
  const knownGather = (item: string) => visited.filter((i) => grid.cells[i]?.kind === 'gather' && grid.cells[i].item === item).length;
  return { confirmed, full, items, enemies, reason, knownGather };
}
type Choices = ReturnType<typeof choicesFor>;

function tidy() {
  const d = ui.d;
  const ok = new Set(available().map((a) => a.id));
  d.members = d.members.filter((id) => ok.has(id));
  if (!d.leader || !d.members.includes(d.leader)) d.leader = d.members[0] ?? null;
  d.potions = Math.min(d.potions, state.inventory.potion ?? 0);
  if (!state.dungeons[d.dungeon]) d.dungeon = dungeonIds()[0];
  const c = choicesFor(d.dungeon);
  if (c.reason[d.action]) d.action = ACTIONS.find((a) => !c.reason[a]) ?? 'explore';
  if (d.action === 'gather' && !c.items.includes(d.item)) d.item = c.items[0] ?? '';
  if (d.action !== 'hunt' || !c.full || !c.enemies.includes(d.enemy)) d.enemy = '';
}

function currentOrder(): DispatchOrder | null {
  const d = ui.d;
  if (!d.leader || !d.members.length) return null;
  const target: DispatchOrder['target'] = { dungeon: d.dungeon, floor: FLOOR_ID };
  if (d.action === 'gather' && d.item) target.item = d.item;
  if (d.action === 'hunt' && d.enemy) target.enemy = d.enemy;
  return {
    partyIds: [...d.members], leaderId: d.leader, action: d.action, target,
    policy: d.policy, days: d.days, items: d.potions > 0 ? { potion: d.potions } : {},
  };
}

// 日送りや別の隊の出発で前提が変わるので、日と派遣数も条件に含める
const orderKey = (o: DispatchOrder | null) => (o ? JSON.stringify([o, state.day, state.counters.dispatches]) : '');

export function dispatchTab(): HTMLElement {
  tidy();
  const d = ui.d;
  const free = new Set(available().map((a) => a.id));
  const potionStock = state.inventory.potion ?? 0;
  const dungeon = DUNGEON[d.dungeon];
  const c = choicesFor(d.dungeon);
  const leader = d.leader ? advById(d.leader) : undefined;
  const order = currentOrder();
  const forecast = ui.forecast && ui.forecast.key === orderKey(order) ? ui.forecast.r : null;

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
    h('h2', null, '行き先'),
    h('select', { class: 'wide', onchange: (ev: Event) => { d.dungeon = val(ev); render(); } },
      ...dungeonIds().map((id) => h('option', { value: id, selected: id === d.dungeon ? true : undefined },
        `${DUNGEON[id].name}${state.dungeons[id].confirmed ? '' : '(噂)'}`))),
    div('dim small', dungeon.desc),
    h('h2', null, '行動'),
    div('actions', ...ACTIONS.map((a) => h('label', { class: c.reason[a] ? 'dim' : '' },
      h('input', {
        type: 'radio', name: 'action', value: a, checked: d.action === a ? true : undefined, disabled: !!c.reason[a],
        onchange: () => { d.action = a; render(); },
      }),
      ` ${ACTION_NAME[a]}`))),
    h('ul', { class: 'plain reasons small dim' }, ...ACTIONS.filter((a) => c.reason[a]).map((a) => h('li', null, `${ACTION_NAME[a]}: ${c.reason[a]}`))),
    targetBlock(c),
    h('h2', null, `隊員(${d.members.length}/${PARTY_MAX})`),
    h('ul', { class: 'plain members' }, ...memberRows),
    leader ? div('small explore-desc', `地図の埋め方: ${PERSONALITY[leader.personality].exploreDesc}`) : null,
    div('form',
      h('label', null, '方針 ',
        h('select', { onchange: (ev: Event) => { d.policy = val(ev); render(); } },
          ...POLICIES.map((p) => h('option', { value: p.id, selected: p.id === d.policy ? true : undefined }, p.name))),
      ),
      h('label', null, '日数 ',
        h('select', { onchange: (ev: Event) => { d.days = Number(val(ev)); render(); } },
          ...DAY_CHOICES.map((n) => h('option', { value: n, selected: n === d.days ? true : undefined }, `${n}日`))),
      ),
      h('label', null, `回復薬(在庫${potionStock}) `,
        h('select', { onchange: (ev: Event) => { d.potions = Number(val(ev)); render(); } },
          ...Array.from({ length: potionStock + 1 }, (_, n) => h('option', { value: n, selected: n === d.potions ? true : undefined }, `${n}個`))),
      ),
    ),
    div('dim small', POLICIES.find((p) => p.id === d.policy)?.desc ?? ''),
    h('button', { class: 'wide', disabled: !order, onclick: showForecast }, '見込みを見る'),
    forecast ? forecastBlock(forecast) : null,
    h('button', { class: 'primary wide', disabled: !order, onclick: depart }, '出発'),
    h('h2', null, `派遣中(${state.expeditions.length}/${PARTIES_MAX})`),
    state.expeditions.length
      ? h('ul', { class: 'plain' }, ...state.expeditions.map((e) => h('li', null,
        `${e.order.partyIds.map(nameOf).join('・')}`,
        span('dim small', ` 隊長 ${nameOf(e.order.leaderId)} / ${DUNGEON[e.order.target.dungeon ?? '']?.name ?? '?'} / ${actionText(e.order)} / ${e.startDay}日目出発 → `),
        span(null, `${e.returnDay}日目に帰還予定`),
      )))
      : div('dim', '派遣中の隊はありません'),
  );
}

function targetBlock(c: Choices): HTMLElement {
  const d = ui.d;
  if (d.action === 'gather') {
    const known = c.knownGather(d.item);
    return div(null,
      div('form', h('label', null, '対象 ',
        h('select', { onchange: (ev: Event) => { d.item = val(ev); render(); } },
          ...c.items.map((id) => h('option', { value: id, selected: id === d.item ? true : undefined }, ITEM[id]?.name ?? id))))),
      div(known ? 'dim small' : 'small neg', `踏んだことのある採取点: ${known}か所${known ? '' : '(未踏には入らないので、初日に引き返す)'}`),
    );
  }
  if (d.action === 'hunt') {
    return div(null,
      div('form', h('label', null, '対象 ',
        h('select', { disabled: !c.full, onchange: (ev: Event) => { d.enemy = val(ev); render(); } },
          h('option', { value: '', selected: d.enemy === '' ? true : undefined }, '指定なし(知っている巣を全部)'),
          ...(c.full ? c.enemies : []).map((id) => h('option', { value: id, selected: id === d.enemy ? true : undefined }, ENEMY[id]?.name ?? id))))),
      c.full ? null : div('dim small', '討伐の対象指定: 探索率100%で解放'),
    );
  }
  return div('form dim small', '対象: 指定なし');
}

function forecastBlock(r: Readiness): HTMLElement {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const high = r.uncertainty === '高';
  return div('detail forecast',
    div(null, span(`badge grade-${r.grade}`, r.grade), span('dim small', ` 戦力比 ${r.powerRatio.toFixed(2)}(${r.runs}回の試算)`)),
    div('small', `全滅率 ${pct(r.wipeRate)} / 撤退率 ${pct(r.retreatRate)}`),
    div('small', `平均負傷日数 ${r.avgInjuryDays.toFixed(1)}日(1人あたり) / 想定戦闘 ${r.avgFights.toFixed(1)}回`),
    div(high ? 'small neg' : 'small', `不確かさ: ${r.uncertainty}`, high ? '(未踏が多く、見込みは当てにならない)' : ''),
  );
}

function showForecast() {
  const order = currentOrder();
  if (!order) return;
  try {
    ui.forecast = { key: orderKey(order), r: assessReadiness(state, order, FORECAST_RUNS) };
  } catch (err) {
    ui.forecast = null;
    toast(`見込みを出せませんでした: ${(err as Error).message}`, true);
    return;
  }
  render();
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
  const order = currentOrder();
  if (!order) return toast('隊長を選んでください', true);
  const r = dispatch(state, order);
  if (!r.ok) return toast(r.reason, true);
  d.members = [];
  d.leader = null;
  d.potions = 0;
  ui.forecast = null;
  commit();
  toast(`出発しました。${r.expedition.returnDay}日目に帰還します。`);
}
