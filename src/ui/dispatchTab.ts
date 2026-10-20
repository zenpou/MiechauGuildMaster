import { blessingStatus, canBless } from '../core/blessing';
import { carryCapacity } from '../core/adventurer';
import { DUNGEON, DUNGEONS, ENEMY, ITEM, JOB, NODE, POLICIES, PERSONALITY, TUNING } from '../core/data';
import { needsSearch, parseFloor } from '../core/dungeon';
import { floorTransit } from '../core/explore';
import { dispatch, exploredRateOf, recall } from '../core/game';
import { heldKeys } from '../core/ledger';
import { activeQuests, questCargo } from '../core/quests';
import { assessReadiness, type Readiness } from '../core/readiness';
import { travelDays } from '../core/world';
import { PARTY_MAX, PARTIES_MAX, type ActionKind, type DispatchOrder, type Expedition, type Quest } from '../core/types';
import { ACTION_NAME, actionText, advById, commit, destText, nameOf, positionText, render, SLOTS, state, statusText, stepToday, toast, ui } from './app';
import { div, h, span } from './dom';

const DAY_CHOICES = Array.from({ length: TUNING.game.daysMax }, (_, i) => i + 1);
const ACTIONS: ActionKind[] = ['explore', 'gather', 'hunt', 'boss', 'survey'];
const BOSS_KINDS = ['symbol', 'boss'];
const FORECAST_RUNS = 40;

const available = () => state.adventurers.filter((a) => a.status === 'idle' && a.injuryDays === 0);
const dungeonIds = () => DUNGEONS.map((d) => d.id).filter((id) => state.dungeons[id]);
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const val = (ev: Event) => (ev.target as HTMLSelectElement).value;
const HOME = 'base';
const QUEST_PREFIX = 'q:';

/** 行き先に選べる護衛・運搬の依頼。隊を出し済みのものは除く */
const questDests = () => activeQuests(state).filter((q) =>
  (q.type === 'escort' || q.type === 'transport') && !state.expeditions.some((e) => e.order.target.questId === q.id));
const selQuest = (): Quest | undefined => (ui.d.questId ? questDests().find((q) => q.id === ui.d.questId) : undefined);
const nodeName = (id: string | undefined) => (id ? NODE[id]?.name ?? id : '?');

// 出せるかどうかは dispatch と同じ floorTransit で決める(UI が別の条件を持つと、表示と実際の可否が食い違う)
function floorChoices(dungeonId: string) {
  const def = DUNGEON[dungeonId];
  const prog = state.dungeons[dungeonId];
  const keys = heldKeys(state);
  return (def?.floors ?? []).map((f) => ({ id: f.id, name: f.name, transit: prog ? floorTransit(def, f.id, prog, keys) : null }));
}

/** 行き先ごとの選択肢。可否の最終判断は dispatch の戻りに任せ、ここは出発前に見せるための再現 */
function choicesFor(dungeonId: string, floorId: string) {
  const def = DUNGEON[dungeonId];
  const prog = state.dungeons[dungeonId];
  const grid = parseFloor(def.floors.find((f) => f.id === floorId) ?? def.floors[0]);
  const visited = prog?.floors[floorId]?.visited ?? [];
  const confirmed = !!prog?.confirmed;
  const full = confirmed && exploredRateOf(state, dungeonId, floorId) >= 1;
  const items = uniq(grid.cells.filter((c) => c.kind === 'gather' && c.item).map((c) => c.item!));
  const enemies = uniq(grid.cells.filter((c) => (c.kind === 'nest' || BOSS_KINDS.includes(c.kind)) && c.enemy).map((c) => c.enemy!));
  const reason: Partial<Record<ActionKind, string>> = {};
  if (confirmed) reason.survey = '確認済みのダンジョンには不要';
  else for (const a of ACTIONS) if (a !== 'survey') reason[a] = '噂だけのダンジョン。先に踏査が要る';
  if (confirmed && !items.length) reason.gather = 'このフロアに採取点が無い';
  if (confirmed && !visited.some((i) => BOSS_KINDS.includes(grid.cells[i]?.kind))) reason.boss = 'まだ巣の主の部屋に着いていない';
  const knownGather = (item: string) => visited.filter((i) => grid.cells[i]?.kind === 'gather' && grid.cells[i].item === item).length;
  // 歩ける所は踏み尽くしたが探索率が100%にならない = 残りは隠し通路の先。探索を出すと壁を調べ直す
  const searching = confirmed && needsSearch(grid, visited, prog?.floors[floorId]?.hiddenFound ?? [], heldKeys(state));
  return { confirmed, full, items, enemies, reason, knownGather, searching };
}
type Choices = ReturnType<typeof choicesFor>;

