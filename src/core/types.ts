// 見えちゃうギルドマスター 型定義
// 設計の正本は docs/DESIGN.md。数値はここに書かず src/data/*.json に置く。
// GameState に項目を足すときは save.ts の既定値も書く(セーブ互換)。

// ---- 能力(8) ----
export type StatKey = 'hp' | 'atk' | 'def' | 'mag' | 'spd' | 'dex' | 'scout' | 'gather';
export type Stats = Record<StatKey, number>;
export const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'mag', 'spd', 'dex', 'scout', 'gather'];
export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP', atk: '腕力', def: '守備', mag: '魔力', spd: '素早さ', dex: '器用さ', scout: '探索', gather: '採取',
};

// ---- 役割(5)と適性 ----
/** 第6節: アタッカー / タンク / ヒーラー / スカウト / ギャザラー(採取+運搬) */
export type RoleId = 'attacker' | 'tank' | 'healer' | 'scout' | 'gatherer';
export const ROLE_IDS: RoleId[] = ['attacker', 'tank', 'healer', 'scout', 'gatherer'];
export const ROLE_LABEL: Record<RoleId, string> = {
  attacker: 'アタッカー', tank: 'タンク', healer: 'ヒーラー', scout: 'スカウト', gatherer: 'ギャザラー',
};
/** 役割ごとの適性 0〜100。周囲は一番高い役しか見ないが、主人公は全部見える */
export type Aptitude = Record<RoleId, number>;

export type ArmorClass = 'light' | 'medium' | 'heavy';
/** 属性の種類はフェーズ3(装備と耐性)で確定する */
export type ElementId = string;

// ---- データ定義(JSON) ----
export interface JobDef {
  id: string; name: string; desc: string;
  /** lower=下級(役割1つ) / upper=上級(隣り合う2役) */
  tier: 'lower' | 'upper';
  roles: RoleId[];
  /** 上級のみ: 入口となる下級職(2つ) */
  from?: string[];
  /** 上級のみ: 転職に必要な下級職Lv */
  requireLevel?: number;
  attackStat: 'atk' | 'mag';
  statMult: Stats;
  armor: ArmorClass[];
}

export interface RoleSkillDef {
  role: RoleId; id: string; name: string; desc: string;
  kind: 'active' | 'passive';
  params: Record<string, number>;
}

/** 隊長の性格が地図の埋め方を決める(第6節の表) */
export interface ExploreBehavior {
  /** 未踏へ踏み込む 0〜1 */
  venture: number;
  /** 埋め残しを潰す 0〜1 */
  thorough: number;
  /** 1日の歩数倍率 */
  speed: number;
  /** 休憩に入る隊HP比(restMode で誰のHPを見るか) */
  restHp: number;
  restMode: 'average' | 'any';
  /** 分かれ道で失う歩数の期待値 0〜1 */
  hesitate: number;
  /** 分かれ道の選び方を勘(乱数)にする */
  forkRandom: boolean;
  /** 寄り道の対象 */
  detour: 'none' | 'nest' | 'treasure' | 'injured' | 'avoid';
}

export interface PersonalityDef {
  id: string; name: string; desc: string;
  /** 隊長のときの地図の埋まり方(第6節の表)。派遣画面で見せる */
  exploreDesc: string;
  retreatBias: number; fightBias: number; lootBias: number; trapCare: number; cover: number;
  explore: ExploreBehavior;
  likes: string[]; dislikes: string[];
}

export interface TraitDef {
  id: string; name: string; desc: string; mods: Partial<Stats>;
  luck?: number; lostBias?: number; expRate?: number; fatigueRate?: number; salaryMult?: number;
  hiddenChance: number;
}

export interface PolicyDef {
  id: string; name: string; desc: string;
  retreat: number; combat: number; treasure: number; avoid: number;
  goldMult: number; groupBonus: number; expMult: number;
}

