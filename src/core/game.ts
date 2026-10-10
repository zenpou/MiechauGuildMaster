// ゲーム状態の進行。派遣は出発時に 往路・現地・復路 を全部確定し、帰還日に applyReturn で開示する。
import { addExp, carryCapacity, generateAdventurer, powerOf, salaryOf } from './adventurer';
import { achievementExpMult, checkAchievements } from './achievements';
import { bonus, build, completeConstructions, dailyProduction, facilityUpkeep, synergyValue } from './base';
import { completeCrafts } from './craft';
import { completeTraining } from './training';
import { DUNGEON, EDGE, ITEM, JOB, NODE, POLICY, QUEST_TEMPLATES, TUNING, type ReturnOutcome } from './data';
import { exploredRate, parseFloor } from './dungeon';
import { onDragonDefeated } from './ending';
import { onReturn, advanceUniqueChain } from './events';
import { floorTransit, returnDialogue, simulateExploration } from './explore';
import {
  QUEST_TOWNS, REP_LEVELS, accept, createQuest, expireQuests, generateDailyQuests, progressFromReturn, questCargo,
  repLevel, seedUnlockQuests, type RoadInfo,
} from './quests';
import { arriveCandidates, expireCandidates, spawnCandidate } from './recruit';
import { addRelation } from './relations';
import { rngFor, type Rng } from './rng';
import { addInventory, heldKeys, ledger } from './ledger';
import { applyResignations, checkMails, dispatchBlock, markGreeted, markTired, recordParty } from './mail';
import { resolveScenes } from './scenes';
import { emptyState } from './state';
import {
  LOYALTY_MAX, PARTIES_MAX, PARTY_MAX,
  type ActionKind, type Adventurer, type DispatchOrder, type Expedition, type ExpeditionResult, type GameState,
  type LogEntry, type Mail, type Result, type Scene, type WorldStep,
} from './types';
import { edgeBetween, planSteps, route, simulateTravel, type TravelResult } from './world';

// sim で調整する値は src/data/tuning.json
const T = TUNING.game;
export const START_GOLD = T.startGold;
export const START_POTIONS = T.startPotions;
export const UPKEEP_PER_DAY = T.upkeepPerDay;
/** 山村をこの回数訪れると、古い坑道への近道が開く */
const SHORTCUT_VILLAGE = 'mountain_village';
const SHORTCUT_EDGE = 'mountain_village__old_mine_short';
const SHORTCUT_VISITS = 3;
/** 見張り台とシナジーを重ねても、道中の遭遇はこの割合までしか減らさない */
const ROAD_ENCOUNTER_OFF_MAX = 0.8;
const START_JOBS = ['fighter', 'warrior', 'priest', 'scout'];
const BUYABLE = ['potion'];
const NOTICES_MAX = 80;
const HISTORY_MAX = 40;
const ACTIONS: ActionKind[] = ['explore', 'gather', 'hunt', 'boss', 'survey', 'escort', 'transport'];
/** 依頼に紐づく行動。ダンジョンには入らず、依頼の from→to を通る */
const QUEST_ACTIONS: ActionKind[] = ['escort', 'transport'];
const BOSS_KINDS = ['symbol', 'boss'];
/** 隊は拠点から出て拠点へ戻る */
const HOME = 'base';
const START_NODES = [HOME, 'forest_cave'];
const START_QUESTS = 2;
const START_CANDIDATES = 2;
// sim で調整する値
/** 推奨戦力のこの割合未満で成功すると return_underdog */
const UNDERDOG_RATIO = 0.8;
/** 安全第一・戦闘回避でこの平均Lv以下の隊を出すと dispatch_safe_weak */
const SAFE_WEAK_POLICIES = ['safe', 'avoid'];
const SAFE_WEAK_LEVEL = 2;

export type { Result } from './types';
export interface DayReport { day: number; returned: Expedition[]; notices: string[]; scene: Scene | null; mails: Mail[] }

/**
 * 呼び戻しで結果を組み直すため、出発時に引いた道中を区間ごとに残す。帰還時に消す。
 * types.ts の Expedition には載せず、セーブには JSON としてそのまま入る(古いセーブでは無い)。
 */
interface Legs {
  out: TravelResult;
  back: TravelResult;
  outNodes: string[];
  backNodes: string[];
  items: Record<string, number>;
}
type ExpeditionEx = Expedition & { legs?: Legs };

/** 行き先までの道のり。dungeonId が null なら護衛・運搬 */
interface Trip {
  out: string[];
  back: string[];
  dungeonId: string | null;
  floorId: string;
  cargo: number;
}

const ok = (): Result => ({ ok: true });
const fail = (reason: string) => ({ ok: false as const, reason });
const has = <V>(table: Record<string, V>, key: string) => Object.prototype.hasOwnProperty.call(table, key);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;


