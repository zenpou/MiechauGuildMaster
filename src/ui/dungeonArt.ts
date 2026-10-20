import type { CellDef } from '../core/types';
import { div, h } from './dom';
import './dungeonArt.css';

export interface DungeonTheme {
  row: number;
  color: string;
  ground: string;
  mood: string;
}

/** 地形・資源・敵は既存データのまま。素材と色で場所を見分ける。 */
export const DUNGEON_THEMES: Record<string, DungeonTheme> = {
  forest_cave: { row: 0, color: '#96ba76', ground: '#263524', mood: '木の根と苔が覆う、森の奥の洞窟' },
  old_mine: { row: 1, color: '#d3aa72', ground: '#372b21', mood: '枕木と鉱脈が残る、忘れられた坑道' },
  ruined_tower: { row: 2, color: '#b6bdcf', ground: '#292e39', mood: '割れた石畳と崩れた壁をたどる古塔' },
  frost_valley: { row: 3, color: '#a5e1f4', ground: '#233f4c', mood: '雪の道を青い氷壁が囲む谷底' },
  sunken_ruins: { row: 4, color: '#75d4c1', ground: '#183d3c', mood: '浅瀬と水苔に沈む古代の石造遺跡' },
  dragon_lair: { row: 5, color: '#f4a16b', ground: '#42261f', mood: '熾火が走る黒い岩盤と竜の洞穴' },
};
export const TERRAIN_ATLAS = 'tiles/dungeon-terrain-v1.png';
// 原画は1024×1536。区画の境目を除いた224px四方を使い、他の素材を混ぜない。
const ROW_Y = [6, 242, 478, 715, 960, 1255];
const COL_X = [16, 272, 528, 784];
export const artPath = (path: string) => `${import.meta.env.BASE_URL}art/${path}`;
export const dungeonTheme = (id: string) => DUNGEON_THEMES[id] ?? DUNGEON_THEMES.forest_cave;

export function terrainStyle(theme: DungeonTheme, wall: boolean, index: number): string {
  const col = (wall ? 2 : 0) + (index % 7 === 2 ? 1 : 0);
  return `background-image:url("${artPath(TERRAIN_ATLAS)}");background-size:${1024 / 224 * 100}% ${1536 / 224 * 100}%;background-position:${COL_X[col] / 800 * 100}% ${ROW_Y[theme.row] / 1312 * 100}%`;
}

const MARK: Record<string, string> = {
  entrance: '入', gather: '採', nest: '巣', symbol: '主', boss: '主', treasure: '宝', trap: '罠',
  hidden: '隠', door: '扉', stairs_down: '下', stairs_up: '上',
};

export interface TerrainKnowledge {
  known: boolean;
  visited: boolean;
  hidden: boolean;
  recent?: boolean;
  keys?: readonly string[];
}

export function terrainCell(theme: DungeonTheme, cell: CellDef, index: number, k: TerrainKnowledge): HTMLElement {
  if (!k.known) return div('terrain-cell terrain-unknown', { 'aria-hidden': 'true' });
  const wall = cell.kind === 'wall' || (cell.kind === 'hidden' && !k.hidden);
  const open = cell.kind === 'door' && cell.key && k.keys?.includes(cell.key);
  const mark = wall ? '' : cell.kind === 'treasure' && cell.item ? '鍵' : MARK[cell.kind] ?? '';
  return div(`terrain-cell ${wall ? 'terrain-wall' : 'terrain-floor'} ${k.visited ? 'terrain-visited' : 'terrain-seen'}${k.recent ? ' terrain-recent' : ''}`,
    { style: terrainStyle(theme, wall, index), 'aria-hidden': 'true' },
    mark ? h('span', { class: `terrain-mark terrain-${cell.kind}${open ? ' terrain-open' : ''}` }, mark) : null,
  );
}