function tidy() {
  const d = ui.d;
  const ok = new Set(available().map((a) => a.id));
  d.members = d.members.filter((id) => ok.has(id));
  if (!d.leader || !d.members.includes(d.leader)) d.leader = d.members[0] ?? null;
  d.potions = Math.min(d.potions, state.inventory.potion ?? 0);
  if (d.blessed && !canBless(state)) d.blessed = false;
  if (!state.dungeons[d.dungeon]) d.dungeon = dungeonIds()[0];
  const floors = floorChoices(d.dungeon);
  if (!floors.some((f) => f.id === d.floor && f.transit !== null)) d.floor = floors[0]?.id ?? 'f1';
  if (d.questId && !selQuest()) d.questId = '';
  const q = selQuest();
  if (q) { d.action = q.type as ActionKind; return; }
  const c = choicesFor(d.dungeon, d.floor);
  if (c.reason[d.action]) d.action = ACTIONS.find((a) => !c.reason[a]) ?? 'explore';
  if (d.action === 'gather' && !c.items.includes(d.item)) d.item = c.items[0] ?? '';
  if (d.action !== 'hunt' || !c.full || !c.enemies.includes(d.enemy)) d.enemy = '';
}

/** アイリスの祝福(第一章の読了で解禁)。残りが無い・発熱中は理由を出して選べない */
function blessingRow(): HTMLElement | null {
  const b = blessingStatus(state);
  if (!b.unlocked) return null;
  const d = ui.d;
  const can = canBless(state);
  const why = b.fever ? `発熱中(あと${b.daysLeft}日)` : b.charges === 0 ? '残りなし(1日1つ溜まる)' : '';
  return h('label', { class: can ? '' : 'dim', title: `隊の疲労の増え方が${Math.round(TUNING.blessing.fatigueRate * 100)}%になる。出発する隊1つに1回` },
    h('input', { type: 'checkbox', checked: d.blessed ? true : undefined, disabled: !can, onchange: (ev: Event) => { d.blessed = (ev.target as HTMLInputElement).checked; render(); } }),
    ` アイリスの祝福(残り${b.charges}/${b.max})${why ? ` ${why}` : ''}`,
  );
}

function currentOrder(): DispatchOrder | null {
  const d = ui.d;
  if (!d.leader || !d.members.length) return null;
  const q = selQuest();
  if (q) {
    return {
      partyIds: [...d.members], leaderId: d.leader, action: q.type as ActionKind, target: { questId: q.id },
      policy: d.policy, days: 1, items: d.potions > 0 ? { potion: d.potions } : {}, blessed: d.blessed,
    };
  }
  const target: DispatchOrder['target'] = { dungeon: d.dungeon, floor: d.floor };
  if (d.action === 'gather' && d.item) target.item = d.item;
  if (d.action === 'hunt' && d.enemy) target.enemy = d.enemy;
  return {
    partyIds: [...d.members], leaderId: d.leader, action: d.action, target,
    policy: d.policy, days: d.days, items: d.potions > 0 ? { potion: d.potions } : {}, blessed: d.blessed,
  };
}

// 日送りや別の隊の出発で前提が変わるので、日と派遣数も条件に含める
const orderKey = (o: DispatchOrder | null) => (o ? JSON.stringify([o, state.day, state.counters.dispatches]) : '');

