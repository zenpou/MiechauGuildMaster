import { describe, expect, it } from 'vitest';
import { DUNGEON } from '../src/core/data';
import { advanceDay, dispatch, recall } from '../src/core/game';
import { parseFloor } from '../src/core/dungeon';
import { runExploration, type ExploreInput } from '../src/core/explore';
import { journeyStateAt, journeyUntil, playableJourney } from '../src/core/journey';
import { rngFor } from '../src/core/rng';
import { deserialize, serialize } from '../src/core/save';
import type { GameState } from '../src/core/types';
import { fullGame } from './helpers';

function input(seed: number, observed: boolean): ExploreInput {
  const s = fullGame(seed);
  return {
    rng: rngFor(seed, 'journey-test'),
    dungeon: DUNGEON.forest_cave,
    floorId: 'f1',
    members: structuredClone(s.adventurers),
    leaderId: s.adventurers[0].id,
    policy: 'standard',
    progress: structuredClone(s.dungeons.forest_cave),
    days: 2,
    items: {},
    relations: {},
    startDay: 1,
    action: 'explore',
    ...(observed ? { journey: { expeditionStartDay: 1, outDays: 0 } } : {}),
  };
}

describe('自動探索の観察記録', () => {
  it('記録の有無で結果・トレース・乱数列を変えない', () => {
    const plainInput = input(71, false);
    const observedInput = input(71, true);
    const plain = runExploration(plainInput);
    const observed = runExploration(observedInput);
    expect(observed.result).toEqual(plain.result);
    expect(observed.trace).toEqual(plain.trace);
    expect(observedInput.rng.next()).toBe(plainInput.rng.next());
    expect(observed.journey).toBeDefined();
  });

  it('往路日数を相対dayへ加算し、絶対日境界で再生する', () => {
    const run = runExploration({
      ...input(75, false),
      journey: { expeditionStartDay: 5, outDays: 2 },
    });
    const journey = run.journey!;
    expect(journey.frames[0].day).toBe(3);
    expect(journeyUntil(journey, 6)!.frames).toHaveLength(0);
    expect(journeyUntil(journey, 7)!.frames.length).toBeGreaterThan(0);
  });

  it('実際の移動順、隊員の顔情報、HP差分、隠し発見を保存する', () => {
    const run = runExploration(input(72, true));
    const journey = run.journey!;
    const grid = parseFloor(DUNGEON.forest_cave.floors[0]);
    expect(journey.members.every((m) => m.appearance && typeof m.maxHp === 'number')).toBe(true);
    expect(journey.initialVisited).not.toBe(journey.frames[0].visitedDelta);
    expect(journey.frames[0]).toMatchObject({ kind: 'start', cell: grid.cells.findIndex((cell) => cell.kind === 'entrance') });
    expect(journey.frames[0].hp).toEqual(Object.fromEntries(journey.members.map((member) => [member.id, member.maxHp])));
    expect(journey.frames.every((frame) => frame.day >= journey.outDays + 1)).toBe(true);
    expect(journey.frames.every((frame) => frame.day <= journey.outDays + run.result.daysSpent)).toBe(true);
    expect(journey.frames.map((f) => f.seq)).toEqual(journey.frames.map((_, i) => i));

    const moves = journey.frames.filter((f) => f.kind === 'move').map((f) => f.cell!);
    let prev = journey.frames[0].cell!;
    for (const cell of moves) {
      const dx = Math.abs((cell % grid.width) - (prev % grid.width));
      const dy = Math.abs(Math.floor(cell / grid.width) - Math.floor(prev / grid.width));
      expect(dx + dy).toBe(1);
      prev = cell;
    }

    const hp: Record<string, number> = { ...journey.frames[0].hp };
    for (const frame of journey.frames) {
      for (const [id, value] of Object.entries(frame.hpDelta ?? {})) hp[id] = value;
      for (const member of journey.members) {
        expect(hp[member.id]).toBeGreaterThanOrEqual(0);
        expect(hp[member.id]).toBeLessThanOrEqual(member.maxHp);
      }
    }
    expect(journey.frames.some((f) => f.kind === 'combat_action' || f.kind === 'rest' || f.kind === 'camp')).toBe(true);
    for (const frame of journey.frames.filter((f) => f.kind === 'combat_action')) {
      expect(frame.combatKind).toBeDefined();
      expect(frame.actorName).toBeDefined();
    }
    for (const frame of journey.frames) {
      if (frame.hiddenFoundDelta) {
        expect(frame.kind).toBe('hidden');
        expect(frame.hiddenFoundDelta.every((cell) => !journey.initialHiddenFound.includes(cell))).toBe(true);
      }
    }
  });

  it('隠し通路は発見フレームの日まで再生状態へ現れない', () => {
    let found: ReturnType<typeof runExploration>['journey'] | undefined;
    for (let seed = 1; seed <= 40 && !found; seed++) {
      const run = runExploration(input(seed, true));
      if (run.journey?.frames.some((f) => f.kind === 'hidden')) found = run.journey;
    }
    expect(found).toBeDefined();
    const record = found!;
    const hidden = record.frames.find((f) => f.kind === 'hidden')!;
    const absolute = record.startDay + hidden.day - 1;
    const before = journeyStateAt(record, absolute - 1)!;
    const after = journeyStateAt(record, absolute)!;
    for (const cell of hidden.hiddenFoundDelta ?? []) {
      expect(before.hiddenFound).not.toContain(cell);
      expect(after.hiddenFound).toContain(cell);
    }
  });

  it('派遣中は前日まで、帰還履歴は全記録を再生でき、呼び戻しは未来を削る', () => {
    const s = fullGame(73);
    const ids = s.adventurers.map((a) => a.id);
    const sent = dispatch(s, {
      partyIds: ids, leaderId: ids[0], action: 'explore', target: { dungeon: 'forest_cave', floor: 'f1' },
      policy: 'standard', days: 3, items: {},
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const expedition = sent.expedition;
    expect(expedition.journey).toBeDefined();
    const before = playableJourney(expedition, s.day);
    expect(before?.frames ?? []).toHaveLength(0);
    advanceDay(s);
    const disclosed = playableJourney(expedition, s.day)!;
    expect(disclosed.frames.length).toBeGreaterThan(0);
    expect(disclosed.frames.every((f) => expedition.startDay + f.day - 1 < s.day)).toBe(true);
    const all = journeyUntil(expedition.journey, expedition.returnDay)!;
    expect(all.frames.length).toBeGreaterThanOrEqual(disclosed.frames.length);
    expect(recall(s, expedition.id)).toEqual({ ok: true });
    expect(expedition.journey!.frames.length).toBe(disclosed.frames.length);
    expect(expedition.journey!.frames.some((f) => f.kind === 'end')).toBe(false);
  });

  it('観察記録はセーブに残り、記録のない旧セーブも読める', () => {
    const s = fullGame(74);
    const ids = s.adventurers.map((a) => a.id);
    const sent = dispatch(s, {
      partyIds: ids, leaderId: ids[0], action: 'explore', target: { dungeon: 'forest_cave', floor: 'f1' },
      policy: 'standard', days: 1, items: {},
    });
    expect(sent.ok).toBe(true);
    const roundTrip = deserialize(serialize(s))!;
    expect(roundTrip.expeditions[0].journey?.frames.length).toBeGreaterThan(0);
    const old = structuredClone(s) as GameState;
    for (const e of [...old.expeditions, ...old.history]) delete e.journey;
    expect(deserialize(serialize(old))).not.toBeNull();
  });

  it('出発時の鍵を複製し、後の所持品変更を過去へ持ち込まない', () => {
    const keys = ['mine_key'];
    const run = runExploration({ ...input(77, true), keys });
    keys.push('tower_key');
    expect(run.journey!.initialKeys).toEqual(['mine_key']);
    const playback = journeyUntil(run.journey, 99)!;
    playback.initialKeys!.push('new_key');
    expect(run.journey!.initialKeys).toEqual(['mine_key']);
  });

  it('壊れた観察記録だけを捨て、遠征結果と本体セーブは保持する', () => {
    const s = fullGame(78);
    const ids = s.adventurers.map(a => a.id);
    const sent = dispatch(s, {
      partyIds: ids, leaderId: ids[0], action: 'explore', target: { dungeon: 'forest_cave', floor: 'f1' },
      policy: 'standard', days: 1, items: {},
    });
    expect(sent.ok).toBe(true);
    for (const corrupt of [
      (j: any) => { j.members = {}; },
      (j: any) => { j.members[0].maxHp = 'bad'; },
      (j: any) => { j.initialVisited = [null]; },
      (j: any) => { j.frames[0].hp = { a: -1 }; },
      (j: any) => { j.frames[0].cell = {}; },
      (j: any) => { j.frames[0] = null; },
      (j: any) => { j.version = 99; },
    ]) {
      const bad = structuredClone(s);
      corrupt(bad.expeditions[0].journey);
      const loaded = deserialize(serialize(bad));
      expect(loaded).not.toBeNull();
      expect(loaded!.expeditions[0].journey).toBeUndefined();
      expect(loaded!.expeditions[0].result).toEqual(s.expeditions[0].result);
    }
  });
});
