// 台帳と在庫の増減。game / base / craft / equipment が共有するので、game.ts から切り離して循環 import を避ける。
import type { GameState } from './types';

const LEDGER_MAX = 300;

export function ledger(s: GameState, label: string, amount: number) {
  if (amount === 0) return;
  s.ledger.unshift({ day: s.day, label, amount });
  if (s.ledger.length > LEDGER_MAX) s.ledger.length = LEDGER_MAX;
}

export function addInventory(s: GameState, item: string, n: number) {
  const v = (s.inventory[item] ?? 0) + n;
  if (v > 0) s.inventory[item] = v;
  else delete s.inventory[item];
}
