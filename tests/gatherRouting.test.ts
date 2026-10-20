import { describe, expect, it } from 'vitest';
import { generateAdventurer } from '../src/core/adventurer';
import { JOB } from '../src/core/data';
import { parseFloor, type Grid } from '../src/core/dungeon';
import { runExploration, type ExploreInput } from '../src/core/explore';
import { rngFor } from '../src/core/rng';
import type { Adventurer, DungeonDef, DungeonProgress } from '../src/core/types';

function corridor(name: string, rows: string[], o: Partial<DungeonDef> = {}): DungeonDef {
  return {
    id: name, name, desc: '', node: name,
    floors: [{
      id: 'f1', name: '1階', rows,
      legend: {
        '#': { kind: 'wall' }, '.': { kind: 'floor' }, E: { kind: 'entrance' },
        m: { kind: 'gather', item: 'moss_ore' }, w: { kind: 'nest', enemy: 'wolf' },
      },
    }],
    enemies: [{ id: 'wolf', weight: 1, group: [1, 1] }],
    recommended: 100, rescueCost: 77, encounterRate: 0, ...o,
  };
}

function strongParty(seed: number): Adventurer[] {
  return ['fighter', 'warrior', 'priest', 'scout'].map((job, i) => {
    const a = generateAdventurer(rngFor(seed, 'party', i), { id: `m${i}`, level: 20 });
    a.job = job;
    a.personality = i === 0 ? 'cautious' : 'caring';
    for (const role of JOB[job].roles) a.apt[role] = 100;
    return a;
  });
}

function progressOf(visited: number[]): DungeonProgress {
  return { confirmed: true, floors: { f1: { visited, hiddenFound: [] } }, bossDefeated: 0, fullCleared: false };
}

function passableCells(grid: Grid): number[] {
  return grid.cells.flatMap((cell, i) => (cell.kind === 'wall' ? [] : [i]));
}

function gatherInput(
  seed: number,
  dungeon: DungeonDef,
  policy: string,
  visited: number[],
  days = 1,
): ExploreInput {
  const members = strongParty(seed);
  return {
    rng: rngFor(seed, 'gather-routing'), dungeon, floorId: 'f1',
    members, leaderId: members[0].id, policy,
    progress: progressOf(visited), days, items: { potion: 5 }, relations: {}, startDay: 0,
    action: 'gather', target: { item: 'moss_ore' },
  };
}

function moveCells(run: ReturnType<typeof runExploration>): number[] {
  return run.trace.days.flatMap((day) => day.moves.map((move) => move.cell));
}

describe('採集の戦闘回避経路', () => {
  it('標準は巣の近道、安全方針は既知の安全な迂回路を使う', () => {
    const dungeon = corridor('known-detour', [
      '###########',
      '#E..w...m.#',
      '#.........#',
      '###########',
    ]);
    const grid = parseFloor(dungeon.floors[0]);
    const visited = passableCells(grid);
    const nest = grid.cells.findIndex((cell) => cell.kind === 'nest');
    const gather = grid.cells.findIndex((cell) => cell.kind === 'gather');

    const standard = runExploration(gatherInput(1, dungeon, 'standard', visited));
    const safe = runExploration(gatherInput(1, dungeon, 'safe', visited));

    expect(moveCells(standard)).toContain(nest);
    expect(standard.trace.events.filter((event) => event.kind === 'nest')).toHaveLength(1);
    expect(standard.trace.events.filter((event) => event.kind === 'gather').map((event) => event.cell)).toContain(gather);
    expect(moveCells(safe)).not.toContain(nest);
    expect(safe.trace.events.filter((event) => event.kind === 'nest')).toHaveLength(0);
    expect(safe.trace.events.filter((event) => event.kind === 'gather').map((event) => event.cell)).toContain(gather);
    expect(safe.trace.finalCell).toBe(grid.entrance);
    expect(safe.trace.forcedReturn).toBe(false);
    expect(safe.result.log.filter((entry) => entry.text.includes('既知の巣や強敵を避け'))).toHaveLength(1);
    expect(standard.result.log.filter((entry) => entry.text.includes('既知の巣や強敵を避け'))).toHaveLength(0);
  });

  it('迂回路が未踏なら、安全方針でも既知の道へ戻り巣を通る', () => {
    const dungeon = corridor('unvisited-detour', [
      '###########',
      '#E..w...m.#',
      '#.........#',
      '###########',
    ]);
    const grid = parseFloor(dungeon.floors[0]);
    const nest = grid.cells.findIndex((cell) => cell.kind === 'nest');
    const directKnown = Array.from({ length: 8 }, (_, x) => grid.width + x + 1);

    const safe = runExploration(gatherInput(2, dungeon, 'avoid', directKnown));

    expect(moveCells(safe)).toContain(nest);
    expect(safe.trace.events.filter((event) => event.kind === 'nest')).toHaveLength(1);
    expect(safe.trace.finalCell).toBe(grid.entrance);
    expect(safe.trace.forcedReturn).toBe(false);
    expect(safe.result.log.filter((entry) => entry.text.includes('既知の巣や強敵を避け'))).toHaveLength(0);
  });

  it('安全な迂回路が無ければ安全方針でも既存の道を使う', () => {
    const dungeon = corridor('no-detour', [
      '###########',
      '#E..w...m.#',
      '###########',
    ]);
    const grid = parseFloor(dungeon.floors[0]);
    const visited = passableCells(grid);
    const nest = grid.cells.findIndex((cell) => cell.kind === 'nest');

    const safe = runExploration(gatherInput(3, dungeon, 'safe', visited));

    expect(moveCells(safe)).toContain(nest);
    expect(safe.trace.events.filter((event) => event.kind === 'nest')).toHaveLength(1);
    expect(safe.trace.finalCell).toBe(grid.entrance);
    expect(safe.trace.forcedReturn).toBe(false);
  });

  it('安全な迂回路が日数に収まらなければ採取を後回しにして入口へ戻る', () => {
    const width = 21;
    const innerRow = (cellAt?: (x: number) => string) => {
      const cells = Array.from({ length: width - 2 }, (_, i) => cellAt?.(i + 1) ?? '.');
      return `#${cells.join('')}#`;
    };
    const dungeon = corridor('short-days', [
      '#'.repeat(width),
      innerRow((x) => x === 1 ? 'E' : x === 8 ? 'w' : x === 17 ? 'm' : '.'),
      ...Array.from({ length: 4 }, () => innerRow((x) => x === 8 ? 'w' : '.')),
      innerRow(),
      '#'.repeat(width),
    ]);
    const grid = parseFloor(dungeon.floors[0]);
    const visited = passableCells(grid);
    const gather = grid.cells.findIndex((cell) => cell.kind === 'gather');
    const nest = grid.cells.findIndex((cell) => cell.kind === 'nest');

    const standard = runExploration(gatherInput(4, dungeon, 'standard', visited));
    const safe = runExploration(gatherInput(4, dungeon, 'safe', visited));

    expect(standard.trace.events.filter((event) => event.kind === 'gather').map((event) => event.cell)).toContain(gather);
    expect(safe.trace.events.filter((event) => event.kind === 'gather')).toHaveLength(0);
    expect(moveCells(safe)).not.toContain(nest);
    expect(safe.trace.finalCell).toBe(grid.entrance);
    expect(safe.trace.forcedReturn).toBe(false);
  });
});
