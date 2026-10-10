// 竜までの bot: メール・雇用・施設・装備・転職・依頼をこなしながら、森の洞窟から竜の寝床の竜まで順に攻める。
// 竜の討伐までの日数の分布、進行のマイルストーン、討伐できなかった seed がどこで・なぜ止まったかを測る。
// 使い方: npm run sim:dragon -- [seeds=10] [days=200] [--seed N]
import { effectiveStats, equipResist, jobAptitude, powerOf } from '../src/core/adventurer';
import { activeSynergies, assignWorker, facilityLevel, unassignWorker, upgrade } from '../src/core/base';
import { canCraft, craftGold, startCraft } from '../src/core/craft';
import { DUNGEON, ENEMY, FACILITY, ITEM, JOB, PERSONALITY, RECIPE, RECIPES, TUNING } from '../src/core/data';
import { isPassable, parseFloor, visibleFrom } from '../src/core/dungeon';
import { equip } from '../src/core/equipment';
import { cellDepths, floorTransit } from '../src/core/explore';
import { acceptQuest, advanceDay, buildFacility, dailyCost, dispatch, exploredRateOf, newGame, sellMaterial } from '../src/core/game';
import { canChangeJob, changeJob, promotionCost, promotionOptions } from '../src/core/jobs';
import { heldKeys } from '../src/core/ledger';
import { dispatchBlock, markRead, replyMail } from '../src/core/mail';
import { activeMax, activeQuests, deliver, recipeUnlocked, visibleQuests } from '../src/core/quests';
import { assessReadiness, type Readiness } from '../src/core/readiness';
import { capacity, hire, hireFee } from '../src/core/recruit';
import { canTrain, trainSkill } from '../src/core/training';
import { PARTY_MAX, type ActionKind, type Adventurer, type CellDef, type DispatchOrder, type GameState, type LedgerEntry, type Mail, type Quest } from '../src/core/types';
import { travelDays } from '../src/core/world';

const args = process.argv.slice(2);
const seedAt = args.indexOf('--seed');
const ONE_SEED = seedAt >= 0 ? Number(args[seedAt + 1]) : null;
if (ONE_SEED !== null && !Number.isInteger(ONE_SEED)) {
  console.error('--seed には整数を指定する');
  process.exit(1);
}
const nums = args.filter((a, i) => /^\d+$/.test(a) && !(seedAt >= 0 && i === seedAt + 1)).map(Number);
// --seed のときは数字1つめが日数
const SEEDS = ONE_SEED === null ? nums[0] ?? 10 : 1;
const LAST_DAY = (ONE_SEED === null ? nums[1] : nums[0]) ?? 200;

const HOME = 'base';
const POLICY_ID = 'standard';
/** core の上限は4隊だが、先端・その1つ前・依頼の3役に分ける */
const PARTIES = 3;
const MIN_PARTY = 2;
const REST_FATIGUE = 50;
/** 昇給は資金が日給合計のこの日数分あるときだけ承認(playstyles と同じ) */
const RAISE_RESERVE_DAYS = 5;
/** 雇用・建設の前に手元に残す額 = 日給合計×この日数 */
const RESERVE_DAYS = 6;
/** 「余裕があれば」= 払った後も reserve のこの倍が残る(増築・転職・訓練・上等な薬) */
const SPARE_MULT = 2;
const SITE_DAYS = 3;
const DAYS_MAX = TUNING.game.daysMax;
const STEPS_PER_DAY = TUNING.explore.baseSteps;
const TRAIN_GOLD = TUNING.training.gold;
const POTIONS_KEEP = 8;
const HI_POTIONS_KEEP = 4;
const PARTY_POTIONS = 2;
const FIRE_NEED = 0.3;
/** 先端の readiness の予測でこれ以上なら「危険」と同じに扱う */
const RETREAT_DANGER = 0.5;
const WIPE_DANGER = 0.2;
/** 先端の探索がこの回数続けて探索率を増やさなければ、その階の探索は打ち切る */
const STALL_TRIPS = 3;
const IRON_QUEST = 'u_forge_iron';
const TRAIN_SKILLS = ['might', 'tough'];

interface Stage { dungeon: string; floor: string }
/** 進行の並び。先端 = 最初の未完了。完了 = 探索し終えた(explored) かつ その階の主(symbol/boss)を倒した */
const STAGES: Stage[] = [
  { dungeon: 'forest_cave', floor: 'f1' },
  { dungeon: 'old_mine', floor: 'f1' },
  { dungeon: 'ruined_tower', floor: 'f1' },
  { dungeon: 'ruined_tower', floor: 'f2' },
  { dungeon: 'frost_valley', floor: 'f1' },
  { dungeon: 'sunken_ruins', floor: 'f1' },
  { dungeon: 'sunken_ruins', floor: 'f2' },
  { dungeon: 'dragon_lair', floor: 'f1' },
  { dungeon: 'dragon_lair', floor: 'f2' },
];
const LAIR = 'dragon_lair';
// 熾火の指輪は人数分の材料集めに日数がかかるので、竜の寝床が先端になってからでは遅い。紋章のある階から備える
const FIRE_FROM = STAGES.findIndex((st) => st.dungeon === 'sunken_ruins' && st.floor === 'f2');
const stageName = (i: number) => (i < 0 ? 'なし' : i >= STAGES.length ? '全部' : `${DUNGEON[STAGES[i].dungeon].name}${STAGES[i].floor}`);

const BOSS_KINDS = ['symbol', 'boss'];
const keyOf = (dungeon: string, floor: string) => `${dungeon}:${floor}`;
const GRID = Object.fromEntries(Object.values(DUNGEON).flatMap((d) => d.floors.map((f) => [keyOf(d.id, f.id), parseFloor(f)])));
/** 主の敵 → いる階 */
const BOSS_FLOOR = new Map<string, string>();
for (const [k, g] of Object.entries(GRID)) for (const c of g.cells) if (BOSS_KINDS.includes(c.kind) && c.enemy) BOSS_FLOOR.set(c.enemy, k);
const DEPTH = Object.fromEntries(Object.entries(GRID).map(([k, g]) => [k, cellDepths(g)]));
const hasBoss = (k: string) => GRID[k].cells.some((c) => BOSS_KINDS.includes(c.kind));

// 施設: 12シナジーが同時に成立する固定配置と、建てる順
const LAYOUT: Record<string, [number, number]> = {
  library: [0, 0], clinic: [1, 0], sawmill: [2, 0], quarry: [3, 0],
  training: [0, 1], dorm: [1, 1], bath: [2, 1],
  map_room: [0, 2], tavern: [1, 2],
  watchtower: [0, 3], reception: [1, 3], market: [2, 3], smithy: [3, 3], workshop: [4, 3],
  alchemy: [4, 4],
};
const BUILD_ORDER = ['workshop', 'alchemy', 'training', 'dorm', 'sawmill', 'quarry', 'clinic', 'library', 'smithy', 'market', 'reception', 'tavern', 'bath', 'map_room', 'watchtower'];
const WORK_AT = ['workshop', 'alchemy', 'sawmill', 'quarry'];

