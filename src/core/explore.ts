// 探索シミュレーション。出発時に全行程をマス単位で確定し、帰還日に開示する(DESIGN 第3節)。
// 乱数は inp.rng だけを使う。inp.progress は読むだけで、差分は mapDeltas で返す。
import { carryCapacity, effectiveStats, equipEffect, traitNum } from './adventurer';
import { hasSkill, makeAllyUnit, makeEnemies, runCombat, type Unit } from './combat';
import { ENEMY, ITEM, PERSONALITY, POLICY, RETURN_LINES, ROLE_SKILL, TRAIT, TUNING, type ReturnOutcome } from './data';
import { exploredRate, frontier, isPassable, neighbors, parseFloor, searchSpots, shortestPath, visibleFrom, xy, type Grid, type PassKnowledge } from './dungeon';
import type { Rng } from './rng';
import type {
  ActionKind, Adventurer, CellKind, DungeonDef, DungeonProgress, ExpeditionResult, LogKind, ReturnDialogue, StatKey,
} from './types';

// sim で調整する値は src/data/tuning.json
const T = TUNING.explore;


export interface ExploreInput {
  rng: Rng;
  dungeon: DungeonDef;
  /** フェーズ1は 'f1' */
  floorId: string;
  members: Adventurer[]; leaderId: string; policy: string;
  /** 出発前の知識(visited / hiddenFound)。変更しない */
  progress: DungeonProgress;
  /** 現地日数 */
  days: number;
  /** 持ち物(potion など) */
  items: Record<string, number>;
  /** 疲労の増え方の倍率(祝福で下がる) */
  fatigueMult?: number;
  relations: Record<string, number>;
  startDay: number;
  action: ActionKind;
  target?: { item?: string; enemy?: string };
  /** 見込み用: 既知のマスだけを歩き、未踏には踏み込まない */
  knownOnly?: boolean;
  /** 前の階を通り抜ける歩数(片道。floorTransit)。往路と復路で1回ずつ払う。省略時 0 */
  transit?: number;
  /** 出発時に持っている鍵。扉はこの鍵があるときだけ通れる。省略時 [] */
  keys?: string[];
  /** 隠し通路の発見率への加算。省略時 0 */
  hiddenBonus?: number;
}

/** 1歩の記録。cost は既踏1・未踏2 */
export interface ExploreMove { cell: number; cost: number }
export interface ExploreDayTrace {
  day: number; budget: number;
  /** 移動・迷い・休憩・前の階の通り抜けで使った歩数 */
  used: number;
  moves: ExploreMove[];
  /** その日の終わりの位置 */
  camp: number;
}
export interface ExploreEvent { day: number; cell: number; kind: CellKind | 'encounter' | 'hidden' | 'stairs' }
/** 計測(sim)とテスト用の行程記録。ExpeditionResult には入れない */
export interface ExploreTrace {
  days: ExploreDayTrace[];
  events: ExploreEvent[];
  end: 'done' | 'mapFull' | 'retreat' | 'wipe';
  finalCell: number;
  /** 今回入ったマスの最大深度(cellDepths) */
  maxDepth: number;
  /** 歩数が足りず入口へ強制的に戻した(起きないはずの安全弁) */
  forcedReturn: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ONCE_KINDS: CellKind[] = ['gather', 'treasure', 'trap', 'nest', 'symbol', 'boss', 'stairs_down'];
const DANGER_KINDS: CellKind[] = ['nest', 'symbol', 'boss'];
const LOOT_KINDS: CellKind[] = ['treasure', 'gather'];

/**
 * マスの深度 = 入口からの経路長。隠し通路を閉じた形で測り、隠し通路のマス自体は開けた形で測る。
 * 近道を見つけても「奥にあるマス」の深さは変わらない方が、計測の物差しとして比べやすいため。
 * 扉の奥だけのマスは鍵を全部持った形で測る(鍵の有無で深度が -1 になると、奥へ届いたかを比べられない)。
 */
export function cellDepths(grid: Grid): number[] {
  const hidden = grid.cells.flatMap((c, i) => (c.kind === 'hidden' ? [i] : []));
  const keys = [...new Set(grid.cells.flatMap((c) => (c.kind === 'door' && c.key !== undefined ? [c.key] : [])))];
  const walk = (know: PassKnowledge) => {
    const d = new Array<number>(grid.cells.length).fill(-1);
    d[grid.entrance] = 0;
    const q = [grid.entrance];
    for (let h = 0; h < q.length; h++) {
      for (const n of neighbors(grid, q[h], know)) {
        if (d[n] >= 0) continue;
        d[n] = d[q[h]] + 1;
        q.push(n);
      }
    }
    return d;
  };
  const closed = walk({ keys: [], hiddenFound: [] });
  const keyed = walk({ keys, hiddenFound: [] });
  const open = walk({ keys, hiddenFound: hidden });
  return closed.map((v, i) => (v >= 0 ? v : keyed[i] >= 0 ? keyed[i] : open[i]));
}

/**
 * 階 floorId への派遣で、前の階を通り抜ける片道の歩数(各1歩)。1階は 0。
 * 前の階の入口から、踏んだ下り階段までの既知の最短経路の長さに、それより上の階の分を足す。
 * 前の階の下り階段を踏んでいない・既知の道で届かない・階が無いときは null。
 */
export function floorTransit(dungeon: DungeonDef, floorId: string, progress: DungeonProgress, keys: string[] = []): number | null {
  const n = dungeon.floors.findIndex((f) => f.id === floorId);
  if (n < 0) return null;
  if (n === 0) return 0;
  const prevDef = dungeon.floors[n - 1];
  const above = floorTransit(dungeon, prevDef.id, progress, keys);
  const prev = progress.floors[prevDef.id];
  if (above === null || !prev) return null;
  const grid = parseFloor(prevDef);
  const known = new Set(prev.visited);
  const know: PassKnowledge = { keys, hiddenFound: prev.hiddenFound };
  let best = Infinity;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i].kind !== 'stairs_down' || !known.has(i)) continue;
    const p = shortestPath(grid, grid.entrance, i, known, know);
    if (p) best = Math.min(best, p.length - 1);
  }
  return best === Infinity ? null : above + best;
}

