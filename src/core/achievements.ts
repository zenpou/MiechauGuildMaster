import { activeSynergies } from './base';
import { ACHIEVEMENT, ACHIEVEMENTS, ITEM, JOB, TUNING, type AchievementCond } from './data';
import { dungeonRate } from './quests';
import type { GameState } from './types';

export interface AchievementProgress { value: number; target: number }

function truthyFlags(s: GameState, prefix: string): number {
  return Object.entries(s.flags).filter(([k, v]) => k.startsWith(prefix) && v).length;
}

function measure(s: GameState, c: AchievementCond): AchievementProgress {
  const target = c.n ?? 1;
  switch (c.type) {
    case 'gold': return { value: s.gold, target };
    case 'rep': return { value: s.rep, target };
    case 'questsDone': return { value: s.quests.filter((q) => q.status === 'done').length, target };
    case 'questTypeDone': return { value: s.quests.filter((q) => q.status === 'done' && q.type === c.questType).length, target };
    case 'dispatches': return { value: s.counters.dispatches, target };
    // 割り算の誤差で 29% が 28% に落ちないよう、わずかに足してから切り捨てる
    case 'dungeonRate': return { value: Math.floor(dungeonRate(s, c.dungeon ?? '') * 100 + 1e-9), target };
    case 'confirmedCount': return { value: Object.values(s.dungeons).filter((d) => d.confirmed).length, target };
    case 'bossCount': return { value: Object.values(s.dungeons).filter((d) => d.bossDefeated > 0).length, target };
    case 'roster': return { value: s.adventurers.length, target };
    case 'levelMax': return { value: Math.max(0, ...s.adventurers.map((a) => a.level)), target };
    case 'upperJobs': return { value: s.adventurers.filter((a) => JOB[a.job]?.tier === 'upper').length, target };
    case 'friends': return { value: truthyFlags(s, 'friends:'), target };
    case 'facilities': return { value: s.base.facilities.filter((f) => f.level >= 1).length, target };
    case 'facilityLv2': return { value: s.base.facilities.filter((f) => f.level >= 2).length, target };
    case 'synergies': return { value: activeSynergies(s).length, target };
    case 'flag': {
      const v = s.flags[c.flag ?? ''];
      return c.n === undefined ? { value: v ? 1 : 0, target: 1 } : { value: Number(v ?? 0), target };
    }
    case 'flagPrefix': return { value: truthyFlags(s, c.flag ?? ''), target };
    case 'keysHeld': return { value: Object.entries(s.inventory).filter(([id, q]) => q > 0 && ITEM[id]?.kind === 'key').length, target };
    case 'dragon': return { value: s.dragonDefeated ? 1 : 0, target: 1 };
  }
}

/** 新しく達成した実績を s.achievements に足し、そのIDを返す。一度達成したものは条件を外れても消さない */
export function checkAchievements(s: GameState, notices: string[]): string[] {
  const added: string[] = [];
  const stageBefore = achievementStage(s);
  for (const def of ACHIEVEMENTS) {
    if (s.achievements.includes(def.id)) continue;
    const p = measure(s, def.cond);
    if (p.value < p.target) continue;
    s.achievements.push(def.id);
    added.push(def.id);
    notices.push(`実績『${def.name}』を達成した。`);
  }
  // 経験値ボーナスは表に出ない効果なので、段が上がったことを知らせる(隠さない方針)
  const stageAfter = achievementStage(s);
  if (stageAfter > stageBefore) {
    notices.push(`実績ボーナスが${stageAfter}段になった(経験値+${Math.round(TUNING.achievements.expPerStage * stageAfter * 100)}%)。`);
  }
  return added;
}

export function achievementProgress(s: GameState, id: string): AchievementProgress {
  const def = ACHIEVEMENT[id];
  return def ? measure(s, def.cond) : { value: 0, target: 1 };
}

/** 0〜4。セーブに残った、今は無い実績は数えない */
export function achievementStage(s: GameState): number {
  const count = s.achievements.filter((id) => ACHIEVEMENT[id]).length;
  return TUNING.achievements.stages.filter((n) => count >= n).length;
}

export function achievementExpMult(s: GameState): number {
  return 1 + TUNING.achievements.expPerStage * achievementStage(s);
}