// 装備の強さ順
const WEAPONS = ['moon_blade', 'frost_edge', 'crystal_blade', 'iron_sword', 'bone_dagger'];
// 軽・中・重それぞれの順は守ったまま防御の高い順に1列にする。複数の種類を着られる職があるので
const ARMORS = ['guardian_plate', 'frost_mail', 'pelt_cloak', 'iron_armor', 'cloth_robe', 'studded_armor', 'leather_armor'];
const ACCESSORIES = ['ice_charm', 'moss_charm', 'fang_necklace'];
const ACCESSORIES_FIRE = ['ember_ring', 'ruin_amulet', ...ACCESSORIES];
const RECIPE_OF = Object.fromEntries(RECIPES.map((r) => [r.output.item, r]));
const ACTION_NAME: Record<ActionKind, string> = {
  explore: '探索', gather: '採集', hunt: '討伐', boss: '主討伐', survey: '踏査', escort: '護衛', transport: '運搬',
};

type Role = 'front' | 'support' | 'quest';
interface Plan { action: ActionKind; target: DispatchOrder['target']; days: number; label: string; questId?: string }

const REASONS = ['火耐性が足りない', 'readiness が危険', '資金が無く製作できない', '素材が足りない', '隊員が足りない', '依頼で隊を取られる'] as const;
/** 指示の6つに当てはまらない止まり方。見つけたら別に数える */
const EXTRA_REASONS = ['竜の前の資金・回復薬が足りない', '下の階へ行けない(階段・鍵)', '先端の探索が進まない'] as const;
type Reason = (typeof REASONS)[number] | (typeof EXTRA_REASONS)[number];

const MILESTONES = [
  ...['forest_cave', 'old_mine', 'ruined_tower', 'frost_valley', 'sunken_ruins', 'dragon_lair'].map((d) => ({ id: `boss:${d}`, label: `${DUNGEON[d].name}の主を初めて倒した日` })),
  { id: 'promote', label: '最初の転職(上級職)の日' },
  { id: 'fac5', label: '施設が5つ完成した日' },
  { id: 'fac10', label: '施設が10完成した日' },
  { id: 'ach10', label: '実績10個の日' },
  { id: 'crest', label: '竜の紋章を取った日' },
  { id: 'lair', label: '竜の寝床の入口を確認した日' },
];

interface Run {
  seed: number;
  dragonDay: number | null;
  endDay: number;
  ms: Record<string, number | null>;
  gold: number; roster: number; avgLevel: number; upper: number;
  facilities: number; synergies: number; achievements: number; fire: number;
  questsDone: number; questsFailed: number; failedTypes: string;
  lastDone: number;
  /** 探索率100%未満(隠し通路・扉の奥を残したまま)で完了とした階 */
  partial: string[];
  trying: string;
  /** 今の先端で止まっていた日数と、理由ごとの日数 */
  stuckDays: number;
  reasons: Partial<Record<Reason, number>>;
  /** 台帳の項目(ラベルの「:」より前)ごとの合計 */
  flows: Record<string, number>;
}