export interface EnemyDef {
  id: string; name: string; hp: number; atk: number; def: number; mag: number; spd: number; exp: number;
  element?: ElementId; resist?: Record<ElementId, number>;
  loot: { item: string; chance: number }[];
  ai: 'random' | 'weakest' | 'strongest';
  boss?: boolean; symbol?: boolean;
  skill?: { name: string; mult: number; cd: number; aoe: boolean };
}

export type ItemKind = 'material' | 'weapon' | 'armor' | 'accessory' | 'consumable' | 'key' | 'building';
export type EquipSlot = 'weapon' | 'armor' | 'accessory';
export interface ItemDef {
  id: string; name: string; desc: string; kind: ItemKind;
  /** 売却価格。依頼納品はこれより高い */
  price: number;
  /** 積載に占める重さ */
  weight: number;
  equip?: { slot: EquipSlot; armorClass?: ArmorClass; mods: Partial<Stats>; resist?: Record<ElementId, number>; effects?: string[] };
  consumable?: { effect: string; params: Record<string, number> };
  /** 産出するダンジョン(素材のみ) */
  source?: string;
}

export interface RecipeDef {
  id: string; name: string; facility: string;
  output: { item: string; n: number };
  inputs: { item: string; n: number }[];
  days: number; gold: number;
  /** 解放依頼のID。未指定なら最初から作れる */
  unlockedBy?: string;
}

// ---- ダンジョン(固定の手作りマップ) ----
export type CellKind =
  | 'wall' | 'floor' | 'entrance' | 'stairs_down' | 'stairs_up'
  | 'door' | 'hidden' | 'gather' | 'nest' | 'treasure' | 'trap' | 'boss' | 'symbol';
export interface CellDef {
  kind: CellKind;
  /** door: 必要な鍵アイテム */
  key?: string;
  /** gather: 採れる素材 */
  item?: string;
  /** nest / symbol / boss: 敵 */
  enemy?: string;
  /** trap: 罠の種類 */
  trap?: string;
  /** stairs: 行き先 */
  to?: { floor: string; x: number; y: number };
}
/** 1フロア。rows は1文字=1マスの文字列、legend で文字をマスの定義に対応させる */
export interface FloorDef {
  id: string; name: string;
  rows: string[];
  legend: Record<string, CellDef>;
}
export interface DungeonDef {
  id: string; name: string; desc: string;
  /** ワールド上のノード */
  node: string;
  floors: FloorDef[];
  enemies: { id: string; weight: number; group: [number, number] }[];
  recommended: number;
  /** 全滅時の救助費用の基準 */
  rescueCost: number;
  /** 床マスを1歩進むごとの遭遇確率。未指定なら 0.04 */
  encounterRate?: number;
}

// ---- ワールド(ノードと道) ----
export type NodeKind = 'base' | 'town' | 'village' | 'dungeon' | 'waypoint';
export type QuestType = 'deliver' | 'hunt' | 'explore' | 'survey' | 'escort' | 'transport' | 'unlock';
export interface TownDef {
  /** 掲示板の上限(拠点4・街3・村2) */
  boardMax: number;
  /** 街の性格: 依頼種別の重み */
  questWeights: Partial<Record<QuestType, number>>;
  /** 固有の職人が開くレシピ群 */
  crafts?: string[];
}
export interface WorldNodeDef {
  id: string; name: string; desc: string; kind: NodeKind;
  x: number; y: number;
  town?: TownDef;
  /** dungeon: 対応するダンジョン */
  dungeon?: string;
  /** 噂だけで未確認のダンジョン入口 */
  rumored?: boolean;
}
export interface WorldEdgeDef {
  id: string; a: string; b: string;
  days: number;
  /** 本当の危険度。隊が通ると実測値として開く */
  danger: number;
  /** 近道・裏道。踏査や住民との関係で開く */
  hidden?: boolean;
}

// ---- 施設 ----
export interface FacilityLevelCost { gold: number; materials: Record<string, number>; days: number }
export interface FacilityDef {
  id: string; name: string; desc: string;
  category: 'housing' | 'production' | 'training' | 'recovery' | 'info' | 'office';
  maxLevel: number;
  costs: FacilityLevelCost[];
  upkeep: number;
  effectText: string[];
  /** 勤務できる人数と、勤務で効く能力 */
  workSlots?: number; workStat?: StatKey;
}
/** 隣接シナジー。ゲーム内で一覧表示する(隠さない) */
export interface SynergyDef { id: string; a: string; b: string; name: string; desc: string; effect: Record<string, number> }

