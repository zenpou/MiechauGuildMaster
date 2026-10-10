import { ENDING_PAGES } from './data';
import type { GameState } from './types';

/** 竜を倒した帰還で呼ぶ。2頭目以降の討伐ではクリア日を動かさない */
export function onDragonDefeated(s: GameState, notices: string[]) {
  if (s.dragonDefeated) return;
  s.dragonDefeated = true;
  s.flags.clearDay = s.day;
  s.flags['unlock:dragon_slain'] = true;
  notices.push('竜を討伐した。竜鱗の装備のレシピが解放された。');
}

export function endingPending(s: GameState): boolean {
  return s.dragonDefeated && !s.flags['ending:seen'];
}

export function markEndingSeen(s: GameState) {
  s.flags['ending:seen'] = true;
}

export function endingPages(): string[] {
  return [...ENDING_PAGES];
}
