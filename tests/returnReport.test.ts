import { describe, expect, it } from 'vitest';
import { advanceDay, dispatch } from '../src/core/game';
import { DUNGEON } from '../src/core/data';
import { parseFloor } from '../src/core/dungeon';
import { deserialize, serialize } from '../src/core/save';
import { captureReturnState, finishReturnReport, isReturnReport } from '../src/core/returnReport';
import { fullGame } from './helpers';
import type { DispatchOrder, Expedition, GameState } from '../src/core/types';

function order(s: GameState, overrides: Partial<DispatchOrder> = {}): DispatchOrder {
  const id = s.adventurers[0].id;
  return {
    partyIds: [id], leaderId: id, action: 'explore', target: { dungeon: 'forest_cave', floor: 'f1' },
    policy: 'standard', days: 1, items: {}, ...overrides,
  };
}

function sent(s: GameState, overrides: Partial<DispatchOrder> = {}): Expedition {
  const r = dispatch(s, order(s, overrides));
  if (!r.ok) throw new Error(r.reason);
  return r.expedition;
}

describe('return report', () => {
  it('派遣時には報告を作らず、帰還時だけ実状態の成長・疲労・地図差分を確定する', () => {
    const s = fullGame(1201);
    const e = sent(s, { days: 1 });
    expect(e.returnReport).toBeUndefined();
    const beforeLevel = s.adventurers[0].level;
    e.result.expGain[s.adventurers[0].id] = 100;
    while (s.expeditions.length) advanceDay(s);
    const report = s.history[0].returnReport;
    expect(report).toBeDefined();
    expect(report!.members[0]).toMatchObject({
      id: s.adventurers[0].id,
      levelBefore: beforeLevel,
      levelAfter: s.adventurers[0].level,
      fatigueAfter: s.adventurers[0].fatigue,
      injuryDays: s.adventurers[0].injuryDays,
    });
    expect(report!.floors[0].newCells).toBe(s.dungeons.forest_cave.floors.f1.visited.length);
    expect(report!.floors[0].rateAfter).toBeGreaterThanOrEqual(report!.floors[0].rateBefore);
  });

  it('同日二隊は、先に反映された隊の地図を新規セルとして二重計上しない', () => {
    const s = fullGame(1202);
    const a = s.adventurers[0];
    const b = s.adventurers[1];
    const e1 = sent(s, { partyIds: [a.id], leaderId: a.id, days: 1 });
    const e2 = sent(s, { partyIds: [b.id], leaderId: b.id, days: 1 });
    e2.result.mapDeltas = structuredClone(e1.result.mapDeltas);
    const expected = e1.result.mapDeltas[0].cells.length;
    while (s.expeditions.length) advanceDay(s);
    expect(s.history.find((e) => e.id === e1.id)!.returnReport!.floors[0].newCells).toBe(expected);
    expect(s.history.find((e) => e.id === e2.id)!.returnReport!.floors[0].newCells).toBe(0);
  });

  it('全滅でも実際に増えた地図と、前後で解禁された階・鍵を記録する', () => {
    const s = fullGame(1203);
    const e = sent(s, { days: 1 });
    e.result.wiped = true;
    e.result.success = false;
    e.result.mapDeltas = [{ dungeon: 'forest_cave', floor: 'f1', cells: [1, 2], hidden: [] }];
    e.result.items = { ruin_key: 1 };
    e.result.injuries = {};
    while (s.expeditions.length) advanceDay(s);
    const report = s.history[0].returnReport!;
    expect(report.floors[0].newCells).toBe(2);
    expect(report.newKeys).toContain('ruin_key');
    expect(report.members[0].injuryDays).toBe(s.adventurers[0].injuryDays);
  });

  it('保存・再読込で当時の報告を保持し、旧/壊れた報告だけを捨てる', () => {
    const s = fullGame(1204);
    sent(s, { days: 1 });
    while (s.expeditions.length) advanceDay(s);
    const report = s.history[0].returnReport!;
    expect(deserialize(serialize(s))!.history[0].returnReport).toEqual(report);

    const old = structuredClone(s) as GameState & { history: Array<Expedition & { returnReport?: unknown }> };
    delete old.history[0].returnReport;
    expect(deserialize(serialize(old))!.history[0].returnReport).toBeUndefined();

    const broken = structuredClone(s) as GameState & { history: Array<Expedition & { returnReport?: unknown }> };
    (broken.history[0] as unknown as Record<string, unknown>).returnReport = { version: 99, members: [] };
    const loaded = deserialize(serialize(broken))!;
    expect(loaded.history[0].returnReport).toBeUndefined();
    expect(isReturnReport(report)).toBe(true);
    expect(isReturnReport({ version: 1 })).toBe(false);
  });

  it('公開関数は入力を変更せずに前後状態を合成する', () => {
    const s = fullGame(1205);
    const e = sent(s, { days: 1 });
    const before = captureReturnState(s, e);
    const beforeJson = JSON.stringify(before);
    const report = finishReturnReport(s, e, before);
    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(report.version).toBe(1);
  });

  it('採取点・確認済みダンジョン・floorTransit の解禁を前後差分で記録する', () => {
    const s = fullGame(1206);
    const e = sent(s, { days: 1 });
    const before = captureReturnState(s, e);
    const forest = DUNGEON.forest_cave;
    const gatherCell = parseFloor(forest.floors[0]).cells.findIndex((cell) => cell.kind === 'gather');
    s.dungeons.forest_cave.floors.f1.visited.push(gatherCell);
    s.dungeons.old_mine.confirmed = true;
    const oldMine = DUNGEON.old_mine;
    const oldMineF1 = parseFloor(oldMine.floors[0]);
    s.dungeons.old_mine.floors.f1.visited = oldMineF1.cells.map((_, i) => i).filter((i) => oldMineF1.cells[i].kind !== 'wall');
    const tower = DUNGEON.ruined_tower;
    const towerF1 = parseFloor(tower.floors[0]);
    s.dungeons.ruined_tower.floors.f1.visited = towerF1.cells.map((_, i) => i).filter((i) => towerF1.cells[i].kind !== 'wall');
    s.inventory.ruin_key = 1;
    const report = finishReturnReport(s, e, before);
    expect(report.floors.find((f) => f.dungeon === 'forest_cave')!.newlyDiscoveredGather).toContainEqual({ cell: gatherCell, item: 'herb' });
    expect(report.confirmedDungeons).toContain('old_mine');
    expect(report.unlockedFloors).toContainEqual({ dungeon: 'ruined_tower', floor: 'f2' });
  });
});
