// フェーズ1の計測: 森の洞窟 f1 へ毎日派遣し続けたときの探索率・最深到達・損耗を seed 間で集計する。
// 使い方: npm run sim -- [seeds=20] [days=30] [--action explore|gather|hunt|boss|survey] [--item 素材ID] [--dungeon ID]
// --action survey は、踏査の帰還で入口が確認済みになったら以後は探索を出す。
// 古い坑道の難度: npm run sim -- [seeds] [days] --plan mine-naked|forest-then-mine [--switch N]
// 指定した方の詳細と、2通りの比較表を出す。
import { build, facilityLevel } from '../src/core/base';
import { canCraft, startCraft } from '../src/core/craft';
import { DUNGEON, ENEMY, ITEM, JOB, PERSONALITIES } from '../src/core/data';
import { equip } from '../src/core/equipment';
import { acceptUniqueRequest, deliverUniqueRequest, uniqueRequests } from '../src/core/events';
import { parseFloor } from '../src/core/dungeon';
import { cellDepths } from '../src/core/explore';
import { advanceDay, dispatch, exploredRateOf, newGame, sellItem } from '../src/core/game';
import { addInventory } from '../src/core/ledger';
import { canBless } from '../src/core/blessing';
import { readDueStories } from '../src/core/story';
import { addStarterParty } from './roster';
import { PARTY_MAX, type ActionKind, type Adventurer, type DispatchOrder, type Expedition } from '../src/core/types';

