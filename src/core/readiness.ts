// 出発前の見込み。既知のマスだけを歩く探索を同じ条件で何度か回し、損耗の目安を出す(DESIGN 第3節)。
// 未踏の中身は見ないので、探索率が低いほど数字は当てにならない。その度合いを uncertainty で示す。
import { powerOf } from './adventurer';
import { bonus } from './base';
import { DUNGEON, TUNING } from './data';
import { exploredRate, parseFloor } from './dungeon';
import { floorTransit, runExploration } from './explore';
import { heldKeys } from './ledger';
import { rngFor } from './rng';
import type { Adventurer, DispatchOrder, GameState } from './types';

export type Grade = '余裕' | '適正' | '厳しい' | '危険';
export type Uncertainty = '低' | '中' | '高';

export interface Readiness {
  runs: number;
  wipeRate: number; retreatRate: number;
  /** 人・派遣あたり */
  avgInjuryDays: number;
  /** 想定戦闘回数 */
  avgFights: number;
  /** 隊の戦力 / ダンジョンの recommended */
  powerRatio: number;
  grade: Grade;
  uncertainty: Uncertainty;
}

const T = TUNING.readiness;
const GRADE_EDGES = T.gradeEdges;
const UNCERTAINTY_EDGES = T.uncertaintyEdges;
const FIGHT_KINDS = ['nest', 'symbol', 'boss', 'encounter'];

export function gradeOf(ratio: number): Grade {
  if (ratio >= GRADE_EDGES[0]) return '余裕';
  if (ratio >= GRADE_EDGES[1]) return '適正';
  if (ratio >= GRADE_EDGES[2]) return '厳しい';
  return '危険';
}

export function uncertaintyOf(rate: number): Uncertainty {
  if (rate >= UNCERTAINTY_EDGES[0]) return '低';
  if (rate >= UNCERTAINTY_EDGES[1]) return '中';
  return '高';
}

/** s は変更しない。dispatch と同じ検証はしないので、出せる指示かは呼び出し側で確かめる */
export function assessReadiness(s: GameState, o: DispatchOrder, runs = T.runs): Readiness {
  const dungeonId = o.target.dungeon ?? '';
  const dungeon = DUNGEON[dungeonId];
  if (!dungeon) throw new Error(`ダンジョン ${dungeonId} が無い`);
  const floorId = o.target.floor ?? 'f1';
  const floorDef = dungeon.floors.find((f) => f.id === floorId);
  if (!floorDef) throw new Error(`${dungeonId}: フロア ${floorId} が無い`);
  const progress = s.dungeons[dungeonId];
  if (!progress) throw new Error(`${dungeonId}: 進捗が無い`);
  const members = o.partyIds.map((id) => s.adventurers.find((a) => a.id === id)).filter((a): a is Adventurer => !!a);
  if (!members.length) throw new Error('隊員がいない');

  let wipes = 0;
  let retreats = 0;
  let injuryDays = 0;
  let fights = 0;
  for (let i = 0; i < runs; i++) {
    const { result, trace } = runExploration({
      rng: rngFor(s.seed, 'forecast', s.counters.dispatches, i),
      dungeon, floorId,
      members: members.map((m) => structuredClone(m)), leaderId: o.leaderId, policy: o.policy,
      progress, days: o.days, items: { ...(o.items ?? {}) }, relations: s.relations, startDay: s.day,
      action: o.action, target: { item: o.target.item, enemy: o.target.enemy }, knownOnly: true,
      keys: heldKeys(s), transit: floorTransit(dungeon, floorId, progress, heldKeys(s)) ?? 0,
      hiddenBonus: bonus(s, 'hiddenFind'),
    });
    if (result.wiped) wipes++;
    if (result.retreated) retreats++;
    injuryDays += Object.values(result.injuries).reduce((t, n) => t + n, 0);
    fights += trace.events.filter((e) => FIGHT_KINDS.includes(e.kind)).length;
  }
  const n = Math.max(1, runs);
  const powerRatio = members.reduce((t, m) => t + powerOf(m), 0) / dungeon.recommended;
  const rate = exploredRate(parseFloor(floorDef), progress.floors[floorId]?.visited ?? []);
  return {
    runs,
    wipeRate: wipes / n, retreatRate: retreats / n,
    avgInjuryDays: injuryDays / (members.length * n),
    avgFights: fights / n,
    powerRatio, grade: gradeOf(powerRatio), uncertainty: uncertaintyOf(rate),
  };
}
