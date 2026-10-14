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
import mailTextJson from '../data/mail-text.json';
import trainedSkillsJson from '../data/trained-skills.json';
import returnLinesJson from '../data/return-lines.json';
import uniquesJson from '../data/uniques.json';
import achievementsJson from '../data/achievements.json';
import endingJson from '../data/ending.json';
import type { Aptitude, Gender, Persona, Stats } from './types';
import type { DungeonDef, EnemyDef, FacilityDef, ItemDef, JobDef, PersonalityDef, PolicyDef, RecipeDef, RoleSkillDef, SynergyDef, TraitDef } from './types';
import type { QuestTemplateDef } from './types';
import type { WorldEdgeDef, WorldNodeDef } from './types';
import type { QuestType } from './types';

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
    /** これ以上の推奨戦力のダンジョンでは、探索と日数の経験値が 推奨戦力÷この値 倍になる(深いほど敵が強く得るものが多い) */
    expRefPower: number;
    traitReveal: number;
    returnRelation: number;
    gatherFocusBonus: number;
  };
  growth: {
    /** 次のレベルまでの経験値 = expPerLevel × 今のレベル */
    expPerLevel: number;
    /** 日給 = 10 + (戦力−50)×この値 + (成長率−1)×14。大きいほど育った人の日給が重い */
    wageSlope: number;
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
  quests: {
    /** 依頼報酬の係数。納品=売値合計×、討伐=敵exp×、護衛・運搬=1日あたり */
    deliverPriceMul: number; huntExpMul: number; escortGoldPerDay: number; transportGoldPerDay: number;
  };
  readiness: {
    runs: number;
    /** 余裕 / 適正 / 厳しい の境(戦力比) */
    gradeEdges: number[];
    /** 不確かさ 低 / 中 の境(探索率) */
    uncertaintyEdges: number[];
  };
  game: {
    /** 素材の売却額の倍率(市場の bonus とは別に、全体の相場) */
    sellScale: number;
    /** 施設の維持費の倍率 */
    facilityUpkeepScale: number;
    /** 解体で戻る割合(払った建設費・増築費の合計に掛ける) */
    demolishRefund: number;
    /** 名簿が空で資金がマイナスのとき、借金を帳消しにしてこの額に戻す(再建支援) */
    reliefGold: number;
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
    candidateMax: number;
    /** 初日の候補の人数と、募集が来はじめる日(没落したギルドに最初は人が来ない、を数値で持つ) */
    startCandidates: number;
    candidateFromDay: number;
    candidateDays: number;
    hireSalaryDays: number;
    baseCapacity: number;
  };
  training: {
    days: number;
    gold: number;
    /** 1人が訓練で覚えられる数 */
    maxSkills: number;
  };
  jobs: {
    promotionGold: number;
  };
  mail: {
    /** 日給が再計算値のこの割合未満で昇給要望 */
    raiseThreshold: number;
    /** 保留・断ったあと、次の昇給要望まで空ける日数。未返信もこの日数で保留扱い */
    raiseResendDays: number;
    /** 保留できる回数。これを超えた保留は断る扱い */
    holdMax: number;
    warnLoyalty: number;
    /** 引き留めた直後でも、この忠誠未満なら警告し直す */
    resignLoyalty: number;
    /** 警告からこの日数を過ぎると自己退職 */
    resignDays: number;
    restFatigue: number;
    complaintRelation: number;
    complaintStreak: number;
    /** 「分ける」と返信してから同じ隊に組めない日数 */
    splitDays: number;
    perDay: number;
    /** 受信箱に残す、読んで用の済んだメールの通数。超えた古い分は checkMails の終わりに消す */
    keep: number;
    /** 返信の忠誠の増減(第6節の表) */
    reply: { accept: number; refuse: number; rest: number; deny: number; split: number; keep: number };
  };
  achievements: {
    /** 達成数がこの数に届くごとに経験値ボーナスが1段上がる */
    stages: number[];
    expPerStage: number;
  };
}

