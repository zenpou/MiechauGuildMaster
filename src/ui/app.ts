// 画面の共有状態。保存は操作ごとに core/save.ts へ。
import { newGame, type DayReport } from '../core/game';
import { load, save } from '../core/save';
import type { Adventurer, GameState } from '../core/types';

export type Tab = 'home' | 'dispatch' | 'map' | 'log';

export let state: GameState = load(localStorage) ?? newGame(Date.now() >>> 0);

export const ui = {
  tab: 'home' as Tab,
  selLog: null as string | null,
  d: { members: [] as string[], leader: null as string | null, policy: 'standard', days: 3, potions: 0 },
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
  ui.lastReport = null;
  ui.d = { members: [], leader: null, policy: 'standard', days: 3, potions: 0 };
  commit();
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
  if (a.injuryDays > 0) return `負傷(あと${a.injuryDays}日)`;
  if (a.fatigue >= 70) return '疲労大';
  return '待機';
}