function runSeed(seed: number, log: boolean): Run {
  const s: GameState = newGame(seed);
  const roles = new Map<string, Role>();
  const questOf = new Map<string, string>();
  const labels = new Map<string, string>();
  /** 先端へ出した隊: 遠征ID → 出発時の探索率(帰還で進んだかを見る) */
  const frontRate = new Map<string, { stage: number; rate: number }>();
  const bossKilled = new Set<string>();
  /** 階ごとの、探索率が増えなかった探索の続いた回数(先端の探索だけ数える) */
  const stalls = new Map<string, number>();
  const ms: Record<string, number | null> = Object.fromEntries(MILESTONES.map((m) => [m.id, null]));
  let front = 0;
  let frontSince = s.day;
  let reasons: Partial<Record<Reason, number>> = {};
  let today = new Set<Reason>();
  let trying = '';
  let acts: string[] = [];
  /** 製作の目標が止まっている理由(その日の製作で記録し、先端が止まった日に添える) */
  let craftBlock = new Set<Reason>();
  const flows: Record<string, number> = {};
  // 台帳は先頭に積まれ300件で切られるので、日ごとに前日の先頭までを足し込む
  const tally = (head: LedgerEntry | undefined) => {
    for (const e of s.ledger) {
      if (e === head) break;
      const k = e.label.split(/[:(]/)[0].trim();
      flows[k] = (flows[k] ?? 0) + e.amount;
    }
  };

  // 地図・鍵・確認済みは日送りでしか変わらないので、それに依る計算は1日の間だけ使い回す(毎日の判断で何百回も呼ぶため)
  let memo = new Map<string, unknown>();
  const cached = <T>(key: string, f: () => T): T => {
    if (!memo.has(key)) memo.set(key, f());
    return memo.get(key) as T;
  };
  const payroll = () => s.adventurers.reduce((t, a) => t + a.salary, 0);
  const reserve = () => payroll() * RESERVE_DAYS;
  const spare = (cost: number) => s.gold - cost >= SPARE_MULT * reserve();
  /** 隊に入れられる人。勤務中は出発の前に外すので含める */
  const ready = (a: Adventurer) => (a.status === 'idle' || a.status === 'working') && a.injuryDays === 0 && a.fatigue < REST_FATIGUE;
  const byPower = (xs: Adventurer[]) => [...xs].sort((a, b) => powerOf(b) - powerOf(a));
  const have = (item: string) => s.inventory[item] ?? 0;
  const crafting = (item: string) => s.crafts.filter((j) => RECIPE[j.recipeId]?.output.item === item).length;

  // ---- 進行 ----
  const rateOf = (st: Stage) => exploredRateOf(s, st.dungeon, st.floor);
  /**
   * 見える範囲を歩き尽くした = 踏んだマスの隣に、今の知識(鍵・見つけた隠し通路)で入れる未踏のマスが無い。
   * 探索の隊は歩き尽くすと即日引き返して隠し通路の発見を試さないので、100%を待つと隠し通路を見逃した seed が永久に止まる。
   * 先端の完了はこれでも認め、100%未満で先へ進んだ階は記録する
   */
  const exhausted = (st: Stage) => cached(`ex:${st.dungeon}:${st.floor}`, () => isExhausted(st));
  const isExhausted = (st: Stage) => {
    const fp = s.dungeons[st.dungeon]?.floors[st.floor];
    if (!fp?.visited.length) return false;
    const g = GRID[keyOf(st.dungeon, st.floor)];
    const visited = new Set(fp.visited);
    const know = { keys: heldKeys(s), hiddenFound: fp.hiddenFound };
    for (const i of visited) for (const n of visibleFrom(g, i)) if (!visited.has(n) && isPassable(g, n, know)) return false;
    return true;
  };
  /**
   * 探索で広げられるところは広げた。入れる未踏のマスが残っていても、探索の目標選びが深いマスや巣を優先して
   * 入口近くの1マスを永久に踏まない seed があったので、探索率が増えない探索が続いたら打ち切る
   */
  const explored = (st: Stage) => rateOf(st) >= 1 || exhausted(st) || (stalls.get(keyOf(st.dungeon, st.floor)) ?? 0) >= STALL_TRIPS;
  const stageDone = (st: Stage) => {
    const k = keyOf(st.dungeon, st.floor);
    return explored(st) && (!hasBoss(k) || bossKilled.has(k));
  };
  const frontier = () => {
    const i = STAGES.findIndex((st) => !stageDone(st));
    return i < 0 ? STAGES.length : i;
  };
  const transitOf = (st: Stage) => cached(`tr:${st.dungeon}:${st.floor}`, () => (s.dungeons[st.dungeon]?.confirmed
    ? floorTransit(DUNGEON[st.dungeon], st.floor, s.dungeons[st.dungeon], heldKeys(s))
    : null));
  /**
   * 現地で向かうマスの深さ(入口からの歩数)。探索は踏んだマスに隣り合う未踏のマスのいちばん深いもの、ほかは目当てのマスのいちばん浅いもの。
   * 大きな階の奥は3日では往復できず、何度出しても探索率が増えなくなるので、日数をここから決める
   */
  const targetDepth = (st: Stage, action: ActionKind, extra: DispatchOrder['target']) => {
    const k = keyOf(st.dungeon, st.floor);
    const g = GRID[k];
    const visited = new Set(s.dungeons[st.dungeon]?.floors[st.floor]?.visited ?? []);
    const want = (c: CellDef, i: number) => {
      switch (action) {
        case 'explore': return c.kind !== 'wall' && c.kind !== 'hidden' && !visited.has(i) && visibleFrom(g, i).some((n) => visited.has(n));
        case 'boss': return BOSS_KINDS.includes(c.kind);
        case 'gather': return c.kind === 'gather' && c.item === extra.item && visited.has(i);
        case 'hunt': return c.kind === 'nest' && (!extra.enemy || c.enemy === extra.enemy) && visited.has(i);
        default: return false;
      }
    };
    const ds = g.cells.flatMap((c, i) => (DEPTH[k][i] >= 0 && want(c, i) ? [DEPTH[k][i]] : []));
    if (!ds.length) return 0;
    return action === 'explore' ? Math.max(...ds) : Math.min(...ds);
  };
  /** 往復(目当てのマスまで)と移動費(上の階を抜ける歩数)が収まる最小の日数 + 1日、3〜7日 */
  const siteDays = (transit: number, depth: number) =>
    Math.min(DAYS_MAX, Math.max(SITE_DAYS, Math.ceil((2 * (transit + depth)) / STEPS_PER_DAY) + 1));
  const roundTrip = (dungeon: string) => 2 * (travelDays(HOME, DUNGEON[dungeon].node, s.world) ?? Infinity);

  const dungeonPlan = (st: Stage, action: ActionKind, extra: DispatchOrder['target'] = {}): Plan | null => {
    const prog = s.dungeons[st.dungeon];
    const name = DUNGEON[st.dungeon].name;
    if (!prog) return null;
    if (!prog.confirmed) return { action: 'survey', target: { dungeon: st.dungeon, floor: 'f1' }, days: SITE_DAYS, label: `${name}を踏査` };
    const transit = transitOf(st);
    if (transit === null) return null;
    const what = extra.item ? `(${ITEM[extra.item].name})` : extra.enemy ? `(${ENEMY[extra.enemy].name})` : '';
    const days = siteDays(transit, targetDepth(st, action, extra));
    return { action, target: { dungeon: st.dungeon, floor: st.floor, ...extra }, days, label: `${name}${st.floor}を${ACTION_NAME[action]}${what}` };
  };
  /** その階を進める: 探索率100%までは探索、主を踏んでいれば主討伐 */
  const advancePlan = (st: Stage): Plan | null => {
    if (!explored(st)) return dungeonPlan(st, 'explore');
    const k = keyOf(st.dungeon, st.floor);
    const visited = s.dungeons[st.dungeon].floors[st.floor]?.visited ?? [];
    const bossSeen = visited.some((i) => BOSS_KINDS.includes(GRID[k].cells[i]?.kind));
    return dungeonPlan(st, bossSeen && !bossKilled.has(k) ? 'boss' : 'explore');
  };

  // ---- 素材の出どころ ----
  const drops = (enemy: string, item: string) => (ENEMY[enemy]?.loot ?? []).some((l) => l.item === item);
  /** 素材を取りに行く先。確認済みで行ける階のうち、進行の並びで最初に見つかるもの。採取点 > 巣 > 道中の敵 */
  const sourcePlan = (item: string): Plan | null => cached(`src:${item}`, () => findSource(item));
  const findSource = (item: string): Plan | null => {
    for (const st of STAGES) {
      const prog = s.dungeons[st.dungeon];
      if (!prog?.confirmed || transitOf(st) === null) continue;
      const g = GRID[keyOf(st.dungeon, st.floor)];
      const visited = new Set(prog.floors[st.floor]?.visited ?? []);
      const full = rateOf(st) >= 1;
      const gathers = g.cells.flatMap((c, i) => (c.kind === 'gather' && c.item === item ? [i] : []));
      if (gathers.some((i) => visited.has(i))) return dungeonPlan(st, 'gather', { item });
      const nests = g.cells.flatMap((c, i) => (c.kind === 'nest' && c.enemy && drops(c.enemy, item) ? [i] : []));
      const seen = nests.find((i) => visited.has(i));
      if (seen !== undefined) return dungeonPlan(st, 'hunt', full ? { enemy: g.cells[seen].enemy } : {});
      if ((gathers.length || nests.length) && !full) return dungeonPlan(st, 'explore');
      if (DUNGEON[st.dungeon].enemies.some((e) => drops(e.id, item))) return dungeonPlan(st, full ? 'hunt' : 'explore');
    }
    return null;
  };
  const obtainable = (item: string) => !!sourcePlan(item);

  // ---- 装備 ----
  const fireMode = () => front >= FIRE_FROM;
  const lists = () => (fireMode() ? [ACCESSORIES_FIRE, WEAPONS, ARMORS] : [WEAPONS, ARMORS, ACCESSORIES]);
  const slotOf = (item: string) => ITEM[item].equip!.slot;
  /** 列の中の順位。何も着けていなければ列の長さ、列に無い品なら -1(触らない) */
  const rankIn = (list: string[], item: string | null) => (item === null ? list.length : list.indexOf(item));
  const canUse = (a: Adventurer, item: string) => {
    const eq = ITEM[item].equip!;
    return eq.slot !== 'armor' || !eq.armorClass || JOB[a.job].armor.includes(eq.armorClass);
  };
  const craftable = (item: string) => {
    const r = RECIPE_OF[item];
    return !!r && facilityLevel(s, r.facility) >= 1 && recipeUnlocked(s, r.id) && r.inputs.every((i) => have(i.item) >= i.n || obtainable(i.item));
  };

  /**
   * 在庫と製作中の品を強い人から割り当て、それでも今より良くならない人の分を数える。
   * goal = その人が目指す品(作り方を知っていて材料の出どころが分かる最上位)、demand = 今より良くなる品(つなぎを含む)
   */
  const equipNeeds = () => {
    const goal = new Map<string, number>();
    const demand = new Map<string, number>();
    const add = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const list of lists()) {
      const slot = slotOf(list[0]);
      const pool = new Map(list.map((it) => [it, have(it) + crafting(it)]));
      for (const a of byPower(s.adventurers)) {
        const cur = rankIn(list, a.equipment[slot]);
        if (cur < 0) continue;
        const got = list.find((it, r) => r < cur && canUse(a, it) && (pool.get(it) ?? 0) > 0);
        if (got) {
          pool.set(got, pool.get(got)! - 1);
          continue;
        }
        list.forEach((it, r) => { if (r < cur && canUse(a, it)) add(demand, it); });
        const g = list.find((it, r) => r < cur && canUse(a, it) && craftable(it));
        if (g) add(goal, g);
      }
    }
    return { goal, demand };
  };

  const equipAll = () => {
    for (const a of byPower(s.adventurers)) {
      if (a.status !== 'idle') continue;
      for (const list of lists()) {
        const cur = rankIn(list, a.equipment[slotOf(list[0])]);
        if (cur < 0) continue;
        const best = list.find((it, r) => r < cur && have(it) > 0 && canUse(a, it));
        if (best && equip(s, a.id, best).ok) acts.push(`装備 ${a.name}:${ITEM[best].name}`);
      }
    }
  };

  /** 製作費を払っても日々の支払いで借金にならない */
  const affordCraft = (recipeId: string) => s.gold - craftGold(s, recipeId) >= dailyCost(s);
  const craftAll = () => {
    craftBlock = new Set();
    const { goal, demand } = equipNeeds();
    for (const [it, n] of goal) {
      if (n <= 0) continue;
      const r = RECIPE_OF[it];
      if (r.inputs.some((i) => have(i.item) < i.n)) craftBlock.add('素材が足りない');
      if (!affordCraft(r.id)) craftBlock.add('資金が無く製作できない');
    }
    if (!s.base.facilities.some((f) => f.id === 'workshop') && s.gold < reserve() + FACILITY.workshop.costs[0].gold) craftBlock.add('資金が無く製作できない');
    const order = lists().flat();
    const next = order.find((it) => (demand.get(it) ?? 0) > 0 && canCraft(s, RECIPE_OF[it]?.id ?? '').ok && affordCraft(RECIPE_OF[it].id));
    if (next && startCraft(s, RECIPE_OF[next].id).ok) acts.push(`製作 ${ITEM[next].name}`);
    // 調合所: 回復薬を常に8本。余裕があれば上等な薬
    const potions = have('potion') + 2 * crafting('potion');
    if (potions < POTIONS_KEEP && canCraft(s, 'r_potion').ok && affordCraft('r_potion')) {
      startCraft(s, 'r_potion');
      acts.push('製作 回復薬');
    } else if (potions >= POTIONS_KEEP && have('hi_potion') + crafting('hi_potion') < HI_POTIONS_KEEP
      && canCraft(s, 'r_hi_potion').ok && spare(craftGold(s, 'r_hi_potion'))) {
      startCraft(s, 'r_hi_potion');
      acts.push('製作 上等な薬');
    }
  };

  // ---- 残す素材と足りない素材 ----
  const facilityNext = (): { id: string; materials: Record<string, number> } | null => {
    for (const id of BUILD_ORDER) if (!s.base.facilities.some((f) => f.id === id)) return { id, materials: FACILITY[id].costs[0].materials };
    for (const id of BUILD_ORDER) {
      const f = s.base.facilities.find((x) => x.id === id)!;
      if (f.level >= 1 && !f.construction && f.level < FACILITY[id].maxLevel) return { id, materials: FACILITY[id].costs[f.level].materials };
    }
    return null;
  };
  /** 残す分。並びは足りないときに取りに行く優先順(装備 → 施設 → 薬 → 鉄の解放 → 納品) */
  const keepOf = (): [string, number][] => {
    const keep = new Map<string, number>();
    const add = (item: string, n: number) => keep.set(item, (keep.get(item) ?? 0) + n);
    // 借金中は製作も建設もできない(core が資金を見る)ので、装備・施設・薬の材料は残さず売って返済に回す
    if (s.gold >= 0) {
      const { goal } = equipNeeds();
      for (const [it, n] of goal) for (const i of RECIPE_OF[it].inputs) add(i.item, i.n * n);
      for (const [it, n] of Object.entries(facilityNext()?.materials ?? {})) add(it, n);
      const potions = have('potion') + 2 * crafting('potion');
      if (potions < POTIONS_KEEP) add('herb', 2 * Math.ceil((POTIONS_KEEP - potions) / 2));
    }
    if (!s.flags['unlock:' + IRON_QUEST]) add('iron_ore', 5);
    for (const q of activeQuests(s)) if (q.type === 'deliver' && q.target.item) add(q.target.item, q.target.n ?? 0);
    return [...keep.entries()];
  };
  const shortages = () => keepOf().filter(([it, n]) => ITEM[it]?.kind === 'material' && have(it) < n).map(([it]) => it);

  const sellAll = () => {
    const keep = Object.fromEntries(keepOf());
    let gold = 0;
    for (const [item, n] of Object.entries(s.inventory)) {
      if (ITEM[item]?.kind !== 'material') continue;
      const extra = n - (keep[item] ?? 0);
      const before = s.gold;
      if (extra > 0 && sellMaterial(s, item, extra).ok) gold += s.gold - before;
    }
    if (gold > 0) acts.push(`売却 ${gold}G`);
  };

  // ---- メール・雇用・施設・転職・訓練 ----
  const choiceFor = (m: Mail): string | null => {
    switch (m.kind) {
      case 'raise': return s.gold >= RAISE_RESERVE_DAYS * payroll() ? 'accept' : 'hold';
      case 'warning': return 'retain';
      case 'rest': return 'rest';
      case 'complaint': return 'split';
      default: return null;
    }
  };
  // 返信できないもの(選択肢が無い・差出人が去った)も既読にしておかないと、毎日同じメールを開き直す
  const answerMails = () => {
    for (const m of s.mails) {
      if (m.read) continue;
      const choice = choiceFor(m);
      if (!choice || !replyMail(s, m.id, choice).ok) markRead(s, m.id);
    }
  };

  const hireOne = () => {
    if (s.adventurers.length >= capacity(s)) return;
    const c = [...s.candidates].sort((a, b) => powerOf(b.adv) / b.adv.salary - powerOf(a.adv) / a.adv.salary)[0];
    if (c && s.gold >= reserve() + hireFee(c.adv.salary) && hire(s, c.adv.id).ok) acts.push(`雇用 ${c.adv.name}`);
  };

  const buildOne = () => {
    const built = (id: string) => s.base.facilities.find((f) => f.id === id);
    // 資金が足りないときは安い施設で抜かさず待つ(抜かすと工房が後回しになる)。建材・素材が無いものだけ飛ばす
    for (const id of BUILD_ORDER) {
      if (built(id)) continue;
      const cost = FACILITY[id].costs[0];
      if (Object.entries(cost.materials).some(([it, n]) => have(it) < n)) continue;
      if (s.gold < reserve() + cost.gold) return;
      if (buildFacility(s, id, ...LAYOUT[id]).ok) {
        acts.push(`建設 ${FACILITY[id].name}`);
        return;
      }
    }
    if (!BUILD_ORDER.every((id) => built(id)?.level)) return;
    for (const id of BUILD_ORDER) {
      const f = built(id)!;
      if (f.construction || f.level >= FACILITY[id].maxLevel || !spare(FACILITY[id].costs[f.level].gold)) continue;
      if (upgrade(s, id).ok) {
        acts.push(`増築 ${FACILITY[id].name}`);
        return;
      }
    }
  };

  const promote = () => {
    for (const a of s.adventurers) {
      if (a.status !== 'idle' || JOB[a.job].tier !== 'lower') continue;
      const opts = promotionOptions(a).filter((j) => a.level >= (j.requireLevel ?? 0));
      if (!opts.length) continue;
      const best = [...opts].sort((x, y) => jobAptitude(a, y.id) - jobAptitude(a, x.id))[0];
      if (!spare(promotionCost(s)) || !canChangeJob(s, a.id, best.id).ok) continue;
      if (changeJob(s, a.id, best.id).ok) {
        acts.push(`転職 ${a.name}→${best.name}`);
        ms.promote ??= s.day;
      }
    }
  };

  // 訓練は派遣の後に、出なかった人だけ。先に回すと先端の隊から強い人が3日抜ける
  const trainLeftovers = () => {
    for (const a of s.adventurers) {
      if (a.status !== 'idle') continue;
      const sk = TRAIN_SKILLS.find((id) => canTrain(s, a.id, id).ok);
      if (sk && spare(TRAIN_GOLD) && trainSkill(s, a.id, sk).ok) acts.push(`訓練 ${a.name}:${sk}`);
    }
  };

  // 勤務は「その日に出ない人」の仕事にする。勤務中は装備を替えられず、ずっと据えると隊が組めなくなるので、
  // 朝に全員外し(装備のため)、製作の前と派遣の後に待機中の人を就ける。隊に選ばれたら出発の前に外す
  const releaseWorkers = () => {
    for (const a of s.adventurers) if (a.status === 'working') unassignWorker(s, a.id);
  };
  const assignWorkers = () => {
    if (s.adventurers.length < 6) return;
    for (const id of WORK_AT) {
      const def = FACILITY[id];
      if (!s.base.facilities.some((f) => f.id === id && f.level >= 1)) continue;
      if (s.adventurers.some((a) => a.status === 'working' && a.assignment && 'facility' in a.assignment && a.assignment.facility === id)) continue;
      const stat = def.workStat!;
      const pick = s.adventurers.filter((a) => a.status === 'idle').sort((a, b) => effectiveStats(b)[stat] - effectiveStats(a)[stat])[0];
      if (pick) assignWorker(s, pick.id, id);
    }
  };

  // ---- 依頼(playstyles の quests-deadline を複数フロアに広げたもの) ----
  const nestFloor = (dungeon: string, wanted: (enemy: string) => boolean): Stage | null => {
    for (const f of DUNGEON[dungeon].floors) {
      if (GRID[keyOf(dungeon, f.id)].cells.some((c) => c.kind === 'nest' && c.enemy && wanted(c.enemy))) return { dungeon, floor: f.id };
    }
    return null;
  };
  const knownNest = (st: Stage, wanted: (enemy: string) => boolean) => {
    const g = GRID[keyOf(st.dungeon, st.floor)];
    return (s.dungeons[st.dungeon]?.floors[st.floor]?.visited ?? []).some((i) => g.cells[i]?.kind === 'nest' && wanted(g.cells[i].enemy!));
  };
  const firstOpenFloor = (dungeon: string): Stage => {
    const f = DUNGEON[dungeon].floors.find((x) => exploredRateOf(s, dungeon, x.id) < 1 && transitOf({ dungeon, floor: x.id }) !== null);
    return { dungeon, floor: f?.id ?? 'f1' };
  };
  const workFor = (q: Quest): Plan | null => {
    const tag = (p: Plan | null): Plan | null => (p ? { ...p, questId: q.id, label: `依頼「${q.name}」: ${p.label}` } : null);
    switch (q.type) {
      case 'escort': return q.departDay === s.day ? { action: 'escort', target: { questId: q.id }, days: 1, label: `依頼「${q.name}」: 護衛`, questId: q.id } : null;
      case 'transport': return { action: 'transport', target: { questId: q.id }, days: 1, label: `依頼「${q.name}」: 運搬`, questId: q.id };
      case 'hunt': {
        const d = q.target.dungeon!;
        const st = nestFloor(d, (e) => e === q.target.enemy) ?? { dungeon: d, floor: 'f1' };
        return tag(knownNest(st, (e) => e === q.target.enemy) ? dungeonPlan(st, 'hunt') : dungeonPlan(firstOpenFloor(d), 'explore'));
      }
      case 'explore': return tag(dungeonPlan(firstOpenFloor(q.target.dungeon!), 'explore'));
      case 'deliver': {
        if (have(q.target.item!) >= (q.target.n ?? 0)) return null;
        return tag(sourcePlan(q.target.item!));
      }
      default: return null;
    }
  };
  const needDays = (q: Quest): number => {
    const survey = (d: string) => (s.dungeons[d]?.confirmed ? 0 : roundTrip(d) + SITE_DAYS);
    switch (q.type) {
      case 'escort': return 0;
      case 'transport': {
        const from = q.target.from ?? HOME;
        const to = q.target.to ?? HOME;
        const a = travelDays(HOME, from, s.world);
        const b = travelDays(from, to, s.world);
        const c = travelDays(to, HOME, s.world);
        return a === null || b === null || c === null ? Infinity : a + b + c;
      }
      case 'hunt': return survey(q.target.dungeon!) + roundTrip(q.target.dungeon!) + SITE_DAYS;
      case 'explore': {
        const d = q.target.dungeon!;
        // 1回で増える探索率は分からないので、浅い階の sim の序盤のおおよそ(playstyles と同じ 15%)で見積もる
        const gap = Math.max(0, (q.target.percent ?? 100) / 100 - exploredRateOf(s, d, 'f1'));
        return survey(d) + Math.ceil(gap / 0.15) * (roundTrip(d) + SITE_DAYS);
      }
      case 'deliver': {
        if (have(q.target.item!) >= (q.target.n ?? 0)) return 0;
        const p = sourcePlan(q.target.item!);
        return p?.target.dungeon ? roundTrip(p.target.dungeon) + p.days : Infinity;
      }
      default: return Infinity;
    }
  };
  // 受注後の納期は core が道の日数から決める。受注は依頼の status と dueDay しか書かないので、依頼の配列だけ複製して試す
  const dueIfAccepted = (q: Quest): number | null => {
    const probe: GameState = { ...s, quests: s.quests.map((x) => ({ ...x })) };
    if (!acceptQuest(probe, q.id).ok) return null;
    return probe.quests.find((x) => x.id === q.id)!.dueDay;
  };
  const deliverAll = () => {
    for (const q of activeQuests(s)) {
      if ((q.type === 'deliver' || q.type === 'unlock') && have(q.target.item!) >= (q.target.n ?? 0) && deliver(s, q.id).ok) acts.push(`納品 ${q.name}`);
    }
  };
  const unlockIron = () => {
    if (s.flags['unlock:' + IRON_QUEST]) return;
    const q = visibleQuests(s).find((x) => x.templateId === IRON_QUEST && x.status === 'posted');
    if (q && have('iron_ore') >= (q.target.n ?? 0) && acceptQuest(s, q.id).ok) acts.push(`受注 ${q.name}`);
  };
  const acceptAll = () => {
    const board = visibleQuests(s).filter((q) => q.status === 'posted' && q.type !== 'unlock')
      .sort((a, b) => (a.acceptBy ?? Infinity) - (b.acceptBy ?? Infinity));
    // 依頼に回るのは先端の4人(戦力上位)を除いた人。その顔ぶれで出せない・危険な依頼は受けても納期切れになるだけ
    const core = new Set(byPower(s.adventurers).slice(0, PARTY_MAX).map((a) => a.id));
    const crew = byPower(s.adventurers.filter((a) => !core.has(a.id))).slice(0, PARTY_MAX);
    for (const q of board) {
      if (activeQuests(s).length >= activeMax(s)) break;
      const due = dueIfAccepted(q);
      if (due === null) continue;
      const need = needDays(q);
      if (need > due - s.day) continue;
      const inStock = q.type === 'deliver' && have(q.target.item!) >= (q.target.n ?? 0);
      if (!inStock) {
        if (crew.length < MIN_PARTY) continue;
        const p = q.type === 'escort' || q.type === 'transport' ? null : workFor(q);
        if (q.type !== 'escort' && q.type !== 'transport' && (!p || danger(crew, p, 'quest'))) continue;
      }
      // 依頼の隊は1つなので、受けている分を順に片付けた後でも間に合うものだけ受ける
      if (q.type !== 'escort' && questLoad() + need > due - s.day) continue;
      // 護衛は出発日に隊がいなければ失敗する。出発が今日か明日で、今その顔ぶれがそろっているときだけ受ける
      if (q.type === 'escort' && ((q.departDay ?? 0) - s.day > 1 || formParty(core).length < MIN_PARTY
        || activeQuests(s).some((x) => x.type === 'escort' && x.departDay === q.departDay))) continue;
      if (acceptQuest(s, q.id).ok) acts.push(`受注 ${q.name}`);
    }
  };
  /** 受けている依頼を1隊で順に片付ける日数。護衛は出発日が決まっているので数えない */
  const questLoad = () => activeQuests(s).filter((q) => q.type !== 'unlock' && q.type !== 'escort').reduce((t, q) => t + needDays(q), 0);

  // ---- 派遣 ----
  const formParty = (except: Set<string> = new Set()) => {
    const party: Adventurer[] = [];
    for (const a of byPower(s.adventurers.filter((x) => ready(x) && !except.has(x.id)))) {
      if (party.length < PARTY_MAX && !dispatchBlock(s, [...party, a])) party.push(a);
    }
    return party;
  };
  /**
   * 先端の隊が出ていない間は、待機中で負傷していない戦力上位4人を支援・依頼に回さない。
   * 回すと、休み明けの人から順に支援・依頼へ出ていき、先端の4人が同じ日にそろわなくなる
   */
  const frontReserve = () => (out('front') ? new Set<string>()
    : new Set(byPower(s.adventurers.filter((a) => (a.status === 'idle' || a.status === 'working') && a.injuryDays === 0)).slice(0, PARTY_MAX).map((a) => a.id)));
  // 探索の寄り道は隊長の性格で決まる。臆病(avoid)は巣と主のマスを踏まず主の居場所が分からないまま、
  // 強欲(treasure)は既知の宝箱・採取点を回って地図を広げないまま止まる seed があったので、探索ではこの順で隊長を選ぶ
  const DETOUR_RANK = ['none', 'nest', 'injured', 'treasure', 'avoid'];
  const leaderOf = (party: Adventurer[], action: ActionKind) => {
    if (action !== 'explore' && action !== 'survey') return party[0];
    const rank = (a: Adventurer) => DETOUR_RANK.indexOf(PERSONALITY[a.personality]?.explore.detour ?? 'none');
    return [...party].sort((a, b) => rank(a) - rank(b))[0];
  };
  const orderOf = (party: Adventurer[], p: Plan, role: Role): DispatchOrder => {
    const items: Record<string, number> = {};
    const pot = Math.min(PARTY_POTIONS, have('potion'));
    if (pot) items.potion = pot;
    const hi = Math.min(PARTY_POTIONS, have('hi_potion'));
    if (role === 'front' && p.target.dungeon && hi) items.hi_potion = hi;
    return { partyIds: party.map((a) => a.id), leaderId: leaderOf(party, p.action).id, action: p.action, target: p.target, policy: POLICY_ID, days: p.days, items };
  };
  // grade は戦力比だけで決まり、予測の試行の結果(撤退率・全滅率)を見ない。坑道で予測「撤退100%」のまま
  // 「厳しい」止まりで20回続けて撤退した seed があったので、先端だけは試行して予測も見る。支援・依頼は試行0回(速さのため)
  const assess = (party: Adventurer[], p: Plan, role: Role, runs = 0): Readiness | null =>
    (p.target.dungeon && p.action !== 'survey' ? assessReadiness(s, orderOf(party, p, role), runs) : null);
  const dangerous = (r: Readiness | null) =>
    !!r && (r.grade === '危険' || (r.runs > 0 && (r.retreatRate >= RETREAT_DANGER || r.wipeRate >= WIPE_DANGER)));
  const danger = (party: Adventurer[], p: Plan, role: Role) => dangerous(assess(party, p, role));
  const readinessText = (r: Readiness | null) => (r ? `[${r.grade} 戦力比${r.powerRatio.toFixed(2)} 撤退${Math.round(r.retreatRate * 100)}% 全滅${Math.round(r.wipeRate * 100)}%]` : '');
  const out = (role: Role) => [...s.expeditions].filter((e) => roles.get(e.id) === role).length;
  const send = (party: Adventurer[], p: Plan, role: Role): boolean => {
    for (const a of party) if (a.status === 'working') unassignWorker(s, a.id);
    const r = dispatch(s, orderOf(party, p, role));
    if (!r.ok) {
      acts.push(`派遣失敗(${p.label}): ${r.reason}`);
      return false;
    }
    roles.set(r.expedition.id, role);
    labels.set(r.expedition.id, p.label);
    if (p.questId) questOf.set(r.expedition.id, p.questId);
    if (role === 'front' && p.target.dungeon) {
      const i = STAGES.findIndex((st) => st.dungeon === p.target.dungeon && st.floor === p.target.floor);
      if (i === front) frontRate.set(r.expedition.id, { stage: i, rate: rateOf(STAGES[i]) });
    }
    acts.push(`${role === 'front' ? '先端' : role === 'support' ? '支援' : '依頼'}: ${p.label}(${party.length}人${p.days}日)`);
    return true;
  };

  /** 素材が足りなければ取りに行き、無ければ先端の1つ前(から手前へ)で討伐して経験値と素材を稼ぐ */
  const supportPlan = (party: Adventurer[], role: Role): Plan | null => {
    for (const item of shortages()) {
      const p = sourcePlan(item);
      if (p && !danger(party, p, role)) return p;
    }
    for (let i = Math.max(0, front - 1); i >= 0; i--) {
      const st = STAGES[i];
      const p = stageDone(st) ? dungeonPlan(st, 'hunt') : advancePlan(st);
      if (p && !danger(party, p, role)) return p;
    }
    return null;
  };

  const lairReady = (party: Adventurer[]): Reason[] => {
    const why: Reason[] = [];
    const fire = party.reduce((t, a) => t + (equipResist(a).fire ?? 0), 0) / party.length;
    if (fire < FIRE_NEED) why.push('火耐性が足りない');
    if (s.gold < DUNGEON[LAIR].rescueCost + reserve() || have('potion') < PARTY_POTIONS) why.push('竜の前の資金・回復薬が足りない');
    return why;
  };

  const frontStep = () => {
    if (out('front') || front >= STAGES.length) return;
    const party = formParty();
    const need = Math.min(PARTY_MAX, s.adventurers.length);
    if (party.length < need || s.expeditions.length >= PARTIES) {
      const questIds = new Set([...s.expeditions].filter((e) => roles.get(e.id) === 'quest').flatMap((e) => e.order.partyIds));
      const healthy = s.adventurers.filter((a) => a.injuryDays === 0).length;
      // 疲労が抜けるのを待つだけの日(休養待ち)は止まった理由に数えない
      if (questIds.size && (s.expeditions.length >= PARTIES || party.length + questIds.size >= need)) today.add('依頼で隊を取られる');
      else if (healthy < need) today.add('隊員が足りない');
      trying = `${stageName(front)}へ出す隊を待つ`;
      return;
    }
    const st = STAGES[front];
    let plan = advancePlan(st);
    const why: Reason[] = [];
    if (!plan) why.push('下の階へ行けない(階段・鍵)');
    else if (st.dungeon === LAIR && plan.action !== 'survey') why.push(...lairReady(party));
    const r = plan && !why.length ? assess(party, plan, 'front', TUNING.readiness.runs) : null;
    if (log && r) acts.push(`見込み ${readinessText(r)}`);
    if (dangerous(r)) why.push('readiness が危険');
    if (why.length) {
      for (const r of why) today.add(r);
      for (const r of craftBlock) today.add(r);
      trying = `${plan?.label ?? stageName(front)}(見送り: ${why.join('・')})`;
      plan = supportPlan(party, 'front');
      if (!plan) return;
    } else {
      trying = plan!.label;
    }
    send(party, plan!, 'front');
  };

  const supportStep = () => {
    if (out('support') || s.expeditions.length >= PARTIES) return;
    const party = formParty(frontReserve());
    if (party.length < MIN_PARTY) return;
    const plan = supportPlan(party, 'support');
    if (plan) send(party, plan, 'support');
  };

  const questStep = () => {
    const busy = (id: string) => [...questOf.entries()].some(([eid, qid]) => qid === id && s.expeditions.some((e) => e.id === eid));
    const qs = activeQuests(s).filter((q) => !busy(q.id))
      // 護衛は出発日を逃すと失敗なので、その日だけは納期順より先に出す
      .sort((a, b) => (a.type === 'escort' ? -1 : 0) - (b.type === 'escort' ? -1 : 0) || (a.dueDay ?? Infinity) - (b.dueDay ?? Infinity));
    for (const q of qs) {
      if (s.expeditions.length >= PARTIES) return;
      const p = workFor(q);
      if (!p) continue;
      // 依頼の隊は1つまで。護衛だけは出発日に隊が空いていれば2つめも出す
      if (out('quest') >= 1 && p.action !== 'escort') continue;
      const party = formParty(frontReserve());
      if (party.length < MIN_PARTY) return;
      if (danger(party, p, 'quest')) continue;
      send(party, p, 'quest');
    }
  };

  // ---- 1日 ----
  const record = () => {
    for (const d of Object.keys(s.dungeons)) if (`boss:${d}` in ms && s.dungeons[d].bossDefeated > 0) ms[`boss:${d}`] ??= s.day;
    const done = s.base.facilities.filter((f) => f.level >= 1).length;
    if (done >= 5) ms.fac5 ??= s.day;
    if (done >= 10) ms.fac10 ??= s.day;
    if (s.achievements.length >= 10) ms.ach10 ??= s.day;
    if (heldKeys(s).includes('dragon_crest')) ms.crest ??= s.day;
    if (s.dungeons[LAIR]?.confirmed) ms.lair ??= s.day;
  };

  let returned: string[] = [];
  while (s.day < LAST_DAY && !s.dragonDefeated) {
    acts = returned;
    returned = [];
    today = new Set();
    memo = new Map();
    const head = s.ledger[0];
    front = frontier();
    answerMails();
    hireOne();
    buildOne();
    releaseWorkers();
    promote();
    equipAll();
    assignWorkers();
    craftAll();
    deliverAll();
    unlockIron();
    deliverAll();
    acceptAll();
    deliverAll();
    frontStep();
    supportStep();
    questStep();
    trainLeftovers();
    assignWorkers();
    sellAll();
    for (const r of today) reasons[r] = (reasons[r] ?? 0) + 1;
    if (log) {
      const gone = s.expeditions.length;
      console.log(`| ${s.day} | ${s.gold} | ${s.adventurers.length} | ${stageName(front)} ${Math.floor(rateOf(STAGES[Math.min(front, STAGES.length - 1)]) * 100)}% | ${gone} | ${acts.join(' / ') || '-'} |`);
    }
    const rep = advanceDay(s);
    tally(head);
    memo = new Map();
    for (const e of rep.returned) {
      for (const [enemy, n] of Object.entries(e.result.kills)) {
        const k = BOSS_FLOOR.get(enemy);
        if (k && n > 0) bossKilled.add(k);
      }
      const fr = frontRate.get(e.id);
      if (fr && e.order.action === 'explore') {
        const st = STAGES[fr.stage];
        const k = keyOf(st.dungeon, st.floor);
        const stuck = rateOf(st) <= fr.rate;
        stalls.set(k, stuck ? (stalls.get(k) ?? 0) + 1 : 0);
        if (stuck) reasons['先端の探索が進まない'] = (reasons['先端の探索が進まない'] ?? 0) + 1;
      }
      if (log) {
        const r = e.result;
        const how = r.wiped ? '全滅' : r.retreated ? '撤退' : r.success ? '成功' : '未達';
        const value = Object.entries(r.materials).reduce((t, [it, n]) => t + (ITEM[it]?.price ?? 0) * n, 0);
        const kills = Object.entries(r.kills).map(([k, n]) => `${ENEMY[k]?.name ?? k}${n}`).join('');
        returned.push(`帰還 ${labels.get(e.id) ?? e.order.action}: ${how} 素材${value}G 拾得${r.gold}G ${kills}`);
      }
      labels.delete(e.id);
      roles.delete(e.id);
      questOf.delete(e.id);
      frontRate.delete(e.id);
    }
    record();
    const f = frontier();
    if (f !== front) {
      frontSince = s.day;
      reasons = {};
    }
  }

  front = frontier();
  const n = s.adventurers.length;
  return {
    seed,
    dragonDay: s.dragonDefeated ? (typeof s.flags.clearDay === 'number' ? s.flags.clearDay : s.day) : null,
    endDay: s.day,
    ms,
    gold: s.gold,
    roster: n,
    avgLevel: n ? s.adventurers.reduce((t, a) => t + a.level, 0) / n : NaN,
    upper: s.adventurers.filter((a) => JOB[a.job].tier === 'upper').length,
    facilities: s.base.facilities.filter((f) => f.level >= 1).length,
    synergies: activeSynergies(s).length,
    achievements: s.achievements.length,
    fire: n ? s.adventurers.reduce((t, a) => t + (equipResist(a).fire ?? 0), 0) / n : NaN,
    questsDone: s.quests.filter((q) => q.status === 'done' && q.type !== 'unlock').length,
    questsFailed: s.quests.filter((q) => q.status === 'failed').length,
    failedTypes: Object.entries(s.quests.filter((q) => q.status === 'failed').reduce<Record<string, number>>((m, q) => ({ ...m, [q.type]: (m[q.type] ?? 0) + 1 }), {})).map(([k, v]) => k + v).join(' '),
    lastDone: front - 1,
    partial: STAGES.slice(0, front).filter((st) => rateOf(st) < 1).map((st) => `${DUNGEON[st.dungeon].name}${st.floor} ${Math.floor(rateOf(st) * 100)}%`),
    trying,
    stuckDays: s.day - frontSince,
    reasons,
    flows,
  };
}

