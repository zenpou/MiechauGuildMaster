import { DUNGEONS } from './data';
import { SAVE_VERSION, type DungeonProgress, type GameState } from './types';

/** 最初から入口が分かっているダンジョン。他は噂だけで、踏査で確認する */
const CONFIRMED_AT_START = ['forest_cave'];

export function initialDungeonProgress(dungeonId: string): DungeonProgress {
  const def = DUNGEONS.find((d) => d.id === dungeonId);
  const floors = Object.fromEntries((def?.floors ?? []).map((f) => [f.id, { visited: [], hiddenFound: [] }]));
  return { confirmed: CONFIRMED_AT_START.includes(dungeonId), floors, bossDefeated: 0, fullCleared: false };
}

/** 全ダンジョンの初期進捗 */
export function initialDungeons(): Record<string, DungeonProgress> {
  return Object.fromEntries(DUNGEONS.map((d) => [d.id, initialDungeonProgress(d.id)]));
}

/** 何も持たない初期状態。初期資金・初期メンバーなどはフェーズ1以降で game.ts の newGame が足す */
export function emptyState(seed: number, playerName = ''): GameState {
  return {
    version: SAVE_VERSION,
    playerName,
    seed, day: 1, gold: 0, rep: 0,
    adventurers: [],
    candidates: [],
    relations: {},
    base: { width: 5, height: 5, facilities: [] },
    inventory: {},
    crafts: [],
    world: { visitedNodes: [], foundEdges: [], measuredDanger: {} },
    dungeons: initialDungeons(),
    quests: [],
    expeditions: [],
    history: [],
    partyPlans: [],
    mails: [],
    achievements: [],
    scenes: [],
    seenScenes: [],
    ledger: [],
    notices: [],
    counters: { nextId: 1, dispatches: 0 },
    pendingTags: [],
    repMilestones: [],
    debt: false,
    dragonDefeated: false,
    dragonVictory: null,
    blessing: { charges: 0, feverUntil: null, fullSince: null },
    flags: {},
  };
}
