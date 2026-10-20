// 自動探索の観察記録。結果ログから推測せず、探索処理が確定した状態変化を順番に保存する。
import type { CombatObservation } from './combat';
import type { Adventurer, Expedition, JourneyFrame, JourneyFrameKind, JourneyRecord, LogKind } from './types';

const FRAME_KINDS = new Set<JourneyFrameKind>([
  'start', 'move', 'event', 'hidden', 'gather', 'treasure', 'trap', 'stairs',
  'encounter', 'combat_action', 'rest', 'retreat', 'camp', 'end',
]);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const numbers = (v: unknown) => Array.isArray(v) && v.every(natural);
const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string');
const hpValues = (v: unknown) => object(v) && Object.values(v).every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0);

/** 任意の追加記録だけを検証する。壊れていても遠征結果や本体セーブは捨てない。 */
export function isJourneyRecord(value: unknown): value is JourneyRecord {
  if (!object(value) || value.version !== 1
    || !natural(value.startDay) || value.startDay < 1 || !natural(value.outDays)
    || !['dungeon', 'floor', 'leaderId'].every(k => typeof value[k] === 'string')
    || !numbers(value.initialVisited) || !numbers(value.initialHiddenFound)
    || (value.initialKeys !== undefined && !strings(value.initialKeys))
    || !Array.isArray(value.members) || !Array.isArray(value.frames)) return false;
  if (!value.members.every(m => object(m)
    && ['id', 'name', 'appearance', 'personality'].every(k => typeof m[k] === 'string')
    && (m.unique === undefined || typeof m.unique === 'string')
    && (m.gender === 'male' || m.gender === 'female')
    && typeof m.maxHp === 'number' && Number.isFinite(m.maxHp) && m.maxHp >= 0)) return false;
  let lastSeq = -1;
  let lastDay = 0;
  for (const f of value.frames) {
    if (!object(f) || !natural(f.day) || f.day < 1 || f.day < lastDay
      || !natural(f.seq) || f.seq <= lastSeq || f.phase !== 'dungeon'
      || !(f.cell === null || natural(f.cell))
      || !FRAME_KINDS.has(f.kind as JourneyFrameKind)
      || ['text', 'actorId', 'actorName', 'targetId', 'targetName', 'logKind', 'battleEnemy'].some(k => f[k] !== undefined && typeof f[k] !== 'string')
      || (f.movement !== undefined && f.movement !== 'explore' && f.movement !== 'return')
      || (f.combatKind !== undefined && !['attack', 'heal', 'item', 'down', 'flee'].includes(f.combatKind as string))
      || (f.amount !== undefined && (typeof f.amount !== 'number' || !Number.isFinite(f.amount) || f.amount < 0))
      || ['hp', 'hpDelta'].some(k => f[k] !== undefined && !hpValues(f[k]))
      || ['visitedDelta', 'hiddenFoundDelta'].some(k => f[k] !== undefined && !numbers(f[k]))) return false;
    lastSeq = f.seq;
    lastDay = f.day;
  }
  return (value.finalCell === undefined || natural(value.finalCell))
    && (value.end === undefined || ['done', 'mapFull', 'retreat', 'wipe'].includes(value.end as string));
}

export interface JourneyRecorderOptions {
  dungeon: string;
  floor: string;
  startDay: number;
  outDays: number;
  leaderId: string;
  members: Adventurer[];
  initialVisited: number[];
  initialHiddenFound: number[];
  initialKeys?: string[];
}

export interface JourneyFrameOptions {
  day: number;
  cell: number | null;
  kind: JourneyFrameKind;
  movement?: 'explore' | 'return';
  text?: string;
  logKind?: LogKind;
  actorId?: string;
  targetId?: string;
  combatKind?: CombatObservation['kind'];
  actorName?: string;
  targetName?: string;
  amount?: number;
  hp?: Record<string, number>;
  visitedDelta?: number[];
  hiddenFoundDelta?: number[];
}

