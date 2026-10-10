// 竜までの bot: メール・雇用・施設・装備・転職・依頼をこなしながら、竜の寝床の竜まで攻める。
// 竜の討伐までの日数の分布、目標の達成日、討伐できなかった seed がどこで・なぜ止まったかを測る。
// 使い方: npm run sim:dragon -- [seeds=10] [days=200] [--seed N] [--route fast|full] [--rich] [--set パス=値]...
//   --route fast(既定)は竜までの最短の進行(目標①〜⑤)、full は全階を探索率100%と主の討伐で進む
//   --rich は毎日、所持金を50000Gまで補う(経済を切り離して進みの速さだけを測る)
//   --set はゲームの数値をメモリ上で上書きする(ファイルは書き換えない)。パスは tuning / enemy / item / recipe / facility / dungeon
//   で始まる点区切り(配列は添字)、値は数値か true/false。例 --set tuning.game.debtInterest=0.01 --set enemy.dragon.hp=2000
import { DUNGEON, ENEMY, FACILITY, ITEM, JOB, PERSONALITY, POLICY, RECIPE, RECIPES, TUNING, WORLD } from '../src/core/data';
import type { Readiness } from '../src/core/readiness';
import type { ActionKind, Adventurer, CellDef, DispatchOrder, GameState, LedgerEntry, Mail, Quest } from '../src/core/types';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ---- 引数 ----
const args = process.argv.slice(2);
const VALUE_FLAGS = ['--seed', '--route', '--set'];
const FLAGS = [...VALUE_FLAGS, '--rich'];
/** 値をとる指定の、値の位置 */
const valueAt = new Set<number>();
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) continue;
  if (!FLAGS.includes(args[i])) fail(`知らない指定: ${args[i]}(使えるのは ${FLAGS.join(' ')})`);
  if (!VALUE_FLAGS.includes(args[i])) continue;
  if (i + 1 >= args.length) fail(`${args[i]} の後に値が要る`);
  valueAt.add(++i);
}
const valuesOf = (flag: string) => args.flatMap((a, i) => (a === flag && !valueAt.has(i) && valueAt.has(i + 1) ? [args[i + 1]] : []));
const seedArg = valuesOf('--seed')[0];
const ONE_SEED = seedArg === undefined ? null : Number(seedArg);
if (ONE_SEED !== null && !Number.isInteger(ONE_SEED)) fail('--seed には整数を指定する');
const routeArg = valuesOf('--route')[0] ?? 'fast';
if (routeArg !== 'fast' && routeArg !== 'full') fail('--route は fast か full');
const ROUTE = routeArg as 'fast' | 'full';
const RICH = args.some((a, i) => a === '--rich' && !valueAt.has(i));
const plain = args.filter((a, i) => !valueAt.has(i) && !a.startsWith('--'));
const unread = plain.filter((a) => !/^\d+$/.test(a));
if (unread.length) fail(`読めない引数: ${unread.join(' ')}`);
const nums = plain.map(Number);
// --seed のときは数字1つめが日数
const SEEDS = ONE_SEED === null ? nums[0] ?? 10 : 1;
const LAST_DAY = (ONE_SEED === null ? nums[1] : nums[0]) ?? 200;

// ---- 数値の上書き(--set) ----
const ROOTS: Record<string, object> = { tuning: TUNING, enemy: ENEMY, item: ITEM, recipe: RECIPE, facility: FACILITY, dungeon: DUNGEON, world: WORLD };
const own = (o: object, k: string) => (Array.isArray(o) ? /^\d+$/.test(k) && Number(k) < o.length : Object.prototype.hasOwnProperty.call(o, k));
const applySet = (spec: string): string => {
  const eq = spec.indexOf('=');
  if (eq < 0) fail(`--set ${spec}: パス=値 の形で書く`);
  const path = spec.slice(0, eq).trim();
  const raw = spec.slice(eq + 1).trim();
  const value = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : fail(`--set ${spec}: 値は数値か true/false`);
  const keys = path.split('.');
  if (keys.length < 2 || !own(ROOTS, keys[0])) fail(`--set ${spec}: パスは ${Object.keys(ROOTS).join(' / ')} のどれかで始まる点区切り`);
  let holder: unknown = ROOTS[keys[0]];
  for (let i = 1; i < keys.length; i++) {
    if (typeof holder !== 'object' || holder === null || !own(holder, keys[i])) fail(`--set ${spec}: 存在しないパス(${keys.slice(0, i + 1).join('.')})`);
    if (i < keys.length - 1) holder = (holder as Record<string, unknown>)[keys[i]];
  }
  const parent = holder as Record<string, unknown>;
  const key = keys[keys.length - 1];
  const before = parent[key];
  if (typeof before !== typeof value) fail(`--set ${spec}: 今の値 ${JSON.stringify(before)} と型が違う(数値か true/false の項目だけ上書きできる)`);
  parent[key] = value;
  return `${path}: ${before} → ${value}`;
};
const OVERRIDES = valuesOf('--set').map(applySet);

const POLICY_ID = 'standard';
const POLICY_HUNT = 'hunt';
const POLICY_SAFE = 'safe';
/** 戦力比(readiness の powerRatio)がこれ以上なら強敵優先で経験値を稼ぎ、これ未満なら安全第一 */
const HUNT_RATIO = 1.3;
const SAFE_RATIO = 0.9;
for (const id of [POLICY_ID, POLICY_HUNT, POLICY_SAFE]) if (!POLICY[id]) fail(`方針 ${id} がデータに無い`);

// core の一部は読み込み時に TUNING の値を定数へ写す(game.ts の UPKEEP_PER_DAY など)ので、上書きの後で読み込む
const { effectiveStats, equipResist, jobAptitude, powerOf } = await import('../src/core/adventurer');
const { activeSynergies, assignWorker, facilityLevel, unassignWorker, upgrade } = await import('../src/core/base');
const { canCraft, craftGold, startCraft } = await import('../src/core/craft');
const { isPassable, parseFloor, searchSpots, visibleFrom } = await import('../src/core/dungeon');
const { equip } = await import('../src/core/equipment');
const { cellDepths, floorTransit } = await import('../src/core/explore');
const { acceptQuest, advanceDay, buildFacility, dailyCost, dispatch, exploredRateOf, newGame, sellMaterial } = await import('../src/core/game');
const { canChangeJob, changeJob, promotionCost, promotionOptions } = await import('../src/core/jobs');
const { heldKeys } = await import('../src/core/ledger');
const { dispatchBlock, markRead, replyMail } = await import('../src/core/mail');
const { activeMax, activeQuests, deliver, recipeUnlocked, visibleQuests } = await import('../src/core/quests');
const { assessReadiness } = await import('../src/core/readiness');
const { capacity, hire, hireFee } = await import('../src/core/recruit');
const { canTrain, trainSkill } = await import('../src/core/training');
const { PARTY_MAX } = await import('../src/core/types');
const { travelDays } = await import('../src/core/world');

const HOME = 'base';
/** core の上限は4隊だが、先端A・先端B・3隊目(次の目標の踏査・依頼・素材)の3役に分ける */
const PARTIES = 3;
const MIN_PARTY = 2;
/** 先端Bを出すのは、AとBの8人を除いても3隊目が組める名簿のとき */
const TWO_FRONTS_ROSTER = 2 * PARTY_MAX + MIN_PARTY;
const REST_FATIGUE = 50;
/** 昇給は資金が日給合計のこの日数分あるときだけ承認(playstyles と同じ) */
const RAISE_RESERVE_DAYS = 5;
/** 資金が足りなくても、忠誠がこれ未満の人の昇給・引き留めは承認する */
const RETAIN_LOYALTY = 10;
/** 雇用・建設の前に手元に残す額 = 日給合計×この日数 */
const RESERVE_DAYS = 6;
/** 「余裕があれば」= 払った後も reserve のこの倍が残る(増築・転職・訓練・上等な薬) */
const SPARE_MULT = 2;
const SITE_DAYS = 3;
/** 片道がこの日数以下(拠点の隣の森)は近場。坑道は隠れた近道で片道1日になるが、往復2日に対して現地3日は短い */
const NEAR_TRAVEL = 0;
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
/** 今の目標の階の探索がこの回数続けて探索率を増やさなければ、その階の探索は打ち切る */
const STALL_TRIPS = 3;
const IRON_QUEST = 'u_forge_iron';
const TRAIN_SKILLS = ['might', 'tough'];
const RICH_GOLD = 50000;
const CHECKPOINTS = [10, 20, 30, 45, 60, 75, 90, 120, 150].filter((d) => d <= LAST_DAY);
const PERIODS = [{ label: '〜30日', from: 1, to: 30 }, { label: '31〜60日', from: 31, to: 60 }, { label: '61〜90日', from: 61, to: 90 }];
/** 返事を待たせるメール */
const LATER = '(later)';

