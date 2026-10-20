// 初回の森の洞窟だけに使う、安全な導入行程の判定と経路計画。
// 状態を変更せず、乱数も消費しない。実際の移動・採取・帰還処理は explore.ts に任せる。
import { DUNGEON, TUNING } from './data';
import { isPassable, parseFloor, shortestPath, type PassKnowledge } from './dungeon';
import type { DispatchOrder, GameState } from './types';

export interface IntroExplorationPlan {
  route: number[];
  days: 1;
  description: string;
}

const INTRO_DUNGEON = 'forest_cave';
const INTRO_FLOOR = 'f1';
const INTRO_ITEM = 'herb';

/**
 * 初回のティナ/セラによる森の洞窟入口確認を、導入用の短い行程として扱えるか。
 * 「初回」は dispatch の成功ではなく、まだ派遣状態を消費していないことから判定する。
 */
export function isIntroExploration(s: GameState, o: DispatchOrder): boolean {
  if (!s || !o || typeof o !== 'object') return false;
  if (s.counters?.dispatches !== 0) return false;
  if ((s.history?.length ?? 0) !== 0 || (s.expeditions?.length ?? 0) !== 0) return false;
  if (o.action !== 'explore' || !Array.isArray(o.partyIds) || o.partyIds.length < 1 || o.partyIds.length > 2) return false;
  if (new Set(o.partyIds).size !== o.partyIds.length) return false;
  if (o.target?.dungeon !== INTRO_DUNGEON || (o.target.floor ?? INTRO_FLOOR) !== INTRO_FLOOR) return false;
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > TUNING.game.daysMax) return false;
  if (s.flags?.['story:ch1'] !== undefined && s.flags['story:ch1'] !== false) return false;

  const members = o.partyIds.map((id) => s.adventurers?.find((a) => a.id === id));
  if (members.some((member) => !member || (member.unique !== 'tina' && member.unique !== 'sera'))) return false;
  if (!o.partyIds.includes(o.leaderId)) return false;
  const progress = s.dungeons?.[INTRO_DUNGEON]?.floors?.[INTRO_FLOOR];
  if (!progress || !Array.isArray(progress.visited) || !Array.isArray(progress.hiddenFound)
    || progress.visited.length !== 0 || progress.hiddenFound.length !== 0) return false;
  return true;
}

/** 初回導入用の、入口から最寄りの薬草採取点までの短い安全経路。 */
export function getIntroExploration(s: GameState, o: DispatchOrder): IntroExplorationPlan | null {
  if (!isIntroExploration(s, o)) return null;
  const dungeon = DUNGEON[INTRO_DUNGEON];
  const floor = dungeon.floors.find((f) => f.id === INTRO_FLOOR);
  const progress = s.dungeons[INTRO_DUNGEON]?.floors[INTRO_FLOOR];
  if (!floor || !progress) return null;
  const grid = parseFloor(floor);
  const safe = new Set<number>();
  const herbs: number[] = [];
  for (let i = 0; i < grid.cells.length; i++) {
    const cell = grid.cells[i];
    if (cell.kind === 'floor' || cell.kind === 'entrance') safe.add(i);
    if (cell.kind === 'gather' && cell.item === INTRO_ITEM) {
      safe.add(i);
      herbs.push(i);
    }
  }
  // 入口確認直後なので鍵や隠し通路は無い。safe に含めた既知の候補だけを BFS する。
  const know: PassKnowledge = { keys: [], hiddenFound: [] };
  let selected: number[] | null = null;
  for (const herb of herbs.sort((a, b) => a - b)) {
    const route = shortestPath(grid, grid.entrance, herb, safe, know);
    if (!route || route.some((i) => !isPassable(grid, i, know))) continue;
    if (!selected || route.length < selected.length) selected = route;
  }
  if (!selected || selected.length < 2) return null;
  return {
    route: selected,
    days: 1,
    description: '入口近くの薬草を一つ採り、帰路を確認する。',
  };
}

/** explore.ts が導入計画を受け取る際に使う固定の採取対象。 */
export const introExplorationItem = INTRO_ITEM;
