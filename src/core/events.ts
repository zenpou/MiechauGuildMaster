// 帰還時のイベント: 組み合わせ(親友)と、ユニーク冒険者の依頼チェーン(DESIGN 第6節)。
import { salaryOf } from './adventurer';
import { UNIQUE, UNIQUES, type UniqueChainStep, type UniqueDef } from './data';
import { addRelation, getRelation, pairKey } from './relations';
import { LOYALTY_MAX, type Adventurer, type Expedition, type GameState } from './types';

/** この関係値以上の2人が同じ隊で FRIEND_RUNS 回帰ると親友になる */
const FRIEND_RELATION = 60;
const FRIEND_RUNS = 5;
const FRIEND_LOYALTY = 10;
const FRIEND_RELATION_BONUS = 20;

const addLoyalty = (a: Adventurer, d: number) => { a.loyalty = Math.max(0, Math.min(LOYALTY_MAX, a.loyalty + d)); };

export function uniqueDef(id: string): UniqueDef {
  return UNIQUE[id];
}

/** ユニークの冒険者を定義どおりに作る。乱数は使わない */
export function uniqueAdventurer(def: UniqueDef, id: string): Adventurer {
  const a: Adventurer = {
    id, name: def.name, age: def.age, level: 1, exp: 0, job: def.job,
    base: { ...def.base }, apt: { ...def.apt }, growth: def.growth,
    personality: def.personality, traits: [],
    fatigue: 0, injuryDays: 0, salary: def.salary, loyalty: 50, status: 'idle',
    assignment: null,
    equipment: { weapon: null, armor: null, accessory: null },
    skills: [def.skill.id],
    persona: { ...def.persona },
    history: { hiredDay: 0, expeditions: 0, kills: 0, visits: {}, raisesRefused: 0, warnedDay: null },
    unique: def.id,
  };
  if (a.salary <= 0) a.salary = salaryOf(a);
  return a;
}

/** 帰還の反映の後に呼ぶ。親友イベントとユニークの依頼チェーンを進める */
export function onReturn(s: GameState, e: Expedition, notices: string[]) {
  const members = e.order.partyIds.map((id) => s.adventurers.find((a) => a.id === id)).filter((a): a is Adventurer => !!a);
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) countPair(s, members[i], members[j], notices);
  }
  for (const def of UNIQUES) {
    const u = s.adventurers.find((a) => a.unique === def.id);
    const step = currentStep(s, def);
    if (!u || !step || !e.order.partyIds.includes(u.id)) continue;
    if (step.kind === 'visit' && e.result.mapDeltas.some((d) => d.dungeon === step.dungeon)) {
      const key = `${def.id}:${step.dungeon}`;
      s.flags[key] = Number(s.flags[key] ?? 0) + 1;
      if (Number(s.flags[key]) >= step.n) finishStep(s, def, u, notices);
    } else if (step.kind === 'soloKill' && e.order.partyIds.length === 1 && (e.result.kills[step.enemy!] ?? 0) >= step.n) {
      finishStep(s, def, u, notices);
    }
  }
}

/** 納品の段を進める。在庫から必要数まで直接引く(日送りで呼ぶ) */
export function advanceUniqueChain(s: GameState, notices: string[]) {
  for (const def of UNIQUES) {
    const u = s.adventurers.find((a) => a.unique === def.id);
    const step = currentStep(s, def);
    if (!u || !step || step.kind !== 'deliver') continue;
    const key = `${def.id}:${step.item}`;
    const have = Number(s.flags[key] ?? 0);
    const take = Math.min(s.inventory[step.item!] ?? 0, step.n - have);
    if (take <= 0) continue;
    s.inventory[step.item!] -= take;
    s.flags[key] = have + take;
    if (have + take >= step.n) finishStep(s, def, u, notices);
  }
}

function countPair(s: GameState, a: Adventurer, b: Adventurer, notices: string[]) {
  const key = pairKey(a.id, b.id);
  if (s.flags[`friends:${key}`] || getRelation(s.relations, a, b) < FRIEND_RELATION) return;
  const n = Number(s.flags[`pair:${key}`] ?? 0) + 1;
  s.flags[`pair:${key}`] = n;
  if (n < FRIEND_RUNS) return;
  s.flags[`friends:${key}`] = true;
  addLoyalty(a, FRIEND_LOYALTY);
  addLoyalty(b, FRIEND_LOYALTY);
  addRelation(s.relations, a, b, FRIEND_RELATION_BONUS);
  notices.push(`${a.name}と${b.name}は親友になった(2人の忠誠+${FRIEND_LOYALTY}、関係値+${FRIEND_RELATION_BONUS})。`);
}

function currentStep(s: GameState, def: UniqueDef): UniqueChainStep | undefined {
  return def.chain[Number(s.flags[`${def.id}:step`] ?? 0)];
}

function finishStep(s: GameState, def: UniqueDef, u: Adventurer, notices: string[]) {
  const i = Number(s.flags[`${def.id}:step`] ?? 0);
  s.flags[`${def.id}:step`] = i + 1;
  notices.push(`${u.name}の頼み「${def.chain[i].text}」を果たした。`);
  const next = def.chain[i + 1];
  if (next) {
    notices.push(`${u.name}から次の頼み:「${next.text}」`);
    return;
  }
  addLoyalty(u, def.chainLoyalty);
  notices.push(`${u.name}の頼みをすべて果たした。${u.name}は深く感謝している(忠誠+${def.chainLoyalty})。`);
}
