// フェーズ1の計測: 森の洞窟 f1 へ毎日派遣し続けたときの探索率・最深到達・損耗を seed 間で集計する。
// 使い方: npm run sim -- [seeds=20] [days=30] [--action explore|gather|hunt|boss|survey] [--item 素材ID] [--dungeon ID]
// --action survey は、踏査の帰還で入口が確認済みになったら以後は探索を出す。
import { DUNGEON, ITEM, PERSONALITIES } from '../src/core/data';
import { parseFloor } from '../src/core/dungeon';
import { cellDepths } from '../src/core/explore';
import { advanceDay, dispatch, exploredRateOf, newGame, sellMaterial } from '../src/core/game';
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
  const s = newGame(seed);
  if (leaderPersonality) s.adventurers[0].personality = leaderPersonality;
  const rate: number[] = [];
  rate[s.day] = exploredRateOf(s, DUNGEON_ID, FLOOR_ID);
  const dispatches: DispatchRecord[] = [];
  const pending = new Map<string, number>();
  const skips: Record<string, number> = {};
  const skip = (why: string) => { skips[why] = (skips[why] ?? 0) + 1; };
  let count = 0;
  let sold = 0;

  while (s.day < LAST_DAY) {
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
      };
      const r = dispatch(s, order);
      if (r.ok) pending.set(r.expedition.id, ++count);
      else skip(r.reason);
    } else if (party.length >= MIN_PARTY) skip('固定した隊長が出られない');
    else if (s.expeditions.length === 0) skip('出られる隊員が2人未満');

    const rep = advanceDay(s);
    rate[s.day] = exploredRateOf(s, DUNGEON_ID, FLOOR_ID);
    for (const e of rep.returned) dispatches.push(record(e, pending.get(e.id)!));
    // 人が遊ぶときは帰還した素材を売って日給に充てるので、sim も毎日全部売る
    for (const [item, n] of Object.entries(s.inventory)) {
      if (ITEM[item].kind !== 'material' || n <= 0) continue;
      const before = s.gold;
      if (sellMaterial(s, item, n).ok) sold += s.gold - before;
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

console.log(out.join('\n'));
