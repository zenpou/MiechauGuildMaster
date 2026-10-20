import { ENDING_PAGES } from './data';
import { captureDragonVictory } from './dragonStory';
import type { Expedition, GameState } from './types';

/** 竜を倒した帰還で呼ぶ。2頭目以降の討伐ではクリア日を動かさない */
export function onDragonDefeated(s: GameState, notices: string[], expedition?: Expedition) {
  if (s.dragonDefeated) return;
  if (expedition) s.dragonVictory = captureDragonVictory(s, expedition);
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

export function endingPages(s?: GameState): string[] {
  const pages = [...ENDING_PAGES];
  if (s?.dragonVictory?.wiped) pages[0] = '竜の試練には勝ったものの、隊は帰路で力尽き、救助されて戻った。ギルドは負傷者を迎え入れ、治療と休養を手配した。';
  else if (s?.dragonVictory?.injuredIds.length) pages[0] = '竜の試練を越え、隊が帰ってきた。傷ついた仲間を支え、まずは治療と休養へ向かう。';
  return pages;
}
