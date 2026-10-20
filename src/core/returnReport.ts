import { DUNGEON, DUNGEONS } from './data';
import { exploredRate, parseFloor } from './dungeon';
import { floorTransit } from './explore';
import { heldKeys } from './ledger';
import type {
  Adventurer, Expedition, ExpeditionReturnReport, GameState, ReturnFloorReport, ReturnMemberReport,
} from './types';

/** applyReturn の前後を比較するための、保存しない内部スナップショット。 */
export interface ReturnStateSnapshot {
  members: Array<ReturnMemberReport & { injuryDaysBefore: number }>;
  floors: Record<string, {
    dungeon: string;
    floor: string;
    visited: number[];
    hiddenFound: number[];
    rate: number;
  }>;
  confirmedDungeons: Record<string, boolean>;
  keys: string[];
  transit: Record<string, number | null>;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonNegativeInt = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

function ints(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(nonNegativeInt))];
}

function memberReport(a: Adventurer): ReturnMemberReport & { injuryDaysBefore: number } {
  const out: ReturnMemberReport & { injuryDaysBefore: number } = {
    id: a.id,
    name: a.name,
    appearance: a.appearance,
    personality: a.personality,
    gender: a.gender,
    levelBefore: a.level,
    levelAfter: a.level,
    fatigueBefore: a.fatigue,
    fatigueAfter: a.fatigue,
    injuryDays: a.injuryDays,
    injuryDaysBefore: a.injuryDays,
  };
  if (a.unique !== undefined) out.unique = a.unique;
  return out;
}

function dungeonFloorState(s: GameState, dungeonId: string, floorId: string) {
  const def = DUNGEON[dungeonId]?.floors.find((f) => f.id === floorId);
  const progress = s.dungeons[dungeonId]?.floors?.[floorId];
  const visited = ints(progress?.visited);
  const hiddenFound = ints(progress?.hiddenFound);
  let rate = 0;
  if (def) {
    try { rate = exploredRate(parseFloor(def), visited); } catch { rate = 0; }
  }
  return { dungeon: dungeonId, floor: floorId, visited, hiddenFound, rate };
}

function transitOf(s: GameState, dungeonId: string, floorId: string, keys: string[]): number | null {
  const dungeon = DUNGEON[dungeonId];
  const progress = s.dungeons[dungeonId];
  if (!dungeon || !progress) return null;
  try { return floorTransit(dungeon, floorId, progress, keys); } catch { return null; }
}

function keyFor(dungeon: string, floor: string): string {
  return `${dungeon}:${floor}`;
}

/**
 * 帰還処理の直前に呼ぶ。ここで読むのは s の現在値だけで、結果や RNG は変更しない。
 * 同日に複数隊が帰還する場合も、先に適用された隊の地図が次の before に入る。
 */
export function captureReturnState(s: GameState, e: Expedition): ReturnStateSnapshot {
  const partyIds = Array.isArray(e.order?.partyIds) ? e.order.partyIds : [];
  const members = partyIds
    .map((id) => s.adventurers.find((a) => a.id === id))
    .filter((a): a is Adventurer => !!a)
    .map(memberReport);
  const keys = heldKeys(s).sort();
  const floors: ReturnStateSnapshot['floors'] = {};
  const transit: ReturnStateSnapshot['transit'] = {};
  for (const dungeon of DUNGEONS) {
    for (const floor of dungeon.floors) {
      const state = dungeonFloorState(s, dungeon.id, floor.id);
      floors[keyFor(dungeon.id, floor.id)] = state;
      transit[keyFor(dungeon.id, floor.id)] = transitOf(s, dungeon.id, floor.id, keys);
    }
  }
  const confirmedDungeons = Object.fromEntries(DUNGEONS.map((d) => [d.id, !!s.dungeons[d.id]?.confirmed]));
  return { members, floors, confirmedDungeons, keys, transit };
}

