import { journeyFrameAbsoluteDay, journeyPlaybackDays, isPlayableJourney } from '../core/journeyPlayback';
import type { Expedition } from '../core/types';
import { render, state } from './app';
import { createJourneyPlayer, type JourneyPlayer, type JourneySpec } from './journeyPlayer';

let pending: JourneySpec[] | null = null;
let active: { player: JourneyPlayer; overlay: HTMLElement } | null = null;

function maxDayFor(e: Expedition): number {
  // 履歴でも、現在日より先の壊れた/移植途中の記録を選択肢へ出さない。
  return Math.min(e.returnDay, state.day - 1);
}

function specFor(e: Expedition, initialDay?: number): JourneySpec | null {
  if (!isPlayableJourney(e.journey)) return null;
  const maxDay = maxDayFor(e);
  const days = journeyPlaybackDays(e.journey, maxDay);
  if (!days.length) return null;
  return { id: e.id, expedition: e, record: e.journey, maxDay, initialDay: initialDay && days.includes(initialDay) ? initialDay : days.at(-1)!, revealOutcome: e.claimed };
}

/** 直前の日送りで観察する隊を予約する。自動再生の対象日は呼び出し側が固定して渡す。 */
export function queueJourneyObservation(expeditions: Expedition[], absoluteDay: number): void {
  const specs = expeditions
    .filter((e) => e.journey?.frames.some((frame) => journeyFrameAbsoluteDay(e.journey!, frame) === absoluteDay))
    .map((e): JourneySpec | null => { const spec = specFor(e, absoluteDay); return spec ? { ...spec, revealOutcome: false } : null; })
    .filter((x): x is JourneySpec => !!x);
  pending = specs.length ? specs : null;
}

/** 派遣中の「道中を見る」。昨日までの確定フレームだけを対象にする。 */
export function openJourney(e: Expedition, absoluteDay?: number): void {
  const spec = specFor(e, absoluteDay);
  pending = spec ? [spec] : null;
  if (pending) render();
}

/** 履歴からの手動再生は帰還日までの全記録を選べる。 */
export function canOpenJourney(e: Expedition): boolean {
  return !!specFor(e);
}

export function journeyOverlay(onDone: () => void): HTMLElement | null {
  if (active) return active.overlay;
  if (!pending?.length) return null;
  const player = createJourneyPlayer({
    specs: pending,
    onClose: () => {
      active = null;
      pending = null;
      onDone();
    },
  });
  if (!player) {
    pending = null;
    return null;
  }
  active = { player, overlay: player.element.parentElement! };
  return active.overlay;
}

export function clearJourney(): void {
  if (active) active.player.close();
  else pending = null;
}

/** replaceState 専用。古い GameState の隊を再生したままにしない。 */
export function resetJourney(): void {
  active?.player.dispose();
  active = null;
  pending = null;
}
