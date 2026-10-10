// 探索シミュレーション。出発時に全行程をマス単位で確定し、帰還日に開示する(DESIGN 第3節)。
// 乱数は inp.rng だけを使う。inp.progress は読むだけで、差分は mapDeltas で返す。
import { carryCapacity, effectiveStats, traitNum } from './adventurer';
import { hasSkill, makeAllyUnit, makeEnemies, runCombat, type Unit } from './combat';
import { ENEMY, ITEM, PERSONALITY, POLICY, ROLE_SKILL, TRAIT } from './data';
import { exploredRate, frontier, isPassable, neighbors, parseFloor, shortestPath, visibleFrom, xy, type Grid, type PassKnowledge } from './dungeon';
import type { Rng } from './rng';
import type {
  Adventurer, CellKind, DungeonDef, DungeonProgress, ExpeditionResult, LogKind, StatKey,
} from './types';

// ---- sim で調整する値(フェーズ2で JSON へ移す) ----
export const BASE_STEPS = 16;
const COST_KNOWN = 1;
const COST_UNKNOWN = 2;
const REST_STEPS = 3;
const REST_HEAL = 0.15;
const REST_MAX_PER_DAY = 2;
const CAMP_HEAL = 0.2;
const CAMP_FATIGUE = -8;
const DAY_FATIGUE = 10;
const COMBAT_FATIGUE = 4;
const TRAP_FATIGUE = 5;
const TRAP_DAMAGE: [number, number] = [0.1, 0.2];
const TRAP_BASE = 0.4;
const TRAP_DEX_SCALE = 40;
const TREASURE_GOLD: [number, number] = [30, 80];
const TREASURE_TRAP = 0.3;
const GATHER_BASE = 0.35;
const GATHER_SCALE = 40;
const GATHER_QTY: [number, number] = [1, 2];
const HIDDEN_BASE = 0.2;
const HIDDEN_SCALE = 50;
const NEST_GROUP: [number, number] = [2, 3];
const DEFAULT_ENCOUNTER = 0.04;
const DETOUR_BONUS = 0.5;
// 前の派遣で踏んだ寄り道先は加点を弱める。強欲が入口近くの採取点だけを毎回往復して地図が止まったため
const DETOUR_BONUS_KNOWN = 0.05;
const SCORE_NOISE = 0.05;
const FORK_NEIGHBORS = 3;
const FORK_TOP = 3;
const INJURED_HP = 0.5;
const REVIVE_HP = 0.2;
const RETREAT_TIRED = 70;
const RETREAT_TIRED_ADD = 0.08;
const FLEE_RATIO = 0.55;
const INJURY_LOW_HP = 0.3;
const INJURY_LOW_DAYS: [number, number] = [1, 3];
const INJURY_DOWN_DAYS: [number, number] = [2, 4];
const WIPE_INJURY_DAYS: [number, number] = [2, 4];
const EXP_PER_CELL = 2;
const EXP_PER_DAY = 5;
const TRAIT_REVEAL = 0.25;
const RETURN_RELATION = 1;

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
  relations: Record<string, number>;
  startDay: number;
}

/** 1歩の記録。cost は既踏1・未踏2 */
export interface ExploreMove { cell: number; cost: number }
export interface ExploreDayTrace {
  day: number; budget: number;
  /** 移動・迷い・休憩で使った歩数 */
  used: number;
  moves: ExploreMove[];
  /** その日の終わりの位置 */
  camp: number;
}
export interface ExploreEvent { day: number; cell: number; kind: CellKind | 'encounter' | 'hidden' }
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
const ONCE_KINDS: CellKind[] = ['gather', 'treasure', 'trap', 'nest', 'symbol', 'boss'];
const DANGER_KINDS: CellKind[] = ['nest', 'symbol', 'boss'];
const LOOT_KINDS: CellKind[] = ['treasure', 'gather'];

/**
 * マスの深度 = 入口からの経路長。隠し通路を閉じた形で測り、隠し通路のマス自体は開けた形で測る。
 * 近道を見つけても「奥にあるマス」の深さは変わらない方が、計測の物差しとして比べやすいため。
 */
