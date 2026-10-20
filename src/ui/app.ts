// 画面の共有状態。保存は操作ごとに core/save.ts へ。
import { DUNGEON, ENEMY, FACILITY, ITEM, NODE } from '../core/data';
import { newGame, type DayReport } from '../core/game';
import { getIntroExploration } from '../core/introExploration';
import type { Readiness } from '../core/readiness';
import { load, save } from '../core/save';
import type { ActionKind, Adventurer, DispatchOrder, EquipSlot, Expedition, GameState, Persona, StatKey, WorldStep } from '../core/types';
import { resetJourney } from './journeyHost';

export type Tab = 'home' | 'inbox' | 'quests' | 'dispatch' | 'world' | 'recruit' | 'base' | 'map' | 'log' | 'records';

export let state: GameState = load(localStorage) ?? newGame(Date.now() >>> 0);

export const ui = {
  tab: 'home' as Tab,
  selLog: null as string | null,
  /** 受信箱で開いているメール */
  selMail: null as string | null,
  /** 施設タブで選んだマス */
  selCell: null as null | { x: number; y: number },
  craftRecipe: '',
  craftMember: '',
  /** 名簿で装備パネルを開いている冒険者 */
  selAdv: null as string | null,
  d: newDispatchForm(),
  dispatchNotes: [] as string[],
  partyPlanEditId: '',
  partyPlanName: '',
  partyPlanEditorOpen: false,
  partyPlanRemoveId: null as string | null,
  /** 見込みと、それを出した時の条件。条件が変わったら表示しない */
  forecast: null as null | { key: string; r: Readiness },
  mapDungeon: 'forest_cave',
  mapFloor: 'f1',
  /** ワールドタブで選んだノード */
  selNode: null as string | null,
  lastReport: null as DayReport | null,
  toast: null as null | { text: string; err: boolean },
  saveWarning: '',
  /** エンディングのモーダルで開いているページ */
  endingPage: 0,
};

let renderFn: () => void = () => {};
export function setRender(fn: () => void) { renderFn = fn; }
export function render() { renderFn(); }

export function commit() {
  // 装備・勤務・施設などを変えた後に、変更前の見込みを残さない。
  ui.forecast = null;
  ui.saveWarning = save(localStorage, state) ? '' : '保存できませんでした。ブラウザの空き容量・保存設定を確認してください。';
  render();
}

export function replaceState(s: GameState) {
  resetJourney();
  state = s;
  ui.selLog = null;
  ui.selMail = null;
  ui.selCell = null;
  ui.selAdv = null;
  ui.lastReport = null;
  ui.d = newDispatchForm();
  ui.dispatchNotes = [];
  ui.partyPlanEditId = '';
  ui.partyPlanName = '';
  ui.partyPlanEditorOpen = false;
  ui.partyPlanRemoveId = null;
  ui.forecast = null;
  ui.mapDungeon = 'forest_cave';
  ui.craftRecipe = '';
  ui.craftMember = '';
  ui.mapFloor = 'f1';
  ui.selNode = null;
  ui.endingPage = 0;
  commit();
}

function newDispatchForm() {
  const starters = ['tina', 'sera'].map((unique) => state.adventurers.find((a) => a.unique === unique));
  const members = starters.flatMap((a) => a && a.status === 'idle' && a.injuryDays === 0 ? [a.id] : []);
  const initial = members.length === 2 && getIntroExploration(state, {
    partyIds: members, leaderId: members[0], action: 'explore',
    target: { dungeon: 'forest_cave', floor: 'f1' }, policy: 'standard', days: 1, items: {},
  });
  return {
    members: initial ? members : [] as string[], leader: initial ? members[0] : null as string | null, policy: 'standard', days: 1, potions: 0, blessed: false,
    /** 護衛・運搬の依頼に出すときの依頼ID。空ならダンジョンへ */
    dungeon: 'forest_cave', floor: 'f1', questId: '', action: 'explore' as ActionKind, item: '', enemy: '',
  };
}