const FLOOR_ID = 'f1';
const DAYS = 3;
const POLICY_ID = 'standard';
const MIN_PARTY = 2;
const RATE_STEP = 5;
const DISPATCH_PICKS = [1, 2, 3, 5, 8];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const nums = args.filter((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith('--')).map(Number);
const SEEDS = nums[0] ?? 20;
const LAST_DAY = nums[1] ?? 30;
const ACTIONS: ActionKind[] = ['explore', 'gather', 'hunt', 'boss', 'survey'];
const ACTION_NAME: Record<string, string> = { explore: '探索', gather: '採集', hunt: '討伐', boss: 'ボス', survey: '踏査→探索' };
const ACTION = (flag('action') ?? 'explore') as ActionKind;
const DUNGEON_ID = flag('dungeon') ?? 'forest_cave';
if (!ACTIONS.includes(ACTION)) throw new Error(`--action は ${ACTIONS.join(' / ')} のどれか`);
if (!DUNGEON[DUNGEON_ID]) throw new Error(`ダンジョン ${DUNGEON_ID} が無い`);

const floorDef = DUNGEON[DUNGEON_ID].floors.find((f) => f.id === FLOOR_ID)!;
const depths = cellDepths(parseFloor(floorDef));
const GATHER_ITEM = ACTION === 'gather'
  ? flag('item') ?? parseFloor(floorDef).cells.find((c) => c.kind === 'gather')?.item
  : undefined;
if (ACTION === 'gather' && !GATHER_ITEM) throw new Error('採集する素材が決まらない');
const isDefault = ACTION === 'explore' && DUNGEON_ID === 'forest_cave';
const PLANS = ['mine-naked', 'mine-geared', 'forest-then-mine'] as const;
type PlanId = (typeof PLANS)[number];
const PLAN = flag('plan') as PlanId | undefined;
const SWITCH_DAY = Number(flag('switch') ?? 20);
if (PLAN && !PLANS.includes(PLAN)) throw new Error(`--plan は ${PLANS.join(' / ')} のどれか`);
if (!Number.isInteger(SWITCH_DAY) || SWITCH_DAY < 1) throw new Error('--switch は1以上の整数');

interface DispatchRecord {
  n: number;
  newCells: number;
  /** 今回新しく踏んだマスの最大深度(mapDeltas から) */
  newDepth: number;
  /** 今回入ったマスの最大深度(行程の再現から) */
  traceDepth: number;
  members: number;
  injuryDays: number;
  wiped: boolean;
  retreated: boolean;
}

interface RunResult {
  /** rate[d] = d日目の朝(その日の帰還を反映した後)の探索率 */
  rate: number[];
  dispatches: DispatchRecord[];
  gold: number;
  avgLevel: number;
  skips: Record<string, number>;
  /** 期間中に売った素材の合計額 */
  sold: number;
}

const ready = (a: Adventurer) => a.status === 'idle' && a.injuryDays === 0;

function run(seed: number, leaderPersonality?: string): RunResult {
  const s = addStarterParty(newGame(seed), seed);
  readDueStories(s);
  if (leaderPersonality) s.adventurers[0].personality = leaderPersonality;
  const rate: number[] = [];
  rate[s.day] = exploredRateOf(s, DUNGEON_ID, FLOOR_ID);
  const dispatches: DispatchRecord[] = [];
  const pending = new Map<string, number>();
  const skips: Record<string, number> = {};
  const skip = (why: string) => { skips[why] = (skips[why] ?? 0) + 1; };
  let count = 0;
  let sold = 0;
  const serviceUniqueRequests = () => {
    for (const request of uniqueRequests(s)) {
      if (!request.accepted && request.canAccept) acceptUniqueRequest(s, request.unique, request.step);
      const current = uniqueRequests(s).find((x) => x.unique === request.unique);
      if (current?.accepted && current.kind === 'deliver' && current.item && (s.inventory[current.item] ?? 0) > 0) {
        deliverUniqueRequest(s, current.unique, current.step);
      }
    }
  };

  while (s.day < LAST_DAY) {
    serviceUniqueRequests();
    const party = s.adventurers.filter(ready).slice(0, PARTY_MAX);
    const leader = leaderPersonality ? s.adventurers[0] : party[0];
    if (party.length >= MIN_PARTY && leader && party.includes(leader)) {
      const action: ActionKind = ACTION !== 'survey' ? ACTION : s.dungeons[DUNGEON_ID].confirmed ? 'explore' : 'survey';
      const target: DispatchOrder['target'] = { dungeon: DUNGEON_ID, floor: FLOOR_ID };
      if (GATHER_ITEM) target.item = GATHER_ITEM;
      const order: DispatchOrder = {
        partyIds: party.map((a) => a.id), leaderId: leader.id,
        action, target,
        policy: POLICY_ID, days: DAYS,
        items: (s.inventory.potion ?? 0) >= 1 ? { potion: 1 } : {},
        blessed: canBless(s),
      };
      const r = dispatch(s, order);
      if (r.ok) pending.set(r.expedition.id, ++count);
      else skip(r.reason);
    } else if (party.length >= MIN_PARTY) skip('固定した隊長が出られない');
    else if (s.expeditions.length === 0) skip('出られる隊員が2人未満');

    const rep = advanceDay(s);
    // 物語を読まないので、出た章はその日に読んだことにする(章の読了で仲間が加入する)
    readDueStories(s);
    serviceUniqueRequests();
    rate[s.day] = exploredRateOf(s, DUNGEON_ID, FLOOR_ID);
    for (const e of rep.returned) dispatches.push(record(e, pending.get(e.id)!));
    // 人が遊ぶときは帰還した素材を売って日給に充てるので、sim も毎日全部売る
    for (const [item, n] of Object.entries(s.inventory)) {
      if (ITEM[item].kind !== 'material' || n <= 0) continue;
      const before = s.gold;
      if (sellItem(s, item, n).ok) sold += s.gold - before;
    }
  }
  return {
    rate, dispatches, gold: s.gold, skips, sold,
    avgLevel: s.adventurers.reduce((t, a) => t + a.level, 0) / s.adventurers.length,
  };
}

function record(e: Expedition, n: number): DispatchRecord {
  const r = e.result;
  const cells = r.mapDeltas[0]?.cells ?? [];
  return {
    n,
    newCells: cells.length,
    newDepth: cells.length ? Math.max(...cells.map((c) => depths[c])) : 0,
    traceDepth: r.maxDepth,
    members: e.order.partyIds.length,
    injuryDays: e.order.partyIds.reduce((t, id) => t + (r.injuries[id] ?? 0), 0),
    wiped: r.wiped,
    retreated: r.retreated,
  };
}

// ---- 集計と出力 ----
const mean = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : NaN);
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-');
const fix = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const stat = (xs: number[], f: (x: number) => string) => [f(mean(xs)), f(Math.min(...xs)), f(Math.max(...xs))];
const table = (head: string[], rows: string[][]) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n');
const rateDays = () => {
  const ds: number[] = [];
  for (let d = RATE_STEP; d <= LAST_DAY; d += RATE_STEP) ds.push(d);
  if (ds[ds.length - 1] !== LAST_DAY) ds.push(LAST_DAY);
  return ds;
};
const mergeSkips = (rs: RunResult[]) => {
  const out: Record<string, number> = {};
  for (const r of rs) for (const [k, n] of Object.entries(r.skips)) out[k] = (out[k] ?? 0) + n;
  return out;
};