export interface JourneyRecorder {
  readonly record: JourneyRecord;
  frame(options: JourneyFrameOptions): JourneyFrame;
  log(day: number, cell: number | null, kind: LogKind, text: string, hp: Record<string, number>): JourneyFrame;
  move(day: number, cell: number, hp: Record<string, number>, visitedDelta?: number[], movement?: 'explore' | 'return'): JourneyFrame;
  event(day: number, cell: number, kind: JourneyFrameKind, hp: Record<string, number>, options?: Pick<JourneyFrameOptions, 'visitedDelta' | 'hiddenFoundDelta'>): JourneyFrame;
  combat(day: number, cell: number, action: CombatObservation, hp: Record<string, number>): JourneyFrame;
  finish(day: number, cell: number, end: NonNullable<JourneyRecord['end']>, hp: Record<string, number>): JourneyFrame;
}

const cloneRecord = (record: JourneyRecord): JourneyRecord => ({
  ...record,
  members: record.members.map((m) => ({ ...m })),
  initialVisited: [...record.initialVisited],
  initialHiddenFound: [...record.initialHiddenFound],
  initialKeys: [...(record.initialKeys ?? [])],
  frames: record.frames.map((f) => ({
    ...f,
    hp: f.hp ? { ...f.hp } : undefined,
    hpDelta: f.hpDelta ? { ...f.hpDelta } : undefined,
    visitedDelta: f.visitedDelta ? [...f.visitedDelta] : undefined,
    hiddenFoundDelta: f.hiddenFoundDelta ? [...f.hiddenFoundDelta] : undefined,
  })),
});

const hpDiff = (before: Record<string, number>, after: Record<string, number>): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [id, hp] of Object.entries(after)) if (before[id] !== hp) out[id] = hp;
  return out;
};

const makeMembers = (members: Adventurer[], maxHp: Record<string, number>) => members.map((m) => ({
  id: m.id,
  name: m.name,
  ...(m.unique ? { unique: m.unique } : {}),
  personality: m.personality,
  gender: m.gender,
  appearance: m.appearance,
  maxHp: maxHp[m.id] ?? 0,
}));

/** 探索中のコールバックから、再生可能な順序付き記録を作る。乱数や結果計算には触れない。 */
export function createJourneyRecorder(options: JourneyRecorderOptions, maxHp: Record<string, number>): JourneyRecorder {
  const record: JourneyRecord = {
    version: 1,
    dungeon: options.dungeon,
    floor: options.floor,
    startDay: options.startDay,
    outDays: options.outDays,
    leaderId: options.leaderId,
    members: makeMembers(options.members, maxHp),
    initialVisited: [...new Set(options.initialVisited)].sort((a, b) => a - b),
    initialHiddenFound: [...new Set(options.initialHiddenFound)].sort((a, b) => a - b),
    initialKeys: [...new Set(options.initialKeys ?? [])],
    frames: [],
  };
  let seq = 0;
  let previousHp: Record<string, number> | null = null;

  const frame = (options: JourneyFrameOptions): JourneyFrame => {
    const f: JourneyFrame = {
      day: options.day,
      seq: seq++,
      phase: 'dungeon',
      cell: options.cell,
      kind: options.kind,
      ...(options.movement === undefined ? {} : { movement: options.movement }),
      ...(options.text === undefined ? {} : { text: options.text }),
      ...(options.logKind === undefined ? {} : { logKind: options.logKind }),
      ...(options.actorId === undefined ? {} : { actorId: options.actorId }),
      ...(options.targetId === undefined ? {} : { targetId: options.targetId }),
      ...(options.combatKind === undefined ? {} : { combatKind: options.combatKind }),
      ...(options.actorName === undefined ? {} : { actorName: options.actorName }),
      ...(options.targetName === undefined ? {} : { targetName: options.targetName }),
      ...(options.amount === undefined ? {} : { amount: options.amount }),
      ...(options.visitedDelta?.length ? { visitedDelta: [...new Set(options.visitedDelta)] } : {}),
      ...(options.hiddenFoundDelta?.length ? { hiddenFoundDelta: [...new Set(options.hiddenFoundDelta)] } : {}),
    };
    if (options.hp) {
      const snapshot = { ...options.hp };
      if (previousHp === null) f.hp = snapshot;
      else {
        const delta = hpDiff(previousHp, snapshot);
        if (Object.keys(delta).length) f.hpDelta = delta;
      }
      previousHp = snapshot;
    }
    record.frames.push(f);
    return f;
  };

  return {
    record,
    frame,
    log: (day, cell, kind, text, hp) => frame({ day, cell, kind: 'event', text, logKind: kind, hp }),
    move: (day, cell, hp, visitedDelta = [], movement = 'explore') => frame({ day, cell, kind: 'move', hp, visitedDelta, movement }),
    event: (day, cell, kind, hp, extra = {}) => frame({ day, cell, kind, hp, ...extra }),
    combat: (day, cell, action, hp) => frame({
      day,
      cell,
      kind: 'combat_action',
      actorId: action.actorId,
      targetId: action.targetId,
      combatKind: action.kind,
      actorName: action.actorName,
      targetName: action.targetName,
      amount: action.amount,
      hp,
    }),
    finish: (day, cell, end, hp) => {
      record.end = end;
      record.finalCell = cell;
      return frame({ day, cell, kind: 'end', hp });
    },
  };
}