function validMemberReport(value: unknown): value is ReturnMemberReport {
  if (!isObject(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.appearance !== 'string' || typeof value.personality !== 'string') return false;
  if (value.gender !== 'male' && value.gender !== 'female') return false;
  if (value.unique !== undefined && typeof value.unique !== 'string') return false;
  return [value.levelBefore, value.levelAfter, value.fatigueBefore, value.fatigueAfter, value.injuryDays].every((n) => finite(n) && n >= 0);
}

function validFloorReport(value: unknown): value is ReturnFloorReport {
  if (!isObject(value) || typeof value.dungeon !== 'string' || typeof value.floor !== 'string') return false;
  if (!finite(value.rateBefore) || value.rateBefore < 0 || value.rateBefore > 1) return false;
  if (!finite(value.rateAfter) || value.rateAfter < 0 || value.rateAfter > 1) return false;
  if (!nonNegativeInt(value.newCells) || !Array.isArray(value.newlyDiscoveredGather)) return false;
  return value.newlyDiscoveredGather.every((g) => isObject(g) && nonNegativeInt(g.cell) && typeof g.item === 'string');
}

/** 任意のセーブに入っていた報告を検証する。壊れていれば遠征本体を捨てずに削除する。 */
export function isReturnReport(value: unknown): value is ExpeditionReturnReport {
  if (!isObject(value) || value.version !== 1) return false;
  if (!Array.isArray(value.members) || !value.members.every(validMemberReport)) return false;
  if (!Array.isArray(value.floors) || !value.floors.every(validFloorReport)) return false;
  if (!Array.isArray(value.unlockedFloors) || !value.unlockedFloors.every((f) => isObject(f) && typeof f.dungeon === 'string' && typeof f.floor === 'string')) return false;
  if (!Array.isArray(value.confirmedDungeons) || !value.confirmedDungeons.every((id) => typeof id === 'string')) return false;
  if (!Array.isArray(value.newKeys) || !value.newKeys.every((id) => typeof id === 'string')) return false;
  return true;
}

function mapDeltaKeys(e: Expedition): Set<string> {
  const out = new Set<string>();
  for (const d of e.result?.mapDeltas ?? []) {
    if (typeof d?.dungeon !== 'string' || typeof d.floor !== 'string') continue;
    out.add(keyFor(d.dungeon, d.floor));
  }
  return out;
}

function changedCells(before: number[], after: number[]): number[] {
  const old = new Set(before);
  return after.filter((cell) => !old.has(cell));
}

/** applyReturn 完了直前に呼び、結果を保存用の小さな報告にする。 */
export function finishReturnReport(s: GameState, e: Expedition, before: ReturnStateSnapshot): ExpeditionReturnReport {
  const members: ReturnMemberReport[] = before.members.map((old) => {
    const current = s.adventurers.find((a) => a.id === old.id);
    return {
      id: old.id,
      name: old.name,
      ...(old.unique === undefined ? {} : { unique: old.unique }),
      appearance: old.appearance,
      personality: old.personality,
      gender: old.gender,
      levelBefore: old.levelBefore,
      levelAfter: current?.level ?? old.levelBefore,
      fatigueBefore: old.fatigueBefore,
      fatigueAfter: current?.fatigue ?? old.fatigueBefore,
      injuryDays: current?.injuryDays ?? old.injuryDaysBefore,
    };
  });

  const floors: ReturnFloorReport[] = [];
  const keys = new Set([...Object.keys(before.floors), ...mapDeltaKeys(e)]);
  for (const id of keys) {
    const [dungeon, floor] = id.split(':');
    if (!dungeon || !floor || !DUNGEON[dungeon]?.floors.some((f) => f.id === floor)) continue;
    const old = before.floors[id] ?? dungeonFloorState(s, dungeon, floor);
    const current = dungeonFloorState(s, dungeon, floor);
    const fresh = changedCells(old.visited, current.visited);
    const hiddenChanged = changedCells(old.hiddenFound, current.hiddenFound);
    const touched = mapDeltaKeys(e).has(id);
    if (!touched && fresh.length === 0 && hiddenChanged.length === 0 && old.rate === current.rate) continue;
    const grid = parseFloor(DUNGEON[dungeon].floors.find((f) => f.id === floor)!);
    const newlyDiscoveredGather = fresh
      .map((cell) => ({ cell, def: grid.cells[cell] }))
      .filter((x) => x.def?.kind === 'gather' && typeof x.def.item === 'string')
      .map((x) => ({ cell: x.cell, item: x.def.item! }));
    floors.push({
      dungeon, floor, rateBefore: old.rate, rateAfter: current.rate,
      newCells: fresh.length, newlyDiscoveredGather,
    });
  }

  const keysAfter = new Set(heldKeys(s));
  const newKeys = [...keysAfter].filter((id) => !before.keys.includes(id)).sort();
  const confirmedDungeons = DUNGEONS
    .filter((d) => !before.confirmedDungeons[d.id] && !!s.dungeons[d.id]?.confirmed)
    .map((d) => d.id);
  const unlockedFloors: { dungeon: string; floor: string }[] = [];
  for (const dungeon of DUNGEONS) {
    for (const floor of dungeon.floors) {
      const id = keyFor(dungeon.id, floor.id);
      const oldTransit = before.transit[id] ?? null;
      const currentTransit = transitOf(s, dungeon.id, floor.id, [...keysAfter]);
      if (oldTransit === null && currentTransit !== null) unlockedFloors.push({ dungeon: dungeon.id, floor: floor.id });
    }
  }
  return { version: 1, members, floors, unlockedFloors, confirmedDungeons, newKeys };
}