function addLoyalty(a: Adventurer, delta: number) {
  a.loyalty = clamp(a.loyalty + delta, 0, LOYALTY_MAX);
}

function addTag(s: GameState, tag: string) {
  if (!s.pendingTags.includes(tag)) s.pendingTags.push(tag);
}

function addAll(into: Record<string, number>, from: Record<string, number>) {
  for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n;
}

/** 依頼の日数・報酬の計算に渡す道の情報。複数区間なら日数は合計、危険度は一番危ない区間 */
export function roadInfoOf(s: GameState): RoadInfo {
  const nodeOf = (id: string) => (NODE[id] ? id : DUNGEON[id]?.node ?? id);
  return (from, to) => {
    const nodes = route(nodeOf(from), nodeOf(to), s.world);
    if (!nodes) return null;
    let days = 0;
    let danger = 0;
    for (let i = 0; i + 1 < nodes.length; i++) {
      const e = edgeBetween(nodes[i], nodes[i + 1], s.world)!;
      days += e.days;
      danger = Math.max(danger, e.danger);
    }
    return { days, danger };
  };
}

/** UI から受注するときはこちら(納期の計算に道の日数を使う) */
export function acceptQuest(s: GameState, questId: string): Result {
  return accept(s, questId, roadInfoOf(s));
}

/** 施設を建てる。勘違いの種を積むため、UI は base.build ではなくこちらを呼ぶ */
export function buildFacility(s: GameState, facilityId: string, x: number, y: number): Result {
  const r = build(s, facilityId, x, y);
  if (r.ok) addTag(s, 'facility_built');
  return r;
}

/** 拠点の掲示板向けのテンプレートを、拠点の種別の重みで1つ選ぶ */
function pickHomeTemplate(s: GameState, rng: Rng): string {
  const town = QUEST_TOWNS.find((t) => t.id === HOME)!;
  const pool = QUEST_TEMPLATES.filter((t) => t.town === HOME && t.type !== 'unlock' && t.minRep <= s.rep);
  const type = rng.weighted([...new Set(pool.map((t) => t.type))], (ty) => town.questWeights[ty] ?? 0);
  return rng.pick(pool.filter((t) => t.type === type)).id;
}


export const dailyCost = (s: GameState) => s.adventurers.reduce((t, a) => t + a.salary, 0) + UPKEEP_PER_DAY + facilityUpkeep(s);

export function newGame(seed: number, playerName = ''): GameState {
  const s = emptyState(seed, playerName);
  s.gold = START_GOLD;
  ledger(s, '開業資金', START_GOLD);
  const usedNames = new Set<string>();
  START_JOBS.forEach((job, i) => {
    const a = generateAdventurer(rngFor(seed, 'init', i), { id: `a${s.counters.nextId++}`, usedNames });
    a.job = job;
    for (const r of JOB[job].roles) a.apt[r] = Math.max(a.apt[r], T.startApt);
    a.salary = salaryOf(a);
    a.history.hiredDay = 1;
    markGreeted(s, a);
    s.adventurers.push(a);
  });
  s.world.visitedNodes = [...START_NODES];
  s.inventory.potion = START_POTIONS;
  seedUnlockQuests(s);
  const qr = rngFor(seed, 'quests', 'init');
  const info = roadInfoOf(s);
  for (let i = 0; i < START_QUESTS; i++) s.quests.push(createQuest(s, pickHomeTemplate(s, qr), qr, info));
  const cr = rngFor(seed, 'recruit', 'init');
  for (let i = 0; i < START_CANDIDATES; i++) spawnCandidate(s, cr);
  return s;
}

