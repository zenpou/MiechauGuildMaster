// ワールド(ノードと道)。経路と日程は決定論的な幾何、道中の遭遇は出発時に引数の Rng でまとめて引く(DESIGN 第2節)。
import { carryCapacity, effectiveStats, traitNum } from './adventurer';
import { makeAllyUnit, makeEnemies, runCombat, type Unit } from './combat';
import { DUNGEON, ENEMY, ITEM, JOB, NODE, TUNING, WORLD } from './data';
import type { Rng } from './rng';
import type { Adventurer, DungeonDef, LogEntry, LogKind, WorldEdgeDef, WorldKnowledge, WorldStep } from './types';

const T = TUNING.explore;

/** 道の敵表。DungeonDef.enemies と同じ形 */
export type RoadEnemy = DungeonDef['enemies'][number];

/** world.json の道。types.ts の WorldEdgeDef に道中の敵表と救助費用を足したもの */
export interface EdgeDef extends WorldEdgeDef {
  enemies?: RoadEnemy[];
  rescueCostPerDay?: number;
}

// sim で調整する値
const SCOUT_ENCOUNTER_MULT = 0.7;
const RESCUE_COST_PER_DAY = 50;
const ROAD_FLEE_BELOW = 0.3;
const DEFAULT_ROAD_ENEMIES: RoadEnemy[] = [
  { id: 'goblin', weight: 5, group: [1, 2] },
  { id: 'wolf', weight: 5, group: [1, 3] },
];

const EDGES = WORLD.edges as EdgeDef[];

/** 道を使えるか。地理は全部見えるが、隠し道は見つけるまで経路に入れない */
type EdgeKnowledge = Pick<WorldKnowledge, 'foundEdges'>;
const usable = (e: EdgeDef, k: EdgeKnowledge) => !e.hidden || k.foundEdges.includes(e.id);
const other = (e: EdgeDef, n: string) => (e.a === n ? e.b : e.a);

/** a と b を直接結ぶ、使える道のうち最も早いもの。同じ区間に表の道と近道があるので knowledge が要る */
export function edgeBetween(a: string, b: string, knowledge: EdgeKnowledge): EdgeDef | null {
  let best: EdgeDef | null = null;
  for (const e of EDGES) {
    if (!usable(e, knowledge) || !((e.a === a && e.b === b) || (e.a === b && e.b === a))) continue;
    if (!best || e.days < best.days) best = e;
  }
  return best;
}

