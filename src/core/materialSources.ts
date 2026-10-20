// 現在の地図と帰還履歴だけから、素材の次の入手先を導出する。
// 在庫・乱数・保存データは変更しない。履歴の上限で古い討伐知識は消え得るため、
// 現在 history に残っている claimed 済みの討伐だけを既知情報として扱う。
import { DUNGEON, DUNGEONS, ENEMY, ITEM } from './data';
import { exploredRate, parseFloor, shortestPath, type Grid, type PassKnowledge } from './dungeon';
import { draftFromOrder, type ExpeditionDraft } from './expeditionPlan';
import { floorTransit } from './explore';
import { heldKeys } from './ledger';
import type { DispatchOrder, DungeonProgress, GameState } from './types';

export interface MaterialSource {
  dungeon: string;
  floor: string;
  action: 'gather' | 'hunt';
  item: string;
  enemy?: string;
}

const FIGHT_KINDS = new Set(['nest', 'symbol', 'boss']);
const fail = (reason: string): ExpeditionDraft => ({ ok: false, reason });

interface KnownFloor {
  grid: Grid;
  visited: Set<number>;
  know: PassKnowledge;
}

function asVisited(progress: DungeonProgress | undefined, floorId: string, grid: Grid): KnownFloor | null {
  const floor = progress?.floors?.[floorId];
  if (!floor || !Array.isArray(floor.visited)) return null;
  const visited = new Set(floor.visited.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < grid.cells.length));
  const hiddenFound = Array.isArray(floor.hiddenFound)
    ? floor.hiddenFound.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < grid.cells.length)
    : [];
  return { grid, visited, know: { keys: [], hiddenFound } };
}

function reachableFromEntrance(floor: KnownFloor, keys: string[], cell: number): boolean {
  if (!floor.visited.has(floor.grid.entrance) || !floor.visited.has(cell)) return false;
  return shortestPath(
    floor.grid,
    floor.grid.entrance,
    cell,
    floor.visited,
    { keys, hiddenFound: floor.know.hiddenFound },
  ) !== null;
}

function floorKnowledge(s: GameState, dungeonId: string, floorId: string, keys: string[]): KnownFloor | null {
  const dungeon = DUNGEON[dungeonId];
  const progress = s.dungeons?.[dungeonId];
  const floorDef = dungeon?.floors.find((f) => f.id === floorId);
  if (!dungeon || !progress || progress.confirmed !== true || !floorDef) return null;
  try {
    // 上階の階段・扉も含め、実際に今の鍵で通過できるかを共通判定に揃える。
    if (floorTransit(dungeon, floorId, progress, keys) === null) return null;
    const grid = parseFloor(floorDef);
    const known = asVisited(progress, floorId, grid);
    if (!known) return null;
    known.know.keys = [...keys];
    return known;
  } catch {
    return null;
  }
}

function killedEnemies(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const expedition of Array.isArray(s.history) ? s.history : []) {
    if (expedition?.claimed !== true) continue;
    const kills = expedition.result?.kills;
    if (!kills || typeof kills !== 'object') continue;
    for (const [enemy, n] of Object.entries(kills)) {
      if (ENEMY[enemy] && Number.isInteger(n) && n > 0) out.add(enemy);
    }
  }
  return out;
}

function sourceKey(source: MaterialSource): string {
  return `${source.dungeon}:${source.floor}:${source.action}:${source.item}:${source.enemy ?? ''}`;
}

/** 素材ごとに、現在の知識で実際に到達できる採取点・討伐先を返す。 */
export function knownMaterialSources(s: GameState, itemId: string): MaterialSource[] {
  if (!s || typeof itemId !== 'string' || !ITEM[itemId] || ITEM[itemId].kind !== 'material') return [];
  const keys = heldKeys(s);
  const killed = killedEnemies(s);
  const out: MaterialSource[] = [];
  const seen = new Set<string>();
  const add = (source: MaterialSource) => {
    const key = sourceKey(source);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(source);
  };

  for (const dungeon of DUNGEONS) {
    if (!dungeon || typeof dungeon.id !== 'string') continue;
    for (const floorDef of dungeon.floors ?? []) {
      if (!floorDef || typeof floorDef.id !== 'string') continue;
      const floor = floorKnowledge(s, dungeon.id, floorDef.id, keys);
      if (!floor) continue;

      for (let i = 0; i < floor.grid.cells.length; i++) {
        const cell = floor.grid.cells[i];
        if (cell.kind === 'gather' && cell.item === itemId && reachableFromEntrance(floor, keys, i)) {
          add({ dungeon: dungeon.id, floor: floorDef.id, action: 'gather', item: itemId });
        }
      }

      // 討伐対象の指定は、派遣画面と game.checkAction の契約上、
      // その階の探索率が100%になってから提示する。既知の敵情報だけで
      // 未探索の階を討伐候補へ昇格させない。
      if (exploredRate(floor.grid, [...floor.visited]) < 1) continue;
      for (let i = 0; i < floor.grid.cells.length; i++) {
        const cell = floor.grid.cells[i];
        if (!FIGHT_KINDS.has(cell.kind) || !cell.enemy || !killed.has(cell.enemy)) continue;
        const enemy = ENEMY[cell.enemy];
        if (!enemy?.loot?.some((loot) => loot.item === itemId) || !reachableFromEntrance(floor, keys, i)) continue;
        add({ dungeon: dungeon.id, floor: floorDef.id, action: 'hunt', item: itemId, enemy: cell.enemy });
      }
    }
  }
  return out;
}

function sameSource(a: MaterialSource, b: MaterialSource): boolean {
  return a.dungeon === b.dungeon && a.floor === b.floor && a.action === b.action
    && a.item === b.item && a.enemy === b.enemy;
}

/** 現在も有効な入手先だけを再検証し、UIで隊員を選べる空の下書きを返す。 */
export function draftForMaterial(s: GameState, itemId: string, source: MaterialSource): ExpeditionDraft {
  if (!source || typeof source !== 'object') return fail('素材の入手先が不正です');
  const current = knownMaterialSources(s, itemId);
  if (!current.some((candidate) => sameSource(candidate, source))) return fail('その素材の入手先は、現在の地図や討伐記録では確認できません');

  const target: DispatchOrder['target'] = {
    dungeon: source.dungeon,
    floor: source.floor,
    ...(source.action === 'gather' ? { item: itemId } : { enemy: source.enemy }),
  };
  const order: DispatchOrder = {
    partyIds: [], leaderId: '', action: source.action, target,
    policy: source.action === 'gather' ? 'safe' : 'standard', days: 1, items: {}, blessed: false,
  };
  try {
    return draftFromOrder(s, order);
  } catch {
    return fail('その素材の入手先は、現在のデータでは準備できません');
  }
}