export function dispatchTab(): HTMLElement {
  tidy();
  const d = ui.d;
  const free = new Set(available().map((a) => a.id));
  const potionStock = state.inventory.potion ?? 0;
  const quest = selQuest();
  const c = choicesFor(d.dungeon, d.floor);
  const leader = d.leader ? advById(d.leader) : undefined;
  const order = currentOrder();
  const forecast = ui.forecast && ui.forecast.key === orderKey(order) ? ui.forecast.r : null;
  const blocker = quest?.type === 'escort' && quest.departDay !== state.day ? `この護衛は${quest.departDay}日目に出発します` : '';

  const memberRows = state.adventurers.map((a) => {
    const checked = d.members.includes(a.id);
    const can = free.has(a.id);
    return h('li', { class: can ? '' : 'dim' },
      h('label', null,
        h('input', {
          type: 'checkbox', checked: checked ? true : undefined, disabled: !can,
          onchange: (ev: Event) => toggleMember(a.id, (ev.target as HTMLInputElement).checked),
        }),
        ` ${a.name} `, span('gear', ...SLOTS.map((sl) => {
          const id = a.equipment?.[sl.id];
          return span(id ? 'on' : 'off', { title: id ? ITEM[id]?.name ?? id : `${sl.name}なし` }, sl.short);
        })),
        span('dim small', ` ${JOB[a.job].name} Lv${a.level} / ${PERSONALITY[a.personality].name} / 疲労${a.fatigue}`),
        can ? null : span('small', ` (${statusText(a)})`),
      ),
      checked ? h('label', { class: 'leader' },
        h('input', { type: 'radio', name: 'leader', checked: d.leader === a.id ? true : undefined, onchange: () => { d.leader = a.id; render(); } }),
        ' 隊長') : null,
    );
  });

  return div('tab-body',
    h('h2', null, '行き先'),
    h('select', { class: 'wide', onchange: (ev: Event) => pickDest(val(ev)) },
      h('optgroup', { label: 'ダンジョン' }, ...dungeonIds().map((id) => h('option', { value: id, selected: !quest && id === d.dungeon ? true : undefined },
        `${DUNGEON[id].name}${state.dungeons[id].confirmed ? '' : '(噂)'}`))),
      questDests().length ? h('optgroup', { label: '受注中の依頼' }, ...questDests().map((q) => h('option', { value: QUEST_PREFIX + q.id, selected: quest?.id === q.id ? true : undefined },
        `${ACTION_NAME[q.type as ActionKind]}: ${nodeName(q.target.from ?? HOME)}→${nodeName(q.target.to)}`))) : null),
    quest ? questBlock(quest) : dungeonBlock(c),
    h('h2', null, `隊員(${d.members.length}/${PARTY_MAX})`),
    h('ul', { class: 'plain members' }, ...memberRows),
    leader ? div('small explore-desc', `地図の埋め方: ${PERSONALITY[leader.personality].exploreDesc}`) : null,
    div('form',
      h('label', null, '方針 ',
        h('select', { onchange: (ev: Event) => { d.policy = val(ev); render(); } },
          ...POLICIES.map((p) => h('option', { value: p.id, selected: p.id === d.policy ? true : undefined }, p.name))),
      ),
      quest ? null : h('label', null, '現地の日数 ',
        h('select', { onchange: (ev: Event) => { d.days = Number(val(ev)); render(); } },
          ...DAY_CHOICES.map((n) => h('option', { value: n, selected: n === d.days ? true : undefined }, `${n}日`))),
      ),
      h('label', null, `回復薬(在庫${potionStock}) `,
        h('select', { onchange: (ev: Event) => { d.potions = Number(val(ev)); render(); } },
          ...Array.from({ length: potionStock + 1 }, (_, n) => h('option', { value: n, selected: n === d.potions ? true : undefined }, `${n}個`))),
      ),
      blessingRow(),
    ),
    div('dim small', POLICIES.find((p) => p.id === d.policy)?.desc ?? ''),
    div('trip', tripText(quest)),
    quest ? null : h('button', { class: 'wide', disabled: !order, onclick: showForecast }, '見込みを見る'),
    !quest && forecast ? forecastBlock(forecast) : null,
    blocker ? div('small neg', blocker) : null,
    h('button', { class: 'primary wide', disabled: !order || !!blocker, onclick: depart }, '出発'),
    h('h2', null, `派遣中(${state.expeditions.length}/${PARTIES_MAX})`),
    state.expeditions.length
      ? h('ul', { class: 'plain' }, ...state.expeditions.map(awayRow))
      : div('dim', '派遣中の隊はありません'),
  );
}

function awayRow(e: Expedition): HTMLElement {
  const st = stepToday(e);
  const canRecall = e.recalledDay === null && st?.phase !== 'return';
  return h('li', null,
    `${e.order.partyIds.map(nameOf).join('・')}`,
    span('dim small', ` 隊長 ${nameOf(e.order.leaderId)} / ${destText(e)} / ${actionText(e.order)} / ${e.startDay}日目出発 → `),
    span(null, `${e.returnDay}日目に帰還予定`),
    div('small', `いま: ${positionText(st)}`, e.recalledDay !== null ? span('dim', `(${e.recalledDay}日目に呼び戻し)`) : '',
      canRecall ? h('button', { class: 'small danger', onclick: () => doRecall(e) }, '呼び戻す') : null),
  );
}