// ---- 集計と出力 ----
const mean = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const fix = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const stat = (xs: number[], f: (x: number) => string) => {
  const v = xs.filter(Number.isFinite);
  return v.length ? `${f(mean(v))}(${f(Math.min(...v))}〜${f(Math.max(...v))})` : '-';
};
const table = (head: string[], rows: string[][]) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n');

const t0 = performance.now();
if (ONE_SEED !== null) {
  console.log(`### seed ${ONE_SEED} の日ごとのログ(${LAST_DAY}日まで)`);
  console.log('');
  console.log('| 日 | 資金 | 名簿 | 先端 | 出ている隊 | やったこと |');
  console.log('|---|---|---|---|---|---|');
}
const seeds = ONE_SEED !== null ? [ONE_SEED] : Array.from({ length: SEEDS }, (_, i) => i + 1);
const runs = seeds.map((seed) => runSeed(seed, ONE_SEED !== null));
const elapsed = (performance.now() - t0) / 1000;

const out: string[] = [];
if (ONE_SEED !== null) out.push('');
out.push(`### 計測(\`npm run sim:dragon -- ${ONE_SEED !== null ? `--seed ${ONE_SEED} ${LAST_DAY}` : `${SEEDS} ${LAST_DAY}`}\`。${seeds.length}seed×最大${LAST_DAY}日)`);
out.push('');
out.push(`bot: メール返信 → 雇用(日給${RESERVE_DAYS}日分を残して戦力/日給の良い順に1日1人)→ 施設(固定配置・優先順に1日1件、全部建ったら Lv2)→ 転職(Lv10で適性の高い上級職)→ 装備(枠ごとに強い順)と製作(工房1件・調合所で回復薬${POTIONS_KEEP}本)→ 依頼(締め切りの近い順に、間に合うものだけ受ける)→ 派遣(先端・先端の1つ前か素材集め・依頼の3隊、各${PARTY_MAX}人まで、疲労${REST_FATIGUE}以上と負傷中は休み)→ 訓練と勤務(出なかった人)→ 素材を売る(装備・施設・薬・依頼に要る分は残す)。先端は readiness が「危険」なら1つ前で稼ぎ、竜の寝床は火耐性の平均${FIRE_NEED}以上・救助費用+${RESERVE_DAYS}日分の資金・回復薬${PARTY_POTIONS}本が揃うまで入らない。`);
out.push('');
out.push(`指示からの細部の変更: 階の完了は「探索率100%」に加え「入れる未踏のマスが無い」「先端の探索が${STALL_TRIPS}回続けて探索率を増やさない」も探索し終えたとみなす(隠し通路の見逃し・探索の目標選びで永久に止まるため)。先端の「危険」は grade 危険に加え readiness の予測(${TUNING.readiness.runs}回)で撤退${RETREAT_DANGER * 100}%以上か全滅${WIPE_DANGER * 100}%以上。現地の日数は、目当てのマスまでの往復と上の階を抜ける歩数が収まる最小+1日(${SITE_DAYS}〜${DAYS_MAX}日)。探索の隊長は寄り道しない性格を優先(臆病・強欲を避ける)。先端の隊が出ていない間は戦力上位${PARTY_MAX}人を支援・依頼に回さない。勤務はその日出ない人。借金中は装備・施設の材料も売る。`);
out.push('');