export function dispatch(s: GameState, o: DispatchOrder): { ok: true; expedition: Expedition } | { ok: false; reason: string } {
  if (!o || typeof o !== 'object' || !Array.isArray(o.partyIds) || !o.target || typeof o.target !== 'object') return fail('派遣内容が不正です');
  if (!ACTIONS.includes(o.action)) return fail('その行動はまだ選べません');
  const trip = QUEST_ACTIONS.includes(o.action) ? questTrip(s, o) : dungeonTrip(s, o);
  if (typeof trip === 'string') return fail(trip);
  if (!has(POLICY, o.policy)) return fail('方針が不正です');
  if (o.partyIds.length < 1 || o.partyIds.length > PARTY_MAX) return fail(`隊は1〜${PARTY_MAX}人で組んでください`);
  if (new Set(o.partyIds).size !== o.partyIds.length) return fail('同じ冒険者が重複しています');
  if (!o.partyIds.includes(o.leaderId)) return fail('隊長は隊員から選んでください');
  if (s.expeditions.length >= PARTIES_MAX) return fail(`同時に出せる隊は${PARTIES_MAX}隊までです`);
  const members: Adventurer[] = [];
  for (const id of o.partyIds) {
    const m = s.adventurers.find((a) => a.id === id);
    if (!m) return fail('存在しない冒険者が指定されています');
    if (m.status !== 'idle') return fail(`${m.name}は手が空いていません`);
    if (m.injuryDays > 0) return fail(`${m.name}は負傷療養中です`);
    members.push(m);
  }
  const blocked = dispatchBlock(s, members);
  if (blocked) return fail(blocked);
  const items = o.items ?? {};
  for (const [k, n] of Object.entries(items)) {
    if (!has(ITEM, k) || !isCount(n)) return fail('持ち物の指定が不正です');
    if ((s.inventory[k] ?? 0) < n) return fail(`${ITEM[k].name}の在庫が足りません`);
  }
  if (trip.cargo > 0) {
    const cap = members.reduce((t, m) => t + carryCapacity(m), 0);
    if (cap < trip.cargo) return fail(`荷(重さ${trip.cargo})を運ぶには積載が足りません(${cap})`);
  }

  const k = s.world;
  const n = s.counters.dispatches;
  // 帰還日まで隊員の状態は変わらないが、シミュレーション中の書き換えから在籍データを守るため複製を渡す
  const party = members.map((m) => structuredClone(m));
  const encounterMult = 1 - Math.min(ROAD_ENCOUNTER_OFF_MAX, bonus(s, 'roadEncounterOff'));
  const outLeg = simulateTravel(rngFor(s.seed, 'road', n, 'out'), party, trip.out, 'outbound', k, encounterMult);
  // 呼び戻しで現地を切り上げても使えるよう、現地の結果に関係なく帰路の遭遇も先に引いておく
  const backLeg = simulateTravel(rngFor(s.seed, 'road', n, 'back'), party, trip.back, 'outbound', k, encounterMult);
  const outDays = pathDays(trip.out, k);
  let site: ExpeditionResult | null = null;
  if (trip.dungeonId && !outLeg.wiped) {
    for (const m of party) m.fatigue = clamp(m.fatigue + (outLeg.fatigue[m.id] ?? 0), 0, 100);
    site = simulateExploration({
      rng: rngFor(s.seed, 'exp', n),
      dungeon: DUNGEON[trip.dungeonId], floorId: trip.floorId,
      members: party, leaderId: o.leaderId, policy: o.policy,
      progress: s.dungeons[trip.dungeonId], days: o.days, items: { ...items }, relations: s.relations, startDay: s.day + outDays,
      action: o.action, target: { item: o.target.item, enemy: o.target.enemy },
      // 出発時の在庫で扉が決まる。2階以降は前の階を抜ける歩数を往復で払う
      keys: heldKeys(s), transit: floorTransit(DUNGEON[trip.dungeonId], trip.floorId, s.dungeons[trip.dungeonId], heldKeys(s)) ?? 0,
      hiddenBonus: bonus(s, 'hiddenFind'),
    });
  }
  const result = combineLegs(outLeg, site, outLeg.wiped || site?.wiped ? null : backLeg, items, outDays);
  // 現地のひとことは現地の結果で決まるが、道中や復路の全滅で最終の結果は変わる。現地の無い護衛・運搬も含め、最終結果で作り直す
  result.returnDialogue = returnDialogue(rngFor(s.seed, 'rdlg', n), members, finalOutcome(result, o.days, !!site));
  // 採り尽くし・討伐完了で早帰りした隊は、予定日数ではなく実際の日数で戻る
  const stay = site ? Math.max(1, site.daysSpent) : 0;
  let steps = tripSteps(trip.out, trip.back, stay, s.day, k);
  let reached = trip.out;
  if (outLeg.wiped && outLeg.wipedAt) {
    steps = turnBack(steps, s.day + outLeg.wipedAt.day - 1);
    reached = reachedNodes(trip.out, steps, k);
  }
  const expedition: ExpeditionEx = {
    id: `e${s.counters.nextId++}`,
    order: structuredClone({ ...o, items, target: { ...o.target, route: reached } }),
    startDay: s.day, returnDay: steps[steps.length - 1].day,
    steps, result, recalledDay: null, claimed: false,
    legs: { out: outLeg, back: backLeg, outNodes: trip.out, backNodes: trip.back, items: { ...items } },
  };
  s.counters.dispatches++;
  markTired(s, members);
  recordParty(s, o.partyIds);
  for (const m of members) m.status = 'away';
  for (const [k2, c] of Object.entries(items)) addInventory(s, k2, -c);
  s.expeditions.push(expedition);
  // 何もしなかった日(day_idle)の判定に使う
  s.flags.dispatchedDay = s.day;
  const avgLv = members.reduce((t, m) => t + m.level, 0) / members.length;
  if (SAFE_WEAK_POLICIES.includes(o.policy) && avgLv <= SAFE_WEAK_LEVEL) addTag(s, 'dispatch_safe_weak');
  return { ok: true, expedition };
}