// ---- 古い坑道の難度(--plan) ----
const MINE = 'old_mine';
const FOREST = 'forest_cave';
const WORKSHOP_AT = [0, 0] as const;
// 工房の隣に置くと職人通りのシナジーが付く。人が遊ぶときもそう置くので合わせる
const ALCHEMY_AT = [1, 0] as const;
const POTION_STOCK = 4;
/** forest-then-mine が売らずに貯める素材(工房・調合所・レシピの材料) */
const KEEP = new Set(['fang', 'slime_gel', 'moss_ore', 'herb']);
/** 残す上限。防具4+首飾り4+工房・調合所+回復薬の材料のおおよそ */
const KEEP_MAX: Record<string, number> = { fang: 20, slime_gel: 10, moss_ore: 4, herb: 8 };
const GATHERABLE = ['moss_ore', 'slime_gel', 'herb'];
const forestGrid = parseFloor(DUNGEON[FOREST].floors.find((f) => f.id === FLOOR_ID)!);
const ARMORS = ['leather_armor', 'studded_armor'];
const TRACKED_RECIPES = ['r_leather_armor', 'r_studded_armor', 'r_fang_necklace', 'r_potion'];
/** 坑道プランは疲労がこれ以上の者を休ませる。毎日出し続けると疲労の能力低下で失敗率が頭打ちになり、装備の効き目が見えないため */
const REST_FATIGUE = 50;
const readyRested = (a: Adventurer) => ready(a) && a.fatigue < REST_FATIGUE;
const PLAN_NAME: Record<PlanId, string> = { 'mine-naked': '装備なしで坑道', 'mine-geared': '装備一式を支給して坑道(診断用)', 'forest-then-mine': '森で装備を整えて坑道' };
/** 診断用の支給品。経済を切り離して装備の効き目だけを測る */
const GEAR_KIT: Record<string, number> = { leather_armor: 3, studded_armor: 1, fang_necklace: 4, bone_dagger: 2, potion: 4 };

interface MineRecord { members: number; injuryDays: number; wiped: boolean; retreated: boolean; golem: number; golemMet: boolean }

interface PlanRun {
  mine: MineRecord[];
  forest: number;
  mineRate: number;
  gold: number;
  /** 防具・首飾りを着けた人数(最終日 / 坑道へ切り替えた日の朝) */
  armored: number; necklaced: number; armoredAtSwitch: number;
  workshopDay: number | null; alchemyDay: number | null;
  crafted: Record<string, number>;
  skips: Record<string, number>;
}

