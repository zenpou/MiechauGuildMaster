// 帰還時のイベント: 組み合わせ(親友)と、ユニーク冒険者の依頼チェーン(DESIGN 第6節)。
import { salaryOf } from './adventurer';
import { ITEM, UNIQUE, UNIQUES, type UniqueChainStep, type UniqueDef } from './data';
import { markGreeted } from './mail';
import { addRelation, getRelation, pairKey } from './relations';
import { LOYALTY_MAX, type Adventurer, type Expedition, type GameState, type Result } from './types';

/** この関係値以上の2人が同じ隊で FRIEND_RUNS 回帰ると親友になる */
const FRIEND_RELATION = 60;
const FRIEND_RUNS = 5;
const FRIEND_LOYALTY = 10;
const FRIEND_RELATION_BONUS = 20;

const addLoyalty = (a: Adventurer, d: number) => { a.loyalty = Math.max(0, Math.min(LOYALTY_MAX, a.loyalty + d)); };

/** UI・botが同じ条件で表示・受注・納品を扱うための観測値。進行は既存の flags に残す。 */
export interface UniqueRequest {
  unique: string;
  name: string;
  step: number;
  text: string;
  kind: UniqueChainStep['kind'];
  item?: string;
  dungeon?: string;
  enemy?: string;
  required: number;
  progress: number;
  remaining: number;
  accepted: boolean;
  canAccept: boolean;
  completed: boolean;
}

const stepKey = (unique: string) => `${unique}:step`;
const acceptedKey = (unique: string) => `${unique}:accepted`;
const acceptedDayKey = (unique: string) => `${unique}:acceptedDay`;
const acceptedNextIdKey = (unique: string) => `${unique}:acceptedNextId`;