const wins = runs.filter((r) => r.dragonDay !== null).map((r) => r.dragonDay!);
out.push('#### 竜の討伐日');
out.push('');
out.push(table(['成功率', '最小', '中央値', '最大', '平均'], [[
  `${wins.length}/${runs.length}`,
  fix(wins.length ? Math.min(...wins) : NaN, 0), fix(median(wins), 1), fix(wins.length ? Math.max(...wins) : NaN, 0), fix(mean(wins), 1),
]]));
out.push('');
out.push(table(['seed', ...runs.map((r) => String(r.seed))], [
  ['討伐日', ...runs.map((r) => (r.dragonDay === null ? '-' : String(r.dragonDay)))],
  ['最後に完了した階', ...runs.map((r) => stageName(r.lastDone))],
  ['100%未満で完了とした階', ...runs.map((r) => r.partial.join('、') || '-')],
]));
out.push('');

out.push('#### 進行のマイルストーン(到達した seed の中央値)');
out.push('');
out.push(table(['項目', '中央値', '最小〜最大', '到達'], MILESTONES.map((m) => {
  const v = runs.map((r) => r.ms[m.id]).filter((x): x is number => x !== null);
  return [m.label, fix(median(v), 1), v.length ? `${Math.min(...v)}〜${Math.max(...v)}` : '-', `${v.length}/${runs.length}`];
})));
out.push('');