/** 帰還のひとこと。隊員全員分を性格と結果の種類から1つずつ選ぶ */
export function returnDialogue(rng: Rng, members: Adventurer[], outcome: ReturnOutcome): ReturnDialogue[] {
  return members.map((m) => {
    const lines = RETURN_LINES[m.personality] ?? RETURN_LINES.cautious;
    return { advId: m.id, name: m.name, text: rng.pick(lines[outcome]) };
  });
}

export function simulateExploration(inp: ExploreInput): ExpeditionResult {
  return runExploration(inp).result;
}

export function runExploration(inp: ExploreInput): { result: ExpeditionResult; trace: ExploreTrace } {
  const { rng, dungeon, members } = inp;
  const floorDef = dungeon.floors.find((f) => f.id === inp.floorId);
  if (!floorDef) throw new Error(`${dungeon.id}: フロア ${inp.floorId} が無い`);
  const grid = parseFloor(floorDef);
  const policy = POLICY[inp.policy] ?? POLICY.standard;
  const leader = members.find((m) => m.id === inp.leaderId) ?? members[0];
  const ex = PERSONALITY[leader.personality].explore;
  // 寄り道と臆病の回避は探索系だけ。採集・討伐・ボスでは指示を優先する
  const exploring = inp.action === 'explore' || inp.action === 'survey';
  const avoid = exploring && ex.detour === 'avoid';
  const knownOnly = inp.knownOnly === true;
  const targetItem = inp.target?.item;
  const targetEnemy = inp.target?.enemy;
  const entrance = grid.entrance;
  const transit = inp.transit ?? 0;
  const hiddenBonus = inp.hiddenBonus ?? 0;

  // ---- 知識 ----
  const prior = inp.progress.floors[inp.floorId];
  const visited = new Set<number>(prior?.visited ?? []);
  const newCells: number[] = [];
  const hiddenFound = [...(prior?.hiddenFound ?? [])];
  const newHidden: number[] = [];
  // 扉は出発時に持っていた鍵だけで開く。現地で拾った鍵は帰還して在庫に入ってから使える
  const know: PassKnowledge = { keys: inp.keys ?? [], hiddenFound };
  const heldKeys = new Set(know.keys);
  const foundKeys: string[] = [];
  const seen = new Set<number>();
  const look = (i: number) => { for (const n of visibleFrom(grid, i)) seen.add(n); };
  for (const v of visited) look(v);
  const depths = cellDepths(grid);
  const maxDepthAll = Math.max(1, ...depths);
  const kindOf = (i: number) => grid.cells[i].kind;
  const isDanger = (i: number) => DANGER_KINDS.includes(kindOf(i));

  // ---- 隊 ----
  const stats = Object.fromEntries(members.map((m) => [m.id, effectiveStats(m)]));
  const units: Unit[] = members.map((m) => makeAllyUnit(m, stats[m.id]));
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const capacity = members.reduce((s, m) => s + carryCapacity(m), 0);
  const gatherBonus = members.reduce((s, m) => s + equipEffect(m, 'gather'), 0);
  const potions = { n: inp.items.potion ?? 0, used: 0 };
  const luck = members.reduce((s, m) => s + traitNum(m, 'luck'), 0) / members.length;
  const best = (k: StatKey) => members.reduce((b, m) => (stats[m.id][k] > stats[b.id][k] ? m : b));
  const skilled = (skillId: string) => units.find((u) => hasSkill(u, skillId));
  const trapCare = members.reduce((s, m) => s + PERSONALITY[m.personality].trapCare, 0);

  let day = 1;
  const result: ExpeditionResult = {
    success: false, retreated: false, wiped: false, log: [],
    mapDeltas: [], maxDepth: 0, daysSpent: 0, materials: {}, items: {}, gold: 0,
    injuries: {}, expGain: {}, fatigue: {}, relationDeltas: [], revealedTraits: [],
    kills: {}, itemsUsed: {}, repGain: 0, rescueCost: 0, lostMaterials: {},
    questProgress: {}, returnDialogue: [],
  };
  const say = (kind: LogKind, text: string) => { result.log.push({ day, kind, text }); };
  const trace: ExploreTrace = { days: [], events: [], end: 'done', finalCell: entrance, maxDepth: 0, forcedReturn: false };
  for (const m of members) result.fatigue[m.id] = 0;
  const downedEver = new Set<string>();
  const consumed = new Set<number>();
  const edgesDone = new Set<number>();

  const addFatigue = (n: number) => {
    for (const m of members) result.fatigue[m.id] += Math.round(n * traitNum(m, 'fatigueRate', 1) * (inp.fatigueMult ?? 1));
  };
  const avgFatigue = () => members.reduce((s, m) => s + m.fatigue + result.fatigue[m.id], 0) / members.length;
  const retreatThreshold = () =>
    clamp(policy.retreat + PERSONALITY[leader.personality].retreatBias * 0.6 + (avgFatigue() > T.retreatTired ? T.retreatTiredAdd : 0), 0.1, 0.75);
  const ratio = (u: Unit) => (u.down ? 0 : u.hp / u.maxHp);
  const avgHp = () => units.reduce((s, u) => s + ratio(u), 0) / units.length;
  const minHp = () => Math.min(...units.map(ratio));
  const healAll = (r: number) => {
    for (const u of units) if (!u.down) u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * r));
  };
  const bumpRel = (a: string, b: string, delta: number, reason: string) => {
    if (a === b || !byId[a] || !byId[b] || delta === 0) return;
    result.relationDeltas.push({ a, b, delta, reason });
  };
  const carried = () => Object.entries(result.materials).reduce((s, [k, n]) => s + ITEM[k].weight * n, 0);
  /** 積載に収まる分だけ持つ。持てた数を返す */
  const addMaterial = (item: string, n: number): number => {
    const w = ITEM[item].weight;
    const fit = Math.max(0, Math.min(n, Math.floor((capacity - carried()) / w)));
    if (fit > 0) result.materials[item] = (result.materials[item] ?? 0) + fit;
    if (fit < n) say('event', `荷が一杯で、${ITEM[item].name}を${n - fit}個その場に置いていった。`);
    return fit;
  };

  // ---- 経路 ----
  /** visited と to だけを通る経路。臆病な隊長は巣を通らない道を先に探す */
  const pathTo = (from: number, to: number): number[] | null => {
    const set = new Set(visited);
    set.add(to);
    if (avoid) {
      const safe = new Set([...set].filter((i) => i === from || i === to || !isDanger(i)));
      const p = shortestPath(grid, from, to, safe, know);
      if (p) return p;
    }
    return shortestPath(grid, from, to, set, know);
  };
  /** 外へ出るまでの歩数。前の階を抜ける復路の分も常に予約しておく */
  const homeDist = (i: number) => {
    const p = pathTo(i, entrance);
    return p ? p.length - 1 + transit : Infinity;
  };
  const bfs = (from: number, ok: (i: number) => boolean) => {
    const d = new Array<number>(grid.cells.length).fill(-1);
    d[from] = 0;
    const q = [from];
    for (let h = 0; h < q.length; h++) {
      for (const n of neighbors(grid, q[h], know)) {
        if (d[n] >= 0 || !ok(n)) continue;
        d[n] = d[q[h]] + 1;
        q.push(n);
      }
    }
    return d;
  };
  /** 既踏は1歩ずつ、最後の未踏1マスは2歩 */
  const costVia = (d: number[], f: number, unknownCost: number) => {
    if (visited.has(f)) return d[f];
    let m = Infinity;
    for (const n of neighbors(grid, f, know)) if (visited.has(n) && d[n] >= 0) m = Math.min(m, d[n]);
    return m === Infinity ? -1 : m + unknownCost;
  };

  // ---- 1日の状態 ----
  let pos = entrance;
  let left = 0;
  let future = 0;
  let rests = 0;
  /** 往路で前の階をまだ抜けきっていない歩数。最初の目標を決めてから払う(出直すなら払わない) */
  let owed = transit;
  /** 復路で前の階を抜け始めたら true。back はその残りの歩数 */
  let leaving = false;
  let back = 0;
  const tried = new Set<number>();
  let today: ExploreDayTrace = { day: 0, budget: 0, used: 0, moves: [], camp: entrance };
  let seg = { from: pos, steps: 0, fresh: 0, hes: 0, home: false };
  const dirOf = (a: number, b: number) => {
    const p = xy(grid, a);
    const q = xy(grid, b);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    if (dx === 0 && dy === 0) return '周辺';
    return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? '東' : '西') : dy > 0 ? '南' : '北';
  };
  /** 移動は区切りごとに1行にまとめる */
  const flush = () => {
    if (seg.steps > 0) {
      const hes = seg.hes ? `(分かれ道で${seg.hes}度立ち止まった)` : '';
      const text = seg.home
        ? `入口へ向かって${dirOf(seg.from, pos)}へ${seg.steps}歩戻った。`
        : seg.fresh > 0
          ? `${leader.name}の先導で${dirOf(seg.from, pos)}へ進み、新しく${seg.fresh}マス踏んだ。`
          : `既知の道を${dirOf(seg.from, pos)}へ${seg.steps}歩進んだ。`;
      say('narration', text + hes);
    } else if (seg.hes) {
      say('narration', `${leader.name}は分かれ道で${seg.hes}度立ち止まった。`);
    }
    seg = { from: pos, steps: 0, fresh: 0, hes: 0, home: seg.home };
  };
  const event = (cell: number, kind: ExploreEvent['kind']) => {
    flush();
    trace.events.push({ day, cell, kind });
  };

  let retreating = false;
  let mapFull = false;
  let wiped = false;
  const startRetreat = (text: string) => {
    if (retreating) return;
    retreating = true;
    say('narration', text);
  };

  // ---- 戦闘 ----
  const fight = (cell: number, enemyId: string, count: number, kind: ExploreEvent['kind']) => {
    const def = ENEMY[enemyId];
    event(cell, kind);
    say('combat', `${def.name}${count > 1 ? `${count}体` : ''}と戦闘になった。`);
    const foes = makeEnemies(def, count);
    const r = runCombat(units, foes, {
      rng, say, potions, rel: bumpRel, canFlee: true, fleeBelow: retreatThreshold() * T.fleeRatio,
    });
    for (const [k, v] of Object.entries(r.kills)) result.kills[k] = (result.kills[k] ?? 0) + v;
    for (const id of r.downed) downedEver.add(id);
    addFatigue(T.combatFatigue);
    if (r.outcome === 'lost') {
      wiped = true;
      return;
    }
    for (const u of units) {
      if (!u.down) continue;
      u.down = false;
      u.hp = Math.max(1, Math.round(u.maxHp * T.reviveHp));
      say('narration', `${u.name}は仲間に担がれ、しばらくして意識を取り戻した。`);
    }
    if (r.outcome === 'fled') {
      startRetreat(`${leader.name}は撤退を決めた。入口へ引き返す。`);
      return;
    }
    const got: Record<string, number> = {};
    for (const f of foes) {
      for (const l of f.enemy!.loot) if (rng.chance(l.chance)) got[l.item] = (got[l.item] ?? 0) + 1;
    }
    const parts: string[] = [];
    for (const [item, n] of Object.entries(got)) {
      const kept = addMaterial(item, n);
      if (kept > 0) parts.push(`${ITEM[item].name}×${kept}`);
    }
    say('combat', parts.length ? `勝利。戦利品: ${parts.join('、')}。` : '勝利。めぼしい戦利品は無かった。');
  };

  const springTrap = (intro: string) => {
    say('event', intro);
    const scout = skilled('first_strike');
    if (scout && rng.chance(ROLE_SKILL.first_strike.params.trapDisarm)) {
      say('event', `${scout.name}が手早く罠を外した。`);
      return;
    }
    // 斥候が外し損ねても、器用な者がよける機会は残す(斥候がいて不利になる逆転を避けるため)
    const deft = best('dex');
    if (rng.chance(clamp(T.trapBase + stats[deft.id].dex / T.trapDexScale + trapCare, 0.1, 0.95))) {
      say('event', `${deft.name}が仕掛けに気づき、皆を下がらせた。`);
      return;
    }
    const victim = rng.pick(units.filter((u) => !u.down));
    const dmg = Math.max(1, Math.round(victim.maxHp * rng.range(T.trapDamage[0], T.trapDamage[1])));
    // 罠で倒れると「死なない」の表現が戦闘外で必要になるので、HPは1で止める
    victim.hp = Math.max(1, victim.hp - dmg);
    addFatigue(T.trapFatigue);
    say('event', `罠が作動し、${victim.name}が${dmg}ダメージを受けた。`);
  };

  const enterCell = (i: number) => {
    const cell = grid.cells[i];
    if (ONCE_KINDS.includes(cell.kind)) {
      if (consumed.has(i)) return;
      consumed.add(i);
    }
    switch (cell.kind) {
      case 'gather': {
        event(i, 'gather');
        const item = cell.item!;
        const g = best('gather');
        if (!rng.chance(clamp(T.gatherBase + stats[g.id].gather / T.gatherScale + luck * 0.1, 0.1, 0.95))) {
          say('event', `${g.name}が${ITEM[item].name}を探したが、使えるものは見つからなかった。`);
          return;
        }
        const focus = inp.action === 'gather' && (!targetItem || targetItem === item) ? T.gatherFocusBonus : 0;
        const qty = rng.int(T.gatherQty[0], T.gatherQty[1]) + (skilled('pack') ? ROLE_SKILL.pack.params.gatherBonus : 0) + focus + gatherBonus;
        const kept = addMaterial(item, qty);
        if (kept > 0) say('event', `${g.name}が${ITEM[item].name}を${kept}個採った。`);
        return;
      }
      case 'treasure': {
        event(i, 'treasure');
        if (cell.item !== undefined) {
          // 鍵の宝箱。データ側に定義が無い鍵でも止めない
          const name = ITEM[cell.item]?.name ?? cell.item;
          if (heldKeys.has(cell.item)) {
            say('event', `宝箱に${name}があったが、もう持っている。`);
            return;
          }
          heldKeys.add(cell.item);
          foundKeys.push(cell.item);
          say('event', `宝箱から${name}を手に入れた。`);
          return;
        }
        const gold = rng.int(T.treasureGold[0], T.treasureGold[1]);
        if (rng.chance(T.treasureTrap)) springTrap('宝箱に罠が仕掛けられていた。');
        result.gold += gold;
        say('event', `宝箱から${gold}G見つけた。`);
        return;
      }
      case 'trap':
        event(i, 'trap');
        springTrap('足元に仕掛けがある。');
        return;
      case 'stairs_down':
        event(i, 'stairs');
        say('event', '下り階段を見つけた。');
        return;
      case 'nest': {
        const entry = dungeon.enemies.find((e) => e.id === cell.enemy);
        const [lo, hi] = entry?.group ?? T.nestGroup;
        fight(i, cell.enemy!, rng.int(lo, hi), 'nest');
        return;
      }
      case 'symbol':
      case 'boss':
        fight(i, cell.enemy!, 1, cell.kind);
        return;
      case 'floor':
        if (rng.chance(dungeon.encounterRate ?? T.defaultEncounter) && dungeon.enemies.length) {
          const e = rng.weighted(dungeon.enemies, (x) => x.weight);
          fight(i, e.id, rng.int(e.group[0], e.group[1]), 'encounter');
        }
        return;
      default:
        return;
    }
  };

  /** つながった隠しマスは1本の通路として、まとめて開く */
  const hiddenRun = (start: number): number[] => {
    const run = [start];
    for (let h = 0; h < run.length; h++) {
      for (const n of visibleFrom(grid, run[h])) if (kindOf(n) === 'hidden' && !run.includes(n)) run.push(n);
    }
    return run.sort((a, b) => a - b);
  };
  /** 隣の隠し通路は、通りがかった時に1日1度だけ発見を試みる */
  const tryHidden = (i: number) => {
    if (knownOnly) return;
    for (const n of visibleFrom(grid, i)) {
      if (kindOf(n) !== 'hidden' || hiddenFound.includes(n) || tried.has(n)) continue;
      tried.add(n);
      const s = best('scout');
      if (!rng.chance(Math.min(0.95, clamp(T.hiddenBase + stats[s.id].scout / T.hiddenScale, 0.1, 0.9) + hiddenBonus))) continue;
      for (const h of hiddenRun(n)) {
        if (hiddenFound.includes(h)) continue;
        hiddenFound.push(h);
        newHidden.push(h);
      }
      event(n, 'hidden');
      say('event', `${s.name}が壁の継ぎ目に気づいた。隠し通路だ!`);
    }
  };

  const move = (next: number, cost: number) => {
    const fresh = !visited.has(next);
    pos = next;
    edgesDone.add(next);
    if (fresh) {
      visited.add(next);
      newCells.push(next);
    }
    look(next);
    left -= cost;
    today.used += cost;
    today.moves.push({ cell: next, cost });
    trace.maxDepth = Math.max(trace.maxDepth, depths[next]);
    seg.steps++;
    if (fresh) seg.fresh++;
  };

  let homeReason: null | 'injured' | 'safety' = null;
  // 関数越しに読むのは、afterMove 内の代入をループ側の型の絞り込みが見落とすため
  const homeIs = (r: 'injured' | 'safety') => homeReason === r;
  /** 移動後: 隠し通路 → マスのイベント → 撤退 → 休憩 → 負傷者で引き返す */
  const afterMove = () => {
    tryHidden(pos);
    enterCell(pos);
    if (wiped) return;
    if (!retreating && avgHp() < retreatThreshold()) {
      flush();
      startRetreat(`隊の消耗が激しい。${leader.name}は撤退を決めた。`);
    }
    const low = ex.restMode === 'any' ? minHp() : avgHp();
    // 休憩も歩数を使う。その日の残りが足りないときは取らない(翌日分を前借りして負の歩数にしない)
    if (rests < T.restMaxPerDay && low < ex.restHp && left >= T.restSteps && left - T.restSteps + future >= homeDist(pos)) {
      rests++;
      left -= T.restSteps;
      today.used += T.restSteps;
      const healer = units.some((u) => !u.down && hasSkill(u, 'heal'));
      const r = T.restHeal + (healer ? ROLE_SKILL.heal.params.ratio : 0);
      healAll(r);
      flush();
      say('narration', `${leader.name}の判断で小休止を取った(HP+${Math.round(r * 100)}%)。`);
    }
    if (ex.detour === 'injured' && homeReason === null && !retreating && units.some((u) => ratio(u) < T.injuredHp)) {
      homeReason = 'injured';
      flush();
      say('narration', `${leader.name}は傷ついた仲間を気づかい、今日は入口へ引き返すことにした。`);
    }
  };

  // ---- 目標選び ----
  /** 見込み用: 既知の端(未踏に接する既踏マス)。各端はその派遣で1度だけ目指す */
  const knownEdges = () => {
    const out = new Set<number>();
    for (const f of frontier(grid, visited, seen, know)) {
      for (const n of neighbors(grid, f, know)) if (visited.has(n) && !edgesDone.has(n)) out.add(n);
    }
    return out;
  };
  /** 直近の目標選びで、未踏が尽きて隠し通路の調べ直しだけが残ったか */
  let searching = false;
  /** 行動種別ごとの目標候補。値は寄り道先か(加点の有無) */
  const candidates = (): Map<number, boolean> => {
    const cands = new Map<number, boolean>();
    const unspent = (i: number) => !consumed.has(i);
    switch (inp.action) {
      case 'gather':
        for (const i of visited) if (kindOf(i) === 'gather' && unspent(i) && (!targetItem || grid.cells[i].item === targetItem)) cands.set(i, false);
        return cands;
      case 'hunt':
        for (const i of visited) if (isDanger(i) && unspent(i) && (!targetEnemy || grid.cells[i].enemy === targetEnemy)) cands.set(i, false);
        return cands;
      case 'boss':
        for (const i of visited) if ((kindOf(i) === 'symbol' || kindOf(i) === 'boss') && unspent(i)) cands.set(i, false);
        return cands;
      default:
        break;
    }
    if (knownOnly) for (const i of knownEdges()) cands.set(i, false);
    else for (const f of frontier(grid, visited, seen, know)) cands.set(f, false);
    if (ex.detour === 'nest' || ex.detour === 'treasure') {
      const kinds = ex.detour === 'nest' ? DANGER_KINDS : LOOT_KINDS;
      for (const i of knownOnly ? [...visited] : [...visited, ...seen]) {
        // 持っている鍵の宝箱は、行っても何も起きない
        if (kinds.includes(kindOf(i)) && unspent(i) && isPassable(grid, i, know) && !(grid.cells[i].item && know.keys.includes(grid.cells[i].item!))) cands.set(i, true);
      }
    }
    if (avoid) for (const i of [...cands.keys()]) if (isDanger(i)) cands.delete(i);
    // 歩き尽くしたら、通りがかりの判定に外れた隠し通路を調べ直しに戻る。戻らないと、行き止まりの先の鍵に二度と届かない
    searching = false;
    if (!knownOnly && cands.size === 0) {
      for (const i of searchSpots(grid, visited, hiddenFound, tried)) if (!(avoid && isDanger(i))) cands.set(i, false);
      searching = cands.size > 0;
    }
    return cands;
  };
  const exhaustedText = (): string => {
    switch (inp.action) {
      case 'gather': return '目当ての採取点は採り尽くした。入口へ引き返す。';
      case 'hunt': return '巣を回り終えた。入口へ引き返す。';
      case 'boss': return '討ち取って引き返す。';
      default: return '行ける場所は歩き尽くした。入口へ引き返す。';
    }
  };

  /** null = 候補が無い(歩き尽くした)/ 'far' = 候補はあるが今回の残り歩数では往復できない */
  const chooseTarget = (): number | null | 'far' => {
    const cands = candidates();
    cands.delete(pos);
    if (cands.size === 0) return null;

    const fork = neighbors(grid, pos, know).length >= T.forkNeighbors;
    // 前の階を抜ける前は、まだこの階の分かれ道に立っていない
    // 判定の乱数は先に引く(列を変えない)。歩数が残っていない日は迷わない: 予算を超えて歩数が負になっていた
    if (owed === 0 && fork && ex.hesitate > 0 && rng.chance(ex.hesitate) && left >= 1 && left - 1 + future >= homeDist(pos)) {
      left--;
      today.used++;
      seg.hes++;
    }

    const dAll = bfs(pos, (i) => visited.has(i));
    const dSafe = avoid ? bfs(pos, (i) => visited.has(i) && !isDanger(i)) : dAll;
    const dEnt = bfs(entrance, (i) => visited.has(i));
    const scored: { cell: number; dist: number; depth: number; detour: number }[] = [];
    let far = false;
    for (const cell of [...cands.keys()].sort((a, b) => a - b)) {
      let dist = costVia(dSafe, cell, T.costUnknown);
      if (dist < 0) dist = costVia(dAll, cell, T.costUnknown);
      const depth = costVia(dEnt, cell, 1);
      if (dist < 0 || depth < 0) continue;
      // 往復できない目標を選ぶと帰路の制約に当たって足踏みするだけなので、最初から外す
      if (dist + depth + owed + transit > left + future) {
        far = true;
        continue;
      }
      // 前の派遣で踏んだ寄り道先は加点を弱める。強欲が入口近くの採取点だけを毎回往復して地図が止まったため
      scored.push({ cell, dist, depth, detour: cands.get(cell)! ? (visited.has(cell) ? T.detourBonusKnown : T.detourBonus) : 0 });
    }
    if (!scored.length) return far ? 'far' : null;
    const maxDist = Math.max(1, ...scored.map((s) => s.dist));
    const ranked = scored
      .map((s) => ({
        cell: s.cell,
        score: ex.venture * Math.min(1, s.depth / maxDepthAll) - ex.thorough * (s.dist / maxDist)
          + s.detour + rng.range(0, T.scoreNoise),
      }))
      .sort((a, b) => b.score - a.score || a.cell - b.cell);
    return fork && ex.forkRandom ? rng.pick(ranked.slice(0, T.forkTop)).cell : ranked[0].cell;
  };

  // ---- 本編 ----
  say('narration', `${dungeon.name}・${floorDef.name}に入った。隊長は${leader.name}、方針は「${policy.name}」。`);
  if (!visited.has(entrance)) {
    visited.add(entrance);
    newCells.push(entrance);
  }
  look(entrance);

  const budget = Math.max(1, Math.round(T.baseSteps * ex.speed));
  const days = Math.max(1, inp.days);
  let end: ExploreTrace['end'] | null = null;
  let daysSpent = 0;
  for (day = 1; day <= days && end === null; day++) {
    daysSpent = day;
    const last = day === days;
    const cellsBefore = newCells.length;
    const hiddenBefore = newHidden.length;
    left = budget;
    future = budget * (days - day);
    rests = 0;
    tried.clear();
    homeReason = null;
    today = { day, budget, used: 0, moves: [], camp: pos };
    trace.days.push(today);
    seg = { from: pos, steps: 0, fresh: 0, hes: 0, home: false };
    if (day > 1) say('narration', `${day}日目。`);
    let target = -1;
    let route: number[] = [];
    let ri = 0;

    while (end === null) {
      const homeward = leaving || retreating || mapFull || homeReason !== null;
      if (homeward) {
        if (!seg.home) {
          flush();
          seg.home = true;
        }
        const toEntrance = retreating || mapFull || homeIs('injured') || last;
        // 入口で野営すると残りの日数で前の階を抜けきれないときは、今日のうちに抜け始める
        if (pos === entrance && owed < transit && (leaving || retreating || mapFull || last || transit > future)) {
          if (!leaving) {
            leaving = true;
            back = transit - owed;
          }
          flush();
          // 分かれ道の迷いで left が負になることがある(既存の挙動)。負の支払いで back を増やさない
          const pay = Math.max(0, Math.min(back, left));
          back -= pay;
          left -= pay;
          today.used += pay;
          if (back > 0) {
            if (pay > 0) say('narration', `前の階を${pay}歩戻った(残り${back}歩)。`);
            break;
          }
          say('narration', `前の階を抜けて${transit - owed}歩戻った。`);
          end = retreating ? 'retreat' : mapFull ? 'mapFull' : 'done';
          break;
        }
        if (homeDist(pos) <= (toEntrance ? transit : future)) {
          if (pos === entrance && (retreating || mapFull || last)) end = retreating ? 'retreat' : mapFull ? 'mapFull' : 'done';
          break;
        }
        if (left < T.costKnown) break;
        move(pathTo(pos, entrance)![1], T.costKnown);
        afterMove();
        if (wiped) end = 'wipe';
        continue;
      }

      if (target < 0 || pos === target) {
        const t = chooseTarget();
        if (t === 'far') {
          // 入口で何も出来ない日は、待っても届くようにならない。予定日数を使い切らずに戻す
          if (pos === entrance && today.moves.length === 0) {
            mapFull = true;
            flush();
            say('narration', '今の日数では届く場所が無い。出直すことにした。');
            continue;
          }
          homeReason = 'safety';
          continue;
        }
        if (t === null) {
          mapFull = true;
          flush();
          say('narration', exhaustedText());
          continue;
        }
        const r = pathTo(pos, t);
        if (!r) {
          mapFull = true;
          continue;
        }
        target = t;
        route = r;
        ri = 0;
        if (searching) {
          flush();
          say('narration', '行き止まりの壁が気になり、調べ直しに戻った。');
        }
      }
      if (owed > 0) {
        const pay = Math.min(owed, left);
        owed -= pay;
        left -= pay;
        today.used += pay;
        if (owed > 0) {
          say('narration', `前の階を${pay}歩進んだ(残り${owed}歩)。`);
          break;
        }
        say('narration', `前の階を抜けて${transit}歩。`);
      }
      const next = route[ri + 1];
      const cost = visited.has(next) ? T.costKnown : T.costUnknown;
      // 最終日は「次の1歩+そこから入口までの既知の道」を払えなくなった時点で帰路に入る。
      // 最終日以外も翌日以降の歩数で帰れる範囲に留める(野営地が遠すぎると最終日に戻れないため)
      if (left < cost || left - cost + future < homeDist(next)) {
        homeReason = 'safety';
        continue;
      }
      move(next, cost);
      ri++;
      afterMove();
      if (wiped) end = 'wipe';
      else if (retreating || homeReason !== null) target = -1;
    }
    flush();

    if (end === null && last) {
      // 不変条件(残り歩数 ≥ 入口までの距離)が守られていれば通らない
      trace.forcedReturn = true;
      say('narration', '夜道を急ぎ、なんとか入口まで戻った。');
      pos = entrance;
      end = 'done';
    }
    if (end !== 'wipe') addFatigue(T.dayFatigue);
    const fresh = newCells.length - cellsBefore;
    if (fresh > 0 || newHidden.length > hiddenBefore) {
      const rate = Math.round(exploredRate(grid, [...visited]) * 100);
      say('map', `地図に${fresh}マスを書き足した(探索率 ${rate}%)。`);
    }
    today.camp = pos;
    if (end === null) {
      healAll(T.campHeal);
      for (const m of members) result.fatigue[m.id] += T.campFatigue;
      say('narration', 'その場で野営した。');
    }
  }
  day = daysSpent;
  if (end === null) end = 'done';

  // ---- 帰還の集計 ----
  if (end === 'wipe') {
    pos = entrance;
    result.wiped = true;
    result.lostMaterials = result.materials;
    result.materials = {};
    result.rescueCost = dungeon.rescueCost;
    say('result', `全員が倒れた……。${members.map((m) => m.name).join('、')}は救助隊に運び出された(救助費用${dungeon.rescueCost}G)。`);
  } else if (end === 'retreat') {
    result.retreated = true;
    say('result', '入口まで引き返し、探索を切り上げた。');
  } else if (end === 'mapFull') {
    say('result', '行ける場所を歩き尽くし、入口から帰還した。');
  } else {
    say('result', '予定の日数を終え、入口から帰還した。');
  }
  result.success = !result.retreated && !result.wiped;
  trace.end = end;
  trace.finalCell = pos;

  for (const m of members) {
    const u = units.find((x) => x.id === m.id)!;
    let d = 0;
    if (result.wiped) d = rng.int(T.wipeInjuryDays[0], T.wipeInjuryDays[1]);
    else {
      if (ratio(u) < T.injuryLowHp) d = rng.int(T.injuryLowDays[0], T.injuryLowDays[1]);
      if (downedEver.has(m.id)) d = Math.max(d, rng.int(T.injuryDownDays[0], T.injuryDownDays[1]));
    }
    if (d > 0) {
      result.injuries[m.id] = d;
      say('result', `${m.name}は負傷した(療養${d}日)。`);
    }
  }

  const killExp = Object.entries(result.kills).reduce((s, [k, n]) => s + ENEMY[k].exp * n, 0);
  const depth = Math.max(1, dungeon.recommended / T.expRefPower);
  for (const m of members) {
    // 探索と日数の分だけ難度で増やす。敵を倒した分(killExp)は敵の強さがすでに反映されているので増やさない
    const base = (newCells.length * T.expPerCell + daysSpent * T.expPerDay) * depth + killExp / members.length;
    result.expGain[m.id] = Math.max(1, Math.round(base * policy.expMult * traitNum(m, 'expRate', 1)));
  }

  if (!result.wiped && members.length > 1) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) bumpRel(members[i].id, members[j].id, T.returnRelation, '共に帰還した');
    }
    say('relation', `共に帰還し、仲間意識が少し深まった(関係値 +${T.returnRelation})。`);
  }

  for (const m of members) {
    const hidden = m.traits.filter((t) => !t.revealed);
    if (!hidden.length || !rng.chance(T.traitReveal)) continue;
    const t = rng.pick(hidden);
    result.revealedTraits.push({ advId: m.id, traitId: t.id });
    say('result', `【発見】${m.name}の特性「${TRAIT[t.id].name}」が判明した。(${TRAIT[t.id].desc})`);
  }

  // 既存の乱数列を変えないよう、ひとことは最後に引く
  const outcome: ReturnOutcome = result.wiped ? 'wipe' : result.retreated ? 'retreat' : daysSpent < days ? 'early' : 'success';
  result.returnDialogue = returnDialogue(rng, members, outcome);

  result.mapDeltas = [{ dungeon: dungeon.id, floor: inp.floorId, cells: newCells, hidden: newHidden }];
  result.maxDepth = trace.maxDepth;
  result.daysSpent = daysSpent;
  result.items = { ...inp.items };
  if ('potion' in result.items || potions.n > 0) result.items.potion = potions.n;
  if (potions.used > 0) result.itemsUsed.potion = potions.used;
  for (const k of foundKeys) result.items[k] = 1;
  return { result, trace };
}
