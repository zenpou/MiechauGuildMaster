// ゲーム状態の進行。派遣は出発時に simulateExploration で全部確定し、帰還日に applyReturn で開示する。
import { addExp, generateAdventurer, salaryOf } from './adventurer';
import { DUNGEON, ITEM, JOB, POLICY, TUNING } from './data';
import { exploredRate, parseFloor } from './dungeon';
import { simulateExploration } from './explore';
import { addRelation } from './relations';
import { rngFor } from './rng';
import { emptyState } from './state';
import {
  LOYALTY_MAX, PARTIES_MAX, PARTY_MAX,
  type ActionKind, type Adventurer, type DispatchOrder, type Expedition, type GameState,
} from './types';

// sim で調整する値は src/data/tuning.json
const T = TUNING.game;
export const START_GOLD = T.startGold;
export const START_POTIONS = T.startPotions;
export const UPKEEP_PER_DAY = T.upkeepPerDay;
const START_JOBS = ['fighter', 'warrior', 'priest', 'scout'];
const BUYABLE = ['potion'];
const LEDGER_MAX = 300;
const NOTICES_MAX = 80;
const HISTORY_MAX = 40;
/** 今出せる行動。escort / transport はフェーズ4 */
const ACTIONS: ActionKind[] = ['explore', 'gather', 'hunt', 'boss', 'survey'];
const BOSS_KINDS = ['symbol', 'boss'];

export type Result = { ok: true } | { ok: false; reason: string };
export interface DayReport { day: number; returned: Expedition[]; notices: string[] }

const ok = (): Result => ({ ok: true });
const fail = (reason: string) => ({ ok: false as const, reason });
const has = <V>(table: Record<string, V>, key: string) => Object.prototype.hasOwnProperty.call(table, key);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

function ledger(s: GameState, label: string, amount: number) {
  if (amount === 0) return;
  s.ledger.unshift({ day: s.day, label, amount });
  if (s.ledger.length > LEDGER_MAX) s.ledger.length = LEDGER_MAX;
}

function addLoyalty(a: Adventurer, delta: number) {
  a.loyalty = clamp(a.loyalty + delta, 0, LOYALTY_MAX);
}

function addInventory(s: GameState, item: string, n: number) {
  const v = (s.inventory[item] ?? 0) + n;
  if (v > 0) s.inventory[item] = v;
  else delete s.inventory[item];
}

export const dailyCost = (s: GameState) => s.adventurers.reduce((t, a) => t + a.salary, 0) + UPKEEP_PER_DAY;

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
    s.adventurers.push(a);
  });
  s.world.visitedNodes = ['base'];
  s.inventory.potion = START_POTIONS;
  return s;
}

export function dispatch(s: GameState, o: DispatchOrder): { ok: true; expedition: Expedition } | { ok: false; reason: string } {
  if (!o || typeof o !== 'object' || !Array.isArray(o.partyIds)) return fail('派遣内容が不正です');
  const dungeonId = o.target?.dungeon ?? '';
  const dungeon = has(DUNGEON, dungeonId) ? DUNGEON[dungeonId] : undefined;
  const progress = s.dungeons[dungeonId];
  if (!dungeon || !progress) return fail('行き先のダンジョンが分かりません');
  const floorId = o.target.floor ?? 'f1';
  const floorDef = dungeon.floors.find((f) => f.id === floorId);
  if (!floorDef) return fail('行き先のフロアが分かりません');
  const actionError = checkAction(s, o, dungeonId, floorId);
  if (actionError) return fail(actionError);
  if (!has(POLICY, o.policy)) return fail('方針が不正です');
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > T.daysMax) return fail(`日数は1〜${T.daysMax}日で指定してください`);
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
  const items = o.items ?? {};
  for (const [k, n] of Object.entries(items)) {
    if (!has(ITEM, k) || !isCount(n)) return fail('持ち物の指定が不正です');
    if ((s.inventory[k] ?? 0) < n) return fail(`${ITEM[k].name}の在庫が足りません`);
  }

  // 帰還日まで隊員の状態は変わらないが、シミュレーション中の書き換えから在籍データを守るため複製を渡す
  const result = simulateExploration({
    rng: rngFor(s.seed, 'exp', s.counters.dispatches),
    dungeon, floorId,
    members: members.map((m) => structuredClone(m)), leaderId: o.leaderId, policy: o.policy,
    progress, days: o.days, items: { ...items }, relations: s.relations, startDay: s.day,
    action: o.action, target: { item: o.target.item, enemy: o.target.enemy },
  });
  const expedition: Expedition = {
    id: `e${s.counters.nextId++}`,
    order: structuredClone({ ...o, items }),
    // 採り尽くし・討伐完了で早帰りした隊は、予定日数ではなく実際の日数で戻る
    startDay: s.day, returnDay: s.day + Math.max(1, result.daysSpent),
    steps: [], result, recalledDay: null, claimed: false,
  };
  s.counters.dispatches++;
  for (const m of members) m.status = 'away';
  for (const [k, n] of Object.entries(items)) addInventory(s, k, -n);
  s.expeditions.push(expedition);
  return { ok: true, expedition };
}