function runPlan(plan: PlanId, seed: number): PlanRun {
  const s = addStarterParty(newGame(seed), seed);
  readDueStories(s);
  const prepare = plan === 'forest-then-mine';
  if (plan === 'mine-geared') {
    for (const [it, n] of Object.entries(GEAR_KIT)) addInventory(s, it, n);
    for (const a of s.adventurers) {
      for (const it of ARMORS) if ((s.inventory[it] ?? 0) > 0 && equip(s, a.id, it).ok) break;
      if ((s.inventory.fang_necklace ?? 0) > 0) equip(s, a.id, 'fang_necklace');
      if ((s.inventory.bone_dagger ?? 0) > 0 && JOB[a.job].roles.some((r) => r === 'attacker' || r === 'scout')) equip(s, a.id, 'bone_dagger');
    }
  }
  // 骨の短剣は骨片が森で取れないので省く
  const queue = prepare
    ? [
        ...s.adventurers.map((a) => (JOB[a.job].armor.includes('light') ? 'r_leather_armor' : 'r_studded_armor')),
        ...s.adventurers.map(() => 'r_fang_necklace'),
      ]
    : [];
  const started = queue.map(() => false);
  const remaining = (recipe: string) => queue.filter((r, k) => !started[k] && r === recipe).length;
  const placed = (id: string) => s.base.facilities.some((f) => f.id === id);
  const crafted: Record<string, number> = {};
  const mine: MineRecord[] = [];
  const pending = new Set<string>();
  const skips: Record<string, number> = {};
  const skip = (why: string) => { skips[why] = (skips[why] ?? 0) + 1; };
  let forest = 0;
  let workshopDay: number | null = null;
  let alchemyDay: number | null = null;
  let armoredAtSwitch = 0;
  const armoredCount = () => s.adventurers.filter((a) => a.equipment.armor).length;
  const serviceUniqueRequests = () => {
    for (const request of uniqueRequests(s)) {
      if (!request.accepted && request.canAccept) acceptUniqueRequest(s, request.unique, request.step);
      const current = uniqueRequests(s).find((x) => x.unique === request.unique);
      if (current?.accepted && current.kind === 'deliver' && current.item && (s.inventory[current.item] ?? 0) > 0) {
        deliverUniqueRequest(s, current.unique, current.step);
      }
    }
  };

  while (s.day < LAST_DAY) {
    serviceUniqueRequests();
    if (prepare) {
      for (const a of s.adventurers) {
        if (!a.equipment.armor) for (const it of ARMORS) if ((s.inventory[it] ?? 0) > 0 && equip(s, a.id, it).ok) break;
        if (!a.equipment.accessory && (s.inventory.fang_necklace ?? 0) > 0) equip(s, a.id, 'fang_necklace');
      }
      if (!placed('workshop')) {
        if (build(s, 'workshop', ...WORKSHOP_AT).ok) workshopDay = s.day;
      } else if (!placed('alchemy')) {
        if (build(s, 'alchemy', ...ALCHEMY_AT).ok) alchemyDay = s.day;
      }
      if (facilityLevel(s, 'workshop') >= 1) {
        // 材料の揃わない品で止まらないよう、順番の早い方から作れるものを始める
        const i = queue.findIndex((r, k) => !started[k] && canCraft(s, r).ok);
        if (i >= 0 && startCraft(s, queue[i]).ok) {
          started[i] = true;
          crafted[queue[i]] = (crafted[queue[i]] ?? 0) + 1;
        }
      }
      if (facilityLevel(s, 'alchemy') >= 1 && (s.inventory.potion ?? 0) < POTION_STOCK && startCraft(s, 'r_potion').ok) {
        crafted.r_potion = (crafted.r_potion ?? 0) + 1;
      }
    }
    const toMine = !prepare || s.day >= SWITCH_DAY;
    if (prepare && s.day === SWITCH_DAY) armoredAtSwitch = armoredCount();

    const party = s.adventurers.filter(readyRested).slice(0, PARTY_MAX);
    if (party.length >= MIN_PARTY) {
      const items: Record<string, number> = (s.inventory.potion ?? 0) >= 1 ? { potion: 1 } : {};
      const common = { partyIds: party.map((a) => a.id), leaderId: party[0].id, policy: POLICY_ID, days: DAYS, items, blessed: canBless(s) };
      let order: DispatchOrder;
      if (toMine) {
        order = { ...common, action: s.dungeons[MINE].confirmed ? 'explore' : 'survey', target: { dungeon: MINE, floor: FLOOR_ID } };
      } else {
        // 奇数回目は探索、偶数回目は足りない分の多い素材を採集。足りていれば探索。
        // 工房が建たないと何も作れないので、建つまでは苔鉄鉱だけを数える
        const need: Record<string, number> = placed('workshop')
          ? {
              moss_ore: remaining('r_studded_armor'),
              slime_gel: (placed('alchemy') ? 0 : 3) + 2 * remaining('r_leather_armor'),
              herb: 2 * Math.ceil(Math.max(0, POTION_STOCK - (s.inventory.potion ?? 0)) / 2),
            }
          : { moss_ore: 3, slime_gel: 0, herb: 0 };
        // 採集は未踏のマスに入らないので、採取点をまだ踏んでいない素材は探索で地図を広げる
        const visited = s.dungeons[FOREST].floors[FLOOR_ID]?.visited ?? [];
        const reachable = (it: string) => visited.some((i) => forestGrid.cells[i]?.kind === 'gather' && forestGrid.cells[i]?.item === it);
        const short = GATHERABLE.filter(reachable).map((it) => ({ it, n: need[it] - (s.inventory[it] ?? 0) })).sort((x, y) => y.n - x.n)[0];
        const gather = forest % 2 === 1 && !!short && short.n > 0;
        const target: DispatchOrder['target'] = { dungeon: FOREST, floor: FLOOR_ID };
        if (gather) target.item = short.it;
        order = { ...common, action: gather ? 'gather' : 'explore', target };
      }
      const r = dispatch(s, order);
      if (!r.ok) skip(r.reason);
      else if (toMine) pending.add(r.expedition.id);
      else forest++;
    } else if (s.expeditions.length === 0) skip('出られる隊員が2人未満');

    const rep = advanceDay(s);
    // 物語を読まないので、出た章はその日に読んだことにする(章の読了で仲間が加入する)
    readDueStories(s);
    serviceUniqueRequests();
    for (const e of rep.returned) {
      if (!pending.has(e.id)) continue;
      const res = e.result;
      mine.push({
        members: e.order.partyIds.length,
        injuryDays: e.order.partyIds.reduce((t, id) => t + (res.injuries[id] ?? 0), 0),
        wiped: res.wiped, retreated: res.retreated, golem: res.kills.golem ?? 0,
        // ボスからの撤退は装備の有無に関係なく起きるので、装備の効き目は除いて見る
        golemMet: res.log.some((l) => l.text.includes(ENEMY.golem.name)),
      });
    }
    for (const [item, n] of Object.entries(s.inventory)) {
      if (ITEM[item].kind !== 'material' || n <= 0) continue;
      // 装備と施設に要る分だけ残し、余りは売って日給に充てる(人が遊ぶときと同じ)
      const keep = prepare && KEEP.has(item) ? KEEP_MAX[item] ?? 0 : 0;
      if (n > keep) sellItem(s, item, n - keep);
    }
  }
  return {
    mine, forest, mineRate: exploredRateOf(s, MINE, FLOOR_ID), gold: s.gold,
    armored: armoredCount(), necklaced: s.adventurers.filter((a) => a.equipment.accessory).length, armoredAtSwitch,
    workshopDay, alchemyDay, crafted, skips,
  };
}