/** 絶対日までの記録だけを複製して返す。未来のマスや隠し通路を開示しない。 */
export function journeyUntil(record: JourneyRecord | undefined, absoluteDay: number): JourneyRecord | undefined {
  if (!record) return undefined;
  const frames = record.frames.filter((f) => record.startDay + f.day - 1 <= absoluteDay);
  const out: JourneyRecord = cloneRecord({ ...record, frames });
  const hasEnd = frames.some((f) => f.kind === 'end');
  if (!hasEnd) {
    delete out.end;
    delete out.finalCell;
  }
  return out;
}

export interface JourneyPlaybackState {
  frames: JourneyFrame[];
  visited: number[];
  hiddenFound: number[];
  hp: Record<string, number>;
  cell: number | null;
}

/** 再生開始時の地図・HPを、履歴の先頭から復元する。表示側は当日のフレームだけを差分再生できる。 */
export function journeyStateAt(record: JourneyRecord | undefined, absoluteDay: number): JourneyPlaybackState | undefined {
  const visible = journeyUntil(record, absoluteDay);
  if (!visible) return undefined;
  const visited = new Set(visible.initialVisited);
  const hiddenFound = new Set(visible.initialHiddenFound);
  const hp: Record<string, number> = {};
  let cell: number | null = null;
  for (const frame of visible.frames) {
    for (const value of frame.visitedDelta ?? []) visited.add(value);
    for (const value of frame.hiddenFoundDelta ?? []) hiddenFound.add(value);
    if (frame.hp) Object.assign(hp, frame.hp);
    if (frame.hpDelta) Object.assign(hp, frame.hpDelta);
    if (frame.cell !== null) cell = frame.cell;
  }
  return { frames: visible.frames, visited: [...visited].sort((a, b) => a - b), hiddenFound: [...hiddenFound].sort((a, b) => a - b), hp, cell };
}

/** 派遣中は前日まで、履歴は帰還日までを再生可能範囲として返す。 */
export function playableJourney(expedition: Pick<Expedition, 'journey' | 'startDay' | 'returnDay' | 'claimed'>, currentDay: number): JourneyRecord | undefined {
  const maxDay = expedition.claimed ? expedition.returnDay : Math.min(expedition.returnDay, currentDay - 1);
  return journeyUntil(expedition.journey, maxDay);
}
