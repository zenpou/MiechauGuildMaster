import { describe, expect, it } from 'vitest';
import { DUNGEON } from '../src/core/data';
import { parseFloor } from '../src/core/dungeon';
import { newGame } from '../src/core/game';
import { draftForMaterial, knownMaterialSources, type MaterialSource } from '../src/core/materialSources';
import type { Expedition, GameState } from '../src/core/types';

function knowWholeFloor(s: GameState, dungeonId: string, floorId = 'f1') {
  const dungeon = DUNGEON[dungeonId];
  const floorDef = dungeon?.floors.find((floor) => floor.id === floorId);
  if (!dungeon || !floorDef) throw new Error(`テスト用フロアがありません: ${dungeonId}/${floorId}`);
  const grid = parseFloor(floorDef);
  const visited = grid.cells.flatMap((cell, i) => cell.kind === 'wall' ? [] : [i]);
  const hiddenFound = grid.cells.flatMap((cell, i) => cell.kind === 'hidden' ? [i] : []);
  s.dungeons[dungeonId].confirmed = true;
  s.dungeons[dungeonId].floors[floorId] = { visited, hiddenFound };
  return { grid, visited };
}

function claimedKill(enemy: string, claimed = true): Expedition {
  return { claimed, result: { kills: { [enemy]: 1 } } } as unknown as Expedition;
}

function source(sources: MaterialSource[], action: MaterialSource['action'], item: string): MaterialSource {
  const found = sources.find((candidate) => candidate.action === action && candidate.item === item);
  if (!found) throw new Error(`素材の入手先がありません: ${action}/${item}`);
  return found;
}

describe('素材の既知入手先', () => {
  it('既踏・確認済み・入口から到達できる採取点だけを返し、素材sourceを推測に使わない', () => {
    const s = newGame(101);
    const { grid } = knowWholeFloor(s, 'forest_cave');
    const before = structuredClone(s);

    expect(knownMaterialSources(s, 'herb')).toEqual([
      { dungeon: 'forest_cave', floor: 'f1', action: 'gather', item: 'herb' },
    ]);
    expect(knownMaterialSources(s, 'missing_material')).toEqual([]);
    expect(s).toEqual(before);

    s.dungeons.forest_cave.floors.f1.visited = [grid.entrance];
    expect(knownMaterialSources(s, 'herb')).toEqual([]);
    s.dungeons.forest_cave.floors.f1.visited = grid.cells.flatMap((cell, i) => cell.kind === 'wall' ? [] : [i]);
    s.dungeons.forest_cave.confirmed = false;
    expect(knownMaterialSources(s, 'herb')).toEqual([]);
  });

  it('討伐先はclaimed済みの討伐履歴と既知の敵セルだけから作る', () => {
    const s = newGame(102);
    knowWholeFloor(s, 'forest_cave');
    s.expeditions = [claimedKill('wolf', false)];
    expect(knownMaterialSources(s, 'fang').filter((candidate) => candidate.action === 'hunt')).toEqual([]);

    s.expeditions = [];
    s.history = [claimedKill('wolf', false)];
    expect(knownMaterialSources(s, 'fang').filter((candidate) => candidate.action === 'hunt')).toEqual([]);

    s.history = [claimedKill('wolf')];
    expect(knownMaterialSources(s, 'fang')).toEqual([
      { dungeon: 'forest_cave', floor: 'f1', action: 'hunt', item: 'fang', enemy: 'wolf' },
    ]);

    // 同じ敵が複数の既知セルにいても、次の派遣先は敵ごとに一つへまとめる。
    const oldMine = knowWholeFloor(s, 'old_mine');
    oldMine.grid.cells.forEach((cell) => {
      if (cell.kind === 'nest' && cell.enemy === 'skeleton') s.history.push(claimedKill('skeleton'));
    });
    expect(knownMaterialSources(s, 'bone_shard').filter((candidate) => candidate.enemy === 'skeleton')).toHaveLength(1);
  });

  it('探索率100%未満の階では、既知の討伐先を素材計画へ昇格させない', () => {
    const s = newGame(103);
    const { grid, visited } = knowWholeFloor(s, 'forest_cave');
    s.history = [claimedKill('wolf')];
    const omitted = grid.cells.findIndex((cell, i) => cell.kind === 'floor' && i !== grid.entrance);
    if (omitted < 0) throw new Error('テスト用の未踏床がありません');
    s.dungeons.forest_cave.floors.f1.visited = visited.filter((i) => i !== omitted);
    expect(knownMaterialSources(s, 'fang')).toEqual([]);

    s.dungeons.forest_cave.floors.f1.visited = visited;
    expect(knownMaterialSources(s, 'fang')).toEqual([
      { dungeon: 'forest_cave', floor: 'f1', action: 'hunt', item: 'fang', enemy: 'wolf' },
    ]);
  });

  it('鍵がない扉の先や、既知の階段を通れない上階は候補から除外する', () => {
    const s = newGame(104);
    knowWholeFloor(s, 'sunken_ruins');
    expect(knownMaterialSources(s, 'moon_stone')).toEqual([]);
    s.inventory.ruin_key = 1;
    expect(knownMaterialSources(s, 'moon_stone')).toEqual([
      { dungeon: 'sunken_ruins', floor: 'f1', action: 'gather', item: 'moon_stone' },
    ]);

    const tower = knowWholeFloor(s, 'ruined_tower', 'f1');
    knowWholeFloor(s, 'ruined_tower', 'f2');
    expect(knownMaterialSources(s, 'wisp_ember')).toEqual([
      { dungeon: 'ruined_tower', floor: 'f2', action: 'gather', item: 'wisp_ember' },
    ]);
    const stairs = tower.grid.cells.findIndex((cell) => cell.kind === 'stairs_down');
    if (stairs < 0) throw new Error('テスト用の下り階段がありません');
    s.dungeons.ruined_tower.floors.f1.visited = tower.visited.filter((i) => i !== stairs);
    expect(knownMaterialSources(s, 'wisp_ember')).toEqual([]);
  });
});