out.push('#### 最終状態(討伐の日 または 打ち切り日)');
out.push('');
out.push('値は 平均(最小〜最大)。');
out.push('');
out.push(table(['項目', '値'], [
  ['日', stat(runs.map((r) => r.endDay), (x) => fix(x, 0))],
  ['所持金', stat(runs.map((r) => r.gold), (x) => `${Math.round(x)}G`)],
  ['名簿', stat(runs.map((r) => r.roster), (x) => fix(x))],
  ['平均Lv', stat(runs.map((r) => r.avgLevel), (x) => fix(x, 2))],
  ['上級職の人数', stat(runs.map((r) => r.upper), (x) => fix(x))],
  ['施設数(完成)', stat(runs.map((r) => r.facilities), (x) => fix(x))],
  ['成立シナジー', stat(runs.map((r) => r.synergies), (x) => fix(x))],
  ['実績', stat(runs.map((r) => r.achievements), (x) => fix(x))],
  ['平均の火耐性', stat(runs.map((r) => r.fire), (x) => fix(x, 2))],
  ['依頼 達成', stat(runs.map((r) => r.questsDone), (x) => fix(x))],
  ['依頼 失敗', stat(runs.map((r) => r.questsFailed), (x) => fix(x))],
  ['依頼 失敗の内訳(seed ごと)', runs.map((r) => r.failedTypes || '-').join(' / ')],
]));
out.push('');

