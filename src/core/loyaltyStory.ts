// ユニーク冒険者の忠誠イベント。条件と台詞は loyalty-story.json に置き、
// story.ts 側で通常章と同じ表示・既読処理へ渡す。
import loyaltyStoryJson from '../data/loyalty-story.json';
import type { StoryChapter } from './story';

export const LOYALTY_STORIES: StoryChapter[] = loyaltyStoryJson as unknown as StoryChapter[];