// ---- 進行の目標 ----
interface Stage { dungeon: string; floor: string }
/** full の進行の並び。完了 = 探索し終えた(explored) かつ その階の主(symbol/boss)を倒した */
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
const DRAGON_FLOOR = DUNGEON[LAIR].floors[DUNGEON[LAIR].floors.length - 1].id;

type Need =
  | { kind: 'rate'; rate: number; days?: number }
  | { kind: 'key'; key: string; stairs: boolean }
  | { kind: 'stairs' }
  | { kind: 'items'; items: [string, number][]; made: string }
  | { kind: 'dragon' }
  | { kind: 'stage' };
/** 進行の目標。goal は目標の番号(fast は①〜⑤、full は階の順) */
interface Step extends Stage { goal: number; short: string; label: string; need: Need }
const MARK = ['', '①', '②', '③', '④', '⑤'];
const RING = 'ember_ring';
const RING_INPUTS = (RECIPES.find((r) => r.output.item === RING)?.inputs ?? []).map((i): [string, number] => [i.item, i.n]);
const FAST: Step[] = [
  { goal: 1, short: '森', label: '森の洞窟 探索率60%(または15日経過)', dungeon: 'forest_cave', floor: 'f1', need: { kind: 'rate', rate: 0.6, days: 15 } },
  { goal: 2, short: '坑道', label: '古い坑道 踏査→探索率40%', dungeon: 'old_mine', floor: 'f1', need: { kind: 'rate', rate: 0.4 } },
  { goal: 3, short: '塔f1', label: `廃れた塔f1 踏査→${ITEM.ruin_key.name}と下り階段`, dungeon: 'ruined_tower', floor: 'f1', need: { kind: 'key', key: 'ruin_key', stairs: true } },
  {
    goal: 3, short: '塔f2', label: `廃れた塔f2 ${ITEM[RING].name}の素材(${RING_INPUTS.map(([it, n]) => `${ITEM[it].name}${n}`).join('・')})`,
    dungeon: 'ruined_tower', floor: 'f2', need: { kind: 'items', items: RING_INPUTS, made: RING },
  },
  { goal: 4, short: '遺跡f1', label: '沈んだ遺跡f1 踏査→扉を抜けて下り階段', dungeon: 'sunken_ruins', floor: 'f1', need: { kind: 'stairs' } },
  { goal: 4, short: '遺跡f2', label: `沈んだ遺跡f2 ${ITEM.dragon_crest.name}`, dungeon: 'sunken_ruins', floor: 'f2', need: { kind: 'key', key: 'dragon_crest', stairs: false } },
  { goal: 5, short: '寝床f1', label: '竜の寝床f1 踏査→扉を抜けて下り階段', dungeon: LAIR, floor: 'f1', need: { kind: 'stairs' } },
  { goal: 5, short: '寝床f2', label: '竜の寝床f2 竜の討伐', dungeon: LAIR, floor: DRAGON_FLOOR, need: { kind: 'dragon' } },
];
const FULL: Step[] = STAGES.map((st, i): Step => ({
  ...st, goal: i + 1, short: `${DUNGEON[st.dungeon].name}${st.floor}`, label: `${DUNGEON[st.dungeon].name}${st.floor} 探索し終えて主を倒す`, need: { kind: 'stage' },
}));
const PATH = ROUTE === 'fast' ? FAST : FULL;
const pathName = (i: number) => (i < 0 ? 'なし' : i >= PATH.length ? '討伐済' : ROUTE === 'fast' ? `${MARK[PATH[i].goal]}${PATH[i].short}` : PATH[i].short);
// 熾火の指輪は人数分の材料集めに日数がかかるので、竜の寝床が今の目標になってからでは遅い。fast は塔f2(指輪の素材)から、full は紋章のある階から備える
const FIRE_FROM = ROUTE === 'fast' ? PATH.findIndex((st) => st.need.kind === 'items') : PATH.findIndex((st) => st.dungeon === 'sunken_ruins' && st.floor === 'f2');

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

type Role = 'front' | 'second' | 'third';
const ROLE_NAME: Record<Role, string> = { front: '先端A', second: '先端B', third: '3隊目' };
interface Plan { action: ActionKind; target: DispatchOrder['target']; days: number; label: string; questId?: string }

const REASONS = ['火耐性が足りない', 'readiness が危険', '資金が無く製作できない', '素材が足りない', '隊員が足りない', '依頼で隊を取られる'] as const;
/** 指示の6つに当てはまらない止まり方。見つけたら別に数える */
const EXTRA_REASONS = ['竜の前の資金・回復薬が足りない', '下の階へ行けない(階段・鍵)', '先端の探索が進まない', '歩き尽くしたが鍵・階段に届かない'] as const;
type Reason = (typeof REASONS)[number] | (typeof EXTRA_REASONS)[number];

const GENERAL_MS = [
  { id: 'debt', label: '最初に借金になった日' },
  { id: 'promote', label: '最初の転職(上級職)の日' },
  { id: 'fac5', label: '施設が5つ完成した日' },
  { id: 'fac10', label: '施設が10完成した日' },
  { id: 'ach10', label: '実績10個の日' },
];
const MILESTONES = ROUTE === 'fast'
  ? [...['old_mine', 'ruined_tower', 'sunken_ruins', LAIR].map((d) => ({ id: `confirm:${d}`, label: `${DUNGEON[d].name}を確認した日(踏査)` })), ...GENERAL_MS]
  : [
    ...['forest_cave', 'old_mine', 'ruined_tower', 'frost_valley', 'sunken_ruins', LAIR].map((d) => ({ id: `boss:${d}`, label: `${DUNGEON[d].name}の主を初めて倒した日` })),
    ...GENERAL_MS,
    { id: 'crest', label: '竜の紋章を取った日' },
    { id: 'lair', label: '竜の寝床の入口を確認した日' },
  ];

/** ratio = 先端Aが今の目標に出ようとしたときの戦力比(最後に見積もった値) */
interface Snap { gold: number; level: number; roster: number; facilities: number; achievements: number; step: number; ratio: number }
interface Period { days: number; income: number; expense: number; topped: number; flows: Record<string, number> }
interface Run {
  seed: number;
  dragonDay: number | null;
  endDay: number;
  ms: Record<string, number | null>;
  /** 目標(PATH)ごとの達成日 */
  stepDay: (number | null)[];
  snaps: Snap[];
  periods: Period[];
  topped: number;
  gold: number; roster: number; avgLevel: number; upper: number;
  facilities: number; synergies: number; achievements: number; fire: number;
  questsDone: number; questsFailed: number; failedTypes: string;
  gone: number; debtDays: number;
  lastDone: number;
  /** full: 探索率100%未満(隠し通路・扉の奥を残したまま)で完了とした階 */
  partial: string[];
  trying: string;
  /** 今の目標で止まっていた日数と、理由ごとの日数 */
  stuckDays: number;
  reasons: Partial<Record<Reason, number>>;
  /** 台帳の項目(ラベルの「:」より前)ごとの合計 */
  flows: Record<string, number>;
}

