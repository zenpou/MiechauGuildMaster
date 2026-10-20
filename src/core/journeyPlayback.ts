import { isJourneyRecord, journeyStateAt, journeyUntil, type JourneyPlaybackState } from './journey';
import type { JourneyFrame, JourneyRecord } from './types';

/** UI が再生する1日分の状態。再生側が record を書き換えないよう、配列とマップは毎回複製する。 */
export interface PlaybackSnapshot {
  visited: number[];
  hiddenFound: number[];
  hp: Record<string, number>;
  cell: number | null;
}

export interface JourneyDayPlayback {
  record: JourneyRecord;
  absoluteDay: number;
  frames: JourneyFrame[];
  initial: PlaybackSnapshot;
  snapshots: PlaybackSnapshot[];
  final: PlaybackSnapshot;
}

/** 再生カーソル直後の状態。0 は当日の開始状態、n は n 件適用後。 */
export function playbackSnapshotAt(playback: JourneyDayPlayback, index: number): PlaybackSnapshot {
  const safeIndex = Math.max(0, Math.min(playback.snapshots.length, Math.trunc(index)));
  return copySnapshot(safeIndex === 0 ? playback.initial : playback.snapshots[safeIndex - 1]);
}

const cloneSnapshot = (state: JourneyPlaybackState): PlaybackSnapshot => ({
  visited: [...state.visited],
  hiddenFound: [...state.hiddenFound],
  hp: { ...state.hp },
  cell: state.cell,
});

const copyFrame = (frame: JourneyFrame): JourneyFrame => ({
  ...frame,
  hp: frame.hp ? { ...frame.hp } : undefined,
  hpDelta: frame.hpDelta ? { ...frame.hpDelta } : undefined,
  visitedDelta: frame.visitedDelta ? [...frame.visitedDelta] : undefined,
  hiddenFoundDelta: frame.hiddenFoundDelta ? [...frame.hiddenFoundDelta] : undefined,
});

const copySnapshot = (snapshot: PlaybackSnapshot): PlaybackSnapshot => ({
  visited: [...snapshot.visited],
  hiddenFound: [...snapshot.hiddenFound],
  hp: { ...snapshot.hp },
  cell: snapshot.cell,
});

function initialSnapshot(record: JourneyRecord, absoluteDay: number): PlaybackSnapshot {
  const prior = journeyStateAt(record, absoluteDay - 1);
  if (prior) return cloneSnapshot(prior);
  return {
    visited: [...record.initialVisited],
    hiddenFound: [...record.initialHiddenFound],
    hp: {},
    cell: null,
  };
}

/** 1つのフレームを適用して、次のスナップショットを返す。引数は変更しない。 */
export function applyJourneyFrame(previous: PlaybackSnapshot, frame: JourneyFrame): PlaybackSnapshot {
  const visited = new Set(previous.visited);
  const hiddenFound = new Set(previous.hiddenFound);
  for (const cell of frame.visitedDelta ?? []) visited.add(cell);
  for (const cell of frame.hiddenFoundDelta ?? []) hiddenFound.add(cell);
  const hp = { ...previous.hp };
  if (frame.hp) Object.assign(hp, frame.hp);
  if (frame.hpDelta) Object.assign(hp, frame.hpDelta);
  return {
    visited: [...visited].sort((a, b) => a - b),
    hiddenFound: [...hiddenFound].sort((a, b) => a - b),
    hp,
    cell: frame.cell === null ? previous.cell : frame.cell,
  };
}

/** 絶対日を record の相対日へ変換する。record の保存形式を UI 側で再解釈しない。 */
export function journeyFrameAbsoluteDay(record: JourneyRecord, frame: JourneyFrame): number {
  return record.startDay + frame.day - 1;
}

/** 当日のフレームと、各フレーム直後の状態を作る。結果は再生用の読み取り専用スナップショットとして扱う。 */
export function buildJourneyDayPlayback(record: JourneyRecord | undefined, absoluteDay: number): JourneyDayPlayback | undefined {
  if (!record || !Number.isFinite(absoluteDay)) return undefined;
  const visible = journeyUntil(record, absoluteDay);
  if (!visible) return undefined;
  const frames = visible.frames
    .filter((frame) => journeyFrameAbsoluteDay(visible, frame) === absoluteDay)
    .sort((a, b) => a.seq - b.seq)
    .map(copyFrame);
  let current = initialSnapshot(visible, absoluteDay);
  const initial = copySnapshot(current);
  const snapshots: PlaybackSnapshot[] = [];
  for (const frame of frames) {
    current = applyJourneyFrame(current, frame);
    snapshots.push(copySnapshot(current));
  }
  return { record: visible, absoluteDay, frames, initial, snapshots, final: copySnapshot(current) };
}

/** 再生可能な絶対日。未来のフレームを自動表示しないため、呼び出し側の上限を必ず受け取る。 */
export function journeyPlaybackDays(record: JourneyRecord | undefined, maxAbsoluteDay: number): number[] {
  if (!record || !Number.isFinite(maxAbsoluteDay)) return [];
  return [...new Set(record.frames
    .map((frame) => journeyFrameAbsoluteDay(record, frame))
    .filter((day) => day <= maxAbsoluteDay))].sort((a, b) => a - b);
}

/** 壊れた旧セーブを画面へ渡さないための軽い境界チェック。詳細な移行は core/save が担当する。 */
export function isPlayableJourney(record: JourneyRecord | undefined): record is JourneyRecord {
  return isJourneyRecord(record);
}
