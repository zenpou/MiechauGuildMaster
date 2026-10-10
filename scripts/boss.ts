// ボス戦の計測: 基準の隊(剣士・戦士・僧侶・斥候)を Lv と装備の段で振り、敵1体と runCombat を回して勝てる条件を表にする。
// 使い方: npm run sim:boss -- [runs=200] [--boss 敵ID] [--level L]
// --level を付けると、その Lv の段ごとの詳細(勝率・平均ラウンド・上限到達・全滅・生存人数・診断)を出す。--boss はその敵だけに絞る。
import { effectiveStats, generateAdventurer } from '../src/core/adventurer';
import { hasSkill, makeAllyUnit, makeEnemies, runCombat, type Unit } from '../src/core/combat';
import { ENEMY, ITEM, JOB, ROLE_SKILL, TUNING } from '../src/core/data';
import { rngFor } from '../src/core/rng';
import {
  ELEMENT_LABEL, ROLE_IDS, type Adventurer, type Aptitude, type ElementId, type Equipment, type RoleId, type Stats,
} from '../src/core/types';

const SEED = 1;
// combat.ts の上限。export されていないので写す
const ROUND_CAP = 30;
const TARGET = 0.7;
const LEVELS = [3, 5, 8, 10, 12, 15, 18, 20, 25, 30];
const BOSSES = ['golem', 'tower_keeper', 'frost_giant', 'ruin_warden', 'dragon'];
/** 診断の段: そのボスの居る所の素材で作れる段(ボスより前に揃えられる)。谷と遺跡は G4 にまとめてある */
const HOME_TIER: Record<string, number> = { golem: 2, tower_keeper: 3, frost_giant: 4, ruin_warden: 4, dragon: 4 };
/** 通常の敵は、同じダンジョンのボスと同じ条件で診断する(通常の敵は Lv1〜3 から勝ててしまい、その手前では診断にならない) */
const NORMALS: Record<string, string> = { skeleton: 'golem', gargoyle: 'tower_keeper', drake: 'dragon' };

const PARTY: { job: string; role: RoleId }[] = [
  { job: 'fighter', role: 'attacker' },
  { job: 'warrior', role: 'tank' },
  { job: 'priest', role: 'healer' },
  { job: 'scout', role: 'scout' },
];
/** generateAdventurer の基礎値の中央値 */
const BASE: Stats = { hp: 63, atk: 10, def: 8.5, mag: 9.5, spd: 8, dex: 9.5, scout: 9, gather: 9 };