function dungeonBlock(c: Choices): HTMLElement {
  const d = ui.d;
  return div(null,
    div('dim small', DUNGEON[d.dungeon]?.desc ?? ''),
    floorBlock(),
    h('h2', null, '行動'),
    div('actions', ...ACTIONS.map((a) => h('label', { class: c.reason[a] ? 'dim' : '' },
      h('input', {
        type: 'radio', name: 'action', value: a, checked: d.action === a ? true : undefined, disabled: !!c.reason[a],
        onchange: () => { d.action = a; render(); },
      }),
      ` ${ACTION_NAME[a]}`))),
    h('ul', { class: 'plain reasons small dim' }, ...ACTIONS.filter((a) => c.reason[a]).map((a) => h('li', null, `${ACTION_NAME[a]}: ${c.reason[a]}`))),
    c.searching ? div('small', '歩ける所は踏み尽くしました。残りは隠し通路の先です。探索を出すと、隊は行き止まりの壁を調べ直します(見つかるかは斥候の腕しだい)。') : null,
    targetBlock(c),
  );
}

// 階が1つのダンジョンでは選ぶ物が無いので出さない
function floorBlock(): HTMLElement | null {
  const d = ui.d;
  const floors = floorChoices(d.dungeon);
  if (floors.length < 2) return null;
  const keys = heldKeys(state);
  return div(null,
    h('h2', null, '階'),
    div('actions', ...floors.map((f) => h('label', { class: f.transit === null ? 'dim' : '' },
      h('input', {
        type: 'radio', name: 'floor', value: f.id, checked: d.floor === f.id ? true : undefined, disabled: f.transit === null,
        onchange: () => { d.floor = f.id; ui.forecast = null; render(); },
      }),
      ` ${f.name}`))),
    h('ul', { class: 'plain reasons small' }, ...floors.slice(1).map((f) => h('li', { class: f.transit === null ? 'dim' : '' },
      `${f.name}: `, f.transit === null
        ? '前の階の下り階段までの道がまだ分かりません(階段を踏み、鍵の要る扉は鍵を持って)'
        : `前の階を抜けるのに片道${f.transit}歩(行きと帰りに1回ずつ、現地の歩数から払う)`))),
    div('small', `所持: ${keys.length ? keys.map((k) => ITEM[k]?.name ?? k).join('・') : '鍵なし'}`),
  );
}

function questBlock(q: Quest): HTMLElement {
  const cargo = questCargo(q);
  const cap = ui.d.members.map(advById).reduce((t, a) => t + (a ? carryCapacity(a) : 0), 0);
  return div(null,
    div('dim small', q.desc),
    h('h2', null, '行動'),
    div('small', `${ACTION_NAME[q.type as ActionKind]}(依頼の種類で決まります)/ ${nodeName(q.target.from ?? HOME)}→${nodeName(q.target.to)}`),
    q.type === 'escort' ? div(q.departDay === state.day ? 'small' : 'small neg', `出発日: ${q.departDay}日目`) : null,
    cargo ? div(cap >= cargo ? 'small' : 'small neg', `荷の重さ ${cargo} / 隊の積載 ${Math.round(cap)}`) : null,
    q.dueDay !== null ? div('small dim', `納期 ${q.dueDay}日目`) : null,
  );
}

/** 「往復N日+現地M日=帰還X日目」。早帰りで実際の帰還は早まることがある */
function tripText(q: Quest | undefined): string {
  const k = state.world;
  if (q) {
    const from = q.target.from ?? HOME;
    const to = q.target.to ?? HOME;
    const out = [travelDays(HOME, from, k), travelDays(from, to, k)];
    const back = travelDays(to, HOME, k);
    if (out.some((x) => x === null) || back === null) return `${nodeName(to)}へ行く道が分かりません`;
    const go = (out[0] ?? 0) + (out[1] ?? 0);
    return `往路${go}日+復路${back}日=${state.day + go + back}日目に帰還`;
  }
  const node = DUNGEON[ui.d.dungeon]?.node;
  const one = node ? travelDays(HOME, node, k) : null;
  if (one === null) return '行き先への道が分かりません';
  const stay = ui.d.days;
  return `往復${one * 2}日+現地${stay}日=${state.day + one * 2 + stay}日目に帰還(予定。早く切り上げることもある)`;
}

function pickDest(v: string) {
  if (v.startsWith(QUEST_PREFIX)) ui.d.questId = v.slice(QUEST_PREFIX.length);
  else { ui.d.questId = ''; ui.d.dungeon = v; ui.d.floor = 'f1'; }
  ui.forecast = null;
  render();
}

function doRecall(e: Expedition) {
  if (!window.confirm(`隊長 ${nameOf(e.order.leaderId)} の隊を呼び戻しますか? 現地の成果は持ち帰れません。`)) return;
  const r = recall(state, e.id);
  if (!r.ok) return toast(r.reason, true);
  commit();
  toast(`呼び戻しました。${e.returnDay}日目に帰還します。`);
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
  d.blessed = false;
  ui.forecast = null;
  commit();
  toast(`出発しました。${r.expedition.returnDay}日目に帰還します。`);
}
