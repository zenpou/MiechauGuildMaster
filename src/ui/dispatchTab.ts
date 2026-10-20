import { blessingStatus, canBless } from '../core/blessing';
import { carryCapacity } from '../core/adventurer';
import { DUNGEON, DUNGEONS, ENEMY, ITEM, JOB, NODE, POLICIES, PERSONALITY, TUNING } from '../core/data';
import { needsSearch, parseFloor } from '../core/dungeon';
import { floorTransit } from '../core/explore';
import { dispatch, exploredRateOf, recall } from '../core/game';
import { getIntroExploration } from '../core/introExploration';
import { heldKeys } from '../core/ledger';
import { journeyFrameAbsoluteDay } from '../core/journeyPlayback';
import { activeQuests, questCargo } from '../core/quests';
import { assessReadiness, type Readiness } from '../core/readiness';
import { travelDays } from '../core/world';
import { PARTY_MAX, PARTIES_MAX, type ActionKind, type DispatchOrder, type Expedition, type Quest } from '../core/types';
import { ACTION_NAME, actionText, advById, commit, destText, nameOf, positionText, render, SLOTS, state, statusText, stepToday, toast, ui } from './app';
import { div, h, span } from './dom';
import { openJourney } from './journeyHost';
import { mapFace } from './mapFace';
import './returnReport.css';
import { memberUnavailableReason } from '../core/expeditionPlan';
import { partyPlanEditor, partyPlansBlock } from './partyPlans';
import { financeOutlook } from './financeOutlook';

const DAY_CHOICES = Array.from({ length: TUNING.game.daysMax }, (_, i) => i + 1);
const ACTIONS: ActionKind[] = ['explore', 'gather', 'hunt', 'boss', 'survey'];
const BOSS_KINDS = ['symbol', 'boss'];
const FORECAST_RUNS = 40;

