// 画面の共有状態。保存は操作ごとに core/save.ts へ。
import { ENEMY, FACILITY, ITEM } from '../core/data';
import { newGame, type DayReport } from '../core/game';
import type { Readiness } from '../core/readiness';
import { load, save } from '../core/save';
import type { ActionKind, Adventurer, DispatchOrder, EquipSlot, GameState, StatKey } from '../core/types';

export type Tab = 'home' | 'base' | 'dispatch' | 'map' | 'log';

export let state: GameState = load(localStorage) ?? newGame(Date.now() >>> 0);

export const ui = {
  tab: 'home' as Tab,
  selLog: null as string | null,
  /** 施設タブで選んだマス */
  selCell: null as null | { x: number; y: number },
  /** 名簿で装備パネルを開いている冒険者 */
  selAdv: null as string | null,
  d: newDispatchForm(),
  /** 見込みと、それを出した時の条件。条件が変わったら表示しない */
  forecast: null as null | { key: string; r: Readiness },
  mapDungeon: 'forest_cave',
  lastReport: null as DayReport | null,
  toast: null as null | { text: string; err: boolean },
  saveWarning: '',
};

let renderFn: () => void = () => {};
export function setRender(fn: () => void) { renderFn = fn; }
export function render() { renderFn(); }

export function commit() {
  ui.saveWarning = save(localStorage, state) ? '' : '保存できませんでした。ブラウザの空き容量・保存設定を確認してください。';
  render();
}

export function replaceState(s: GameState) {
  state = s;
  ui.selLog = null;
  ui.selCell = null;
  ui.selAdv = null;
  ui.lastReport = null;
  ui.d = newDispatchForm();
  ui.forecast = null;
  ui.mapDungeon = 'forest_cave';
  commit();
}

function newDispatchForm() {
  return {
    members: [] as string[], leader: null as string | null, policy: 'standard', days: 3, potions: 0,
    dungeon: 'forest_cave', action: 'explore' as ActionKind, item: '', enemy: '',
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
  if (a.injuryDays > 0) return `負傷(あと${a.injuryDays}日)`;
  if (a.fatigue >= 70) return '疲労大';
  return '待機';
}

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

export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP', atk: '攻撃', def: '防御', mag: '魔力', spd: '素早さ', dex: '器用さ', scout: '斥候', gather: '採取',
};

export const SLOTS: { id: EquipSlot; name: string; short: string }[] = [
  { id: 'weapon', name: '武器', short: '武' },
  { id: 'armor', name: '防具', short: '防' },
  { id: 'accessory', name: '装飾', short: '飾' },
];