// ---- 依頼 ----
export interface QuestTarget {
  item?: string; n?: number; enemy?: string; dungeon?: string; percent?: number;
  from?: string; to?: string;
}
export interface QuestTemplateDef {
  id: string; type: QuestType; name: string; desc: string;
  /** 発生する街。null なら解放依頼など場所を持たないもの */
  town: string | null;
  target: QuestTarget;
  rewardGold: number; rewardRep: number;
  /** 解放に必要な評判Lv */
  minRep: number;
  /** 解放依頼: 達成で開くもの */
  unlocks?: string[];
}

// ---- 実行時データ ----
export interface TraitInstance { id: string; revealed: boolean }
export interface Persona { hobby: string; talent: string; likes: string; dislikes: string }
export interface Equipment { weapon: string | null; armor: string | null; accessory: string | null }
export type AdventurerStatus = 'idle' | 'away' | 'working' | 'training';

export interface Adventurer {
  id: string; name: string; age: number; level: number; exp: number;
  job: string; base: Stats; apt: Aptitude; growth: number;
  personality: string; traits: TraitInstance[];
  fatigue: number; injuryDays: number;
  salary: number;
  /** 0〜255。式は第6節 */
  loyalty: number;
  status: AdventurerStatus;
  /** 施設勤務 / スキル訓練の割り当て */
  assignment: { facility: string } | { training: string; untilDay: number } | null;
  equipment: Equipment;
  skills: string[];
  persona: Persona;
  history: {
    hiredDay: number; expeditions: number; kills: number;
    /** どのダンジョンに何回行ったか */
    visits: Record<string, number>;
    raisesRefused: number;
    /** 退職警告を出した日 */
    warnedDay: number | null;
  };
  /** ユニーク冒険者のキー。汎用は未設定 */
  unique?: string;
}

export interface Candidate { adv: Adventurer; arrivedDay: number; expiresDay: number }

// ---- 派遣 ----
export type ActionKind = 'explore' | 'gather' | 'hunt' | 'boss' | 'survey' | 'escort' | 'transport';
export interface DispatchOrder {
  partyIds: string[]; leaderId: string;
  action: ActionKind;
  target: { dungeon?: string; floor?: string; item?: string; enemy?: string; questId?: string; route?: string[] };
  policy: string;
  /** 現地の日数(往復は別) */
  days: number;
  /** 持ち物 */
  items: Record<string, number>;
}

export type LogKind = 'narration' | 'combat' | 'talk' | 'event' | 'relation' | 'result' | 'map';
export interface LogEntry { day: number; kind: LogKind; text: string }
export interface RelationDelta { a: string; b: string; delta: number; reason: string }
export interface ReturnDialogue { advId: string; name: string; text: string }

/** 地図の更新差分。index = y * width + x */
export interface MapDelta { dungeon: string; floor: string; cells: number[]; hidden: number[] }

export interface ExpeditionResult {
  success: boolean; retreated: boolean; wiped: boolean;
  log: LogEntry[];
  mapDeltas: MapDelta[];
  /** 今回入ったマスの最大深度(入口からの経路長)。地図が埋まると奥へ行けるかを測る */
  maxDepth: number;
  materials: Record<string, number>;
  items: Record<string, number>;
  gold: number;
  injuries: Record<string, number>;
  expGain: Record<string, number>;
  fatigue: Record<string, number>;
  relationDeltas: RelationDelta[];
  revealedTraits: { advId: string; traitId: string }[];
  kills: Record<string, number>;
  itemsUsed: Record<string, number>;
  repGain: number;
  /** 全滅時 */
  rescueCost: number;
  lostMaterials: Record<string, number>;
  questProgress: Record<string, number>;
  returnDialogue: ReturnDialogue[];
}