const available = () => state.adventurers.filter((a) => !memberUnavailableReason(state, a));
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
  const order = currentOrder();
  if (order && getIntroExploration(state, order)) d.days = 1;
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
  const intro = order ? getIntroExploration(state, order) : null;
  const trip = plannedTrip(quest);
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
        can ? null : span('small', ` (${memberUnavailableReason(state, a) ?? statusText(a)})`),
      ),
    );
  });

  return div('tab-body',
    partyPlansBlock(),
    h('div', { id: 'dispatch-preparation' }),
    ui.dispatchNotes.length ? div('dispatch-notes', { role: 'status' },
      ...ui.dispatchNotes.map((text) => div('small', text))) : null,
    h('h2', null, '行き先'),
    h('select', { class: 'wide', onchange: (ev: Event) => pickDest(val(ev)) },
      h('optgroup', { label: 'ダンジョン' }, ...dungeonIds().map((id) => h('option', { value: id, selected: !quest && id === d.dungeon ? true : undefined },
        `${DUNGEON[id].name}${state.dungeons[id].confirmed ? '' : '(噂)'}`))),
      questDests().length ? h('optgroup', { label: '受注中の依頼' }, ...questDests().map((q) => h('option', { value: QUEST_PREFIX + q.id, selected: quest?.id === q.id ? true : undefined },
        `${ACTION_NAME[q.type as ActionKind]}: ${nodeName(q.target.from ?? HOME)}→${nodeName(q.target.to)}`))) : null),
    quest ? questBlock(quest) : dungeonBlock(c),
    h('h2', null, `隊員(${d.members.length}/${PARTY_MAX})`),
    h('ul', { class: 'plain members' }, ...memberRows),
    intro ? h('section', { class: 'dispatch-notes', 'aria-label': '初回の探索' },
      h('h3', null, '初回は入口近くを確かめる日帰り探索'),
      div('small', intro.description),
      div('small', '薬草を1個採り、歩いた道を地図に残して戻ります。回復薬は不要です。'),
      div('small dim', `${d.members.length === 2 ? 'ティナが前で道を確かめ、セラが回復役として支えます。' : ''}次の派遣からは通常の探索です。装備と回復薬を整えて奥へ進みましょう。`),
    ) : null,
    leader ? leaderChoices(!!intro) : null,
    div('form',
      h('label', null, '方針 ',
        h('select', { disabled: !!intro, onchange: (ev: Event) => { d.policy = val(ev); render(); } },
          ...POLICIES.map((p) => h('option', { value: p.id, selected: p.id === d.policy ? true : undefined }, p.name))),
      ),
      quest ? null : h('label', null, '現地の日数 ',
        h('select', { disabled: !!intro, onchange: (ev: Event) => { d.days = Number(val(ev)); render(); } },
          ...DAY_CHOICES.map((n) => h('option', { value: n, selected: n === d.days ? true : undefined }, `${n}日`))),
      ),
      h('label', null, `回復薬(在庫${potionStock}) `,
        h('select', { onchange: (ev: Event) => { d.potions = Number(val(ev)); render(); } },
          ...Array.from({ length: potionStock + 1 }, (_, n) => h('option', { value: n, selected: n === d.potions ? true : undefined }, `${n}個`))),
      ),
      blessingRow(),
    ),
    partyPlanEditor(order),
    div('dim small', intro ? '初回は決められた入口付近の行程を歩きます。' : POLICIES.find((p) => p.id === d.policy)?.desc ?? ''),
    div('trip', tripText(quest)),
    trip ? financeOutlook(Math.max(1, trip.go + trip.stay + trip.back), true) : null,
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
  const yesterday = state.day - 1;
  const canObserve = !!e.journey?.frames.some((frame) => journeyFrameAbsoluteDay(e.journey!, frame) === yesterday);
  return h('li', null,
    `${e.order.partyIds.map(nameOf).join('・')}`,
    span('dim small', ` 隊長 ${nameOf(e.order.leaderId)} / ${destText(e)} / ${actionText(e.order)} / ${e.startDay}日目出発 → `),
    span(null, `${e.returnDay}日目に帰還予定`),
    div('small', `いま: ${positionText(st)}`, e.recalledDay !== null ? span('dim', `(${e.recalledDay}日目に呼び戻し)`) : '',
      canRecall ? h('button', { class: 'small danger', onclick: () => doRecall(e) }, '呼び戻す') : null),
      canObserve ? h('button', { class: 'small', onclick: () => openJourney(e, yesterday) }, '道中を見る') : null,
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
function plannedTrip(q: Quest | undefined): { go: number; stay: number; back: number } | null {
  const k = state.world;
  if (q) {
    const from = q.target.from ?? HOME;
    const to = q.target.to ?? HOME;
    const out = [travelDays(HOME, from, k), travelDays(from, to, k)];
    const back = travelDays(to, HOME, k);
    if (out.some((x) => x === null) || back === null) return null;
    const go = (out[0] ?? 0) + (out[1] ?? 0);
    return { go, stay: 0, back };
  }
  const node = DUNGEON[ui.d.dungeon]?.node;
  const one = node ? travelDays(HOME, node, k) : null;
  return one === null ? null : { go: one, stay: ui.d.days, back: one };
}

function tripText(q: Quest | undefined): string {
  const trip = plannedTrip(q);
  if (!trip) return '行き先への道が分かりません';
  const { go, stay, back } = trip;
  if (q) return `往路${go}日+復路${back}日=${state.day + Math.max(1, go + back)}日目に帰還`;
  if (go + back === 0) return stay === 1 ? '日帰り。明日の朝に報告が届きます'
    : `現地${stay}日=${state.day + stay}日目に帰還予定（往復に日はかかりません。早く切り上げることもあります）`;
  return `往復${go + back}日+現地${stay}日=${state.day + go + back + stay}日目に帰還(予定。早く切り上げることもある)`;
}

function leaderChoices(intro = false): HTMLElement {
  return h('fieldset', { class: 'leader-choices' },
    h('legend', null, intro ? '今回の隊長' : '隊長で変わる歩き方'),
    div('leader-options', ...ui.d.members.flatMap((id) => {
      const m = advById(id);
      if (!m) return [];
      const personality = PERSONALITY[m.personality];
      return [h('label', { class: `leader-choice${ui.d.leader === id ? ' selected' : ''}` },
        h('input', {
          type: 'radio', name: 'leader', 'aria-label': `${m.name}を隊長にする`,
          checked: ui.d.leader === id ? true : undefined,
          onchange: () => { ui.d.leader = id; ui.forecast = null; render(); },
        }),
        mapFace(m),
        div(null, div(null, `${m.name} · ${personality.name}`),
          div('small', intro ? '入口近くを確認し、薬草を採って戻ります。' : personality.exploreDesc),
          intro ? null : div('small dim', personality.desc)),
      )];
    })),
  );
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
      known ? div('small dim', '採取士は採る量と持てる荷物を増やします。同じ遠征では各採取点を1回ずつ調べ、回り終えると早めに帰ります。') : null,
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
  if (r.introductory) return div('detail forecast',
    h('h3', null, '初回の行程'),
    div('small', '入口付近の安全な道を往復します。戦闘や罠はなく、薬草1個と地図の記録を持ち帰ります。'),
    div('small', '現地1日・翌朝帰還。次の派遣から通常の探索になります。'),
  );
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const high = r.uncertainty === '高';
  return div('detail forecast',
    h('h3', null, '現地での見込み'),
    r.gather ? h('section', { class: 'gather-forecast', 'aria-label': '採集の見込み' },
      h('strong', null, `${ITEM[r.gather.item]?.name ?? r.gather.item}：平均 ${r.gather.avgAmount.toFixed(1)}個`),
      div('small', `その素材を確保できない見込み ${pct(r.gather.emptyRate)} / 既知の採取点 ${r.gather.knownSites}か所`),
      div('small dim', `採取が最も得意：${r.gather.bestGatherer.name}（採取${r.gather.bestGatherer.stat}） / 隊が持てる重さ ${r.gather.capacity}`),
      r.gather.knownSites === 0 ? div('small neg', '先に探索して、この素材の採取点を見つけてください。') : null,
      ui.d.policy === 'safe' || ui.d.policy === 'avoid'
        ? div('small dim', '既知の巣や強敵の場所を迂回できる道を選びます。ほかに道がない場所や、道中の遭遇では戦闘になることがあります。')
        : div('small dim', '既知の巣や強敵を迂回したいときは、安全第一か戦闘回避を選べます。'),
    ) : null,
    div(null, '戦力の目安 ', span(`badge grade-${r.grade}`, r.grade), span('dim small', ` 戦力比 ${r.powerRatio.toFixed(2)}(${r.runs}回の試算)`)),
    div('small', `全滅率 ${pct(r.wipeRate)} / 撤退率 ${pct(r.retreatRate)}`),
    div('small', `平均負傷日数 ${r.avgInjuryDays.toFixed(1)}日(1人あたり) / 想定戦闘 ${r.avgFights.toFixed(1)}回`),
    r.avgSiteDays !== undefined ? div('small', `現地は平均 ${r.avgSiteDays.toFixed(1)}日 / 疲労の変化 ${r.avgFatigueGain! >= 0 ? '+' : ''}${r.avgFatigueGain!.toFixed(1)}（1人あたり）`) : null,
    r.gather && r.avgSiteDays !== undefined && r.avgSiteDays < ui.d.days - 0.5
      ? div('small', '指定した日数より早く切り上げる見込みです。採取点を回り終えた後は、日数を増やしても採り直しません。') : null,
    div(high ? 'small neg' : 'small', `不確かさ: ${r.uncertainty}`, high ? '(未踏が多く、見込みは当てにならない)' : ''),
    div('small dim', '見つけた道だけでの試算です。往復の道中は含まず、実際の成果を保証するものではありません。'),
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
  ui.dispatchNotes = [];
  ui.partyPlanEditId = '';
  ui.partyPlanName = '';
  ui.partyPlanEditorOpen = false;
  ui.partyPlanRemoveId = null;
  commit();
  toast(`出発しました。${r.expedition.returnDay}日目に帰還します。`);
}
