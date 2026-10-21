// 物語の章。どの章をいつ出すかは台本(story.json)の trigger に書き、ここは GameState と照らすだけ。
// 本編・人物別会話とも、flags['story:<id>'] に読んだ日を残す。
import storyJson from '../data/story.json';
import { joinStoryUniques } from './events';
import { dragonBattleLines } from './dragonStory';
import { LOYALTY_STORIES } from './loyaltyStory';
import { heldKeys } from './ledger';
import { speakerCharacter, type PresentedLine } from './presentation';
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
  | { loyalty: { unique: string; value: number } }
  | { joinedDays: { unique: string; days: number } }
  | { recovered: string }
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
export const ALL_STORIES = [...STORY, ...LOYALTY_STORIES];

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
  if ('loyalty' in t) return s.adventurers.some(a => a.unique === t.loyalty.unique && a.loyalty >= t.loyalty.value);
  if ('joinedDays' in t) return s.adventurers.some(a => a.unique === t.joinedDays.unique && s.day - a.history.hiredDay >= t.joinedDays.days);
  if ('recovered' in t) return s.adventurers.some(a => a.unique === t.recovered && a.injuryDays === 0);
  // 書き間違えた条件で章が勝手に開くより、出ないほうが気づける(台本の語彙は tests/story.test.ts で検査する)
  return false;
}

/** 読み終えた日。未読は null */
export function storySeenDay(s: GameState, id: string): number | null {
  const v = s.flags[SEEN_PREFIX + id];
  return typeof v === 'number' ? v : null;
}

/**
 * 章に出る人物(話し手か立ち絵)のうち、名簿にいて派遣中の者。
 * 派遣中の仲間が執務室の場面に出てくると矛盾するので、帰るまでその章は出さない(trigger には書かず、台本から導く)。
 * 訓練・施設の仕事は拠点の中なので止めない
 */
export function castAway(s: GameState, c: StoryChapter): string[] {
  const onStage = new Set<string>();
  for (const l of c.lines) {
    const speaker = speakerCharacter(l.speaker);
    if (speaker) onStage.add(speaker);
    for (const a of l.cast ?? []) onStage.add(a.character);
  }
  return s.adventurers.flatMap((a) => (a.unique && a.status === 'away' && onStage.has(a.unique) ? [a.unique] : []));
}

/** 本編を今日新しく読んだら、人物別会話は次の日まで待つ(0は日付不明なので数えない)。 */
function mainStoryReadToday(s: GameState): boolean {
  return s.day > 0 && STORY.some((chapter) => storySeenDay(s, chapter.id) === s.day);
}

/** 人物別会話を同じ日に二つ開かない。日付0の旧既読は枠を消費しない。 */
function loyaltyStoryReadToday(s: GameState): boolean {
  return s.day > 0 && LOYALTY_STORIES.some((chapter) => storySeenDay(s, chapter.id) === s.day);
}

/** 未読で条件を満たし、出る人物が全員拠点にいる章(台本の並び順) */
export function storyDue(s: GameState): StoryChapter[] {
  const due = (chapters: StoryChapter[]) => chapters.filter(c => storySeenDay(s, c.id) === null && triggerMet(s, c.trigger));
  // 本編が開いているときは先に読む。登場人物の帰還待ちの間も脇話を割り込ませない。
  const main = due(STORY);
  if (main.length) return main.filter(c => castAway(s, c).length === 0);
  // 本編を読み終えた直後に、そのまま人物別会話まで連続表示しない。
  if (mainStoryReadToday(s)) return [];
  if (loyaltyStoryReadToday(s)) return [];
  const loyalty = due(LOYALTY_STORIES)
    .filter(c => castAway(s, c).length === 0);
  // 台本の順序をそのまま使い、同日に複数の人物別会話を開かない。
  return loyalty.slice(0, 1);
}

/** 表示と読み返しで共通。戦闘は保存された実戦の記録から組み立てる。 */
export function presentChapter(s: GameState, chapter: StoryChapter): StoryChapter {
  return chapter.id === 'epilogue' ? { ...chapter, lines: [...dragonBattleLines(s.dragonVictory), ...chapter.lines] } : chapter;
}

/**
 * 二度目以降は最初に読んだ日を残す。読み返しで日付が動くと、いつ読んだかが分からなくなる。
 * day に 0 を渡すと「読んだ日は不明の既読」(物語の導入前から遊んでいたセーブの、過ぎた章)
 */
export function markStorySeen(s: GameState, id: string, day: number = s.day): void {
  if (storySeenDay(s, id) !== null || !ALL_STORIES.some((c) => c.id === id)) return;
  s.flags[SEEN_PREFIX + id] = day;
  joinStoryUniques(s, id);
}

/**
 * 出ている本編を順に読み、人物別会話はその日の上限を守る。物語を読まない bot・計測用。
 * 本編は前章の読了を条件にした鎖なので、1つ既読にすると次が出る。出なくなるまで繰り返す
 */
export function readDueStories(s: GameState, day: number = s.day): void {
  for (let due = storyDue(s); due.length > 0; due = storyDue(s)) {
    if (LOYALTY_STORIES.includes(due[0])) {
      // day=0 は過去移行用の日付不明値でも、同じ呼出しで全人物別会話を既読にしない。
      markStorySeen(s, due[0].id, day);
      return;
    }
    for (const c of due) markStorySeen(s, c.id, day);
  }
}

/** 読み終えた章(台本の並び順)。読み返し用 */
export function storySeen(s: GameState): StoryChapter[] {
  return ALL_STORIES.filter((c) => storySeenDay(s, c.id) !== null);
}