function dungeonTrip(s: GameState, o: DispatchOrder): Trip | string {
  const dungeonId = o.target.dungeon ?? '';
  const dungeon = has(DUNGEON, dungeonId) ? DUNGEON[dungeonId] : undefined;
  if (!dungeon || !s.dungeons[dungeonId]) return '行き先のダンジョンが分かりません';
  const floorId = o.target.floor ?? 'f1';
  if (!dungeon.floors.some((f) => f.id === floorId)) return '行き先のフロアが分かりません';
  // 2階以降は、前の階の下り階段までの道が既知で、道の扉の鍵を持っているときだけ出せる(移動費の計算ができる)
  if (floorTransit(dungeon, floorId, s.dungeons[dungeonId], heldKeys(s)) === null) {
    return `${dungeon.name}の${dungeon.floors.find((f) => f.id === floorId)!.name}へは、前の階の下り階段までの道がまだ分かりません(階段を踏み、鍵の要る扉は鍵を持って)`;
  }
  const actionError = checkAction(s, o, dungeonId, floorId);
  if (actionError) return actionError;
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > T.daysMax) return `日数は1〜${T.daysMax}日で指定してください`;
  const out = route(HOME, dungeon.node, s.world);
  if (!out) return `${dungeon.name}へ行く道が分かりません`;
  return { out, back: [...out].reverse(), dungeonId, floorId, cargo: 0 };
}

/** 護衛・運搬: 拠点 →(依頼の from が拠点以外なら先に移動)→ from → to → 拠点 */
function questTrip(s: GameState, o: DispatchOrder): Trip | string {
  const label = o.action === 'escort' ? '護衛' : '運搬';
  const q = s.quests.find((x) => x.id === o.target.questId);
  if (!q || q.status !== 'accepted' || q.type !== o.action) return `受注中の${label}の依頼を選んでください`;
  if (q.type === 'escort' && q.departDay !== s.day) return `この護衛の出発日は${q.departDay}日目です`;
  if (s.expeditions.some((e) => e.order.target.questId === q.id)) return 'この依頼にはもう隊を出しています';
  const from = q.target.from ?? HOME;
  const to = q.target.to ?? HOME;
  const head = route(HOME, from, s.world);
  const body = route(from, to, s.world);
  const back = route(to, HOME, s.world);
  if (!head || !body || !back) return `${NODE[to]?.name ?? to}へ行く道が分かりません`;
  return { out: [...head, ...body.slice(1)], back, dungeonId: null, floorId: 'f1', cargo: questCargo(q) };
}

function pathDays(nodes: string[], k: GameState['world']): number {
  let d = 0;
  for (let i = 0; i + 1 < nodes.length; i++) d += edgeBetween(nodes[i], nodes[i + 1], k)!.days;
  return d;
}

/** 往路(+滞在)と復路を別の経路で。復路が往路の逆なら planSteps と同じ表になる */
function tripSteps(out: string[], back: string[], stay: number, startDay: number, k: GameState['world']): WorldStep[] {
  const go = planSteps(out, stay, startDay, k).filter((st) => st.phase !== 'return');
  const day = startDay + pathDays(out, k) + stay;
  const ret = planSteps(back, 0, day, k).filter((st) => st.phase === 'outbound').map((st) => ({ ...st, phase: 'return' as const }));
  return [...go, ...ret, { day: day + pathDays(back, k), node: back[back.length - 1], edge: null, phase: 'return' }];
}

/** day の位置から、それまでに歩いた道を逆にたどって拠点へ戻る表に切り替える */
function turnBack(steps: WorldStep[], day: number): WorldStep[] {
  const kept = steps.filter((st) => st.day <= day && st.phase !== 'return');
  const out = [...kept];
  let d = day + 1;
  for (const st of [...kept].reverse()) {
    if (!st.edge) continue;
    out.push({ day: d, node: null, edge: st.edge, phase: 'return' });
    if (EDGE[st.edge]?.days !== 0) d++;
  }
  out.push({ day: d, node: HOME, edge: null, phase: 'return' });
  return out;
}

/** 切り替え後の表で、実際にたどり着いた往路のノード。道の途中で引き返したら手前のノードまで */
function reachedNodes(nodes: string[], steps: WorldStep[], k: GameState['world']): string[] {
  const kept = steps.filter((st) => st.phase !== 'return');
  const reached = [nodes[0]];
  let i = 0;
  for (let j = 0; j + 1 < nodes.length; j++) {
    const e = edgeBetween(nodes[j], nodes[j + 1], k)!;
    const need = Math.max(1, e.days);
    let got = 0;
    while (i < kept.length && kept[i].edge === e.id && got < need) { i++; got++; }
    // 道の最後の日は道の上にいるので、次の位置が表にあって初めて着いたことになる
    if (got < need || i >= kept.length) break;
    reached.push(nodes[j + 1]);
  }
  return reached;
}