/** 行動種別ごとの出発条件。問題なければ null */
function checkAction(s: GameState, o: DispatchOrder, dungeonId: string, floorId: string): string | null {
  if (!ACTIONS.includes(o.action)) return 'その行動はまだ選べません';
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

export function recall(s: GameState, expeditionId: string): Result {
  if (!s.expeditions.some((e) => e.id === expeditionId)) return fail('その隊は派遣中ではありません');
  return fail('呼び戻しはまだできません(ワールド移動の実装後に対応)');
}

function outcomeLabel(e: Expedition): string {
  const r = e.result;
  return r.wiped ? '全滅' : r.retreated ? '撤退' : '帰還';
}

function applyReturn(s: GameState, e: Expedition, notices: string[]) {
  const r = e.result;
  const dungeonId = e.order.target.dungeon ?? '';
  const place = DUNGEON[dungeonId]?.name ?? dungeonId;
  const members = e.order.partyIds.map((id) => s.adventurers.find((a) => a.id === id)).filter((a): a is Adventurer => !!a);

  for (const [k, n] of Object.entries(r.items)) addInventory(s, k, n);
  for (const [k, n] of Object.entries(r.materials)) addInventory(s, k, n);
  if (r.gold) { s.gold += r.gold; ledger(s, `拾得金: ${place}`, r.gold); }
  if (r.rescueCost) { s.gold -= r.rescueCost; ledger(s, `救助費用: ${place}`, -r.rescueCost); }

  const totalKills = Object.values(r.kills).reduce((t, n) => t + n, 0);
  for (const m of members) {
    m.status = 'idle';
    m.fatigue = clamp(m.fatigue + (r.fatigue[m.id] ?? 0), 0, 100);
    const inj = r.injuries[m.id] ?? 0;
    if (inj) m.injuryDays = Math.max(m.injuryDays, inj);
    // 全滅は全員が負傷扱いになるので、負傷の−3を重ねず全滅の−20だけにする
    if (r.wiped) addLoyalty(m, T.loyaltyWipe);
    else {
      if (r.success) addLoyalty(m, T.loyaltySuccess);
      if (inj) addLoyalty(m, T.loyaltyInjured);
    }
    const ups = addExp(m, r.expGain[m.id] ?? 0);
    if (ups) notices.push(`${m.name}がLv${m.level}に上がった。`);
    for (const t of r.revealedTraits) {
      if (t.advId !== m.id) continue;
      const trait = m.traits.find((x) => x.id === t.traitId);
      if (trait) trait.revealed = true;
    }
    m.history.expeditions++;
    m.history.kills += Math.round(totalKills / Math.max(1, members.length));
    m.history.visits[dungeonId] = (m.history.visits[dungeonId] ?? 0) + 1;
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
    // 全滅しても入口までは辿り着いているので、踏査は結果を問わず確認済みにする
    if (e.order.action === 'survey' && !prog.confirmed) {
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

  e.claimed = true;
  s.history.unshift(e);
  if (s.history.length > HISTORY_MAX) s.history.length = HISTORY_MAX;
  const rate = Math.round(exploredRateOf(s, dungeonId, e.order.target.floor ?? 'f1') * 100);
  notices.push(`${members.map((m) => m.name).join('・')}が${place}から${outcomeLabel(e)}した(探索率 ${rate}%)。`);
}

export function advanceDay(s: GameState): DayReport {
  const notices: string[] = [];

  const wages = s.adventurers.reduce((t, a) => t + a.salary, 0);
  s.gold -= wages + UPKEEP_PER_DAY;
  ledger(s, '日給(全冒険者)', -wages);
  ledger(s, 'ギルド維持費', -UPKEEP_PER_DAY);
  if (s.gold < 0) {
    const interest = Math.ceil(-s.gold * T.debtInterest);
    s.gold -= interest;
    ledger(s, '借金の利息', -interest);
    s.debt = true;
    s.rep = Math.max(0, s.rep + T.debtRep);
    for (const a of s.adventurers) addLoyalty(a, T.debtLoyalty);
    notices.push('資金がマイナスです。利息がかかり、忠誠と評判が下がりました。');
  } else s.debt = false;

  s.day++;

  const returned = s.expeditions.filter((e) => e.returnDay <= s.day);
  s.expeditions = s.expeditions.filter((e) => e.returnDay > s.day);
  for (const e of returned) applyReturn(s, e, notices);

  const returnedIds = new Set(returned.flatMap((e) => e.order.partyIds));
  for (const a of s.adventurers) {
    if (a.status !== 'idle' || returnedIds.has(a.id)) continue;
    a.fatigue = Math.max(0, a.fatigue + T.restFatigue);
    if (a.injuryDays > 0) a.injuryDays--;
  }
  for (const a of s.adventurers) addLoyalty(a, T.dailyLoyalty);

  for (const n of notices) s.notices.unshift({ day: s.day, text: n });
  if (s.notices.length > NOTICES_MAX) s.notices.length = NOTICES_MAX;
  return { day: s.day, returned, notices };
}

export function sellMaterial(s: GameState, item: string, n: number): Result {
  const def = has(ITEM, item) ? ITEM[item] : undefined;
  if (!def || def.kind !== 'material') return fail('売れるのは素材だけです');
  if (!isCount(n) || n < 1) return fail('個数が不正です');
  if ((s.inventory[item] ?? 0) < n) return fail(`${def.name}が足りません`);
  addInventory(s, item, -n);
  const gold = def.price * n;
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
