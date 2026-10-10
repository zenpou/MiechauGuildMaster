// 依頼: 掲示板への発生・受注・納品・帰還での達成・期限切れ、評判Lv。
// world.json は読まない。道の日数と危険度は呼び出し側が roadInfo で渡す。
import { bonus } from './base';
import { DUNGEON, ENEMY, ITEM, QUEST_TEMPLATE, QUEST_TEMPLATES, RECIPE, TUNING } from './data';
import { exploredRate, parseFloor } from './dungeon';
import { addInventory, ledger } from './ledger';
import type { Rng } from './rng';
import type { Expedition, GameState, Quest, QuestTarget, QuestTemplateDef, QuestType, Result } from './types';

// ---- sim で調整する値 ----
/** 評判Lvのしきい値(Lv1〜5) */
export const REP_LEVELS = [0, 8, 20, 35, 55];
type TownKind = 'base' | 'town' | 'village';
/** 街の種類ごとの、1日に依頼が1件出る確率 */
const BOARD_CHANCE: Record<TownKind, number> = { base: 0.5, town: 0.4, village: 0.3 };
/** 掲示板の上限(解放依頼は数えない)。拠点は受付で増える */
const BOARD_MAX: Record<TownKind, number> = { base: 4, town: 3, village: 2 };
/** 受注期限 = 掲示日 + この幅 */
const ACCEPT_DAYS: [number, number] = [5, 7];
const ACCEPT_DAYS_EXPLORE: [number, number] = [7, 10];
/** 護衛の出発日 = 掲示日 + この幅 */
const T = TUNING.quests;
const ESCORT_DEPART_DAYS: [number, number] = [3, 5];
/** 同時に受けられる件数の基本値。受付とシナジーの分は activeMax で足す */
export const ACTIVE_MAX = 3;
const DELIVER_PRICE_MUL = T.deliverPriceMul;
const HUNT_EXP_MUL = T.huntExpMul;
const ESCORT_GOLD_PER_DAY = T.escortGoldPerDay;
const TRANSPORT_GOLD_PER_DAY = T.transportGoldPerDay;
/** 納期 = 受注日 + 最短所要 × 倍率 */
const DUE_MUL: Partial<Record<QuestType, number>> = { deliver: 2, hunt: 1.5, transport: 2 };
/** 探索の納期: 目標50%で下限、100%で上限 */
const EXPLORE_DUE_DAYS: [number, number] = [10, 15];
/** 最短所要 = 往復 + この日数。roadInfo が無ければこの日数だけ */
const LEAD_EXTRA_DAYS = 3;
/** roadInfo が無いときの道 */
const DEFAULT_ROAD = { days: 1, danger: 0.2 };
const FAIL_REP = 1;

/** 依頼を出す街と、その性格(種別の重み)。world.json と街IDを揃える */
export const QUEST_TOWNS: { id: string; kind: TownKind; questWeights: Partial<Record<QuestType, number>> }[] = [
  { id: 'base', kind: 'base', questWeights: { deliver: 3, hunt: 3, explore: 1, escort: 2 } },
  { id: 'mountain_village', kind: 'village', questWeights: { deliver: 2, transport: 3 } },
  { id: 'forge_town', kind: 'town', questWeights: { deliver: 4, hunt: 3, escort: 1 } },
  { id: 'academy_town', kind: 'town', questWeights: { deliver: 3, explore: 3 } },
];

/** quest-templates.json の実際の形。幅のあるパラメータを持つ */
export interface TemplateDef extends QuestTemplateDef {
  nRange?: [number, number];
  itemOptions?: string[];
  /** 探索: 目標の探索率ごとの報酬と必要評判 */
  percentOptions?: { percent: number; rewardGold: number; minRep: number }[];
  /** 運搬: 荷の重さ */
  cargo?: number;
}
/** QuestTarget に運搬の荷の重さを足したもの */
export type QuestTargetEx = QuestTarget & { cargo?: number };

/** 道の片道日数と危険度。world.ts の経路計算を呼び出し側から渡す */
export type RoadInfo = (from: string, to: string) => { days: number; danger: number } | null | undefined;

const TEMPLATES = QUEST_TEMPLATES as TemplateDef[];
const ok = (): Result => ({ ok: true });
const fail = (reason: string): Result => ({ ok: false, reason });

export function repLevel(rep: number): number {
  let lv = 1;
  REP_LEVELS.forEach((t, i) => { if (rep >= t) lv = i + 1; });
  return lv;
}

