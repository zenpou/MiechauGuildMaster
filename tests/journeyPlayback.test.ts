import { describe, expect, it } from 'vitest';
import { applyJourneyFrame, buildJourneyDayPlayback, journeyFrameAbsoluteDay, journeyPlaybackDays, isPlayableJourney, playbackSnapshotAt } from '../src/core/journeyPlayback';
import type { JourneyFrame, JourneyRecord } from '../src/core/types';

const frame = (overrides: Partial<JourneyFrame>): JourneyFrame => ({
  day: 1, seq: 0, phase: 'dungeon', cell: 0, kind: 'start', ...overrides,
});

const record = (): JourneyRecord => ({
  version: 1, dungeon: 'forest_cave', floor: 'f1', startDay: 5, outDays: 1, leaderId: 'a',
  members: [{ id: 'a', name: '隊長', personality: 'balanced', gender: 'female', appearance: 'tina', maxHp: 100 }],
  initialVisited: [0], initialHiddenFound: [],
  frames: [
    frame({ day: 1, seq: 0, kind: 'start', cell: 0, hp: { a: 100 }, visitedDelta: [0] }),
    frame({ day: 1, seq: 1, kind: 'move', cell: 1, hpDelta: { a: 95 }, visitedDelta: [1] }),
    frame({ day: 2, seq: 2, kind: 'event', cell: 2, hiddenFoundDelta: [2], text: '隠し通路を発見' }),
  ],
});

describe('journeyPlayback', () => {
  it('absolute day uses startDay and relative frame day without mutating record', () => {
    const r = record();
    expect(journeyFrameAbsoluteDay(r, r.frames[0])).toBe(5);
    expect(journeyFrameAbsoluteDay(r, r.frames[2])).toBe(6);
    const copy = structuredClone(r);
    const p = buildJourneyDayPlayback(r, 5)!;
    p.frames[0].visitedDelta?.push(999);
    expect(r).toEqual(copy);
  });

  it('starts from yesterday, then exposes only the selected day', () => {
    const r = record();
    const p = buildJourneyDayPlayback(r, 6)!;
    expect(p.frames).toHaveLength(1);
    expect(p.frames[0].text).toBe('隠し通路を発見');
    expect(p.initial.cell).toBe(1);
    expect(p.initial.hp.a).toBe(95);
    expect(p.final.hiddenFound).toEqual([2]);
    expect(p.final.cell).toBe(2);
    expect(p.record.frames).toHaveLength(3);
  });

  it('skip and restart use the same immutable state as autoplay', () => {
    const r = record();
    const p = buildJourneyDayPlayback(r, 6)!;
    const skipped = playbackSnapshotAt(p, p.frames.length);
    const restarted = playbackSnapshotAt(p, 0);
    const replayed = p.frames.reduce((state, f) => applyJourneyFrame(state, f), p.initial);
    expect(skipped).toEqual(p.final);
    expect(restarted).toEqual(p.initial);
    expect(replayed).toEqual(p.final);
    expect(playbackSnapshotAt(p, 999)).toEqual(p.final);
  });

  it('cuts a multi-day record at the selected day', () => {
    const r = record();
    const first = buildJourneyDayPlayback(r, 5)!;
    expect(first.frames.map((f) => f.seq)).toEqual([0, 1]);
    expect(first.final.cell).toBe(1);
    expect(first.final.hiddenFound).toEqual([]);
    const second = buildJourneyDayPlayback(r, 6)!;
    expect(second.frames.map((f) => f.seq)).toEqual([2]);
    expect(second.initial.cell).toBe(1);
    expect(second.final.hiddenFound).toEqual([2]);
  });

  it('applies full hp snapshots and deltas immutably', () => {
    const before = { visited: [0], hiddenFound: [], hp: { a: 100, b: 20 }, cell: 0 };
    const next = applyJourneyFrame(before, frame({ hp: { a: 80 }, hpDelta: { b: 0 }, visitedDelta: [1], hiddenFoundDelta: [4], cell: 1 }));
    expect(next).toEqual({ visited: [0, 1], hiddenFound: [4], hp: { a: 80, b: 0 }, cell: 1 });
    expect(before).toEqual({ visited: [0], hiddenFound: [], hp: { a: 100, b: 20 }, cell: 0 });
  });

  it('does not offer future playback days', () => {
    const r = record();
    expect(journeyPlaybackDays(r, 5)).toEqual([5]);
    expect(journeyPlaybackDays(r, 6)).toEqual([5, 6]);
    expect(journeyPlaybackDays(undefined, 6)).toEqual([]);
  });

  it('rejects old or malformed records without throwing', () => {
    expect(isPlayableJourney(undefined)).toBe(false);
    expect(isPlayableJourney({ ...record(), version: 2 as 1 })).toBe(false);
    expect(isPlayableJourney({ ...record(), frames: null as unknown as JourneyFrame[] })).toBe(false);
  });
});