function emptyResult(items: Record<string, number>): ExpeditionResult {
  return {
    success: false, retreated: false, wiped: false, log: [],
    mapDeltas: [], maxDepth: 0, daysSpent: 0, materials: {}, items: { ...items }, gold: 0,
    injuries: {}, expGain: {}, fatigue: {}, relationDeltas: [], revealedTraits: [],
    kills: {}, itemsUsed: {}, repGain: 0, rescueCost: 0, lostMaterials: {},
    questProgress: {}, returnDialogue: [],
  };
}

/**
 * 往路→現地→復路を1つの結果にまとめる。log の day は出発からの通し日数。
 * site が null なら現地に行っていない(護衛・運搬、往路で全滅、呼び戻し)。持ち物は使わずに戻る。
 */
function combineLegs(
  out: TravelResult, site: ExpeditionResult | null, back: TravelResult | null, items: Record<string, number>, outDays: number,
): ExpeditionResult {
  const r = site ? structuredClone(site) : emptyResult(items);
  const stay = site?.daysSpent ?? 0;
  const shift = (log: LogEntry[], by: number) => log.map((l) => ({ ...l, day: l.day + by }));
  r.log = [...out.log, ...shift(r.log, outDays), ...(back ? shift(back.log, outDays + stay) : [])];
  for (const leg of back ? [out, back] : [out]) {
    addAll(r.kills, leg.kills);
    addAll(r.materials, leg.materials);
    addAll(r.fatigue, leg.fatigue);
    for (const [id, d] of Object.entries(leg.injuries)) r.injuries[id] = Math.max(r.injuries[id] ?? 0, d);
    r.rescueCost += leg.rescueCost;
  }
  if (back?.wiped) {
    addAll(r.lostMaterials, r.materials);
    r.materials = {};
  }
  r.wiped = out.wiped || !!site?.wiped || !!back?.wiped;
  r.success = !r.wiped && (site ? site.success : true);
  r.daysSpent = stay;
  return r;
}

/** 行動種別ごとの出発条件。問題なければ null */
function checkAction(s: GameState, o: DispatchOrder, dungeonId: string, floorId: string): string | null {
  const progress = s.dungeons[dungeonId];
  const name = DUNGEON[dungeonId].name;
  if (o.action === 'survey') return progress.confirmed ? `${name}は入口を確認済みです(踏査は噂だけのダンジョンへ)` : null;
  if (!progress.confirmed) return `${name}は噂だけで入口が分かりません。先に踏査してください`;
  const grid = parseFloor(DUNGEON[dungeonId].floors.find((f) => f.id === floorId)!);
  const visited = progress.floors[floorId]?.visited ?? [];
  if (o.action === 'gather') {
    const item = o.target.item;
    if (!item) return '採集する素材を指定してください';
    if (!grid.cells.some((c) => c.kind === 'gather' && c.item === item)) return 'その素材はこのフロアでは採れません';
  }
  if (o.action === 'hunt' && o.target.enemy !== undefined) {
    if (exploredRateOf(s, dungeonId, floorId) < 1) return '対象の指定は探索率100%から選べます';
    const enemy = o.target.enemy;
    if (!grid.cells.some((c) => (c.kind === 'nest' || BOSS_KINDS.includes(c.kind)) && c.enemy === enemy)) return 'その敵の巣はこのフロアにありません';
  }
  if (o.action === 'boss' && !visited.some((i) => BOSS_KINDS.includes(grid.cells[i]?.kind))) return 'ボスの居場所をまだ踏んでいません';
  return null;
}

/**
 * 派遣中の隊を今日の位置から拠点へ引き返させる。現地の成果は捨て、出発時に引いた道中はそのまま使う
 * (往路の途中で引き返しても往路・復路の遭遇は全部残す。日単位で切り分けない簡略)。
 */