describe('素材入手先からの派遣下書き', () => {
  it('現行候補を再検証して共通下書きを作り、状態・候補を変更しない', () => {
    const s = newGame(105);
    knowWholeFloor(s, 'forest_cave');
    const herb = source(knownMaterialSources(s, 'herb'), 'gather', 'herb');
    const before = structuredClone(s);

    const draft = draftForMaterial(s, 'herb', herb);
    expect(draft.ok).toBe(true);
    if (!draft.ok) throw new Error(draft.reason);
    expect(draft.order).toEqual({
      partyIds: [], leaderId: '', action: 'gather',
      target: { dungeon: 'forest_cave', floor: 'f1', item: 'herb' },
      policy: 'safe', days: 1, items: {}, blessed: false,
    });
    expect(s).toEqual(before);

    s.dungeons.forest_cave.floors.f1.visited = [];
    expect(draftForMaterial(s, 'herb', herb)).toEqual({
      ok: false,
      reason: 'その素材の入手先は、現在の地図や討伐記録では確認できません',
    });
  });

  it('討伐候補の下書きはstandard方針で、古い候補や在庫を再利用しない', () => {
    const s = newGame(106);
    knowWholeFloor(s, 'forest_cave');
    s.history = [claimedKill('wolf')];
    const wolf = source(knownMaterialSources(s, 'fang'), 'hunt', 'fang');
    const before = structuredClone(s);
    const draft = draftForMaterial(s, 'fang', wolf);
    expect(draft.ok).toBe(true);
    if (!draft.ok) throw new Error(draft.reason);
    expect(draft.order).toEqual({
      partyIds: [], leaderId: '', action: 'hunt',
      target: { dungeon: 'forest_cave', floor: 'f1', enemy: 'wolf' },
      policy: 'standard', days: 1, items: {}, blessed: false,
    });
    expect(s).toEqual(before);

    s.history = [];
    expect(draftForMaterial(s, 'fang', wolf).ok).toBe(false);
  });
});
