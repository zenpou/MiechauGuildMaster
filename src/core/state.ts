import { SAVE_VERSION, type GameState } from './types';

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
    dungeons: {},
    quests: [],
    expeditions: [],
    history: [],
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
    flags: {},
  };
}
