// 物語の章。どの章をいつ出すかは台本(story.json)の trigger に書き、ここは GameState と照らすだけ。
// 読んだ章は flags['story:<id>'] に読んだ日を残す。GameState に項目を足すとセーブの版を上げることになる
import storyJson from '../data/story.json';
import { joinStoryUniques } from './events';
import { heldKeys } from './ledger';
import type { PresentedLine } from './presentation';
import type { GameState } from './types';

/** 章を出す条件。1つのオブジェクトに1つのキー。組み合わせは all で書く */
export type StoryTrigger =
  | { day: number }
  | { flag: string }
  | { dungeonConfirmed: string }
  | { keyHeld: string }
  | { dragonDefeated: boolean }
  | { endingSeen: boolean }
  | { questsDone: number }
  | { all: StoryTrigger[] };

export interface StoryChapter {
  id: string;
  title: string;
  trigger: StoryTrigger;
  /** 章の扉絵(art.json の stills のキー)。記録の読み返し一覧に出す */
  art?: string;
  /** 仮の台本。本番の文に差し替えたら外す */
  draft?: boolean;
  lines: PresentedLine[];
}

export const STORY = storyJson as unknown as StoryChapter[];

const SEEN_PREFIX = 'story:';

export function triggerMet(s: GameState, t: StoryTrigger): boolean {
  if ('all' in t) return t.all.every((c) => triggerMet(s, c));
  if ('day' in t) return s.day >= t.day;
  // 読んだ日が不明の既読は 0 で記録するので、真偽値に丸めると前章の読了が無かったことになる
  if ('flag' in t) return s.flags[t.flag] !== undefined && s.flags[t.flag] !== false;
  if ('dungeonConfirmed' in t) return s.dungeons[t.dungeonConfirmed]?.confirmed === true;
  if ('keyHeld' in t) return heldKeys(s).includes(t.keyHeld);
  if ('dragonDefeated' in t) return s.dragonDefeated === t.dragonDefeated;
  if ('endingSeen' in t) return Boolean(s.flags['ending:seen']) === t.endingSeen;
  if ('questsDone' in t) return s.quests.filter((q) => q.status === 'done').length >= t.questsDone;
  // 書き間違えた条件で章が勝手に開くより、出ないほうが気づける(台本の語彙は tests/story.test.ts で検査する)
  return false;
}

/** 読み終えた日。未読は null */
export function storySeenDay(s: GameState, id: string): number | null {
  const v = s.flags[SEEN_PREFIX + id];
  return typeof v === 'number' ? v : null;
}

/** 未読で条件を満たす章(台本の並び順) */
export function storyDue(s: GameState): StoryChapter[] {
  return STORY.filter((c) => storySeenDay(s, c.id) === null && triggerMet(s, c.trigger));
}

/**
 * 二度目以降は最初に読んだ日を残す。読み返しで日付が動くと、いつ読んだかが分からなくなる。
 * day に 0 を渡すと「読んだ日は不明の既読」(物語の導入前から遊んでいたセーブの、過ぎた章)
 */
export function markStorySeen(s: GameState, id: string, day: number = s.day): void {
  if (storySeenDay(s, id) !== null || !STORY.some((c) => c.id === id)) return;
  s.flags[SEEN_PREFIX + id] = day;
  joinStoryUniques(s, id);
}

/**
 * 出ている章を全部読んだことにする。物語を読まない bot・計測用。
 * 章は前章の読了を条件にした鎖なので、1つ既読にすると次が出る。出なくなるまで繰り返す
 */
export function readDueStories(s: GameState, day: number = s.day): void {
  for (let due = storyDue(s); due.length > 0; due = storyDue(s)) {
    for (const c of due) markStorySeen(s, c.id, day);
  }
}

/** 読み終えた章(台本の並び順)。読み返し用 */
export function storySeen(s: GameState): StoryChapter[] {
  return STORY.filter((c) => storySeenDay(s, c.id) !== null);
}