/** 評判の増減。Lvが上がったら一度だけ rep_milestone を積む */
export function addRep(s: GameState, n: number) {
  const before = repLevel(s.rep);
  s.rep = Math.max(0, s.rep + n);
  for (let lv = before + 1; lv <= repLevel(s.rep); lv++) {
    if (s.repMilestones.includes(lv)) continue;
    s.repMilestones.push(lv);
    if (!s.pendingTags.includes('rep_milestone')) s.pendingTags.push('rep_milestone');
  }
}

export function questCargo(q: Quest): number {
  return (q.target as QuestTargetEx).cargo ?? 0;
}

const road = (info: RoadInfo | undefined, from: string, to: string) => info?.(from, to) ?? DEFAULT_ROAD;

/** 拠点から dest へ行って帰り、現地で少し動く最短の日数 */
function leadDays(info: RoadInfo | undefined, dest: string | undefined): number {
  const r = info && dest ? info('base', dest) : null;
  return r ? r.days * 2 + LEAD_EXTRA_DAYS : LEAD_EXTRA_DAYS;
}

function fillDesc(text: string, t: QuestTargetEx): string {
  return text
    .replace('{item}', t.item ? ITEM[t.item]?.name ?? t.item : '')
    .replace('{enemy}', t.enemy ? ENEMY[t.enemy]?.name ?? t.enemy : '')
    .replace('{dungeon}', t.dungeon ? DUNGEON[t.dungeon]?.name ?? t.dungeon : '')
    .replace('{n}', String(t.n ?? ''))
    .replace('{percent}', String(t.percent ?? ''))
    .replace('{cargo}', String(t.cargo ?? ''));
}

function rewardOf(t: TemplateDef, target: QuestTargetEx, base: number, info: RoadInfo | undefined): number {
  switch (t.type) {
    case 'deliver': return Math.round((ITEM[target.item!]?.price ?? 0) * (target.n ?? 0) * DELIVER_PRICE_MUL);
    case 'hunt': return Math.round((ENEMY[target.enemy!]?.exp ?? 0) * (target.n ?? 0) * HUNT_EXP_MUL);
    case 'escort': {
      const r = road(info, target.from!, target.to!);
      return Math.round(ESCORT_GOLD_PER_DAY * r.days * (1 + r.danger));
    }
    case 'transport': return Math.round(TRANSPORT_GOLD_PER_DAY * road(info, target.from!, target.to!).days);
    default: return base;
  }
}

/** rng は解放依頼では使わない(null 可) */
function buildQuest(s: GameState, t: TemplateDef, rng: Rng | null, info: RoadInfo | undefined): Quest {
  const target: QuestTargetEx = { ...t.target };
  let rewardGold = t.rewardGold;
  let acceptBy: number | null = null;
  let departDay: number | null = null;
  if (t.type !== 'unlock') {
    if (!rng) throw new Error(`${t.id}: 乱数が要る`);
    if (t.itemOptions?.length) target.item = rng.pick(t.itemOptions);
    if (t.nRange) target.n = rng.int(t.nRange[0], t.nRange[1]);
    if (t.percentOptions?.length) {
      const opts = t.percentOptions.filter((o) => o.minRep <= s.rep);
      const o = rng.pick(opts.length ? opts : [t.percentOptions[0]]);
      target.percent = o.percent;
      rewardGold = o.rewardGold;
    }
    if (t.type === 'escort') {
      departDay = s.day + rng.int(ESCORT_DEPART_DAYS[0], ESCORT_DEPART_DAYS[1]);
      acceptBy = departDay;
    } else {
      const span = t.type === 'explore' ? ACCEPT_DAYS_EXPLORE : ACCEPT_DAYS;
      acceptBy = s.day + rng.int(span[0], span[1]);
    }
  }
  if (t.cargo) target.cargo = t.cargo;
  return {
    id: `q${s.counters.nextId++}`, templateId: t.id, type: t.type,
    town: t.town, name: t.name, desc: fillDesc(t.desc, target),
    target,
    rewardGold: rewardOf(t, target, rewardGold, info), rewardRep: t.rewardRep,
    postedDay: s.day, acceptBy, dueDay: null, departDay,
    status: 'posted', progress: 0, unlocks: [...(t.unlocks ?? [])],
  };
}

/** テンプレートから依頼を1件作る(s.quests には入れない) */
export function createQuest(s: GameState, templateId: string, rng: Rng, roadInfo?: RoadInfo): Quest {
  const t = QUEST_TEMPLATE[templateId] as TemplateDef | undefined;
  if (!t) throw new Error(`依頼テンプレートが無い: ${templateId}`);
  return buildQuest(s, t, rng, roadInfo);
}