function runSeed(seed: number, log: boolean): Run {
  const s: GameState = newGame(seed);
  const startDay = s.day;
  const roles = new Map<string, Role>();
  const questOf = new Map<string, string>();
  const labels = new Map<string, string>();
  /** 今の目標の階へ出した探索: 遠征ID → 出発時の探索率(帰還で進んだかを見る) */
  const frontRate = new Map<string, { step: number; rate: number }>();
  const bossKilled = new Set<string>();
  /** 階ごとの、探索率が増えなかった探索の続いた回数(今の目標の階への探索だけ数える) */
  const stalls = new Map<string, number>();
  const ms: Record<string, number | null> = Object.fromEntries(MILESTONES.map((m) => [m.id, null]));
  const stepDay: (number | null)[] = PATH.map(() => null);
  let front = 0;
  let frontSince = s.day;
  let reasons: Partial<Record<Reason, number>> = {};
  let today = new Set<Reason>();
  let trying = '';
  let acts: string[] = [];
  /** 製作の目標が止まっている理由(その日の製作で記録し、先端が止まった日に添える) */
  let craftBlock = new Set<Reason>();
  let debtDays = 0;
  let topped = 0;
  let frontRatio = NaN;
  const flows: Record<string, number> = {};
  const periods: Period[] = PERIODS.map(() => ({ days: 0, income: 0, expense: 0, topped: 0, flows: {} }));
  const periodOf = (day: number): Period | undefined => periods[PERIODS.findIndex((p) => day >= p.from && day <= p.to)];
  // 台帳は先頭に積まれ300件で切られるので、日ごとに前日の先頭までを足し込む
  const tally = (head: LedgerEntry | undefined, day: number) => {
    const p = periodOf(day);
    for (const e of s.ledger) {
      if (e === head) break;
      const k = e.label.split(/[:(]/)[0].trim();
      flows[k] = (flows[k] ?? 0) + e.amount;
      if (!p) continue;
      p.flows[k] = (p.flows[k] ?? 0) + e.amount;
      if (e.amount >= 0) p.income += e.amount;
      else p.expense += e.amount;
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
  const inDebt = () => s.gold < 0;
  /** 隊に入れられる人。勤務中は出発の前に外すので含める */
  const ready = (a: Adventurer) => (a.status === 'idle' || a.status === 'working') && a.injuryDays === 0 && a.fatigue < REST_FATIGUE;
  const byPower = (xs: Adventurer[]) => [...xs].sort((a, b) => powerOf(b) - powerOf(a));
  const have = (item: string) => s.inventory[item] ?? 0;
  const crafting = (item: string) => s.crafts.filter((j) => RECIPE[j.recipeId]?.output.item === item).length;
  const owned = (item: string) => have(item) + crafting(item) + s.adventurers.filter((a) => Object.values(a.equipment).includes(item)).length;

  // ---- 進行 ----
  const rateOf = (st: Stage) => exploredRateOf(s, st.dungeon, st.floor);
  /**
   * 見える範囲を歩き尽くした = 踏んだマスの隣に、今の知識(鍵・見つけた隠し通路)で入れる未踏のマスが無く、
   * 調べ直せる隠し通路(searchSpots)も残っていない。探索の隊は歩き尽くしても隠し通路を調べ直しに戻るので、
   * 調べ直せる間は歩き尽くしたとみなさず、探索を出し続ける(探索率が増えない探索は STALL_TRIPS で打ち切る)
   */
  const exhausted = (st: Stage) => cached(`ex:${st.dungeon}:${st.floor}`, () => isExhausted(st));
  const isExhausted = (st: Stage) => {
    const fp = s.dungeons[st.dungeon]?.floors[st.floor];
    if (!fp?.visited.length) return false;
    const g = GRID[keyOf(st.dungeon, st.floor)];
    const visited = new Set(fp.visited);
    const know = { keys: heldKeys(s), hiddenFound: fp.hiddenFound };
    for (const i of visited) for (const n of visibleFrom(g, i)) if (!visited.has(n) && isPassable(g, n, know)) return false;
    return searchSpots(g, visited, fp.hiddenFound).length === 0;
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
  const transitOf = (st: Stage) => cached(`tr:${st.dungeon}:${st.floor}`, () => (s.dungeons[st.dungeon]?.confirmed
    ? floorTransit(DUNGEON[st.dungeon], st.floor, s.dungeons[st.dungeon], heldKeys(s))
    : null));
  const nextFloor = (st: Stage) => {
    const fs = DUNGEON[st.dungeon].floors;
    return fs[fs.findIndex((f) => f.id === st.floor) + 1]?.id ?? null;
  };
  /** 下の階へ出せる = 下り階段まで(扉は今の鍵で)行ける */
  const below = (st: Stage) => {
    const f = nextFloor(st);
    return f !== null && transitOf({ dungeon: st.dungeon, floor: f }) !== null;
  };
  const bossSeen = (st: Stage) => {
    const g = GRID[keyOf(st.dungeon, st.floor)];
    return (s.dungeons[st.dungeon]?.floors[st.floor]?.visited ?? []).some((i) => BOSS_KINDS.includes(g.cells[i]?.kind));
  };
  const reached = (st: Step): boolean => {
    const n = st.need;
    switch (n.kind) {
      case 'rate': return rateOf(st) >= n.rate || (n.days !== undefined && s.day - startDay >= n.days) || explored(st);
      case 'key': return heldKeys(s).includes(n.key) && (!n.stairs || below(st));
      case 'stairs': return below(st);
      case 'items': return n.items.every(([it, k]) => have(it) >= k) || owned(n.made) > 0;
      case 'dragon': return s.dragonDefeated;
      case 'stage': return stageDone(st);
    }
  };
  // fast の素材の目標は、作ると素材が減って未達に戻るので、一度達成したら戻さない
  const stepDone = (i: number) => (ROUTE === 'fast' && stepDay[i] !== null) || reached(PATH[i]);
  const frontier = () => {
    const i = PATH.findIndex((_, j) => !stepDone(j));
    return i < 0 ? PATH.length : i;
  };
  /**
   * 現地で向かうマスの深さ(入口からの歩数)。探索は踏んだマスに隣り合う未踏のマスのいちばん深いもの、ほかは目当てのマスのいちばん浅いもの。
   * 大きな階の奥は3日では往復できず、何度出しても探索率が増えなくなるので、近場の日数をここから決める
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
    let ds = g.cells.flatMap((c, i) => (DEPTH[k][i] >= 0 && want(c, i) ? [DEPTH[k][i]] : []));
    // 未踏が尽きた探索は、隠し通路の調べ直しの行き先(searchSpots)まで歩く
    if (!ds.length && action === 'explore') {
      const hiddenFound = s.dungeons[st.dungeon]?.floors[st.floor]?.hiddenFound ?? [];
      ds = searchSpots(g, visited, hiddenFound).flatMap((i) => (DEPTH[k][i] >= 0 ? [DEPTH[k][i]] : []));
    }
    if (!ds.length) return 0;
    return action === 'explore' ? Math.max(...ds) : Math.min(...ds);
  };
  /** 往復(目当てのマスまで)と移動費(上の階を抜ける歩数)が収まる最小の日数 + 1日、3〜7日 */
  const siteDays = (transit: number, depth: number) =>
    Math.min(DAYS_MAX, Math.max(SITE_DAYS, Math.ceil((2 * (transit + depth)) / STEPS_PER_DAY) + 1));
  const oneWay = (dungeon: string) => travelDays(HOME, DUNGEON[dungeon].node, s.world) ?? Infinity;
  const roundTrip = (dungeon: string) => 2 * oneWay(dungeon);
  // 遠いダンジョンは片道2〜4日かかるので、現地を短くすると移動ばかりになる。やることが尽きれば core が早めに引き返させる
  const daysAt = (st: Stage, transit: number, depth: number) => (oneWay(st.dungeon) <= NEAR_TRAVEL ? siteDays(transit, depth) : DAYS_MAX);

  const dungeonPlan = (st: Stage, action: ActionKind, extra: DispatchOrder['target'] = {}): Plan | null => {
    const prog = s.dungeons[st.dungeon];
    const name = DUNGEON[st.dungeon].name;
    if (!prog) return null;
    if (!prog.confirmed) return { action: 'survey', target: { dungeon: st.dungeon, floor: 'f1' }, days: SITE_DAYS, label: `${name}を踏査` };
    const transit = transitOf(st);
    if (transit === null) return null;
    const what = extra.item ? `(${ITEM[extra.item].name})` : extra.enemy ? `(${ENEMY[extra.enemy].name})` : '';
    const days = daysAt(st, transit, targetDepth(st, action, extra));
    return { action, target: { dungeon: st.dungeon, floor: st.floor, ...extra }, days, label: `${name}${st.floor}を${ACTION_NAME[action]}${what}` };
  };
  /** full: その階を進める。探索し終えるまでは探索、主を踏んでいれば主討伐 */
  const advancePlan = (st: Stage): Plan | null => {
    if (!explored(st)) return dungeonPlan(st, 'explore');
    const k = keyOf(st.dungeon, st.floor);
    return dungeonPlan(st, bossSeen(st) && !bossKilled.has(k) ? 'boss' : 'explore');
  };

  // ---- 素材の出どころ ----
  const drops = (enemy: string, item: string) => (ENEMY[enemy]?.loot ?? []).some((l) => l.item === item);
  /** その階で素材を取る: 踏んだ採取点 > 踏んだ巣 */
  const floorSource = (st: Stage, item: string): Plan | null => {
    const g = GRID[keyOf(st.dungeon, st.floor)];
    const visited = new Set(s.dungeons[st.dungeon]?.floors[st.floor]?.visited ?? []);
    if (g.cells.some((c, i) => c.kind === 'gather' && c.item === item && visited.has(i))) return dungeonPlan(st, 'gather', { item });
    const nest = g.cells.findIndex((c, i) => c.kind === 'nest' && !!c.enemy && drops(c.enemy, item) && visited.has(i));
    // 敵の指定は探索率100%の階だけ(core の出発条件)。そうでない階は指定せず、踏んだ巣を回る
    return nest >= 0 ? dungeonPlan(st, 'hunt', rateOf(st) >= 1 ? { enemy: g.cells[nest].enemy } : {}) : null;
  };
  /** 素材を取りに行く先。確認済みで行ける階のうち、進行の並びで最初に見つかるもの。採取点 > 巣 > 道中の敵 */
  const sourcePlan = (item: string): Plan | null => cached(`src:${item}`, () => findSource(item));
  const findSource = (item: string): Plan | null => {
    // 道中の敵が落とす階を先に選ぶと、奥の階で踏んだ採取点・巣を使わない(塔f1の道中の鬼火を、f2の採取点より先に選んでいた)
    for (const st of STAGES) {
      if (!s.dungeons[st.dungeon]?.confirmed || transitOf(st) === null) continue;
      const p = floorSource(st, item);
      if (p) return p;
    }
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
    }
    // 道中の敵だけが落とす階は、採取点・巣のある階をすべて見てから。先に選ぶと、未踏の奥の階の巣を使わず手前で粘る
    for (const st of STAGES) {
      if (!s.dungeons[st.dungeon]?.confirmed || transitOf(st) === null) continue;
      if (DUNGEON[st.dungeon].enemies.some((e) => drops(e.id, item))) return dungeonPlan(st, rateOf(st) >= 1 ? 'hunt' : 'explore');
    }
    return null;
  };
  const obtainable = (item: string) => !!sourcePlan(item);
  const samePlace = (p: Plan, o: DispatchOrder) => p.action === o.action && p.target.dungeon === o.target.dungeon
    && p.target.floor === o.target.floor && p.target.item === o.target.item && p.target.enemy === o.target.enemy;
  /**
   * 素材の目標: その階の採取点・巣が分かっていれば取りに行き、分からなければその階を探索し、ほかの階でも探す。
   * 先端Bは先端Aと同じ行き先を避ける(同じ階を2隊で探索すると地図が重なる)
   */
  const itemsPlan = (st: Step, items: [string, number][], avoid: DispatchOrder | null): Plan | null => {
    const missing = items.filter(([it, n]) => have(it) < n).map(([it]) => it);
    const plans = [
      ...missing.map((it) => floorSource(st, it)),
      rateOf(st) < 1 && !exhausted(st) ? dungeonPlan(st, 'explore') : null,
      ...missing.map((it) => sourcePlan(it)),
    ].filter((p): p is Plan => !!p);
    return plans.find((p) => !avoid || !samePlace(p, avoid)) ?? plans[0] ?? null;
  };
  /** 今の目標を進める計画。null = 下の階へ行けない、または歩き尽くしても届かない */
  const stepPlan = (i: number, avoid: DispatchOrder | null): Plan | null => {
    const st = PATH[i];
    const n = st.need;
    switch (n.kind) {
      case 'stage': return advancePlan(st);
      case 'items': return itemsPlan(st, n.items, avoid);
      case 'dragon': return dungeonPlan(st, bossSeen(st) ? 'boss' : 'explore');
      default: return exhausted(st) ? null : dungeonPlan(st, 'explore');
    }
  };

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
      // 火耐性の品は竜と戦う先端Aの分だけ作る。名簿全員の分まで素材を集めると、竜の前に日数を食いつぶす
      const wearers = list === ACCESSORIES_FIRE ? byPower(s.adventurers).slice(0, PARTY_MAX) : byPower(s.adventurers);
      for (const a of wearers) {
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
    if (inDebt()) {
      craftBlock.add('資金が無く製作できない');
      return;
    }
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
    // 借金中は製作も建設もしないので、装備・施設・薬の材料は残さず売って返済に回す
    if (!inDebt()) {
      const { goal } = equipNeeds();
      for (const [it, n] of goal) for (const i of RECIPE_OF[it].inputs) add(i.item, i.n * n);
      for (const [it, n] of Object.entries(facilityNext()?.materials ?? {})) add(it, n);
      const potions = have('potion') + 2 * crafting('potion');
      if (potions < POTIONS_KEEP) add('herb', 2 * Math.ceil((POTIONS_KEEP - potions) / 2));
    }
    if (!s.flags['unlock:' + IRON_QUEST]) add('iron_ore', 5);
    for (const q of activeQuests(s)) if (q.type === 'deliver' && q.target.item) add(q.target.item, q.target.n ?? 0);
    // 素材の目標は在庫が揃った日で達成とみなすので、指輪がまだ作れない間も売らずに貯める
    const st = PATH[front];
    if (st?.need.kind === 'items' && !stepDone(front)) for (const [it, n] of st.need.items) if ((keep.get(it) ?? 0) < n) keep.set(it, n);
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
  const tight = () => s.gold < RAISE_RESERVE_DAYS * payroll();
  /**
   * 昇給は資金に余裕があるか、忠誠が RETAIN_LOYALTY 未満のときだけ承認し、ほかは保留する(利息が膨らむ前に日給を増やさない)。
   * 引き留めを断ると7日後に去って戻らないので、断るのは借金中だけにし、返事は去る前の最後の日まで待たせて決め直す。
   * 名簿が1隊分を切るまでは断らない(借金中に全員を去らせると、名簿が尽きて何も進まなかった)
   */
  const choiceFor = (m: Mail): string | null => {
    const a = s.adventurers.find((x) => x.id === m.from);
    const low = a !== undefined && a.loyalty < RETAIN_LOYALTY;
    switch (m.kind) {
      case 'raise': return !tight() || low ? 'accept' : 'hold';
      case 'warning': {
        if (!inDebt() || low || s.adventurers.length <= PARTY_MAX) return 'retain';
        const w = a?.history.warnedDay;
        return a && typeof w === 'number' && s.day < w + TUNING.mail.resignDays ? LATER : 'leave';
      }
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
      if (choice === LATER) continue;
      if (!choice || !replyMail(s, m.id, choice).ok) markRead(s, m.id);
    }
  };

  const hireOne = () => {
    if (inDebt() || s.adventurers.length >= capacity(s)) return;
    const c = [...s.candidates].sort((a, b) => powerOf(b.adv) / b.adv.salary - powerOf(a.adv) / a.adv.salary)[0];
    if (c && s.gold >= reserve() + hireFee(c.adv.salary) && hire(s, c.adv.id).ok) acts.push(`雇用 ${c.adv.name}`);
  };

  const buildOne = () => {
    if (inDebt()) return;
    const built = (id: string) => s.base.facilities.find((f) => f.id === id);
    // 宿舎のLv2は名簿(=同時に出せる隊の数)を増やす唯一の道なので、残りの施設を建てる前に済ませる
    const dorm = built('dorm');
    if (dorm && !dorm.construction && dorm.level >= 1 && dorm.level < FACILITY.dorm.maxLevel && spare(FACILITY.dorm.costs[dorm.level].gold) && upgrade(s, 'dorm').ok) {
      acts.push(`増築 ${FACILITY.dorm.name}`);
      return;
    }
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

  // 訓練は派遣の後に、出なかった人だけ。先に回すと先端の隊から強い人が3日抜ける。先端の隊のために取っておいた人も回さない
  const trainLeftovers = () => {
    const keep = heldBack('third');
    for (const a of s.adventurers) {
      if (a.status !== 'idle' || keep.has(a.id)) continue;
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
  const byDue = (a: Quest, b: Quest) => (a.dueDay ?? Infinity) - (b.dueDay ?? Infinity);
  /** 依頼をこなすのは3隊目だけ。受けている分を納期順に1隊で片付ける。護衛は出発日が決まっているので数えない */
  const questWork = () => activeQuests(s).filter((q) => q.type !== 'unlock' && q.type !== 'escort').sort(byDue);
  /** 先に extra 日かかる用事(踏査)を済ませても、受けている依頼(と add)を納期順に片付けられる */
  const fitsAfter = (extra: number, add: Quest | null = null) => {
    let t = s.day + extra;
    for (const q of [...questWork(), ...(add ? [add] : [])].sort(byDue)) {
      t += needDays(q);
      if (t > (q.dueDay ?? Infinity)) return false;
    }
    return true;
  };
  const surveying = (dungeon: string) => [...s.expeditions].some((e) => e.order.action === 'survey' && e.order.target.dungeon === dungeon);
  /**
   * 3隊目が先回りして踏査する先: 次の目標までで、まだ確認していないダンジョンのいちばん手前。
   * それより先まで踏査すると、弱い3隊目が遠い道で全滅を繰り返す(竜の寝床を60日早く踏査しに行っていた)
   */
  const surveyPlan = (): Plan | null => {
    if (front >= PATH.length) return null;
    for (let i = front + 1; i < PATH.length && PATH[i].goal <= PATH[front].goal + 1; i++) {
      const d = PATH[i].dungeon;
      if (s.dungeons[d]?.confirmed || surveying(d)) continue;
      return dungeonPlan(PATH[i], 'survey');
    }
    return null;
  };
  const surveyLead = () => {
    const p = surveyPlan();
    return p?.target.dungeon ? roundTrip(p.target.dungeon) + p.days : 0;
  };
  const acceptAll = () => {
    const board = visibleQuests(s).filter((q) => q.status === 'posted' && q.type !== 'unlock')
      .sort((a, b) => (a.acceptBy ?? Infinity) - (b.acceptBy ?? Infinity));
    // 依頼に回るのは先端の隊(戦力上位)を除いた人。その顔ぶれで出せない・危険な依頼は受けても納期切れになるだけ
    const core = new Set(byPower(s.adventurers).slice(0, (twoFronts() ? 2 : 1) * PARTY_MAX).map((a) => a.id));
    const crew = byPower(s.adventurers.filter((a) => !core.has(a.id))).slice(0, PARTY_MAX);
    const lead = out('third') ? 0 : surveyLead();
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
        if (q.type !== 'escort' && q.type !== 'transport' && (!p || danger(crew, p, 'third'))) continue;
      }
      if (q.type !== 'escort' && !fitsAfter(lead, { ...q, dueDay: due })) continue;
      // 護衛は出発日に隊がいなければ失敗する。出発が今日か明日で、3隊目が空いていて顔ぶれがそろっているときだけ受ける
      if (q.type === 'escort' && ((q.departDay ?? 0) - s.day > 1 || out('third') || formParty(core).length < MIN_PARTY
        || activeQuests(s).some((x) => x.type === 'escort' && x.departDay === q.departDay))) continue;
      if (acceptQuest(s, q.id).ok) acts.push(`受注 ${q.name}`);
    }
  };

  // ---- 派遣 ----
  const twoFronts = () => s.adventurers.length >= TWO_FRONTS_ROSTER;
  const formParty = (except: Set<string> = new Set()) => {
    const party: Adventurer[] = [];
    for (const a of byPower(s.adventurers.filter((x) => ready(x) && !except.has(x.id)))) {
      if (party.length < PARTY_MAX && !dispatchBlock(s, [...party, a])) party.push(a);
    }
    return party;
  };
  /**
   * 出ていない先端の隊のために、待機中で負傷していない戦力上位を取っておく(A に上位4人、B にその次の4人)。
   * 取っておかないと、休み明けの人から順に後の隊へ出ていき、先端の4人が同じ日にそろわなくなる
   */
  const heldBack = (role: Role): Set<string> => {
    const keep = new Set<string>();
    if (role === 'front') return keep;
    const healthy = byPower(s.adventurers.filter((a) => (a.status === 'idle' || a.status === 'working') && a.injuryDays === 0));
    let at = 0;
    if (!out('front')) {
      for (const a of healthy.slice(0, PARTY_MAX)) keep.add(a.id);
      at = PARTY_MAX;
    }
    if (role === 'third' && twoFronts() && !out('second')) for (const a of healthy.slice(at, at + PARTY_MAX)) keep.add(a.id);
    return keep;
  };
  // 探索の寄り道は隊長の性格で決まる。臆病(avoid)は巣と主のマスを踏まず主の居場所が分からないまま、
  // 強欲(treasure)は既知の宝箱・採取点を回って地図を広げないまま止まる seed があったので、探索ではこの順で隊長を選ぶ
  const DETOUR_RANK = ['none', 'nest', 'injured', 'treasure', 'avoid'];
  const leaderOf = (party: Adventurer[], action: ActionKind) => {
    if (action !== 'explore' && action !== 'survey') return party[0];
    const rank = (a: Adventurer) => DETOUR_RANK.indexOf(PERSONALITY[a.personality]?.explore.detour ?? 'none');
    return [...party].sort((a, b) => rank(a) - rank(b))[0];
  };
  const orderOf = (party: Adventurer[], p: Plan, role: Role, policy = POLICY_ID): DispatchOrder => {
    const items: Record<string, number> = {};
    const pot = Math.min(PARTY_POTIONS, have('potion'));
    if (pot) items.potion = pot;
    const hi = Math.min(PARTY_POTIONS, have('hi_potion'));
    if (role !== 'third' && p.target.dungeon && hi) items.hi_potion = hi;
    return { partyIds: party.map((a) => a.id), leaderId: leaderOf(party, p.action).id, action: p.action, target: p.target, policy, days: p.days, items };
  };
  // grade は戦力比だけで決まり、予測の試行の結果(撤退率・全滅率)を見ない。坑道で予測「撤退100%」のまま
  // 「厳しい」止まりで20回続けて撤退した seed があったので、先端だけは試行して予測も見る。ほかは試行0回(速さのため)
  const assess = (party: Adventurer[], p: Plan, role: Role, policy = POLICY_ID, runs = 0): Readiness | null =>
    (p.target.dungeon && p.action !== 'survey' ? assessReadiness(s, orderOf(party, p, role, policy), runs) : null);
  const dangerous = (r: Readiness | null) =>
    !!r && (r.grade === '危険' || (r.runs > 0 && (r.retreatRate >= RETREAT_DANGER || r.wipeRate >= WIPE_DANGER)));
  const danger = (party: Adventurer[], p: Plan, role: Role) => dangerous(assess(party, p, role));
  /** 戦力比で方針を決める。踏査は readiness が扱わないので、入口の階の探索として見る */
  const policyFor = (party: Adventurer[], p: Plan, role: Role) => {
    if (!p.target.dungeon) return POLICY_ID;
    const r = assess(party, p.action === 'survey' ? { ...p, action: 'explore' } : p, role);
    if (!r) return POLICY_ID;
    return r.powerRatio >= HUNT_RATIO ? POLICY_HUNT : r.powerRatio < SAFE_RATIO ? POLICY_SAFE : POLICY_ID;
  };
  const readinessText = (r: Readiness | null) => (r ? `[${r.grade} 戦力比${r.powerRatio.toFixed(2)} 撤退${Math.round(r.retreatRate * 100)}% 全滅${Math.round(r.wipeRate * 100)}%]` : '');
  const out = (role: Role) => [...s.expeditions].filter((e) => roles.get(e.id) === role).length;
  const send = (party: Adventurer[], p: Plan, role: Role, policy = policyFor(party, p, role)): boolean => {
    for (const a of party) if (a.status === 'working') unassignWorker(s, a.id);
    const r = dispatch(s, orderOf(party, p, role, policy));
    if (!r.ok) {
      acts.push(`派遣失敗(${p.label}): ${r.reason}`);
      return false;
    }
    roles.set(r.expedition.id, role);
    labels.set(r.expedition.id, p.label);
    if (p.questId) questOf.set(r.expedition.id, p.questId);
    const st = PATH[front];
    if (role !== 'third' && st && p.target.dungeon === st.dungeon && p.target.floor === st.floor) frontRate.set(r.expedition.id, { step: front, rate: rateOf(st) });
    acts.push(`${ROLE_NAME[role]}: ${p.label}(${party.length}人${p.days}日${policy === POLICY_ID ? '' : ` ${POLICY[policy].name}`})`);
    return true;
  };

  /** 経験値と素材を稼ぐ行き先。full は前の階を進めるか巣で討伐、fast は巣を知っていれば巣、知らなければ探索 */
  const xpPlan = (st: Step): Plan | null => {
    if (ROUTE === 'full') return stageDone(st) ? dungeonPlan(st, 'hunt') : advancePlan(st);
    return dungeonPlan(st, knownNest(st, () => true) || exhausted(st) ? 'hunt' : 'explore');
  };
  /** 素材が足りなければ取りに行き、無ければ今の目標の1つ前(から手前へ)で稼ぐ */
  const supportPlan = (party: Adventurer[], role: Role): Plan | null => {
    for (const item of shortages()) {
      const p = sourcePlan(item);
      if (p && !danger(party, p, role)) return p;
    }
    for (let i = Math.max(0, front - 1); i >= 0; i--) {
      const p = xpPlan(PATH[i]);
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

  /** 先端A(戦力上位4人)と先端B(その次の4人)は今の目標へ。危険・行けないときは素材集めか前の目標で稼ぐ */
  const frontStep = (role: 'front' | 'second') => {
    const isA = role === 'front';
    if (out(role) || front >= PATH.length || (!isA && !twoFronts())) return;
    const party = formParty(heldBack(role));
    // 引き留めずに去らせると名簿が尽きることがあるので、A も1人は要る
    const need = isA ? Math.max(1, Math.min(PARTY_MAX, s.adventurers.length)) : PARTY_MAX;
    if (party.length < need || s.expeditions.length >= PARTIES) {
      if (!isA) return;
      const questIds = new Set([...s.expeditions].filter((e) => roles.get(e.id) === 'third').flatMap((e) => e.order.partyIds));
      const healthy = s.adventurers.filter((a) => a.injuryDays === 0).length;
      // 疲労が抜けるのを待つだけの日(休養待ち)は止まった理由に数えない
      if (questIds.size && (s.expeditions.length >= PARTIES || party.length + questIds.size >= need)) today.add('依頼で隊を取られる');
      else if (healthy < need) today.add('隊員が足りない');
      trying = `${pathName(front)}へ出す隊を待つ`;
      return;
    }
    const st = PATH[front];
    const avoid = isA ? null : [...s.expeditions].find((e) => roles.get(e.id) === 'front')?.order ?? null;
    const plan = stepPlan(front, avoid);
    const why: Reason[] = [];
    let wait = '';
    if (!plan) why.push(exhausted(st) ? '歩き尽くしたが鍵・階段に届かない' : '下の階へ行けない(階段・鍵)');
    else if (plan.action === 'survey' && surveying(st.dungeon)) wait = `${DUNGEON[st.dungeon].name}の踏査の帰りを待つ`;
    else if (st.dungeon === LAIR && st.floor === DRAGON_FLOOR && plan.action !== 'survey') why.push(...lairReady(party));
    if (isA && plan && plan.action !== 'survey') frontRatio = assess(party, plan, role)?.powerRatio ?? frontRatio;
    const go = !!plan && !why.length && !wait;
    const policy = go ? policyFor(party, plan!, role) : POLICY_ID;
    const r = go ? assess(party, plan!, role, policy, TUNING.readiness.runs) : null;
    if (log && r) acts.push(`見込み(${ROLE_NAME[role]}) ${readinessText(r)}`);
    if (dangerous(r)) why.push('readiness が危険');
    if (why.length || wait) {
      if (isA) {
        for (const x of why) today.add(x);
        if (why.length) for (const x of craftBlock) today.add(x);
        trying = `${plan?.label ?? pathName(front)}(見送り: ${wait || why.join('・')})`;
      }
      const alt = supportPlan(party, role);
      if (alt) send(party, alt, role);
      return;
    }
    if (isA) trying = plan!.label;
    send(party, plan!, role, policy);
  };

  /** 3隊目: 当日出発の護衛 → 先の目標のダンジョンの踏査(受けた依頼の納期に響かなければ)→ 依頼 → 踏査 → 足りない素材・前の目標で稼ぐ */
  const thirdStep = () => {
    if (out('third') || s.expeditions.length >= PARTIES) return;
    const party = formParty(heldBack('third'));
    if (party.length < MIN_PARTY) return;
    const busy = (id: string) => [...questOf.entries()].some(([eid, qid]) => qid === id && s.expeditions.some((e) => e.id === eid));
    const escort = activeQuests(s).find((q) => q.type === 'escort' && q.departDay === s.day && !busy(q.id));
    if (escort) {
      const p = workFor(escort);
      if (p) send(party, p, 'third');
      return;
    }
    // 護衛は出発日に隊がいなければ失敗するので、明日出る護衛があれば今日は出ない
    if (activeQuests(s).some((q) => q.type === 'escort' && q.departDay === s.day + 1)) return;
    const survey = surveyPlan();
    if (survey && fitsAfter(surveyLead())) {
      send(party, survey, 'third');
      return;
    }
    for (const q of questWork()) {
      if (busy(q.id)) continue;
      const p = workFor(q);
      if (p && !danger(party, p, 'third')) {
        send(party, p, 'third');
        return;
      }
    }
    const p = survey ?? supportPlan(party, 'third');
    if (p) send(party, p, 'third');
  };

  // ---- 1日 ----
  const record = () => {
    for (const d of Object.keys(s.dungeons)) {
      if (`boss:${d}` in ms && s.dungeons[d].bossDefeated > 0) ms[`boss:${d}`] ??= s.day;
      if (`confirm:${d}` in ms && s.dungeons[d].confirmed) ms[`confirm:${d}`] ??= s.day;
    }
    const done = s.base.facilities.filter((f) => f.level >= 1).length;
    if (done >= 5) ms.fac5 ??= s.day;
    if (done >= 10) ms.fac10 ??= s.day;
    if (s.achievements.length >= 10) ms.ach10 ??= s.day;
    if ('crest' in ms && heldKeys(s).includes('dragon_crest')) ms.crest ??= s.day;
    if ('lair' in ms && s.dungeons[LAIR]?.confirmed) ms.lair ??= s.day;
    PATH.forEach((st, i) => {
      if (stepDay[i] === null && reached(st)) stepDay[i] = s.day;
    });
  };
  const snap = (): Snap => ({
    gold: s.gold,
    level: s.adventurers.length ? s.adventurers.reduce((t, a) => t + a.level, 0) / s.adventurers.length : NaN,
    roster: s.adventurers.length,
    facilities: s.base.facilities.filter((f) => f.level >= 1).length,
    achievements: s.achievements.length,
    step: s.dragonDefeated ? PATH.length : frontier(),
    ratio: frontRatio,
  });
  const snaps: (Snap | null)[] = CHECKPOINTS.map(() => null);

  let returned: string[] = [];
  while (s.day < LAST_DAY && !s.dragonDefeated) {
    acts = returned;
    returned = [];
    today = new Set();
    memo = new Map();
    const day = s.day;
    const head = s.ledger[0];
    front = frontier();
    const at = CHECKPOINTS.indexOf(day);
    if (at >= 0) snaps[at] = snap();
    if (RICH && s.gold < RICH_GOLD) {
      const add = RICH_GOLD - s.gold;
      topped += add;
      const p = periodOf(day);
      if (p) p.topped += add;
      s.gold = RICH_GOLD;
    }
    if (inDebt()) {
      debtDays++;
      ms.debt ??= day;
    }
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
    frontStep('front');
    frontStep('second');
    thirdStep();
    trainLeftovers();
    assignWorkers();
    sellAll();
    for (const r of today) reasons[r] = (reasons[r] ?? 0) + 1;
    if (log) {
      const st = PATH[Math.min(front, PATH.length - 1)];
      console.log(`| ${day} | ${s.gold} | ${s.adventurers.length} | ${pathName(front)} ${Math.floor(rateOf(st) * 100)}% | ${s.expeditions.length} | ${acts.join(' / ') || '-'} |`);
    }
    const rep = advanceDay(s);
    tally(head, day);
    const p = periodOf(day);
    if (p) p.days++;
    memo = new Map();
    for (const e of rep.returned) {
      for (const [enemy, n] of Object.entries(e.result.kills)) {
        const k = BOSS_FLOOR.get(enemy);
        if (k && n > 0) bossKilled.add(k);
      }
      const fr = frontRate.get(e.id);
      if (fr && e.order.action === 'explore') {
        const st = PATH[fr.step];
        const k = keyOf(st.dungeon, st.floor);
        const stuck = rateOf(st) <= fr.rate;
        stalls.set(k, stuck ? (stalls.get(k) ?? 0) + 1 : 0);
        if (stuck && roles.get(e.id) === 'front') reasons['先端の探索が進まない'] = (reasons['先端の探索が進まない'] ?? 0) + 1;
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
      frontRatio = NaN;
    }
  }

  front = frontier();
  const last = snap();
  const n = s.adventurers.length;
  return {
    seed,
    dragonDay: s.dragonDefeated ? (typeof s.flags.clearDay === 'number' ? s.flags.clearDay : s.day) : null,
    endDay: s.day,
    ms,
    stepDay,
    snaps: snaps.map((x) => x ?? last),
    periods,
    topped,
    gold: s.gold,
    roster: n,
    avgLevel: last.level,
    upper: s.adventurers.filter((a) => JOB[a.job].tier === 'upper').length,
    facilities: last.facilities,
    synergies: activeSynergies(s).length,
    achievements: s.achievements.length,
    fire: n ? s.adventurers.reduce((t, a) => t + (equipResist(a).fire ?? 0), 0) / n : NaN,
    questsDone: s.quests.filter((q) => q.status === 'done' && q.type !== 'unlock').length,
    questsFailed: s.quests.filter((q) => q.status === 'failed').length,
    failedTypes: Object.entries(s.quests.filter((q) => q.status === 'failed').reduce<Record<string, number>>((m, q) => ({ ...m, [q.type]: (m[q.type] ?? 0) + 1 }), {})).map(([k, v]) => k + v).join(' '),
    gone: Object.keys(s.flags).filter((k) => k.startsWith('gone:')).length,
    debtDays,
    lastDone: front - 1,
    partial: ROUTE === 'full' ? PATH.slice(0, front).filter((st) => rateOf(st) < 1).map((st) => `${st.short} ${Math.floor(rateOf(st) * 100)}%`) : [],
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
const days = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);

const seeds = ONE_SEED !== null ? [ONE_SEED] : Array.from({ length: SEEDS }, (_, i) => i + 1);
const cmd = [
  ONE_SEED !== null ? `--seed ${ONE_SEED} ${LAST_DAY}` : `${SEEDS} ${LAST_DAY}`,
  ROUTE === 'full' ? '--route full' : '',
  RICH ? '--rich' : '',
  ...valuesOf('--set').map((v) => `--set ${v}`),
].filter(Boolean).join(' ');
const intro = [`### 計測(\`npm run sim:dragon -- ${cmd}\`。${seeds.length}seed×最大${LAST_DAY}日、${ROUTE === 'fast' ? '竜までの最短(fast)' : '全階100%と主(full)'}${RICH ? '、所持金を補う' : ''})`, ''];
if (OVERRIDES.length) intro.push(`数値の上書き(--set。メモリ上だけ): ${OVERRIDES.join(' / ')}`, '');
if (RICH) intro.push(`--rich: 毎日、所持金が${RICH_GOLD}G未満なら${RICH_GOLD}Gに補った(経済を切り離し、進みの速さだけを測る)。補った額は収支の表の収入に入れず、別の列に出す。`, '');
console.log(intro.join('\n'));

const t0 = performance.now();
if (ONE_SEED !== null) {
  console.log(`#### seed ${ONE_SEED} の日ごとのログ(${LAST_DAY}日まで)`);
  console.log('');
  console.log('| 日 | 資金 | 名簿 | 今の目標 | 出ている隊 | やったこと |');
  console.log('|---|---|---|---|---|---|');
}
const runs = seeds.map((seed) => runSeed(seed, ONE_SEED !== null));
const elapsed = (performance.now() - t0) / 1000;

const out: string[] = [];
if (ONE_SEED !== null) out.push('');
out.push(`bot: メール返信(昇給は資金が日給${RAISE_RESERVE_DAYS}日分あるか忠誠${RETAIN_LOYALTY}未満のときだけ承認し、ほかは保留。引き留めは借金中・忠誠${RETAIN_LOYALTY}以上・名簿${PARTY_MAX}人超のときだけ断り、返事は去る前の最後の日まで待つ)→ 雇用(日給${RESERVE_DAYS}日分を残して戦力/日給の良い順に1日1人)→ 施設(固定配置・優先順に1日1件、全部建ったら Lv2)→ 転職(Lv10で適性の高い上級職)→ 装備(枠ごとに強い順)と製作(工房1件・調合所で回復薬${POTIONS_KEEP}本)→ 依頼(締め切りの近い順に、3隊目で間に合うものだけ受ける)→ 派遣 → 訓練と勤務(出なかった人)→ 素材を売る(装備・施設・薬・依頼に要る分は残す)。借金中は雇用・建設・製作を止め、材料も売る。`);
out.push('');
out.push(`派遣: 最大${PARTIES}隊・各${PARTY_MAX}人まで、疲労${REST_FATIGUE}以上と負傷中は休み。先端A(戦力上位${PARTY_MAX}人)と先端B(その次の${PARTY_MAX}人。名簿${TWO_FRONTS_ROSTER}人以上のとき)は今の目標へ出し、素材の目標では B は A と別の行き先(採取・討伐)を選ぶ。3隊目は 当日出発の護衛 → 先の目標のダンジョンの踏査(受けた依頼の納期に響かなければ)→ 依頼 → 足りない素材・前の目標で稼ぐ。方針は戦力比${HUNT_RATIO}以上で強敵優先、${SAFE_RATIO}未満で安全第一、ほかは標準。現地の日数は、片道${NEAR_TRAVEL}日${NEAR_TRAVEL > 0 ? '以下' : ''}(森)は目当てのマスまでの往復と上の階を抜ける歩数が収まる最小+1日(${SITE_DAYS}日〜)、ほかは${DAYS_MAX}日、踏査は${SITE_DAYS}日。先端は readiness が危険(grade 危険、または予測${TUNING.readiness.runs}回で撤退${RETREAT_DANGER * 100}%以上・全滅${WIPE_DANGER * 100}%以上)なら素材集めか前の目標で稼ぐ。竜の階は火耐性の平均${FIRE_NEED}以上・救助費用+日給${RESERVE_DAYS}日分の資金・回復薬${PARTY_POTIONS}本が揃うまで入らない。`);
out.push('');
if (ROUTE === 'fast') {
  out.push(`目標(fast): ${PATH.map((st) => `${MARK[st.goal]} ${st.label}`).join(' / ')}。谷・主の討伐・探索率100%は求めない。装備は ③塔f2 から火耐性(${ITEM[RING].name})を優先する。`);
} else {
  out.push(`目標(full): 各階を探索し終え(探索率100%、または入れる未踏のマスが無い、または探索が${STALL_TRIPS}回続けて探索率を増やさない)、主を倒して次の階へ。`);
}
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
  [ROUTE === 'fast' ? '最後に達成した目標' : '最後に完了した階', ...runs.map((r) => pathName(r.lastDone))],
  ...(ROUTE === 'full' ? [['100%未満で完了とした階', ...runs.map((r) => r.partial.join('、') || '-')]] : []),
]));
out.push('');

if (ROUTE === 'fast') {
  const goals = [...new Set(PATH.map((st) => st.goal))];
  // 目標はその番号の段がすべて達成された日(素材は先に揃うことがある)
  const goalDay = (r: Run, g: number) => {
    const ds = PATH.flatMap((st, i) => (st.goal === g ? [r.stepDay[i]] : []));
    return ds.some((d) => d === null) ? null : Math.max(...days(ds));
  };
  out.push('#### 目標の達成日(達成した seed の中央値)');
  out.push('');
  out.push(table(['', ...goals.map((g) => MARK[g])], [
    ['中央値', ...goals.map((g) => fix(median(days(runs.map((r) => goalDay(r, g)))), 1))],
    ['最小〜最大', ...goals.map((g) => {
      const v = days(runs.map((r) => goalDay(r, g)));
      return v.length ? `${Math.min(...v)}〜${Math.max(...v)}` : '-';
    })],
    ['到達', ...goals.map((g) => `${days(runs.map((r) => goalDay(r, g))).length}/${runs.length}`)],
  ]));
  out.push('');
}

out.push('#### 進行のマイルストーン(到達した seed の中央値)');
out.push('');
const msRow = (label: string, v: number[]) => [label, fix(median(v), 1), v.length ? `${Math.min(...v)}〜${Math.max(...v)}` : '-', `${v.length}/${runs.length}`];
out.push(table(['項目', '中央値', '最小〜最大', '到達'], [
  ...(ROUTE === 'fast' ? PATH.map((st, i) => msRow(`${MARK[st.goal]} ${st.label}`, days(runs.map((r) => r.stepDay[i])))) : []),
  ...MILESTONES.map((m) => msRow(m.label, days(runs.map((r) => r.ms[m.id])))),
]));
out.push('');

out.push('#### 日ごとの推移(その日の朝。seed の中央値。討伐した seed は討伐の日の値)');
out.push('');
const stepAt = (x: number) => (!Number.isFinite(x) ? '-' : Number.isInteger(x) ? pathName(x) : `${pathName(Math.floor(x))}〜${pathName(Math.ceil(x))}`);
out.push(`「先端Aの戦力比」は先端Aが今の目標に出ようとして最後に見積もった readiness の戦力比(疲労込み)。${TUNING.readiness.gradeEdges[2]}未満は grade 危険で出さない。`);
out.push('');
out.push(table(['日', '所持金', '平均Lv', '名簿', '施設', '実績', 'いまの目標', '先端Aの戦力比', '討伐済'], CHECKPOINTS.map((d, j) => {
  const v = runs.map((r) => r.snaps[j]);
  const med = (f: (x: Snap) => number) => median(v.map(f).filter(Number.isFinite));
  return [String(d), `${Math.round(med((x) => x.gold))}G`, fix(med((x) => x.level), 1), fix(med((x) => x.roster), 1), fix(med((x) => x.facilities), 1),
    fix(med((x) => x.achievements), 1), stepAt(med((x) => x.step)), fix(med((x) => x.ratio), 2), `${v.filter((x) => x.step >= PATH.length).length}/${runs.length}`];
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
  ['去った人数(引き留めなかった・断った)', stat(runs.map((r) => r.gone), (x) => fix(x))],
  ['借金だった日数', stat(runs.map((r) => r.debtDays), (x) => fix(x))],
  ...(RICH ? [['補った額(--rich)', stat(runs.map((r) => r.topped), (x) => `${Math.round(x)}G`)]] : []),
]));
out.push('');

out.push(`#### 収支の内訳(1seedあたりの平均、討伐の日 または 打ち切り日まで${RICH ? '。補った額は含めない' : ''})`);
out.push('');
const flowKeys = [...new Set(runs.flatMap((r) => Object.keys(r.flows)))];
out.push(table(['項目', '金額'], flowKeys.map((k) => [k, mean(runs.map((r) => r.flows[k] ?? 0))] as const)
  .sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${Math.round(v)}G`])));
out.push('');

out.push('#### 収入と支出の1日あたり(期間別。その期間を過ごした seed の平均)');
out.push('');
const sumOf = (p: Period, ...ks: string[]) => ks.reduce((t, k) => t + (p.flows[k] ?? 0), 0);
const cols: [string, (p: Period) => number][] = [
  ['収入', (p) => p.income],
  ['うち依頼', (p) => sumOf(p, '依頼達成')],
  ['うち素材売却', (p) => sumOf(p, '素材売却')],
  ['支出', (p) => p.expense],
  ['うち日給', (p) => sumOf(p, '日給')],
  ['うち維持費', (p) => sumOf(p, '施設維持費', 'ギルド維持費')],
  ['うち利息', (p) => sumOf(p, '借金の利息')],
  ['差引', (p) => p.income + p.expense],
  ...(RICH ? [['補った額', (p: Period) => p.topped] as [string, (p: Period) => number]] : []),
];
out.push(table(['期間', ...cols.map(([k]) => `${k}/日`)], PERIODS.map((pd, j) => {
  const had = runs.filter((r) => r.periods[j].days > 0);
  return [`${pd.label}(${had.length}seed)`, ...cols.map(([, f]) => `${Math.round(mean(had.map((r) => f(r.periods[j]) / r.periods[j].days)))}G`)];
})));
out.push('');

const stalled = runs.filter((r) => r.dragonDay === null);
out.push('#### 停滞の診断(討伐できなかった seed)');
out.push('');
if (!stalled.length) out.push('なし');
else {
  out.push(`理由は、今の目標になってから打ち切りまでの日のうち、その理由で先端Aを今の目標に出せなかった日数。「素材が足りない」「資金が無く製作できない」は見送った日に装備の製作も止まっていた日数、「先端の探索が進まない」は先端Aの探索が探索率を増やさなかった帰還の回数、「歩き尽くしたが鍵・階段に届かない」は入れる未踏のマスが無いのに目標の鍵・階段に届いていない日数(隠し通路の見逃し)。疲労が抜けるのを待つだけの日は数えない。`);
  out.push('');
  out.push(table(['seed', ROUTE === 'fast' ? '最後に達成した目標' : '最後に完了した階', '今の目標で止まった日数', '打ち切り日にしようとしていたこと', '止まっていた理由'], stalled.map((r) => [
    String(r.seed), pathName(r.lastDone), String(r.stuckDays), r.trying || '-',
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