export function cellDepths(grid: Grid): number[] {
  const hidden = grid.cells.flatMap((c, i) => (c.kind === 'hidden' ? [i] : []));
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
  const open = walk({ keys: [], hiddenFound: hidden });
  return closed.map((v, i) => (v >= 0 ? v : open[i]));
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
  const avoid = ex.detour === 'avoid';
  const entrance = grid.entrance;

  // ---- 知識 ----
  const prior = inp.progress.floors[inp.floorId];
  const visited = new Set<number>(prior?.visited ?? []);
  const newCells: number[] = [];
  const hiddenFound = [...(prior?.hiddenFound ?? [])];
  const newHidden: number[] = [];
  const know: PassKnowledge = { keys: [], hiddenFound };
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
  const potions = { n: inp.items.potion ?? 0, used: 0 };
  const luck = members.reduce((s, m) => s + traitNum(m, 'luck'), 0) / members.length;
  const best = (k: StatKey) => members.reduce((b, m) => (stats[m.id][k] > stats[b.id][k] ? m : b));
  const skilled = (skillId: string) => units.find((u) => hasSkill(u, skillId));
  const trapCare = members.reduce((s, m) => s + PERSONALITY[m.personality].trapCare, 0);

  let day = 1;
  const result: ExpeditionResult = {
    success: false, retreated: false, wiped: false, log: [],
    mapDeltas: [], materials: {}, items: {}, gold: 0,
    injuries: {}, expGain: {}, fatigue: {}, relationDeltas: [], revealedTraits: [],
    kills: {}, itemsUsed: {}, repGain: 0, rescueCost: 0, lostMaterials: {},
    questProgress: {}, returnDialogue: [],
  };
  const say = (kind: LogKind, text: string) => { result.log.push({ day, kind, text }); };
  const trace: ExploreTrace = { days: [], events: [], end: 'done', finalCell: entrance, maxDepth: 0, forcedReturn: false };
  for (const m of members) result.fatigue[m.id] = 0;
  const downedEver = new Set<string>();
  const consumed = new Set<number>();

  const addFatigue = (n: number) => {
    for (const m of members) result.fatigue[m.id] += Math.round(n * traitNum(m, 'fatigueRate', 1));
  };
  const avgFatigue = () => members.reduce((s, m) => s + m.fatigue + result.fatigue[m.id], 0) / members.length;
  const retreatThreshold = () =>
    clamp(policy.retreat + PERSONALITY[leader.personality].retreatBias * 0.6 + (avgFatigue() > RETREAT_TIRED ? RETREAT_TIRED_ADD : 0), 0.1, 0.75);
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
  const homeDist = (i: number) => {
    const p = pathTo(i, entrance);
    return p ? p.length - 1 : Infinity;
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
      rng, say, potions, rel: bumpRel, canFlee: true, fleeBelow: retreatThreshold() * FLEE_RATIO,
    });
    for (const [k, v] of Object.entries(r.kills)) result.kills[k] = (result.kills[k] ?? 0) + v;
    for (const id of r.downed) downedEver.add(id);
    addFatigue(COMBAT_FATIGUE);
    if (r.outcome === 'lost') {
      wiped = true;
      return;
    }
    for (const u of units) {
      if (!u.down) continue;
      u.down = false;
      u.hp = Math.max(1, Math.round(u.maxHp * REVIVE_HP));
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
    if (rng.chance(clamp(TRAP_BASE + stats[deft.id].dex / TRAP_DEX_SCALE + trapCare, 0.1, 0.95))) {
      say('event', `${deft.name}が仕掛けに気づき、皆を下がらせた。`);
      return;
    }
    const victim = rng.pick(units.filter((u) => !u.down));
    const dmg = Math.max(1, Math.round(victim.maxHp * rng.range(TRAP_DAMAGE[0], TRAP_DAMAGE[1])));
    // 罠で倒れると「死なない」の表現が戦闘外で必要になるので、HPは1で止める
    victim.hp = Math.max(1, victim.hp - dmg);
    addFatigue(TRAP_FATIGUE);
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
        if (!rng.chance(clamp(GATHER_BASE + stats[g.id].gather / GATHER_SCALE + luck * 0.1, 0.1, 0.95))) {
          say('event', `${g.name}が${ITEM[item].name}を探したが、使えるものは見つからなかった。`);
          return;
        }
        const qty = rng.int(GATHER_QTY[0], GATHER_QTY[1]) + (skilled('pack') ? ROLE_SKILL.pack.params.gatherBonus : 0);
        const kept = addMaterial(item, qty);
        if (kept > 0) say('event', `${g.name}が${ITEM[item].name}を${kept}個採った。`);
        return;
      }
      case 'treasure': {
        event(i, 'treasure');
        const gold = rng.int(TREASURE_GOLD[0], TREASURE_GOLD[1]);
        if (rng.chance(TREASURE_TRAP)) springTrap('宝箱に罠が仕掛けられていた。');
        result.gold += gold;
        say('event', `宝箱から${gold}G見つけた。`);
        return;
      }
      case 'trap':
        event(i, 'trap');
        springTrap('足元に仕掛けがある。');
        return;
      case 'nest': {
        const entry = dungeon.enemies.find((e) => e.id === cell.enemy);
        const [lo, hi] = entry?.group ?? NEST_GROUP;
        fight(i, cell.enemy!, rng.int(lo, hi), 'nest');
        return;
      }
      case 'symbol':
      case 'boss':
        fight(i, cell.enemy!, 1, cell.kind);
        return;
      case 'floor':
        if (rng.chance(dungeon.encounterRate ?? DEFAULT_ENCOUNTER) && dungeon.enemies.length) {
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
    for (const n of visibleFrom(grid, i)) {
      if (kindOf(n) !== 'hidden' || hiddenFound.includes(n) || tried.has(n)) continue;
      tried.add(n);
      const s = best('scout');
      if (!rng.chance(clamp(HIDDEN_BASE + stats[s.id].scout / HIDDEN_SCALE, 0.1, 0.9))) continue;
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
    if (rests < REST_MAX_PER_DAY && low < ex.restHp && left - REST_STEPS + future >= homeDist(pos)) {
      rests++;
      left -= REST_STEPS;
      today.used += REST_STEPS;
      const healer = units.some((u) => !u.down && hasSkill(u, 'heal'));
      const r = REST_HEAL + (healer ? ROLE_SKILL.heal.params.ratio : 0);
      healAll(r);
      flush();
      say('narration', `${leader.name}の判断で小休止を取った(HP+${Math.round(r * 100)}%)。`);
    }
    if (ex.detour === 'injured' && homeReason === null && !retreating && units.some((u) => ratio(u) < INJURED_HP)) {
      homeReason = 'injured';
      flush();
      say('narration', `${leader.name}は傷ついた仲間を気づかい、今日は入口へ引き返すことにした。`);
    }
  };

  // ---- 目標選び ----
  /** null = 候補が無い(歩き尽くした)/ 'far' = 候補はあるが今回の残り歩数では往復できない */
  const chooseTarget = (): number | null | 'far' => {
    const cands = new Map<number, boolean>();
    for (const f of frontier(grid, visited, seen, know)) cands.set(f, false);
    if (ex.detour === 'nest' || ex.detour === 'treasure') {
      const kinds = ex.detour === 'nest' ? DANGER_KINDS : LOOT_KINDS;
      for (const i of [...visited, ...seen]) {
        if (kinds.includes(kindOf(i)) && !consumed.has(i) && isPassable(grid, i, know)) cands.set(i, true);
      }
    }
    if (avoid) for (const i of [...cands.keys()]) if (isDanger(i)) cands.delete(i);
    cands.delete(pos);
    if (cands.size === 0) return null;

    const fork = neighbors(grid, pos, know).length >= FORK_NEIGHBORS;
    if (fork && ex.hesitate > 0 && rng.chance(ex.hesitate) && left - 1 + future >= homeDist(pos)) {
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
      let dist = costVia(dSafe, cell, COST_UNKNOWN);
      if (dist < 0) dist = costVia(dAll, cell, COST_UNKNOWN);
      const depth = costVia(dEnt, cell, 1);
      if (dist < 0 || depth < 0) continue;
      // 往復できない目標を選ぶと帰路の制約に当たって足踏みするだけなので、最初から外す
      if (dist + depth > left + future) {
        far = true;
        continue;
      }
      scored.push({ cell, dist, depth, detour: cands.get(cell)! ? (visited.has(cell) ? DETOUR_BONUS_KNOWN : DETOUR_BONUS) : 0 });
    }
    if (!scored.length) return far ? 'far' : null;
    const maxDist = Math.max(1, ...scored.map((s) => s.dist));
    const ranked = scored
      .map((s) => ({
        cell: s.cell,
        score: ex.venture * Math.min(1, s.depth / maxDepthAll) - ex.thorough * (s.dist / maxDist)
          + s.detour + rng.range(0, SCORE_NOISE),
      }))
      .sort((a, b) => b.score - a.score || a.cell - b.cell);
    return fork && ex.forkRandom ? rng.pick(ranked.slice(0, FORK_TOP)).cell : ranked[0].cell;
  };

  // ---- 本編 ----
  say('narration', `${dungeon.name}・${floorDef.name}に入った。隊長は${leader.name}、方針は「${policy.name}」。`);
  if (!visited.has(entrance)) {
    visited.add(entrance);
    newCells.push(entrance);
  }
  look(entrance);

  const budget = Math.max(1, Math.round(BASE_STEPS * ex.speed));
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
      const homeward = retreating || mapFull || homeReason !== null;
      if (homeward) {
        if (!seg.home) {
          flush();
          seg.home = true;
        }
        const toEntrance = retreating || mapFull || homeIs('injured') || last;
        if (homeDist(pos) <= (toEntrance ? 0 : future)) {
          if (pos === entrance && (retreating || mapFull || last)) end = retreating ? 'retreat' : mapFull ? 'mapFull' : 'done';
          break;
        }
        if (left < COST_KNOWN) break;
        move(pathTo(pos, entrance)![1], COST_KNOWN);
        afterMove();
        if (wiped) end = 'wipe';
        continue;
      }

      if (target < 0 || pos === target) {
        const t = chooseTarget();
        if (t === 'far') {
          homeReason = 'safety';
          continue;
        }
        if (t === null) {
          mapFull = true;
          flush();
          say('narration', '行ける場所は歩き尽くした。入口へ引き返す。');
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
      }
      const next = route[ri + 1];
      const cost = visited.has(next) ? COST_KNOWN : COST_UNKNOWN;
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
    if (end !== 'wipe') addFatigue(DAY_FATIGUE);
    const fresh = newCells.length - cellsBefore;
    if (fresh > 0 || newHidden.length > hiddenBefore) {
      const rate = Math.round(exploredRate(grid, [...visited]) * 100);
      say('map', `地図に${fresh}マスを書き足した(探索率 ${rate}%)。`);
    }
    today.camp = pos;
    if (end === null) {
      healAll(CAMP_HEAL);
      for (const m of members) result.fatigue[m.id] += CAMP_FATIGUE;
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
    if (result.wiped) d = rng.int(WIPE_INJURY_DAYS[0], WIPE_INJURY_DAYS[1]);
    else {
      if (ratio(u) < INJURY_LOW_HP) d = rng.int(INJURY_LOW_DAYS[0], INJURY_LOW_DAYS[1]);
      if (downedEver.has(m.id)) d = Math.max(d, rng.int(INJURY_DOWN_DAYS[0], INJURY_DOWN_DAYS[1]));
    }
    if (d > 0) {
      result.injuries[m.id] = d;
      say('result', `${m.name}は負傷した(療養${d}日)。`);
    }
  }

  const killExp = Object.entries(result.kills).reduce((s, [k, n]) => s + ENEMY[k].exp * n, 0);
  for (const m of members) {
    const base = newCells.length * EXP_PER_CELL + daysSpent * EXP_PER_DAY + killExp / members.length;
    result.expGain[m.id] = Math.max(1, Math.round(base * policy.expMult * traitNum(m, 'expRate', 1)));
  }

  if (!result.wiped && members.length > 1) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) bumpRel(members[i].id, members[j].id, RETURN_RELATION, '共に帰還した');
    }
    say('relation', `共に帰還し、仲間意識が少し深まった(関係値 +${RETURN_RELATION})。`);
  }

  for (const m of members) {
    const hidden = m.traits.filter((t) => !t.revealed);
    if (!hidden.length || !rng.chance(TRAIT_REVEAL)) continue;
    const t = rng.pick(hidden);
    result.revealedTraits.push({ advId: m.id, traitId: t.id });
    say('result', `【発見】${m.name}の特性「${TRAIT[t.id].name}」が判明した。(${TRAIT[t.id].desc})`);
  }

  result.mapDeltas = [{ dungeon: dungeon.id, floor: inp.floorId, cells: newCells, hidden: newHidden }];
  result.items = { ...inp.items };
  if ('potion' in result.items || potions.n > 0) result.items.potion = potions.n;
  if (potions.used > 0) result.itemsUsed.potion = potions.used;
  return { result, trace };
}