/** 解放依頼を掲示板に置く(締め切りなし)。何度呼んでも1件ずつ */
export function seedUnlockQuests(s: GameState) {
  for (const t of TEMPLATES) {
    if (t.type !== 'unlock' || s.flags['unlock:' + t.id] || s.quests.some((q) => q.templateId === t.id)) continue;
    s.quests.push(buildQuest(s, t, null, undefined));
  }
}

/** 日送りで呼ぶ。街ごとに確率で1件。出した依頼を返す */
export function generateDailyQuests(s: GameState, rng: Rng, roadInfo?: RoadInfo): Quest[] {
  const out: Quest[] = [];
  const homeExtra = bonus(s, 'boardBonus');
  for (const town of QUEST_TOWNS) {
    // 掲示板が満杯でも引いておき、乱数の列を街の状態に左右させない
    if (!rng.chance(BOARD_CHANCE[town.kind])) continue;
    const posted = s.quests.filter((q) => q.status === 'posted' && q.town === town.id && q.type !== 'unlock').length;
    if (posted >= BOARD_MAX[town.kind] + (town.kind === 'base' ? homeExtra : 0)) continue;
    const pool = TEMPLATES.filter((t) => t.town === town.id && t.type !== 'unlock' && t.minRep <= s.rep);
    if (!pool.length) continue;
    const type = rng.weighted([...new Set(pool.map((t) => t.type))], (ty) => town.questWeights[ty] ?? 0);
    const q = buildQuest(s, rng.pick(pool.filter((t) => t.type === type)), rng, roadInfo);
    s.quests.push(q);
    out.push(q);
  }
  return out;
}

const boardSeen = (s: GameState, town: string | null) => town === null || town === 'base' || s.world.visitedNodes.includes(town);

/** 見える依頼: 拠点と訪れた街の掲示板 + 受注中の全部 */
export function visibleQuests(s: GameState): Quest[] {
  return s.quests.filter((q) => q.status === 'accepted' || (q.status === 'posted' && boardSeen(s, q.town)));
}

/** UI用: 見える街ごとの掲示板 */
export function visibleBoards(s: GameState): { town: string; quests: Quest[] }[] {
  return QUEST_TOWNS.filter((t) => boardSeen(s, t.id)).map((t) => ({
    town: t.id,
    quests: s.quests.filter((q) => q.status === 'posted' && q.town === t.id),
  }));
}

export function activeQuests(s: GameState): Quest[] {
  return s.quests.filter((q) => q.status === 'accepted');
}

/** 同時に受けられる件数 */
export function activeMax(s: GameState): number {
  return ACTIVE_MAX + bonus(s, 'questSlots');
}

function dueDayFor(s: GameState, q: Quest, info: RoadInfo | undefined): number | null {
  switch (q.type) {
    case 'unlock': return null;
    case 'escort': return q.departDay;
    case 'explore': {
      const [lo, hi] = EXPLORE_DUE_DAYS;
      const k = Math.min(1, Math.max(0, ((q.target.percent ?? 50) - 50) / 50));
      return s.day + Math.round(lo + (hi - lo) * k);
    }
    case 'deliver': return s.day + Math.ceil(leadDays(info, q.target.item ? ITEM[q.target.item]?.source : undefined) * DUE_MUL.deliver!);
    case 'hunt': return s.day + Math.ceil(leadDays(info, q.target.dungeon) * DUE_MUL.hunt!);
    case 'transport': return s.day + Math.ceil(leadDays(info, q.target.from) * DUE_MUL.transport!);
    default: return s.day + leadDays(info, undefined);
  }
}

export function accept(s: GameState, questId: string, roadInfo?: RoadInfo): Result {
  const q = s.quests.find((x) => x.id === questId);
  if (!q) return fail('その依頼はありません');
  if (q.status !== 'posted') return fail('この依頼は受けられません');
  if (!boardSeen(s, q.town)) return fail('まだその街の掲示板を見ていません');
  if (q.acceptBy !== null && q.acceptBy < s.day) return fail('受注期限を過ぎています');
  const max = activeMax(s);
  if (activeQuests(s).length >= max) return fail(`同時に受けられる依頼は${max}件までです`);
  q.status = 'accepted';
  q.dueDay = dueDayFor(s, q, roadInfo);
  return ok();
}

