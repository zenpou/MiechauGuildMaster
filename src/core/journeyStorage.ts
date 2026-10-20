import { isJourneyRecord } from './journey';
import type { JourneyFrame, JourneyRecord } from './types';

// 同じキーが数百フレーム繰り返されるので、保存時だけ短くする。実行中の型・計算・記録順は変えない。
const FIELDS = {
  day: 'd', cell: 'c', kind: 'k', movement: 'm', text: 't', logKind: 'l',
  actorId: 'a', actorName: 'n', targetId: 'b', targetName: 'o',
  combatKind: 'j', battleEnemy: 'z', amount: 'v', hp: 'h', hpDelta: 'u',
  visitedDelta: 'p', hiddenFoundDelta: 'f',
} as const;

export function packJourney(record: JourneyRecord): unknown {
  const { frames, ...header } = record;
  return {
    ...header, encoding: 'compact-1',
    frames: frames.map((frame, index) => {
      const out: Record<string, unknown> = {};
      if (frame.seq !== index) out.q = frame.seq;
      for (const [field, key] of Object.entries(FIELDS)) {
        const value = frame[field as keyof typeof FIELDS];
        if (value !== undefined) out[key] = value;
      }
      return out;
    }),
  };
}

/** 初期版の非圧縮記録も読み込む。破損した追加記録は無視し、本体は読めるようにする。 */
export function unpackJourney(raw: unknown): JourneyRecord | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (!('encoding' in raw)) return isJourneyRecord(raw) ? raw : undefined;
  const packed = raw as Record<string, unknown>;
  if (packed.encoding !== 'compact-1' || !Array.isArray(packed.frames)) return undefined;
  const frames: unknown[] = [];
  for (const [index, input] of packed.frames.entries()) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
    const short = input as Record<string, unknown>;
    const frame: Record<string, unknown> = { phase: 'dungeon', seq: short.q ?? index };
    for (const [field, key] of Object.entries(FIELDS)) {
      if (short[key] !== undefined) frame[field] = short[key];
    }
    frames.push(frame as unknown as JourneyFrame);
  }
  const { encoding: _encoding, ...header } = packed;
  const record = { ...header, frames };
  return isJourneyRecord(record) ? record : undefined;
}