/** ワールド上の位置。出発時に全行程を確定するので、日付→位置の表 */
export interface WorldStep { day: number; node: string | null; edge: string | null; phase: 'outbound' | 'stay' | 'return' }

export interface Expedition {
  id: string;
  order: DispatchOrder;
  startDay: number; returnDay: number;
  steps: WorldStep[];
  result: ExpeditionResult;
  /** 呼び戻し(帰還方向への切替)を出した日 */
  recalledDay: number | null;
  claimed: boolean;
}

// ---- 蓄積する知識 ----
export interface FloorProgress { visited: number[]; hiddenFound: number[] }
export interface DungeonProgress {
  /** 入口を確認したか(噂→踏査で確定) */
  confirmed: boolean;
  floors: Record<string, FloorProgress>;
  bossDefeated: number;
  fullCleared: boolean;
}
export interface WorldKnowledge {
  visitedNodes: string[];
  foundEdges: string[];
  /** 実測した道の危険度 */
  measuredDanger: Record<string, number>;
}

// ---- 拠点 ----
export interface PlacedFacility {
  id: string; level: number; x: number; y: number;
  builtDay: number;
  construction: { toLevel: number; untilDay: number } | null;
}
export interface BaseState { width: number; height: number; facilities: PlacedFacility[] }
export interface CraftJob { id: string; recipeId: string; startDay: number; doneDay: number; workers: string[] }

// ---- 依頼(実行時) ----
export type QuestStatus = 'posted' | 'accepted' | 'done' | 'expired' | 'failed';
export interface Quest {
  id: string; templateId: string | null; type: QuestType;
  town: string | null; name: string; desc: string;
  target: QuestTarget;
  rewardGold: number; rewardRep: number;
  postedDay: number;
  /** 掲示板から消える日。解放依頼は null */
  acceptBy: number | null;
  /** 納期(受注後に設定)。解放依頼は null */
  dueDay: number | null;
  /** 護衛: 出発日固定 */
  departDay: number | null;
  status: QuestStatus;
  progress: number;
  unlocks: string[];
}

// ---- メール(10種、第6節の表) ----
export type MailKind =
  | 'greeting' | 'loyalty' | 'raise' | 'warning' | 'resign'
  | 'rest' | 'complaint' | 'rumor' | 'quest' | 'event';
export interface MailChoice { id: string; label: string }
export interface Mail {
  id: string; day: number; kind: MailKind;
  /** 差出人: 冒険者ID、または town:<id> / guild */
  from: string;
  subject: string; body: string;
  choices: MailChoice[];
  answered: string | null;
  read: boolean;
  payload: Record<string, string | number>;
}

// ---- その他 ----
export interface Scene { id: string; day: number; lines: string[]; thought: string; rep: number }
export interface LedgerEntry { day: number; label: string; amount: number }
export interface Notice { day: number; text: string }

export interface GameState {
  version: number;
  playerName: string;
  seed: number; day: number; gold: number; rep: number;
  adventurers: Adventurer[];
  candidates: Candidate[];
  relations: Record<string, number>;
  base: BaseState;
  inventory: Record<string, number>;
  crafts: CraftJob[];
  world: WorldKnowledge;
  dungeons: Record<string, DungeonProgress>;
  quests: Quest[];
  expeditions: Expedition[];
  history: Expedition[];
  mails: Mail[];
  achievements: string[];
  scenes: Scene[];
  seenScenes: string[];
  ledger: LedgerEntry[];
  notices: Notice[];
  counters: { nextId: number; dispatches: number };
  pendingTags: string[];
  repMilestones: number[];
  debt: boolean;
  dragonDefeated: boolean;
  flags: Record<string, number | boolean>;
}

// ---- 定数(数値調整はここではなく data/ で行う。構造上の上限だけ置く) ----
export const SAVE_VERSION = 1;
export const PARTY_MAX = 4;
export const PARTIES_MAX = 4;
export const LOYALTY_MAX = 255;
export const LOYALTY_MILESTONES = [50, 120, 255];