export function recall(s: GameState, expeditionId: string): Result {
  const e = s.expeditions.find((x) => x.id === expeditionId) as ExpeditionEx | undefined;
  if (!e) return fail('その隊は派遣中ではありません');
  if (e.recalledDay !== null) return fail('その隊はもう呼び戻しています');
  const now = e.steps.filter((st) => st.day <= s.day).pop();
  const legs = e.legs;
  if (!legs || !now || now.phase === 'return') return fail('その隊はもう帰路についています');
  e.recalledDay = s.day;
  // 往路で全滅した隊は全滅の日に引き返す表になっている。結果を明かさないよう、受け付けるだけにする
  if (legs.out.wiped) return ok();
  e.steps = turnBack(e.steps, s.day);
  e.returnDay = e.steps[e.steps.length - 1].day;
  e.order.target.route = reachedNodes(legs.outNodes, e.steps, s.world);
  const walked = s.day - e.startDay + 1;
  const r = combineLegs(legs.out, null, legs.back, legs.items, walked);
  const at = r.log.findIndex((l) => l.day > walked);
  r.log.splice(at < 0 ? r.log.length : at, 0, { day: walked, kind: 'event', text: 'ギルドからの呼び戻しを受け、引き返した。' });
  r.success = false;
  r.retreated = true;
  const crew = e.order.partyIds.map((id) => s.adventurers.find((a) => a.id === id)).filter((a): a is Adventurer => !!a);
  r.returnDialogue = returnDialogue(rngFor(s.seed, 'rdlg', e.id), crew, 'retreat');
  e.result = r;
  return ok();
}

function finalOutcome(r: ExpeditionResult, days: number, hadSite: boolean): ReturnOutcome {
  return r.wiped ? 'wipe' : r.retreated ? 'retreat' : hadSite && r.daysSpent < days ? 'early' : 'success';
}

function outcomeLabel(e: Expedition): string {
  const r = e.result;
  return r.wiped ? '全滅' : r.retreated ? '撤退' : '帰還';
}

