// 物語の章を画面に重ねる。どの章を出すかは core/story.ts、演じるのは storyPlayer.ts
import { stillArt } from '../core/presentation';
import { ALL_STORIES, markStorySeen, presentChapter, storyDue, type StoryChapter } from '../core/story';
import { render, state } from './app';
import { div, h } from './dom';
import { artUrl, createStoryPlayer } from './storyPlayer';

/** 開いている章。描き直しのたびに作り直すと、タイプライターと効果音が頭から始まる */
let active: { id: string; overlay: HTMLElement } | null = null;

function open(chapter: StoryChapter, onClose: () => void): HTMLElement {
  const player = createStoryPlayer({
    id: chapter.id,
    title: chapter.title,
    lines: presentChapter(state, chapter).lines,
    onClose: () => {
      active = null;
      onClose();
    },
  });
  active = { id: chapter.id, overlay: div('vn-overlay', player.element) };
  return active.overlay;
}

/**
 * 未読で条件を満たす章のうち先頭を、プレイヤーにして返す。無ければ null。
 * 閉じたら(読み終えても飛ばしても)既読にして onDone を呼ぶ。背後を inert にするのは呼び出し側
 */
export function storyOverlay(onDone: () => void): HTMLElement | null {
  if (active) return active.overlay;
  const chapter = storyDue(state)[0];
  if (!chapter) return null;
  return open(chapter, () => {
    markStorySeen(state, chapter.id);
    onDone();
  });
}

/** 読み終えた章をもう一度出す。既読の記録(読んだ日)は動かさない */
export function rereadChapter(id: string, onDone: () => void): void {
  const chapter = ALL_STORIES.find((c) => c.id === id);
  if (!chapter || active) return;
  open(chapter, onDone);
  render();
}

/** 章の扉絵の小さな見本。絵が無い・読めないときは地の色の枠だけ出す */
export function chapterThumb(chapter: StoryChapter): HTMLElement {
  const path = chapter.art ? stillArt(chapter.art) : null;
  if (path === null) return div('story-thumb', { 'aria-hidden': 'true' });
  const img = h('img', { class: 'story-thumb', src: artUrl(path), alt: '', loading: 'lazy' }) as HTMLImageElement;
  img.addEventListener('error', () => img.replaceWith(div('story-thumb', { 'aria-hidden': 'true' })), { once: true });
  return img;
}