out.push('#### 収支の内訳(1seedあたりの平均、討伐の日 または 打ち切り日まで)');
out.push('');
const flowKeys = [...new Set(runs.flatMap((r) => Object.keys(r.flows)))];
out.push(table(['項目', '金額'], flowKeys.map((k) => [k, mean(runs.map((r) => r.flows[k] ?? 0))] as const)
  .sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${Math.round(v)}G`])));
out.push('');

const stalled = runs.filter((r) => r.dragonDay === null);
out.push('#### 停滞の診断(討伐できなかった seed)');
out.push('');
if (!stalled.length) out.push('なし');
else {
  out.push(`理由は、今の先端になってから打ち切りまでの日のうち、その理由で先端に出せなかった日数。「素材が足りない」「資金が無く製作できない」は先端を見送った日に装備の製作も止まっていた日数、「先端の探索が進まない」は探索率が増えなかった帰還の回数。疲労が抜けるのを待つだけの日は数えない。`);
  out.push('');
  out.push(table(['seed', '最後に完了した階', '先端で止まった日数', '打ち切り日にしようとしていたこと', '止まっていた理由'], stalled.map((r) => [
    String(r.seed), stageName(r.lastDone), String(r.stuckDays), r.trying || '-',
    Object.entries(r.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、') || '-',
  ])));
  out.push('');
  const total: Partial<Record<Reason, number>> = {};
  for (const r of stalled) for (const [k, v] of Object.entries(r.reasons)) if (v > 0) total[k as Reason] = (total[k as Reason] ?? 0) + 1;
  out.push(table(['理由', '当てはまった seed 数'], [...REASONS, ...EXTRA_REASONS].map((k) => [k, `${total[k] ?? 0}/${stalled.length}`])));
}
out.push('');
out.push(`処理時間: ${elapsed.toFixed(2)}秒`);
console.log(out.join('\n'));
