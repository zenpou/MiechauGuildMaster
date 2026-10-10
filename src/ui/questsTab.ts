import { DUNGEON, ENEMY, ITEM, NODE, RECIPE } from '../core/data';
import { acceptQuest } from '../core/game';
import { activeQuests, deliver, questCargo, visibleBoards, visibleQuests, ACTIVE_MAX, dungeonRate } from '../core/quests';
import type { Quest, QuestType } from '../core/types';
import { commit, render, state, toast, ui } from './app';
import { div, h, span } from './dom';

export const QUEST_TYPE_NAME: Record<QuestType, string> = {
  deliver: '納品', hunt: '討伐', explore: '探索', survey: '踏査', escort: '護衛', transport: '運搬', unlock: '解放',
};

const nodeName = (id: string | null | undefined) => (id ? NODE[id]?.name ?? id : '');
const left = (day: number) => {
  const n = day - state.day;
  return n > 0 ? `あと${n}日` : n === 0 ? '今日まで' : '期限切れ';
};

/** 掲示板の1行。受注ボタンは呼び出し側で足す */
export function questLine(q: Quest): HTMLElement {
  return span(null,
    span('badge', QUEST_TYPE_NAME[q.type] ?? q.type), ' ', q.name,
    div('dim small', q.desc),
    div('small',
      `報酬 ${q.rewardGold}G・評判+${q.rewardRep}`,
      q.departDay !== null ? ` / 出発日 ${q.departDay}日目` : '',
      q.acceptBy !== null ? span(q.acceptBy <= state.day ? 'neg' : '', ` / 受注期限 ${q.acceptBy}日目(${left(q.acceptBy)})`) : '',
    ),
  );
}

export function questsTab(): HTMLElement {
  const active = activeQuests(state).filter((q) => q.type !== 'unlock');
  const unlocks = visibleQuests(state).filter((q) => q.type === 'unlock');
  const boards = visibleBoards(state);
  return div('tab-body',
    div('summary', span('big', `${state.day}日目`), span('big', `${state.gold}G`), span('dim', `受注中 ${activeQuests(state).length}/${ACTIVE_MAX}件`)),
    h('h2', null, '受注中'),
    active.length ? h('ul', { class: 'plain quests' }, ...active.map(activeRow)) : div('dim', '受けている依頼はありません'),
    h('h2', null, '掲示板'),
    div('dim small', '拠点で受けられます。他の街の掲示板は、隊がその街を通ると見えるようになります。'),
    ...boards.map((b) => div(null,
      h('h3', null, nodeName(b.town)),
      b.quests.filter((q) => q.type !== 'unlock').length
        ? h('ul', { class: 'plain quests' }, ...b.quests.filter((q) => q.type !== 'unlock').map((q) => h('li', null, questLine(q),
          h('button', { class: 'small', onclick: () => accept(q.id, q.name) }, '受注'))))
        : div('dim small', '今は依頼がありません'),
    )),
    h('h2', null, '解放依頼'),
    div('dim small', '職人などからの頼み事。達成すると作れる物が増えます。締め切りはありません。'),
    unlocks.length ? h('ul', { class: 'plain quests' }, ...unlocks.map(unlockRow)) : div('dim small', 'まだ見つけていません。街を訪れると見つかることがあります。'),
  );
}

function progressView(q: Quest): HTMLElement | string {
  const t = q.target;
  switch (q.type) {
    case 'deliver':
    case 'unlock': {
      const have = state.inventory[t.item ?? ''] ?? 0;
      const n = t.n ?? 0;
      return span(have >= n ? 'pos' : 'neg', `${ITEM[t.item ?? '']?.name ?? t.item} 在庫${have}/${n}`);
    }
    case 'hunt':
      return `${ENEMY[t.enemy ?? '']?.name ?? t.enemy}(${DUNGEON[t.dungeon ?? '']?.name ?? ''}) ${q.progress}/${t.n ?? 0}体`;
    case 'explore':
      return `${DUNGEON[t.dungeon ?? '']?.name ?? ''}の探索率 ${Math.round(dungeonRate(state, t.dungeon ?? '') * 100)}%/${t.percent ?? 100}%(帰還時に判定)`;
    case 'escort':
      return `${nodeName(t.from ?? 'base')}→${nodeName(t.to)} / 出発日 ${q.departDay}日目`;
    case 'transport':
      return `${nodeName(t.from)}→${nodeName(t.to)} / 荷の重さ ${questCargo(q)}`;
    default:
      return '';
  }
}

function activeRow(q: Quest): HTMLElement {
  const out = state.expeditions.some((e) => e.order.target.questId === q.id);
  const canGo = (q.type === 'escort' && q.departDay === state.day) || q.type === 'transport';
  return h('li', null,
    span('badge', QUEST_TYPE_NAME[q.type] ?? q.type), ' ', q.name,
    div('small', progressView(q)),
    div('small', `報酬 ${q.rewardGold}G・評判+${q.rewardRep}`,
      q.dueDay !== null ? span(q.dueDay - state.day <= 1 ? 'neg' : '', ` / 納期 ${q.dueDay}日目(${left(q.dueDay)})`) : ''),
    q.type === 'deliver' ? h('button', { class: 'small', onclick: () => doDeliver(q) }, '納品する') : null,
    out ? div('small pos', '隊が向かっています') : null,
    !out && canGo ? h('button', { class: 'small', onclick: () => goDispatch(q.id) }, '派遣タブで隊を出す') : null,
    !out && q.type === 'escort' && q.departDay !== null && q.departDay > state.day ? div('dim small', `出発日(${q.departDay}日目)に派遣タブから出せます`) : null,
  );
}

function unlockRow(q: Quest): HTMLElement {
  const opens = q.unlocks.map((id) => RECIPE[id]?.name ?? ITEM[id]?.name ?? id).join('・');
  return h('li', null,
    span('badge', '解放'), ' ', q.name, span('dim small', ` (${nodeName(q.town)})`),
    div('dim small', q.desc),
    div('small', `達成で開くもの: ${opens || 'なし'}`),
    div('small', progressView(q), ` / 報酬 ${q.rewardGold}G・評判+${q.rewardRep}`),
    q.status === 'posted'
      ? h('button', { class: 'small', onclick: () => accept(q.id, q.name) }, '受注')
      : h('button', { class: 'small', onclick: () => doDeliver(q) }, '納品する'),
  );
}

function goDispatch(questId: string) {
  ui.d.questId = questId;
  ui.tab = 'dispatch';
  render();
}

function accept(id: string, name: string) {
  const r = acceptQuest(state, id);
  if (!r.ok) return toast(r.reason, true);
  commit();
  toast(`「${name}」を受けました`);
}

function doDeliver(q: Quest) {
  const r = deliver(state, q.id);
  if (!r.ok) return toast(r.reason, true);
  commit();
  toast(`「${q.name}」を納めました。報酬 ${q.rewardGold}G`);
}