function applyReturn(s: GameState, e: Expedition, notices: string[]) {
  const r = e.result;
  const legs = (e as ExpeditionEx).legs;
  delete (e as ExpeditionEx).legs;
  const isDungeon = !QUEST_ACTIONS.includes(e.order.action);
  const dungeonId = isDungeon ? e.order.target.dungeon ?? '' : '';
  // 経路を持たない古いセーブの隊は、行き先に着いたものとして扱う
  const reached = e.order.target.route ?? [HOME, ...(DUNGEON[dungeonId] ? [DUNGEON[dungeonId].node] : [])];
  const dest = reached[reached.length - 1] ?? HOME;
  const place = isDungeon ? DUNGEON[dungeonId]?.name ?? dungeonId : NODE[dest]?.name ?? dest;
  const members = e.order.partyIds.map((id) => s.adventurers.find((a) => a.id === id)).filter((a): a is Adventurer => !!a);
  // 経験値が入る前の、出発時と同じ戦力で比べる
  const power = members.reduce((t, m) => t + powerOf(m), 0);

  // 鍵は在庫に最大1個。同時に出た2隊が同じ鍵の宝箱を取っても増やさない
  for (const [k, n] of Object.entries(r.items)) addInventory(s, k, ITEM[k]?.kind === 'key' ? Math.max(0, Math.min(n, 1 - (s.inventory[k] ?? 0))) : n);
  for (const [k, n] of Object.entries(r.materials)) addInventory(s, k, n);
  if (r.gold) { s.gold += r.gold; ledger(s, `拾得金: ${place}`, r.gold); }
  if (r.rescueCost) { s.gold -= r.rescueCost; ledger(s, `救助費用: ${place}`, -r.rescueCost); }

  const totalKills = Object.values(r.kills).reduce((t, n) => t + n, 0);
  for (const m of members) {
    m.status = 'idle';
    m.fatigue = clamp(m.fatigue + (r.fatigue[m.id] ?? 0), 0, 100);
    const rawInj = r.injuries[m.id] ?? 0;
    const inj = rawInj ? Math.max(1, rawInj + bonus(s, 'injuryDays')) : 0;
    if (inj) m.injuryDays = Math.max(m.injuryDays, inj);
    // 全滅は全員が負傷扱いになるので、負傷の−3を重ねず全滅の−20だけにする
    if (r.wiped) addLoyalty(m, T.loyaltyWipe);
    else {
      if (r.success) addLoyalty(m, T.loyaltySuccess);
      if (inj) addLoyalty(m, T.loyaltyInjured);
    }
    const ups = addExp(m, Math.round((r.expGain[m.id] ?? 0) * (1 + bonus(s, 'expMult')) * achievementExpMult(s)));
    if (ups) notices.push(`${m.name}がLv${m.level}に上がった。`);
    for (const t of r.revealedTraits) {
      if (t.advId !== m.id) continue;
      const trait = m.traits.find((x) => x.id === t.traitId);
      if (trait) trait.revealed = true;
    }
    m.history.expeditions++;
    m.history.kills += Math.round(totalKills / Math.max(1, members.length));
    if (isDungeon) m.history.visits[dungeonId] = (m.history.visits[dungeonId] ?? 0) + 1;
  }
  for (const d of r.relationDeltas) {
    const a = s.adventurers.find((x) => x.id === d.a);
    const b = s.adventurers.find((x) => x.id === d.b);
    if (a && b) addRelation(s.relations, a, b, d.delta);
  }
  for (const md of r.mapDeltas) {
    const prog = s.dungeons[md.dungeon];
    if (!prog) continue;
    const fl = (prog.floors[md.floor] ??= { visited: [], hiddenFound: [] });
    fl.visited = [...new Set([...fl.visited, ...md.cells])];
    fl.hiddenFound = [...new Set([...fl.hiddenFound, ...md.hidden])];
  }
  const prog = s.dungeons[dungeonId];
  const def = DUNGEON[dungeonId];
  if (prog && def) {
    // 現地に着いていれば全滅しても入口は見ているので、踏査は結果を問わず確認済みにする
    if (e.order.action === 'survey' && !prog.confirmed && reached.includes(def.node)) {
      prog.confirmed = true;
      notices.push(`${place}の入口を確認した。`);
    }
    const bossEnemies = new Set(def.floors.flatMap((f) => parseFloor(f).cells.filter((c) => BOSS_KINDS.includes(c.kind)).map((c) => c.enemy!)));
    for (const [k, n] of Object.entries(r.kills)) if (bossEnemies.has(k)) prog.bossDefeated += n;
    if (!prog.fullCleared && def.floors.every((f) => exploredRateOf(s, dungeonId, f.id) >= 1)) {
      prog.fullCleared = true;
      notices.push(`${place}を踏破した(探索率100%)。`);
    }
  }

  // 竜の討伐は、どのダンジョンの帰還でも kills で見る(道中の戦闘で倒すことはないが、定義に依存しないため)
  if ((r.kills.dragon ?? 0) > 0) onDragonDefeated(s, notices);

  // 帰りの道は、往路を最後まで行けたときだけ依頼の経路(to→拠点)を通る
  const fullOut = !!legs && reached.length === legs.outNodes.length;
  s.world.visitedNodes = [...new Set([...s.world.visitedNodes, ...reached, ...(fullOut ? legs!.backNodes : [])])];
  // 隠し道は住民との関係で開く(第2節)。今は「山村を3回訪れる」だけで、依頼や関係値による開き方はフェーズ5以降
  if (reached.includes(SHORTCUT_VILLAGE)) {
    const n = (Number(s.flags[`visits:${SHORTCUT_VILLAGE}`]) || 0) + 1;
    s.flags[`visits:${SHORTCUT_VILLAGE}`] = n;
    if (n >= SHORTCUT_VISITS && !s.world.foundEdges.includes(SHORTCUT_EDGE)) {
      s.world.foundEdges.push(SHORTCUT_EDGE);
      notices.push('山村の住民が、古い坑道への近道を教えてくれた。');
    }
  }
  for (const st of e.steps) if (st.edge && EDGE[st.edge]) s.world.measuredDanger[st.edge] = EDGE[st.edge].danger;
  progressFromReturn(s, e, notices);

  if (r.success && !s.flags.hadSuccess) {
    s.flags.hadSuccess = true;
    addTag(s, 'return_first_success');
  }
  if (r.success && def && power < def.recommended * UNDERDOG_RATIO) addTag(s, 'return_underdog');

  e.claimed = true;
  s.history.unshift(e);
  if (s.history.length > HISTORY_MAX) s.history.length = HISTORY_MAX;
  const names = members.map((m) => m.name).join('・');
  if (isDungeon) {
    const rate = Math.round(exploredRateOf(s, dungeonId, e.order.target.floor ?? 'f1') * 100);
    notices.push(`${names}が${place}から${outcomeLabel(e)}した(探索率 ${rate}%)。`);
  } else {
    notices.push(`${names}が${e.order.action === 'escort' ? '護衛' : '運搬'}(${place}まで)から${outcomeLabel(e)}した。`);
  }
}