const ANY = '*';
interface Tier { name: string; weapon: Record<string, string>; armor: Record<string, string[]>; accessory: string[] }
/** 防具は職の armor で着られる最初の候補。装飾は候補のうち火耐性の高い方 */
const TIERS: Tier[] = [
  { name: '装備なし', weapon: {}, armor: {}, accessory: [] },
  { name: '森', weapon: { [ANY]: 'bone_dagger' }, armor: { warrior: ['studded_armor'], [ANY]: ['leather_armor'] }, accessory: [] },
  {
    name: '坑道', weapon: { [ANY]: 'iron_sword' },
    armor: { fighter: ['iron_armor'], warrior: ['iron_armor'], [ANY]: ['leather_armor'] }, accessory: ['fang_necklace'],
  },
  {
    name: '塔', weapon: { [ANY]: 'crystal_blade' },
    armor: { fighter: ['iron_armor'], warrior: ['iron_armor'], [ANY]: ['cloth_robe'] }, accessory: ['ember_ring'],
  },
  {
    name: '谷・遺跡', weapon: { fighter: 'moon_blade', [ANY]: 'frost_edge' },
    armor: { fighter: ['guardian_plate'], warrior: ['guardian_plate'], [ANY]: ['pelt_cloak', 'cloth_robe'] },
    accessory: ['ember_ring', 'ruin_amulet'],
  },
];
const tierId = (t: number) => `G${t}`;

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const nums = args.filter((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith('--')).map(Number);
const RUNS = nums[0] ?? 200;
const BOSS = flag('boss');
const LEVEL = flag('level') === undefined ? undefined : Number(flag('level'));
if (RUNS < 1) throw new Error('runs は1以上');
if (BOSS !== undefined && !ENEMY[BOSS]) throw new Error(`敵 ${BOSS} が無い`);
if (LEVEL !== undefined && !(Number.isInteger(LEVEL) && LEVEL >= 1)) throw new Error('--level は1以上の整数');

// ---- 隊 ----
const isEquip = (id: string) => !!ITEM[id]?.equip;
const wearable = (job: string, id: string) => {
  const c = ITEM[id].equip!.armorClass;
  return !c || JOB[job].armor.includes(c);
};
const fireOf = (id: string) => ITEM[id].equip!.resist?.fire ?? 0;

function gearFor(tier: number, job: string): Equipment {
  const t = TIERS[tier];
  const weapon = t.weapon[job] ?? t.weapon[ANY];
  const armor = (t.armor[job] ?? t.armor[ANY] ?? []).find((id) => isEquip(id) && wearable(job, id)) ?? null;
  const accessory = t.accessory
    .filter(isEquip)
    .reduce<string | null>((best, id) => (best === null || fireOf(id) > fireOf(best) ? id : best), null);
  return { weapon: weapon && isEquip(weapon) ? weapon : null, armor, accessory };
}

function makeParty(level: number, tier: number): Adventurer[] {
  return PARTY.map(({ job, role }, i) => {
    const a = generateAdventurer(rngFor(SEED, 'boss', i), { id: `b${i}` });
    a.job = job;
    a.base = { ...BASE };
    a.growth = 1.0;
    a.apt = Object.fromEntries(ROLE_IDS.map((r) => [r, r === role ? 80 : 30])) as Aptitude;
    a.traits = [];
    a.personality = 'caring';
    a.level = level;
    a.equipment = gearFor(tier, job);
    return a;
  });
}
const allyUnits = (party: Adventurer[]) => party.map((a) => makeAllyUnit(a, effectiveStats(a)));

// ---- 計測 ----
interface Tally { won: number; capped: number; wiped: number; rounds: number; survivors: number }
const tallies = new Map<string, Tally>();

function measure(enemyId: string, level: number, tier: number): Tally {
  const key = `${enemyId}|${level}|${tier}`;
  const cached = tallies.get(key);
  if (cached) return cached;
  const party = makeParty(level, tier);
  const t: Tally = { won: 0, capped: 0, wiped: 0, rounds: 0, survivors: 0 };
  for (let k = 0; k < RUNS; k++) {
    const allies = allyUnits(party);
    const foes = makeEnemies(ENEMY[enemyId], 1);
    // 乱数列は k だけで決め、全条件で同じ列を使う(条件どうしの差に乱数のぶれを混ぜない)
    const r = runCombat(allies, foes, {
      rng: rngFor(SEED, 'boss-combat', k), say: () => {}, potions: { n: 2, used: 0 }, rel: () => {},
      canFlee: false, fleeBelow: 0,
    });
    const up = allies.filter((u) => !u.down).length;
    t.rounds += r.rounds;
    if (r.outcome === 'won') {
      t.won++;
      t.survivors += up;
    } else if (up === 0) t.wiped++;
    // 上限到達は outcome で見ない(全滅扱いか撤退扱いかは combat.ts 側で変わりうる)
    else if (r.rounds >= ROUND_CAP) t.capped++;
    else throw new Error(`想定外の決着: ${r.outcome} ${r.rounds}R`);
  }
  tallies.set(key, t);
  return t;
}
const winRate = (t: Tally) => t.won / RUNS;

function minLevel(enemyId: string, tier: number): number | null {
  let prev = 0;
  for (const lv of LEVELS) {
    if (winRate(measure(enemyId, lv, tier)) >= TARGET) {
      for (let l = prev + 1; l < lv; l++) if (winRate(measure(enemyId, l, tier)) >= TARGET) return l;
      return lv;
    }
    prev = lv;
  }
  return null;
}
/** 診断する Lv: 勝率70%に届く1つ手前(足りないものがそこで一番はっきり出る)。Lv30でも届かなければ Lv30 */
function frontier(enemyId: string, tier: number): number {
  const m = minLevel(enemyId, tier);
  return m === null ? LEVELS[LEVELS.length - 1] : Math.max(1, m - 1);
}
function diagCondition(enemyId: string): { level: number; tier: number } {
  const anchor = NORMALS[enemyId] ?? enemyId;
  const tier = HOME_TIER[anchor] ?? TIERS.length - 1;
  return { level: frontier(anchor, tier), tier };
}

// ---- 診断(期待値) ----
// combat.ts の hitChance と damage の期待値。どちらも export されていないので式を写す
const hitChance = (att: number, def: number) => Math.max(0.5, Math.min(0.97, 0.85 + (att - def) * 0.01));
const CRIT = 0.08;
const expectedHit = (atk: number, mult: number, def: number) => {
  const one = (crit: number) => Math.max(1, atk * mult * crit - def * TUNING.combat.defScale);
  return (1 - CRIT) * one(1) + CRIT * one(1.5);
};
const afterResist = (dmg: number, element: ElementId | undefined, t: Unit) => {
  const r = element ? t.resist[element] ?? 0 : 0;
  return r === 0 ? dmg : Math.max(1, dmg * (1 - r));
};

interface Diag {
  partyDpr: number; k: number;
  single: number; aoe: number; foeDpr: number; partyHp: number; s: number;
}

function diagnose(enemyId: string, level: number, tier: number): Diag {
  const allies = allyUnits(makeParty(level, tier));
  const [foe] = makeEnemies(ENEMY[enemyId], 1);
  const def = foe.enemy!;
  const strike = ROLE_SKILL.power_strike;
  const partyDpr = allies.reduce((sum, u) => {
    const share = hasSkill(u, strike.id) ? 1 / strike.params.cd : 0;
    const per = (1 - share) * expectedHit(u.atk, 1, foe.def) + share * expectedHit(u.atk, strike.params.mult, foe.def);
    return sum + hitChance(u.spd, foe.spd) * per;
  }, 0);
  const hitOn = (t: Unit) => hitChance(foe.spd, t.spd) * afterResist(expectedHit(foe.atk, 1, t.def), def.element, t);
  const target = def.ai === 'strongest' ? allies.reduce((b, u) => (u.atk > b.atk ? u : b))
    : def.ai === 'weakest' ? allies.reduce((b, u) => (u.hp < b.hp ? u : b))
      : undefined;
  const single = target ? hitOn(target) : allies.reduce((sum, u) => sum + hitOn(u), 0) / allies.length;
  const aoe = def.skill?.aoe
    ? allies.reduce((sum, t) => sum + afterResist(expectedHit(foe.atk, def.skill!.mult, t.def), def.element, t), 0)
    : 0;
  // 敵の範囲スキルは CT が 0 の手番に撃ち、0 になるまでの cd 手番は通常攻撃なので cd+1 ラウンドに1回
  const every = def.skill?.aoe ? def.skill.cd + 1 : 0;
  const foeDpr = every ? ((every - 1) * single + aoe) / every : single;
  const partyHp = allies.reduce((sum, u) => sum + u.maxHp, 0);
  return { partyDpr, k: foe.maxHp / partyDpr, single, aoe, foeDpr, partyHp, s: partyHp / foeDpr };
}

// 持ちR は回復・回復薬・かばうを入れないので、実際に持つラウンドよりずっと短く出る。
// そのため攻撃側か耐久側かは計測の負けの内訳で決め、期待値の必要R は攻撃不足と上限の切り分けにだけ使う
function verdict(d: Diag, m: Tally): string {
  if (winRate(m) >= TARGET) return '足りる';
  const slow = d.k > ROUND_CAP;
  if (m.capped >= m.wiped) {
    return slow
      ? `攻撃不足(全員が毎R殴っても${ROUND_CAP}Rで削り切れない)`
      : `上限${ROUND_CAP}ターン(期待値は${ROUND_CAP}R内だが、回復と回復薬に手番を割くぶん届かない)`;
  }
  return slow ? `耐久不足(先に全滅する。攻撃も${ROUND_CAP}Rに届かない)` : '耐久不足(削り切る前に全滅する)';
}

function firstLevel(enemyId: string, tier: number, ok: (d: Diag) => boolean): number | null {
  for (let l = 1; l <= LEVELS[LEVELS.length - 1]; l++) if (ok(diagnose(enemyId, l, tier))) return l;
  return null;
}

// ---- 出力 ----
// 整数に丸めると 69.5% が 70 と出て、70%以上の最小Lv の表と食い違う
const pct = (x: number) => `${Number((x * 100).toFixed(1))}`;
const fix = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const lvOrDash = (l: number | null) => (l === null ? '—' : `Lv${l}`);
const table = (head: string[], rows: string[][]) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n');

const TIER_IDS = TIERS.map((_, t) => t);
const itemName = (id: string | null) => (id ? ITEM[id].name : '—');

function enemyTitle(id: string): string {
  const e = ENEMY[id];
  const el = e.element ? ` ${ELEMENT_LABEL[e.element]}属性` : '';
  const sk = e.skill?.aoe ? ` / 範囲「${e.skill.name}」×${e.skill.mult}(${e.skill.cd + 1}Rに1回)` : '';
  return `${e.name}(${id})hp${e.hp} 攻${e.atk} 守${e.def} 速${e.spd}${el}${sk}`;
}

function outcomeCell(t: Tally): string {
  const loss: string[] = [];
  if (t.capped) loss.push(`上${pct(t.capped / RUNS)}`);
  if (t.wiped) loss.push(`滅${pct(t.wiped / RUNS)}`);
  return `${pct(winRate(t))}${loss.length ? `(${loss.join(' ')})` : ''}`;
}

function gearTable(): string {
  const rows = TIER_IDS.map((t) => [
    `${tierId(t)} ${TIERS[t].name}`,
    ...PARTY.map(({ job }) => {
      const g = gearFor(t, job);
      return [g.weapon, g.armor, g.accessory].filter((x): x is string => !!x).map(itemName).join('・') || '—';
    }),
  ]);
  return table(['段', ...PARTY.map(({ job }) => JOB[job].name)], rows);
}

function winTable(id: string): string {
  const rows = LEVELS.map((lv) => [`${lv}`, ...TIER_IDS.map((t) => outcomeCell(measure(id, lv, t)))]);
  return table(['Lv', ...TIER_IDS.map(tierId)], rows);
}

function roundsTable(id: string): string {
  const cell = (t: Tally) => `${fix(t.rounds / RUNS)}${t.won ? ` / ${fix(t.survivors / t.won, 2)}` : ''}`;
  const rows = LEVELS.map((lv) => [`${lv}`, ...TIER_IDS.map((t) => cell(measure(id, lv, t)))]);
  return table(['Lv', ...TIER_IDS.map(tierId)], rows);
}

function minLevelTable(ids: string[]): string {
  return table(['ボス', ...TIER_IDS.map(tierId)], ids.map((id) => [ENEMY[id].name, ...TIER_IDS.map((t) => lvOrDash(minLevel(id, t)))]));
}

function diagRow(id: string): string[] {
  const { level, tier } = diagCondition(id);
  const d = diagnose(id, level, tier);
  const m = measure(id, level, tier);
  return [
    ENEMY[id].name, `Lv${level} ${tierId(tier)}`,
    fix(d.partyDpr), fix(d.k), fix(d.single), d.aoe ? fix(d.aoe) : '—', fix(d.foeDpr), `${d.partyHp}`, fix(d.s),
    `勝${pct(winRate(m))} 上${pct(m.capped / RUNS)} 滅${pct(m.wiped / RUNS)}`,
    lvOrDash(firstLevel(id, tier, (x) => x.k <= ROUND_CAP)),
    verdict(d, m),
  ];
}
const DIAG_HEAD = [
  '敵', '条件', '隊→敵/R', '必要R', '敵→隊 単体', '範囲1回', '敵→隊/R', '隊HP', '持ちR', '計測%',
  `必要R≤${ROUND_CAP}になるLv`, '主因',
];
const DIAG_NOTE = [
  '隊→敵/R = 4人の通常攻撃の期待値(命中・会心込み、剣士は強打をCT3で1/3混ぜる)の和。回復や回復薬に手番を使う分は引かない。',
  '敵→隊/R = 単体(AIの狙う相手。strongest=攻撃最大 / weakest=HP最小 / random=平均)と範囲(全員の合計)を頻度で混ぜた値。かばう・回復・回復薬は入れない。',
  '必要R = 敵hp ÷ 隊→敵/R、持ちR = 隊HP ÷ 敵→隊/R(回復なしなので実際より短い)。',
  `主因: 勝率${pct(TARGET)}%以上なら足りる。届かなければ計測の負けの内訳で、全滅が多ければ耐久不足、上限到達が多ければ攻撃側。`
    + `攻撃側は 必要R > ${ROUND_CAP} なら攻撃不足、${ROUND_CAP} 以内なら上限${ROUND_CAP}ターン(回復の手番ぶん届かない)。`,
].join('\n');

function partyStatsTable(level: number, enemyId: string): string {
  const el = ENEMY[enemyId].element;
  const rows = TIER_IDS.map((t) => [
    tierId(t),
    ...allyUnits(makeParty(level, t)).map((u) => {
      const r = el ? ` ${ELEMENT_LABEL[el]}耐${pct(u.resist[el] ?? 0)}%` : '';
      return `HP${u.maxHp} 攻${u.atk} 守${u.def} 速${u.spd}${r}`;
    }),
  ]);
  return table(['段', ...PARTY.map(({ job }) => `${JOB[job].name}(攻=${JOB[job].attackStat})`)], rows);
}

function detail(id: string, level: number): string {
  const rows = TIER_IDS.map((t) => {
    const m = measure(id, level, t);
    const d = diagnose(id, level, t);
    return [
      tierId(t), `${pct(winRate(m))}%`, fix(m.rounds / RUNS), `${pct(m.capped / RUNS)}%`, `${pct(m.wiped / RUNS)}%`,
      m.won ? fix(m.survivors / m.won, 2) : '-',
      fix(d.partyDpr), fix(d.k), fix(d.foeDpr), fix(d.s), verdict(d, m),
    ];
  });
  return [
    `## ${enemyTitle(id)} — Lv${level}`,
    '',
    table(['段', '勝率', '平均R', '上限到達', '全滅', '勝ち時の生存人数', '隊→敵/R', '必要R', '敵→隊/R', '持ちR', '主因'], rows),
    '',
    `隊の能力(Lv${level})`,
    '',
    partyStatsTable(level, id),
  ].join('\n');
}

const out: string[] = [
  `# ボス戦の計測(各条件 ${RUNS} 回)`,
  '',
  '基準の隊: 剣士・戦士・僧侶・斥候。基礎は中央値、成長1.0、適性は役割80・他30、特性なし、仲間思い。回復薬2、撤退なし。',
  '',
  '## 装備の段',
  '',
  gearTable(),
  '',
];

if (LEVEL !== undefined) {
  for (const id of BOSS ? [BOSS] : BOSSES) out.push(detail(id, LEVEL), '');
  out.push(DIAG_NOTE);
} else {
  const bosses = BOSS ? [BOSS] : BOSSES;
  out.push(`勝率の表の括弧は負けの内訳(上=${ROUND_CAP}ターン上限で決着せず / 滅=全滅)。`, '');
  for (const id of bosses) {
    out.push(`## ${enemyTitle(id)}`, '', '勝率%', '', winTable(id), '', '平均ラウンド / 勝ち時の生存人数', '', roundsTable(id), '');
  }
  out.push(
    `## 勝率${pct(TARGET)}%以上の最小Lv`,
    '',
    `表の Lv で初めて${pct(TARGET)}%に届いた所から、手前の Lv を1刻みで詰めた値。Lv${LEVELS[LEVELS.length - 1]}でも届かなければ —。`,
    '',
    minLevelTable(bosses),
    '',
  );
  const diagIds = BOSS ? [BOSS] : [...BOSSES, ...Object.keys(NORMALS)];
  out.push(
    '## 診断',
    '',
    `段はボスの居る所の素材で作れる段。Lv はその段で勝率${pct(TARGET)}%に届く1つ手前(届かなければ Lv${LEVELS[LEVELS.length - 1]})。`
      + '通常の敵は同じダンジョンのボスと同じ条件。',
    '',
    table(DIAG_HEAD, diagIds.map(diagRow)),
    '',
    DIAG_NOTE,
  );
}
console.log(out.join('\n'));