/** 訓練で覚える、または固有で持つパッシブ。effectiveStats に特性と同じ段で足す */
export interface TrainedSkillDef { id: string; name: string; desc: string; mods: Partial<Stats> }

export type ReturnOutcome = 'success' | 'retreat' | 'wipe' | 'early';

export interface UniqueChainStep {
  kind: 'deliver' | 'visit' | 'soloKill';
  item?: string; dungeon?: string; enemy?: string; n: number;
  text: string;
}
/**
 * initial: 初日の名簿。story: その章を読み終えた日に名簿へ直接入る(雇用費なし、宿舎の定員を見ない)。
 * minDay・minRep: 条件を満たすと候補一覧に出る
 */
export type UniqueJoin = { initial: true } | { story: string } | { minDay: number; minRep: number };
export interface UniqueDef {
  id: string; name: string; job: string; personality: string; age: number;
  gender: Gender; appearance: string;
  base: Stats; apt: Aptitude; growth: number;
  /** 0 なら雇う時に salaryOf で決める */
  salary: number;
  persona: Persona;
  skill: TrainedSkillDef;
  join: UniqueJoin;
  chain: UniqueChainStep[];
  chainLoyalty: number;
}

export type AchievementCategory = 'manage' | 'dispatch' | 'explore' | 'growth' | 'facility' | 'story';
export type AchievementCondType =
  | 'gold' | 'rep' | 'questsDone' | 'questTypeDone' | 'dispatches'
  | 'dungeonRate' | 'confirmedCount' | 'bossCount'
  | 'roster' | 'levelMax' | 'upperJobs' | 'friends'
  | 'facilities' | 'facilityLv2' | 'synergies'
  | 'flag' | 'flagPrefix' | 'keysHeld' | 'dragon';
/** dungeonRate の n は百分率。flag は n が無ければ真かどうか、あれば値が n 以上か */
export interface AchievementCond { type: AchievementCondType; n?: number; dungeon?: string; questType?: QuestType; flag?: string }
export interface AchievementDef { id: string; category: AchievementCategory; name: string; desc: string; cond: AchievementCond }

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
export const TRAINED_SKILLS = trainedSkillsJson as unknown as TrainedSkillDef[];
/** 性格 → 結果 → 候補の台詞 */
export const RETURN_LINES = returnLinesJson as unknown as Record<string, Record<ReturnOutcome, string[]>>;
export const UNIQUES = uniquesJson as unknown as UniqueDef[];
/** メールの文面。kind × 性格。台詞はフェーズ7で書き直す */
export const MAIL_TEXT = mailTextJson as {
  text: Record<string, Record<string, { subject: string; body: string }>>;
  choices: Record<string, { id: string; label: string }[]>;
};
export const WORLD = worldJson as unknown as { nodes: WorldNodeDef[]; edges: WorldEdgeDef[] };
export const ACHIEVEMENTS = achievementsJson as unknown as AchievementDef[];
/** エンディングの文。フェーズ7で書き直す */
export const ENDING_PAGES = (endingJson as { pages: string[] }).pages;

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
export const UNIQUE = byId(UNIQUES);
export const ACHIEVEMENT = byId(ACHIEVEMENTS);
/** 訓練スキルと固有スキルを合わせた表。effectiveStats はこちらを引く */
export const TRAINED_SKILL = byId([...TRAINED_SKILLS, ...UNIQUES.map((u) => u.skill)]);

export const LOWER_JOBS = JOBS.filter((j) => j.tier === 'lower');
export const UPPER_JOBS = JOBS.filter((j) => j.tier === 'upper');

/** その下級職から転職できる上級職 */
export function upperJobsFrom(lowerId: string): JobDef[] {
  return UPPER_JOBS.filter((j) => j.from?.includes(lowerId));
}