export function advanceDay(s: GameState): DayReport {
  const notices: string[] = [];
  const idle = s.flags.dispatchedDay !== s.day && s.flags.hiredDay !== s.day && s.expeditions.length === 0;

  if (s.day <= T.supportDays) {
    s.gold += T.supportGold;
    ledger(s, '初期支援金', T.supportGold);
  }
  const wages = s.adventurers.reduce((t, a) => t + a.salary, 0);
  s.gold -= wages + UPKEEP_PER_DAY;
  ledger(s, '日給(全冒険者)', -wages);
  ledger(s, 'ギルド維持費', -UPKEEP_PER_DAY);
  const facilityCost = facilityUpkeep(s);
  s.gold -= facilityCost;
  ledger(s, '施設維持費', -facilityCost);
  if (s.gold < 0) {
    const interest = Math.ceil(-s.gold * T.debtInterest);
    s.gold -= interest;
    ledger(s, '借金の利息', -interest);
    s.debt = true;
    s.rep = Math.max(0, s.rep + T.debtRep);
    for (const a of s.adventurers) addLoyalty(a, T.debtLoyalty);
    notices.push('資金がマイナスです。利息がかかり、忠誠と評判が下がりました。');
  } else s.debt = false;
  if (idle) addTag(s, 'day_idle');

  s.day++;

  // 帰還日の隊はまだ s.expeditions にいるので、その隊の依頼は納期切れにならず帰還の判定に回る
  expireQuests(s, notices);
  const returned = s.expeditions.filter((e) => e.returnDay <= s.day);
  s.expeditions = s.expeditions.filter((e) => e.returnDay > s.day);
  for (const e of returned) applyReturn(s, e, notices);
  // 親友とユニークの頼みは、忠誠・関係値・地図の反映が済んだ後の状態で数える
  for (const e of returned) onReturn(s, e, notices);
  completeConstructions(s, notices);
  completeCrafts(s, notices);
  // 完成したその日から産む
  dailyProduction(s, notices);
  completeTraining(s, notices);
  advanceUniqueChain(s, notices);

  const returnedIds = new Set(returned.flatMap((e) => e.order.partyIds));
  const rest = T.restFatigue - bonus(s, 'fatigueRecover');
  const idleExp = synergyValue(s, 'idleExp');
  for (const a of s.adventurers) {
    // 派遣中だけ回復しない。訓練中・勤務中は待機と同じに休める
    if (a.status === 'away' || returnedIds.has(a.id)) continue;
    a.fatigue = Math.max(0, a.fatigue + rest);
    if (a.injuryDays > 0) a.injuryDays--;
    if (idleExp && a.status === 'idle' && addExp(a, idleExp)) notices.push(`${a.name}がLv${a.level}に上がった。`);
  }
  for (const a of s.adventurers) addLoyalty(a, T.dailyLoyalty);
  const mails = applyResignations(s, notices);
  mails.push(...checkMails(s, rngFor(s.seed, 'mail', s.day), notices));

  expireCandidates(s);
  arriveCandidates(s, rngFor(s.seed, 'recruit', s.day));
  generateDailyQuests(s, rngFor(s.seed, 'quests', s.day), roadInfoOf(s));
  const scene = resolveScenes(s, rngFor(s.seed, 'scenes', s.day));
  const lv = repLevel(s.rep);
  const noticed = typeof s.flags.repLevelNoticed === 'number' ? s.flags.repLevelNoticed : 1;
  if (lv > noticed) {
    s.flags.repLevelNoticed = lv;
    notices.push(`ギルドの評判が上がった(Lv${lv}、評判${REP_LEVELS[lv - 1]}〜)。候補者の数と質、受けられる依頼が増える。`);
  }

  // 竜の討伐と帰還・依頼・建設の反映が済んだ後に数える(竜を倒した日のうちに s_dragon が付く)
  checkAchievements(s, notices);

  for (const n of notices) s.notices.unshift({ day: s.day, text: n });
  if (s.notices.length > NOTICES_MAX) s.notices.length = NOTICES_MAX;
  return { day: s.day, returned, notices, scene, mails };
}

/** 素材を n 個売ったときの額。UI の表示と売却で同じ額を使う */
export function sellGold(s: GameState, item: string, n: number): number {
  return Math.round((has(ITEM, item) ? ITEM[item].price : 0) * n * T.sellScale * (1 + bonus(s, 'sellMult')));
}

export function sellMaterial(s: GameState, item: string, n: number): Result {
  const def = has(ITEM, item) ? ITEM[item] : undefined;
  if (!def || def.kind !== 'material') return fail('売れるのは素材だけです');
  if (!isCount(n) || n < 1) return fail('個数が不正です');
  if ((s.inventory[item] ?? 0) < n) return fail(`${def.name}が足りません`);
  addInventory(s, item, -n);
  const gold = sellGold(s, item, n);
  s.gold += gold;
  ledger(s, `素材売却: ${def.name}×${n}`, gold);
  return ok();
}

export function buyItem(s: GameState, item: string, n: number): Result {
  if (!BUYABLE.includes(item) || !has(ITEM, item)) return fail('その品は扱っていません');
  if (!isCount(n) || n < 1) return fail('個数が不正です');
  const def = ITEM[item];
  const cost = def.price * n;
  if (s.gold < cost) return fail('資金が足りません');
  s.gold -= cost;
  addInventory(s, item, n);
  ledger(s, `購入: ${def.name}×${n}`, -cost);
  return ok();
}

export function exploredRateOf(s: GameState, dungeonId: string, floorId: string): number {
  const def = DUNGEON[dungeonId]?.floors.find((f) => f.id === floorId);
  if (!def) return 0;
  return exploredRate(parseFloor(def), s.dungeons[dungeonId]?.floors[floorId]?.visited ?? []);
}