interface PlanSummary { dispatches: number; wipe: number; retreat: number; injury: number; rate: number[]; gold: number[]; golem: number; failureNoGolem: number; golemMetRate: number }

function summarize(runs: PlanRun[]): PlanSummary {
  const all = runs.flatMap((r) => r.mine);
  const persons = all.reduce((t, d) => t + d.members, 0);
  return {
    dispatches: all.length,
    wipe: all.filter((d) => d.wiped).length / all.length,
    retreat: all.filter((d) => d.retreated).length / all.length,
    injury: all.reduce((t, d) => t + d.injuryDays, 0) / persons,
    rate: runs.map((r) => r.mineRate),
    gold: runs.map((r) => r.gold),
    golem: all.reduce((t, d) => t + d.golem, 0),
    failureNoGolem: (() => { const xs = all.filter((d) => !d.golemMet); return xs.length ? xs.filter((d) => d.wiped || d.retreated).length / xs.length : 0; })(),
    golemMetRate: all.filter((d) => d.golemMet).length / Math.max(1, all.length),
  };
}

function planReport(plan: PlanId): string {
  const t0 = performance.now();
  const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
  const runs = Object.fromEntries(PLANS.map((p) => [p, seeds.map((seed) => runPlan(p, seed))])) as Record<PlanId, PlanRun[]>;
  const sums = Object.fromEntries(PLANS.map((p) => [p, summarize(runs[p])])) as Record<PlanId, PlanSummary>;
  const elapsed = (performance.now() - t0) / 1000;
  const rs = runs[plan];
  const sm = sums[plan];
  const out: string[] = [];
  const sw = plan === 'forest-then-mine' ? ` --switch ${SWITCH_DAY}` : '';
  out.push(`### 計測(\`npm run sim -- ${SEEDS} ${LAST_DAY} --plan ${plan}${sw}\`。${SEEDS}seed×${LAST_DAY}日、${PLAN_NAME[plan]})`);
  out.push('');
  out.push(`坑道は ${MINE} ${FLOOR_ID} を踏査→確認済みなら探索・${DAYS}日・標準方針・回復薬1(在庫があれば)。待機中で負傷0の隊員を最大${PARTY_MAX}人、${MIN_PARTY}人未満なら休む。隊長は名簿順で最初の者。`);
  if (plan === 'forest-then-mine') {
    out.push(`${SWITCH_DAY - 1}日目までは森の洞窟(奇数回目は探索、偶数回目は足りない素材の採集)。fang・slime_gel・moss_ore・herb は売らずに貯め、他の素材は毎日売る。工房(0,0)→調合所(1,0)を建て、防具(light可なら革の鎧、それ以外は鋲打ち革鎧)を全員分→牙の首飾りを全員分の順に作って着せる。回復薬は在庫${POTION_STOCK}未満なら作る。骨の短剣は骨片が森で取れないので省く。`);
  } else {
    out.push('素材は毎日全部売る。');
  }
  out.push('');
  const rows: string[][] = [
    ['坑道の派遣数', `${sm.dispatches}件(${fix(sm.dispatches / SEEDS)}/seed)`],
    ['全滅率(派遣あたり)', pct(sm.wipe)],
    ['撤退率(派遣あたり)', pct(sm.retreat)],
    ['平均負傷日数(人・派遣あたり)', fix(sm.injury, 2)],
    [`${LAST_DAY}日目の坑道の探索率 平均/最小/最大`, stat(sm.rate, pct).join(' / ')],
    [`${LAST_DAY}日目の所持金 平均/最小/最大`, stat(sm.gold, (x) => `${Math.round(x)}G`).join(' / ')],
    ['ゴーレム撃破数(全seed 合計)', `${sm.golem}`],
  ];
  if (plan === 'forest-then-mine') {
    const built = (xs: (number | null)[]) => {
      const ds = xs.filter((x): x is number => x !== null);
      return `${ds.length}/${SEEDS} seed、着工 平均${fix(mean(ds))}日目`;
    };
    rows.push(
      ['森の派遣数/seed', fix(mean(rs.map((r) => r.forest)))],
      ['工房', built(rs.map((r) => r.workshopDay))],
      ['調合所', built(rs.map((r) => r.alchemyDay))],
      [`防具を着けた人数 ${SWITCH_DAY}日目の朝 / ${LAST_DAY}日目(平均、4人中)`, `${fix(mean(rs.map((r) => r.armoredAtSwitch)))} / ${fix(mean(rs.map((r) => r.armored)))}`],
      [`牙の首飾りを着けた人数 ${LAST_DAY}日目(平均)`, fix(mean(rs.map((r) => r.necklaced)))],
      ['製作を始めた数/seed', TRACKED_RECIPES.map((id) => `${id} ${fix(mean(rs.map((r) => r.crafted[id] ?? 0)))}`).join('、')],
    );
  }
  out.push(table(['項目', '値'], rows));
  out.push('');
  const skips: Record<string, number> = {};
  for (const r of rs) for (const [k, n] of Object.entries(r.skips)) skips[k] = (skips[k] ?? 0) + n;
  out.push('#### 派遣しなかった日(全seed 合計、派遣中の隊がいない日のみ)');
  out.push('');
  out.push(Object.keys(skips).length ? table(['理由', '日数'], Object.entries(skips).map(([k, n]) => [k, `${n}`])) : 'なし');
  out.push('');

  const a = sums['mine-naked'];
  const g = sums['mine-geared'];
  const b = sums['forest-then-mine'];
  // 死なないゲームなので全滅は稀。装備の効き目は「撤退+全滅」(失敗率)と探索率で見る
  const failure = (x: PlanSummary) => x.wipe + x.retreat;
  out.push(`#### 比較(${SEEDS}seed×${LAST_DAY}日、forest-then-mine は ${SWITCH_DAY}日目から坑道)`);
  out.push('');
  out.push(table(['項目', 'mine-naked', 'mine-geared(支給)', 'forest-then-mine'], [
    ['坑道の派遣数/seed', fix(a.dispatches / SEEDS), fix(g.dispatches / SEEDS), fix(b.dispatches / SEEDS)],
    ['失敗率(撤退+全滅)', pct(failure(a)), pct(failure(g)), pct(failure(b))],
    ['失敗率(ゴーレム戦を除く)', pct(a.failureNoGolem), pct(g.failureNoGolem), pct(b.failureNoGolem)],
    ['ゴーレムに遭った派遣の割合', pct(a.golemMetRate), pct(g.golemMetRate), pct(b.golemMetRate)],
    ['全滅率', pct(a.wipe), pct(g.wipe), pct(b.wipe)],
    ['撤退率', pct(a.retreat), pct(g.retreat), pct(b.retreat)],
    ['平均負傷日数(人・派遣あたり)', fix(a.injury, 2), fix(g.injury, 2), fix(b.injury, 2)],
    [`${LAST_DAY}日目の坑道の探索率 平均`, pct(mean(a.rate)), pct(mean(g.rate)), pct(mean(b.rate))],
    [`${LAST_DAY}日目の所持金 平均`, `${Math.round(mean(a.gold))}G`, `${Math.round(mean(g.gold))}G`, `${Math.round(mean(b.gold))}G`],
    ['ゴーレム撃破数(合計)', `${a.golem}`, `${g.golem}`, `${b.golem}`],
  ]));
  out.push('');
  out.push(`目標(ゴーレム戦を除く失敗率): mine-naked 30%以上 → ${pct(a.failureNoGolem)} ${a.failureNoGolem >= 0.3 ? '達成' : '未達'} / mine-geared 10%未満 → ${pct(g.failureNoGolem)} ${g.failureNoGolem < 0.1 ? '達成' : '未達'} / 探索率の差(geared − naked) 10pt以上 → ${fix((mean(g.rate) - mean(a.rate)) * 100)}pt ${mean(g.rate) - mean(a.rate) >= 0.1 ? '達成' : '未達'}`);
  const armoredAtSwitch = mean(runs['forest-then-mine'].map((r) => r.armoredAtSwitch));
  if (armoredAtSwitch < PARTY_MAX) {
    out.push('');
    out.push(`注意: forest-then-mine は ${SWITCH_DAY}日目の朝に防具を着けた人数が平均${fix(armoredAtSwitch)}人で、装備の効き目の比較になっていない。`);
  }
  out.push('');
  out.push(`処理時間: ${elapsed.toFixed(2)}秒`);
  return out.join('\n');
}