/** 拠点の在庫から納める(納品・解放依頼) */
export function deliver(s: GameState, questId: string): Result {
  const q = s.quests.find((x) => x.id === questId);
  if (!q) return fail('その依頼はありません');
  if (q.status !== 'accepted') return fail('受注中の依頼ではありません');
  if (q.type !== 'deliver' && q.type !== 'unlock') return fail('納める依頼ではありません');
  const item = q.target.item!;
  const n = q.target.n ?? 0;
  const have = s.inventory[item] ?? 0;
  if (have < n) return fail(`${ITEM[item]?.name ?? item}が足りません(${have}/${n})`);
  addInventory(s, item, -n);
  const notices: string[] = [];
  completeQuest(s, q, notices);
  for (const text of notices) s.notices.unshift({ day: s.day, text });
  return ok();
}

/** ダンジョン全体の探索率(全フロアの通行可能マスの合計に対する割合) */
export function dungeonRate(s: GameState, dungeonId: string): number {
  const def = DUNGEON[dungeonId];
  if (!def) return 0;
  let open = 0;
  let stepped = 0;
  for (const f of def.floors) {
    const grid = parseFloor(f);
    const total = grid.cells.filter((c) => c.kind !== 'wall').length;
    open += total;
    stepped += exploredRate(grid, s.dungeons[dungeonId]?.floors[f.id]?.visited ?? []) * total;
  }
  return open ? stepped / open : 0;
}

/** 帰還の反映後に呼ぶ(探索率は s.dungeons の更新後の値で見る)。達成した依頼を返す */
export function progressFromReturn(s: GameState, e: Expedition, notices: string[] = []): Quest[] {
  const done: Quest[] = [];
  for (const q of activeQuests(s)) {
    let complete = false;
    switch (q.type) {
      case 'hunt':
        q.progress += e.result.kills[q.target.enemy ?? ''] ?? 0;
        complete = q.progress >= (q.target.n ?? 0);
        break;
      case 'explore':
        q.progress = Math.floor(dungeonRate(s, q.target.dungeon ?? '') * 100);
        complete = q.progress >= (q.target.percent ?? 100);
        break;
      case 'escort':
      case 'transport': {
        const route = e.order.target.route;
        complete = e.order.target.questId === q.id && e.order.action === q.type && !e.result.wiped
          && (!route?.length || route[route.length - 1] === q.target.to);
        break;
      }
    }
    if (!complete) continue;
    completeQuest(s, q, notices);
    done.push(q);
  }
  return done;
}

/** 日送りで呼ぶ。掲示の期限切れは消し、納期切れは失敗にする */
export function expireQuests(s: GameState, notices: string[]) {
  s.quests = s.quests.filter((q) => !(q.status === 'posted' && q.acceptBy !== null && q.acceptBy < s.day));
  // 結果は出発時に確定済みでも開示は帰還日なので、出ている隊がいる依頼は帰還まで待つ
  const busy = new Set(s.expeditions.map((e) => e.order.target.questId).filter((id): id is string => !!id));
  for (const q of activeQuests(s)) {
    if (q.dueDay === null || q.dueDay >= s.day || busy.has(q.id)) continue;
    q.status = 'failed';
    addRep(s, -FAIL_REP);
    notices.push(`依頼「${q.name}」の納期を過ぎた。評判が${FAIL_REP}下がった。`);
  }
}

/** 達成時に払う額。掲示の額(rewardGold)は変えず、護衛・運搬の見張り台の割増しは達成時の施設で決める */
export function questRewardGold(s: GameState, q: Quest): number {
  return q.type === 'escort' || q.type === 'transport' ? Math.round(q.rewardGold * (1 + bonus(s, 'escortGoldMult'))) : q.rewardGold;
}

export function completeQuest(s: GameState, q: Quest, notices: string[]) {
  if (q.status === 'done') return;
  q.status = 'done';
  const gold = questRewardGold(s, q);
  s.gold += gold;
  ledger(s, `依頼達成: ${q.name}`, gold);
  addRep(s, q.rewardRep);
  notices.push(`依頼「${q.name}」を達成した。報酬 ${gold}G、評判+${q.rewardRep}。`);
  if (q.type === 'unlock' && q.templateId) s.flags['unlock:' + q.templateId] = true;
  for (const id of q.unlocks) {
    s.flags['unlock:' + id] = true;
    if (RECIPE[id]) notices.push(`${RECIPE[id].name}の作り方を教わった。`);
  }
}

/** レシピが作れる状態か。recipes.json の unlockedBy と、解放依頼の unlocks の両方を見る */
export function recipeUnlocked(s: GameState, recipeId: string): boolean {
  const by = RECIPE[recipeId]?.unlockedBy;
  if (by && !s.flags['unlock:' + by]) return false;
  const lockedByQuest = TEMPLATES.some((t) => t.unlocks?.includes(recipeId));
  return !lockedByQuest || !!s.flags['unlock:' + recipeId];
}