function stepIndex(s: GameState, def: UniqueDef): number {
  const value = s.flags[stepKey(def.id)];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function progressKey(def: UniqueDef, step: UniqueChainStep): string | null {
  if (step.kind === 'deliver') return `${def.id}:${step.item}`;
  if (step.kind === 'visit') return `${def.id}:${step.dungeon}`;
  if (step.kind === 'soloKill') return `${def.id}:${step.enemy}`;
  return null;
}

function progressOf(s: GameState, def: UniqueDef, step: UniqueChainStep): number {
  const key = progressKey(def, step);
  const value = key ? s.flags[key] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** 50話の読了。日付0は既読として扱い、false/未設定だけを未読とする。 */
function firstLoyaltySeen(s: GameState, unique: string): boolean {
  const value = s.flags[`story:loyalty:${unique}:50`];
  return value !== undefined && value !== false;
}

function acceptedFor(s: GameState, unique: string, step: number): boolean {
  return s.flags[acceptedKey(unique)] === step;
}

function requestVisible(s: GameState, def: UniqueDef, step: number, progress: number): boolean {
  return step > 0 || progress > 0 || firstLoyaltySeen(s, def.id) || acceptedFor(s, def.id, step);
}

function requestOf(s: GameState, def: UniqueDef): UniqueRequest | null {
  const step = stepIndex(s, def);
  const current = def.chain[step];
  if (!current) return null;
  const progress = progressOf(s, def, current);
  if (!requestVisible(s, def, step, progress)) return null;
  const required = Math.max(0, current.n);
  const completed = progress >= required;
  const accepted = acceptedFor(s, def.id, step);
  return {
    unique: def.id, name: def.name, step, text: current.text, kind: current.kind,
    item: current.item, dungeon: current.dungeon, enemy: current.enemy,
    required, progress, remaining: Math.max(0, required - progress), accepted,
    canAccept: !accepted && !completed,
    completed,
  };
}

/** 現在の名簿にいるユニークの頼み。台詞未読でも旧進行・進捗があれば返す。 */
export function uniqueRequests(s: GameState): UniqueRequest[] {
  return UNIQUES
    .filter((def) => s.adventurers.some((a) => a.unique === def.id))
    .map((def) => requestOf(s, def))
    .filter((request): request is UniqueRequest => request !== null);
}

/** 単独観測用。UIとbotの詳細表示に使う。 */
export function uniqueRequest(s: GameState, unique: string): UniqueRequest | null {
  const def = UNIQUE[unique];
  return def && s.adventurers.some((a) => a.unique === unique) ? requestOf(s, def) : null;
}

const requestOk = (): Result => ({ ok: true });
const requestFail = (reason: string): Result => ({ ok: false, reason });

function requestMember(s: GameState, def: UniqueDef): Adventurer | null {
  return s.adventurers.find((a) => a.unique === def.id) ?? null;
}

/** 頼みを受ける。expectedStep は古い表示を再送しても次段階を誤って受けないために必須。 */
export function acceptUniqueRequest(s: GameState, unique: string, expectedStep: number): Result {
  const def = UNIQUE[unique];
  const member = def ? requestMember(s, def) : null;
  if (!def || !member) return requestFail('その仲間の頼みはありません');
  const currentStep = stepIndex(s, def);
  if (currentStep !== expectedStep) return requestFail('頼みの段階が変わっています');
  const request = requestOf(s, def);
  if (!request) return requestFail('その頼みはまだ受けられません');
  if (request.accepted) return requestFail('その頼みはすでに受けています');
  if (request.completed) return requestFail('その頼みは達成済みです');
  s.flags[acceptedKey(unique)] = expectedStep;
  s.flags[acceptedDayKey(unique)] = s.day;
  // 同日受注前に出ていた隊を、同日受注後の帰還として数えないための境界。
  s.flags[acceptedNextIdKey(unique)] = s.counters.nextId;
  return requestOk();
}

function addNotice(s: GameState, text: string, notices?: string[]) {
  if (notices) notices.push(text);
  else s.notices.unshift({ day: s.day, text });
}

/** 受注済みの納品段階へ、必要残数だけを明示的に渡す。 */
export function deliverUniqueRequest(s: GameState, unique: string, expectedStep: number): Result {
  const def = UNIQUE[unique];
  const member = def ? requestMember(s, def) : null;
  if (!def || !member) return requestFail('その仲間の頼みはありません');
  const currentStep = stepIndex(s, def);
  if (currentStep !== expectedStep) return requestFail('頼みの段階が変わっています');
  const request = requestOf(s, def);
  if (!request || !request.accepted) return requestFail('先に頼みを受けてください');
  if (request.kind !== 'deliver') return requestFail('この頼みは納品ではありません');
  if (request.completed) return requestFail('その頼みは達成済みです');
  const item = request.item!;
  const have = s.inventory[item] ?? 0;
  const take = Math.min(have, request.remaining);
  if (take <= 0) return requestFail(`${ITEM[item]?.name ?? item}が足りません(${have}/${request.remaining})`);
  s.inventory[item] = have - take;
  const progress = request.progress + take;
  s.flags[progressKey(def, def.chain[currentStep])!] = progress;
  addNotice(s, `${member.name}の頼みに、在庫から${ITEM[item]?.name ?? item}を${take}個渡した（${progress}/${request.required}）。`);
  if (progress >= request.required) finishStep(s, def, member, undefined);
  return requestOk();
}

export function uniqueDef(id: string): UniqueDef {
  return UNIQUE[id];
}

/** ユニークの冒険者を定義どおりに作る。乱数は使わない */
export function uniqueAdventurer(def: UniqueDef, id: string): Adventurer {
  const a: Adventurer = {
    id, name: def.name, age: def.age, level: 1, exp: 0, job: def.job,
    base: { ...def.base }, apt: { ...def.apt }, growth: def.growth,
    personality: def.personality, gender: def.gender, appearance: def.appearance, traits: [],
    fatigue: 0, injuryDays: def.joinInjuryDays ?? 0, salary: def.salary, loyalty: 50, status: 'idle',
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

/** 名簿へ直接入れる。候補一覧に同じユニークがいれば消す(古いセーブで候補に出ていた分) */
function joinUnique(s: GameState, def: UniqueDef): Adventurer {
  const a = uniqueAdventurer(def, `a${s.counters.nextId++}`);
  a.history.hiredDay = s.day;
  markGreeted(s, a);
  s.adventurers.push(a);
  s.candidates = s.candidates.filter((c) => c.adv.unique !== def.id);
  s.flags[`unique:${def.id}`] = true;
  s.flags[`unique:${def.id}:hired`] = s.day;
  return a;
}

const inRoster = (s: GameState, id: string) => s.adventurers.some((a) => a.unique === id);

/** 初日の名簿に入るユニークのうち、まだ名簿にいない者を入れる。入れた者を返す */
export function joinInitialUniques(s: GameState): Adventurer[] {
  return UNIQUES.filter((d) => 'initial' in d.join && d.join.initial && !inRoster(s, d.id)).map((d) => joinUnique(s, d));
}

/**
 * 章 chapterId を読み終えたときに加入するユニークを名簿に入れ、お知らせを出す。
 * 既読かどうかは見ない(story.ts を import すると循環するので、既読の判定は呼び出し側で済ませる)
 */
export function joinStoryUniques(s: GameState, chapterId: string): Adventurer[] {
  const out = UNIQUES
    .filter((d) => 'story' in d.join && d.join.story === chapterId && !inRoster(s, d.id))
    .map((d) => joinUnique(s, d));
  for (const a of out) s.notices.unshift({ day: s.day, text: `${a.name}がギルドに加入した。${a.injuryDays > 0 ? `まず${a.injuryDays}日、怪我の療養をする。` : ''}` });
  return out;
}

/** 帰還の反映の後に呼ぶ。親友イベントとユニークの依頼チェーンを進める */
export function onReturn(s: GameState, e: Expedition, notices: string[]) {
  const members = e.order.partyIds.map((id) => s.adventurers.find((a) => a.id === id)).filter((a): a is Adventurer => !!a);
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) countPair(s, members[i], members[j], notices);
  }
  for (const def of UNIQUES) {
    const u = s.adventurers.find((a) => a.unique === def.id);
    const index = stepIndex(s, def);
    const step = currentStep(s, def);
    if (!u || !step || !e.order.partyIds.includes(u.id) || !acceptedFor(s, def.id, index)) continue;
    if (!startedAfterAcceptance(s, def.id, e)) continue;
    if (step.kind === 'visit' && e.result.mapDeltas.some((d) => d.dungeon === step.dungeon)) {
      const key = progressKey(def, step)!;
      const progress = Math.min(step.n, progressOf(s, def, step) + 1);
      s.flags[key] = progress;
      if (progress >= step.n) finishStep(s, def, u, notices);
    } else if (step.kind === 'soloKill' && e.order.partyIds.length === 1 && (e.result.kills[step.enemy!] ?? 0) >= step.n) {
      s.flags[progressKey(def, step)!] = step.n;
      finishStep(s, def, u, notices);
    }
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
  return def.chain[stepIndex(s, def)];
}

function finishStep(s: GameState, def: UniqueDef, u: Adventurer, notices?: string[]) {
  const i = stepIndex(s, def);
  s.flags[stepKey(def.id)] = i + 1;
  delete s.flags[acceptedKey(def.id)];
  delete s.flags[acceptedDayKey(def.id)];
  delete s.flags[acceptedNextIdKey(def.id)];
  addNotice(s, `${u.name}の頼み「${def.chain[i].text}」を果たした。`, notices);
  const next = def.chain[i + 1];
  if (next) {
    addNotice(s, `${u.name}から次の頼み:「${next.text}」`, notices);
    return;
  }
  addLoyalty(u, def.chainLoyalty);
  addNotice(s, `${u.name}の頼みをすべて果たした。${u.name}は深く感謝している(忠誠+${def.chainLoyalty})。`, notices);
}

/** 受注後に新しく出発した遠征だけを頼みの進行対象にする。 */
function startedAfterAcceptance(s: GameState, unique: string, e: Expedition): boolean {
  const acceptedDay = s.flags[acceptedDayKey(unique)];
  if (typeof acceptedDay !== 'number') return false;
  if (e.startDay > acceptedDay) return true;
  if (e.startDay < acceptedDay) return false;
  const boundary = s.flags[acceptedNextIdKey(unique)];
  const id = /^e(\d+)$/.exec(e.id)?.[1];
  return typeof boundary === 'number' && id !== undefined && Number(id) >= boundary;
}