export function toast(text: string, err = false) {
  ui.toast = { text, err };
  render();
  setTimeout(() => { if (ui.toast?.text === text) { ui.toast = null; render(); } }, 2600);
}

export const advById = (id: string): Adventurer | undefined => state.adventurers.find((a) => a.id === id);
export const nameOf = (id: string) => advById(id)?.name ?? id;

export function statusText(a: Adventurer): string {
  if (a.status === 'away') return '派遣中';
  if (a.status === 'working') {
    const f = a.assignment && 'facility' in a.assignment ? FACILITY[a.assignment.facility]?.name : undefined;
    return f ? `勤務(${f})` : '勤務';
  }
  if (a.status === 'training') {
    const left = a.assignment && 'training' in a.assignment ? a.assignment.untilDay - state.day : 0;
    return left > 0 ? `訓練中(あと${left}日)` : '訓練中';
  }
  if (a.injuryDays > 0) return `負傷(あと${a.injuryDays}日)`;
  if (a.fatigue >= 70) return '疲労大';
  return '待機';
}

/** 趣味・特技・好き・嫌い。数字に見えない人となり */
export function personaText(p: Persona | undefined): string {
  if (!p) return '';
  return `趣味: ${p.hobby} / 特技: ${p.talent} / 好き: ${p.likes} / 嫌い: ${p.dislikes}`;
}

export const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export const ACTION_NAME: Record<ActionKind, string> = {
  explore: '探索', gather: '採集', hunt: '討伐', boss: 'ボス', survey: '踏査', escort: '護衛', transport: '輸送',
};

/** 「採集: 薬草」「討伐」のような行動の見出し */
export function actionText(o: DispatchOrder): string {
  const name = ACTION_NAME[o.action] ?? o.action;
  if (o.action === 'gather' && o.target.item) return `${name}: ${ITEM[o.target.item]?.name ?? o.target.item}`;
  if (o.action === 'hunt' && o.target.enemy) return `${name}: ${ENEMY[o.target.enemy]?.name ?? o.target.enemy}`;
  return name;
}

/** 隊の行き先。護衛・運搬は経路の終点の街 */
export function destText(e: Expedition): string {
  const qid = e.order.target.questId;
  if (qid) {
    const q = state.quests.find((x) => x.id === qid);
    const to = q?.target.to ?? e.order.target.route?.at(-1) ?? '';
    return NODE[to]?.name ?? q?.name ?? '?';
  }
  return DUNGEON[e.order.target.dungeon ?? '']?.name ?? '?';
}

/** 今日の位置。出発前の表や帰還日を過ぎた表なら端の件を返す */
export function stepToday(e: Expedition): WorldStep | undefined {
  return e.steps.filter((st) => st.day <= state.day).pop() ?? e.steps[0];
}

const PHASE_NAME: Record<WorldStep['phase'], string> = { outbound: '往路', stay: '現地', return: '帰路' };

/** 「往路: 拠点の街–山村の道中」のような位置の文 */
export function positionText(st: WorldStep | undefined): string {
  if (!st) return '不明';
  const place = st.edge ? edgeName(st.edge) + 'の道中' : NODE[st.node ?? '']?.name ?? st.node ?? '?';
  return `${PHASE_NAME[st.phase]}: ${place}`;
}

export function edgeName(edgeId: string): string {
  const [a, b] = edgeId.replace(/_short$/, '').split('__');
  return `${NODE[a]?.name ?? a}–${NODE[b]?.name ?? b}${edgeId.endsWith('_short') ? '(近道)' : ''}`;
}

// 能力名は core の表記(腕力・守備・探索)に揃える。UI で別の呼び方をすると、スキルの説明文や設計書と食い違う
export { STAT_LABEL } from '../core/types';

export const SLOTS: { id: EquipSlot; name: string; short: string }[] = [
  { id: 'weapon', name: '武器', short: '武' },
  { id: 'armor', name: '防具', short: '防' },
  { id: 'accessory', name: '装飾', short: '飾' },
];