function defaultReport(): string {
  const t0 = performance.now();
  const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
  const base = seeds.map((seed) => run(seed));
  const byPersonality = PERSONALITIES.map((p) => ({ p, runs: seeds.map((seed) => run(seed, p.id)) }));
  const elapsed = (performance.now() - t0) / 1000;

  const out: string[] = [];
  const extraArgs = isDefault ? '' : ` --action ${ACTION}${GATHER_ITEM ? ` --item ${GATHER_ITEM}` : ''} --dungeon ${DUNGEON_ID}`;
  const actionLabel = `${ACTION_NAME[ACTION]}${GATHER_ITEM ? `(${ITEM[GATHER_ITEM]?.name ?? GATHER_ITEM})` : ''}`;
  out.push(`### 計測(\`npm run sim -- ${SEEDS} ${LAST_DAY}${extraArgs}\`。${SEEDS}seed×${LAST_DAY}日、${DUNGEON_ID} ${FLOOR_ID}・${actionLabel}・${DAYS}日・標準方針・回復薬1(在庫があれば)、待機中で負傷0の隊員を最大${PARTY_MAX}人、${MIN_PARTY}人未満なら休む)`);
  out.push('');
  out.push('N日目 = その日の帰還を反映した後の値。隊長は待機メンバーのうち名簿順で最初の者(性格は seed 次第)。');
  out.push('');

  out.push('#### 日ごとの探索率');
  out.push('');
  out.push(table(['日', '平均', '最小', '最大'], rateDays().map((d) => [`${d}日目`, ...stat(base.map((r) => r.rate[d] ?? 0), pct)])));
  out.push('');

  out.push('#### 派遣回ごと(seed 間の平均)');
  out.push('');
  out.push('最深(新規)= 今回新しく踏んだマスの最大深度(`mapDeltas`)。最深(行程)= 今回入ったマスの最大深度(`ExpeditionResult.maxDepth`)。深度は入口からの経路長(隠し通路を閉じた形)。');
  out.push('');
  out.push(table(['派遣', '件数', '最深(新規)', '最深(行程)', '新しく踏んだマス'], DISPATCH_PICKS.map((n) => {
    const ds = base.flatMap((r) => r.dispatches.filter((d) => d.n === n));
    return [`${n}回目`, `${ds.length}`, fix(mean(ds.map((d) => d.newDepth))), fix(mean(ds.map((d) => d.traceDepth))), fix(mean(ds.map((d) => d.newCells)))];
  })));
  out.push('');

  out.push('#### 隊長の性格を固定(名簿の1人目の性格を書き換え、常に隊長。1人目が出られない日は休む)');
  out.push('');
  // 入口で引き返した派遣(maxDepth 0)を混ぜると、性格の奥への行きやすさが薄まる
  out.push(table(['隊長', '15日目 探索率', `${LAST_DAY}日目 探索率`, '派遣数/seed', '最深(行程) 平均(動いた派遣のみ)'], byPersonality.map(({ p, runs }) => {
    const ds = runs.flatMap((r) => r.dispatches);
    return [p.name, pct(mean(runs.map((r) => r.rate[15] ?? NaN))), pct(mean(runs.map((r) => r.rate[LAST_DAY] ?? 0))),
      fix(ds.length / runs.length), fix(mean(ds.filter((d) => d.traceDepth > 0).map((d) => d.traceDepth)))];
  })));
  out.push('');

  const all = base.flatMap((r) => r.dispatches);
  const personDispatches = all.reduce((t, d) => t + d.members, 0);
  out.push('#### 損耗と経営');
  out.push('');
  out.push(table(['項目', '値'], [
    ['帰還した派遣', `${all.length}件(${fix(all.length / SEEDS)}/seed)`],
    ['全滅率(派遣あたり)', pct(all.filter((d) => d.wiped).length / all.length)],
    ['撤退率(派遣あたり)', pct(all.filter((d) => d.retreated).length / all.length)],
    ['平均負傷日数(人・派遣あたり)', fix(all.reduce((t, d) => t + d.injuryDays, 0) / personDispatches, 2)],
    [`${LAST_DAY}日目の所持金 平均/最小/最大(素材は毎日全部売る)`, stat(base.map((r) => r.gold), (x) => `${Math.round(x)}G`).join(' / ')],
    ['素材の売却額 合計/seed', `${Math.round(mean(base.map((r) => r.sold)))}G`],
    [`${LAST_DAY}日目の平均Lv`, fix(mean(base.map((r) => r.avgLevel)), 2)],
  ]));
  out.push('');

  const skips = mergeSkips(base);
  out.push('#### 派遣しなかった日(全seed 合計、派遣中の隊がいない日のみ)');
  out.push('');
  out.push(Object.keys(skips).length ? table(['理由', '日数'], Object.entries(skips).map(([k, n]) => [k, `${n}`])) : 'なし');
  out.push('');

  out.push(`処理時間: ${elapsed.toFixed(2)}秒`);

  return out.join('\n');
}

console.log(PLAN ? planReport(PLAN) : defaultReport());
