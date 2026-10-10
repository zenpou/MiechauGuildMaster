import jobsJson from '../data/jobs.json';
import personalitiesJson from '../data/personalities.json';
import traitsJson from '../data/traits.json';
import policiesJson from '../data/policies.json';
import enemiesJson from '../data/enemies.json';
import itemsJson from '../data/items.json';
import dungeonsJson from '../data/dungeons.json';
import skillsJson from '../data/skills.json';
import namesJson from '../data/names.json';
import personaJson from '../data/persona.json';
import tuningJson from '../data/tuning.json';
import facilitiesJson from '../data/facilities.json';
import synergiesJson from '../data/synergies.json';
import recipesJson from '../data/recipes.json';
import questTemplatesJson from '../data/quest-templates.json';
import misunderstandingsJson from '../data/misunderstandings.json';
import worldJson from '../data/world.json';
import type { DungeonDef, EnemyDef, FacilityDef, ItemDef, JobDef, PersonalityDef, PolicyDef, RecipeDef, RoleSkillDef, SynergyDef, TraitDef } from './types';
import type { QuestTemplateDef } from './types';
import type { WorldEdgeDef, WorldNodeDef } from './types';

/** sim で調整する値。中身は src/data/tuning.json */
export interface Tuning {
  explore: {
    baseSteps: number;
    costKnown: number;
    costUnknown: number;
    restSteps: number;
    restHeal: number;
    restMaxPerDay: number;
    campHeal: number;
    campFatigue: number;
    dayFatigue: number;
    combatFatigue: number;
    trapFatigue: number;
    trapDamage: [number, number];
    trapBase: number;
    trapDexScale: number;
    treasureGold: [number, number];
    treasureTrap: number;
    gatherBase: number;
    gatherScale: number;
    gatherQty: [number, number];
    hiddenBase: number;
    hiddenScale: number;
    nestGroup: [number, number];
    defaultEncounter: number;
    detourBonus: number;
    detourBonusKnown: number;
    scoreNoise: number;
    forkNeighbors: number;
    forkTop: number;
    injuredHp: number;
    reviveHp: number;
    retreatTired: number;
    retreatTiredAdd: number;
    fleeRatio: number;
    injuryLowHp: number;
    injuryLowDays: [number, number];
    injuryDownDays: [number, number];
    wipeInjuryDays: [number, number];
    expPerCell: number;
    expPerDay: number;
    traitReveal: number;
    returnRelation: number;
    gatherFocusBonus: number;
  };
  combat: {
    /** 被ダメージ = 攻撃×倍率 − 守備×defScale。大きいほど守備(防具)が効く */
    defScale: number;
  };
  equipment: {
    /** 装備の耐性合計の上限 */
    resistCap: number;
  };
  craft: {
    /** 勤務者の能力がこれ以上なら完成日数−1 */
    workerStatMin: number;
  };
  readiness: {
    runs: number;
    /** 余裕 / 適正 / 厳しい の境(戦力比) */
    gradeEdges: number[];
    /** 不確かさ 低 / 中 の境(探索率) */
    uncertaintyEdges: number[];
  };
  game: {
    startGold: number;
    startPotions: number;
    upkeepPerDay: number;
    startApt: number;
    debtInterest: number;
    debtLoyalty: number;
    debtRep: number;
    restFatigue: number;
    dailyLoyalty: number;
    loyaltySuccess: number;
    loyaltyInjured: number;
    loyaltyWipe: number;
    daysMax: number;
    supportGold: number;
    supportDays: number;
  };
}

const byId = <T extends { id: string }>(arr: T[]): Record<string, T> => Object.fromEntries(arr.map((x) => [x.id, x]));

export const JOBS = jobsJson as unknown as JobDef[];
export const PERSONALITIES = personalitiesJson as unknown as PersonalityDef[];
export const TRAITS = traitsJson as unknown as TraitDef[];
export const POLICIES = policiesJson as unknown as PolicyDef[];
export const ENEMIES = enemiesJson as unknown as EnemyDef[];
export const ITEMS = itemsJson as unknown as ItemDef[];
export const DUNGEONS = dungeonsJson as unknown as DungeonDef[];
export const ROLE_SKILLS = skillsJson as unknown as RoleSkillDef[];
export const NAMES = namesJson as { given: string[] };
export const PERSONA = personaJson as { hobby: string[]; talent: string[]; likes: string[]; dislikes: string[] };
export const TUNING = tuningJson as Tuning;
export const FACILITIES = facilitiesJson as unknown as FacilityDef[];
export const SYNERGIES = synergiesJson as unknown as SynergyDef[];
export const RECIPES = recipesJson as unknown as RecipeDef[];
export const QUEST_TEMPLATES = questTemplatesJson as unknown as QuestTemplateDef[];
/** 勘違いイベント(行動タグ→噂→評判)。台詞はフェーズ4では仮 */
export const MISUNDERSTANDINGS = misunderstandingsJson as { id: string; tag: string; rep: number; scene: string[]; thought: string }[];
export const WORLD = worldJson as unknown as { nodes: WorldNodeDef[]; edges: WorldEdgeDef[] };

export const JOB = byId(JOBS);
export const PERSONALITY = byId(PERSONALITIES);
export const TRAIT = byId(TRAITS);
export const POLICY = byId(POLICIES);
export const ENEMY = byId(ENEMIES);
export const ITEM = byId(ITEMS);
export const DUNGEON = byId(DUNGEONS);
export const ROLE_SKILL = byId(ROLE_SKILLS);
export const FACILITY = byId(FACILITIES);
export const RECIPE = byId(RECIPES);
export const QUEST_TEMPLATE = byId(QUEST_TEMPLATES);
export const NODE = byId(WORLD.nodes);
export const EDGE = byId(WORLD.edges);

export const LOWER_JOBS = JOBS.filter((j) => j.tier === 'lower');
export const UPPER_JOBS = JOBS.filter((j) => j.tier === 'upper');

/** その下級職から転職できる上級職 */
export function upperJobsFrom(lowerId: string): JobDef[] {
  return UPPER_JOBS.filter((j) => j.from?.includes(lowerId));
}