/** 最短日数の経路(Dijkstra)。同じ日数なら道の本数が少ない方 */
function shortest(from: string, to: string, knowledge: EdgeKnowledge): { days: number; nodes: string[] } | null {
  if (!NODE[from] || !NODE[to]) return null;
  const dist = new Map<string, [number, number]>([[from, [0, 0]]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  const less = (x: [number, number], y: [number, number]) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  for (;;) {
    let cur: string | null = null;
    for (const [n, d] of dist) if (!done.has(n) && (cur === null || less(d, dist.get(cur)!))) cur = n;
    if (cur === null) return null;
    if (cur === to) break;
    done.add(cur);
    const [d, hops] = dist.get(cur)!;
    for (const e of EDGES) {
      if ((e.a !== cur && e.b !== cur) || !usable(e, knowledge)) continue;
      const n = other(e, cur);
      const cand: [number, number] = [d + e.days, hops + 1];
      const old = dist.get(n);
      if (!done.has(n) && (!old || less(cand, old))) {
        dist.set(n, cand);
        prev.set(n, cur);
      }
    }
  }
  const nodes = [to];
  for (let p = to; p !== from; ) nodes.push((p = prev.get(p)!));
  return { days: dist.get(to)![0], nodes: nodes.reverse() };
}

/** 片道の最短日数。行けなければ null */
export function travelDays(from: string, to: string, knowledge: EdgeKnowledge): number | null {
  return shortest(from, to, knowledge)?.days ?? null;
}

/** 片道の最短経路(両端を含むノード列)。行けなければ null */
export function route(from: string, to: string, knowledge: EdgeKnowledge): string[] | null {
  return shortest(from, to, knowledge)?.nodes ?? null;
}

/** 経路の道を順に。つながっていない区間があれば例外(経路は route() から作る前提) */
function edgesOf(nodes: string[], knowledge: EdgeKnowledge): EdgeDef[] {
  const out: EdgeDef[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const e = edgeBetween(nodes[i], nodes[i + 1], knowledge);
    if (!e) throw new Error(`${nodes[i]} と ${nodes[i + 1]} を結ぶ道が無い`);
    out.push(e);
  }
  return out;
}

/**
 * 日付→位置の表。道は1日に1件(days 日ぶん)、days=0 の道は次の件と同じ日に置く。
 * 帰着日(= 出発日 + 往路 + 滞在 + 復路)に起点のノードを置いて終わる。
 */
export function planSteps(nodes: string[], stayDays: number, startDay: number, knowledge: EdgeKnowledge): WorldStep[] {
  const edges = edgesOf(nodes, knowledge);
  const steps: WorldStep[] = [];
  let day = startDay;
  const walk = (e: EdgeDef, phase: WorldStep['phase']) => {
    if (e.days === 0) steps.push({ day, node: null, edge: e.id, phase });
    for (let i = 0; i < e.days; i++) steps.push({ day: day++, node: null, edge: e.id, phase });
  };
  for (const e of edges) walk(e, 'outbound');
  for (let i = 0; i < stayDays; i++) steps.push({ day: day++, node: nodes[nodes.length - 1], edge: null, phase: 'stay' });
  for (const e of [...edges].reverse()) walk(e, 'return');
  steps.push({ day, node: nodes[0], edge: null, phase: 'return' });
  return steps;
}

/** 道の敵表: 道の定義 → 両端のダンジョンの表 → 既定(ゴブリンと森狼) */
export function roadEnemies(e: EdgeDef): RoadEnemy[] {
  if (e.enemies?.length) return e.enemies;
  const fromDungeons = [e.a, e.b].flatMap((n) => {
    const d = NODE[n]?.dungeon;
    return d && DUNGEON[d] ? DUNGEON[d].enemies : [];
  });
  return fromDungeons.length ? fromDungeons : DEFAULT_ROAD_ENEMIES;
}

export interface TravelResult {
  /** day は今回の移動の何日目か(1始まり) */
  log: LogEntry[];
  kills: Record<string, number>;
  /** 療養日数 */
  injuries: Record<string, number>;
  /** 一度でも倒れた冒険者 */
  downed: string[];
  wiped: boolean;
  /** 全滅した道と移動の何日目か */
  wipedAt: { edge: string; day: number } | null;
  fatigue: Record<string, number>;
  rescueCost: number;
  materials: Record<string, number>;
  encounters: number;
}

/**
 * 片道ぶんの道中を確定する。移動1日ごとに danger(斥候役がいれば ×0.7)× encounterMult(見張り台など)で遭遇1回。
 * direction 'return' は経路を逆にたどる。全滅したらそこで打ち切る。
 */
export function simulateTravel(
  rng: Rng, members: Adventurer[], nodes: string[], direction: 'outbound' | 'return', knowledge: EdgeKnowledge,
  encounterMult = 1,
): TravelResult {
  const path = direction === 'outbound' ? nodes : [...nodes].reverse();
  const edges = edgesOf(path, knowledge);
  const result: TravelResult = {
    log: [], kills: {}, injuries: {}, downed: [], wiped: false, wipedAt: null,
    fatigue: {}, rescueCost: 0, materials: {}, encounters: 0,
  };
  let day = 0;
  const say = (kind: LogKind, text: string) => { result.log.push({ day, kind, text }); };
  const units: Unit[] = members.map((m) => makeAllyUnit(m, effectiveStats(m)));
  const scouted = members.some((m) => JOB[m.job].roles.includes('scout'));
  const capacity = members.reduce((s, m) => s + carryCapacity(m), 0);
  const carried = () => Object.entries(result.materials).reduce((s, [k, n]) => s + ITEM[k].weight * n, 0);
  const potions = { n: 0, used: 0 };
  const downed = new Set<string>();
  for (const m of members) result.fatigue[m.id] = 0;
  const addFatigue = (n: number) => {
    for (const m of members) result.fatigue[m.id] += Math.round(n * traitNum(m, 'fatigueRate', 1));
  };

  for (let i = 0; i < edges.length && !result.wiped; i++) {
    const e = edges[i];
    const label = `道中(${NODE[path[i]].name}→${NODE[path[i + 1]].name})`;
    for (let d = 0; d < e.days && !result.wiped; d++) {
      day++;
      if (day > 1) for (const u of units) u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * T.campHeal));
      addFatigue(T.dayFatigue + T.campFatigue);
      if (!rng.chance(e.danger * (scouted ? SCOUT_ENCOUNTER_MULT : 1) * encounterMult)) continue;
      result.encounters++;
      const pick = rng.weighted(roadEnemies(e), (x) => x.weight);
      const def = ENEMY[pick.id];
      const count = rng.int(pick.group[0], pick.group[1]);
      say('combat', `${label}: ${def.name}${count > 1 ? `${count}体` : ''}に出くわした。`);
      const foes = makeEnemies(def, count);
      // 道中では関係値を動かさない(探索の帰還時にまとめて動くため)
      const r = runCombat(units, foes, { rng, say, potions, rel: () => {}, canFlee: true, fleeBelow: ROAD_FLEE_BELOW });
      for (const [k, v] of Object.entries(r.kills)) result.kills[k] = (result.kills[k] ?? 0) + v;
      for (const id of r.downed) downed.add(id);
      addFatigue(T.combatFatigue);
      if (r.outcome === 'lost') {
        result.wiped = true;
        result.wipedAt = { edge: e.id, day };
        result.rescueCost = (e.rescueCostPerDay ?? RESCUE_COST_PER_DAY) * e.days;
        result.materials = {};
        say('result', `${label}で全員が倒れた……。救助隊に運ばれて引き返した(救助費用${result.rescueCost}G)。`);
        break;
      }
      for (const u of units) {
        if (!u.down) continue;
        u.down = false;
        u.hp = Math.max(1, Math.round(u.maxHp * T.reviveHp));
        say('narration', `${u.name}は仲間に担がれ、しばらくして意識を取り戻した。`);
      }
      if (r.outcome === 'fled') {
        say('combat', `${label}: 敵を振り切って先を急いだ。`);
        continue;
      }
      const parts: string[] = [];
      for (const f of foes) {
        for (const l of f.enemy!.loot) {
          if (!rng.chance(l.chance) || carried() + ITEM[l.item].weight > capacity) continue;
          result.materials[l.item] = (result.materials[l.item] ?? 0) + 1;
          parts.push(ITEM[l.item].name);
        }
      }
      say('combat', parts.length ? `${label}: 勝利。戦利品: ${parts.join('、')}。` : `${label}: 勝利。`);
    }
  }

  result.downed = [...downed];
  for (const m of members) {
    const u = units.find((x) => x.id === m.id)!;
    let d = 0;
    if (result.wiped) d = rng.int(T.wipeInjuryDays[0], T.wipeInjuryDays[1]);
    else {
      if (u.hp / u.maxHp < T.injuryLowHp) d = rng.int(T.injuryLowDays[0], T.injuryLowDays[1]);
      if (downed.has(m.id)) d = Math.max(d, rng.int(T.injuryDownDays[0], T.injuryDownDays[1]));
    }
    if (d > 0) {
      result.injuries[m.id] = d;
      say('result', `${m.name}は道中で負傷した(療養${d}日)。`);
    }
  }
  return result;
}
