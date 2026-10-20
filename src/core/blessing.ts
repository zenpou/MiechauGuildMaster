// アイリスの祝福。第一章でセラとティナを癒した祈りを、出発する隊に掛ける加護として毎日使う。
// 魔力は日ごとに溜まり(上限あり)、隊が出ない日が続いて溜まりきると発熱して数日使えなくなる。
// 罰はそれだけ(金も評判も減らさない)。効き目は疲労の増え方を下げるだけで、乱数の引き方は変えない
import { TUNING } from './data';
import type { GameState } from './types';

const B = TUNING.blessing;
const UNLOCK_FLAG = 'story:ch1';

export function blessingUnlocked(s: GameState): boolean {
  const v = s.flags[UNLOCK_FLAG];
  return v !== undefined && v !== false;
}

export function canBless(s: GameState): boolean {
  return blessingUnlocked(s) && s.blessing.feverUntil === null && s.blessing.charges >= 1;
}

export interface BlessingStatus {
  unlocked: boolean;
  charges: number;
  max: number;
  fever: boolean;
  /** 発熱中なら熱が引くまでの日数、満杯なら発熱までの日数、それ以外は null */
  daysLeft: number | null;
}

/** 画面に出す状態(隠さない) */
export function blessingStatus(s: GameState): BlessingStatus {
  const b = s.blessing;
  const fever = b.feverUntil !== null;
  let daysLeft: number | null = null;
  if (fever) daysLeft = Math.max(0, b.feverUntil! - s.day);
  else if (b.fullSince !== null) daysLeft = Math.max(0, b.fullSince + B.feverAfterDays - s.day);
  return { unlocked: blessingUnlocked(s), charges: b.charges, max: B.max, fever, daysLeft };
}

/** 出発する隊に掛ける。残りを1減らし、満杯の数え直しをする。使えるかは canBless で先に見る */
export function useBlessing(s: GameState): void {
  s.blessing.charges = Math.max(0, s.blessing.charges - 1);
  s.blessing.fullSince = null;
}

/** 日送り(s.day を進めたあと)。解禁前は何もしない */
export function tickBlessing(s: GameState, notices: string[]): void {
  if (!blessingUnlocked(s)) return;
  const b = s.blessing;
  if (b.feverUntil !== null) {
    if (s.day < b.feverUntil) return;
    b.feverUntil = null;
    notices.push('アイリスの熱が引いた。祝福がまた使える。');
  }
  b.charges = Math.min(B.max, b.charges + 1);
  if (b.charges < B.max) {
    b.fullSince = null;
    return;
  }
  if (b.fullSince === null) {
    b.fullSince = s.day;
    return;
  }
  if (s.day - b.fullSince >= B.feverAfterDays) {
    b.feverUntil = s.day + B.feverDays;
    b.charges = 0;
    b.fullSince = null;
    notices.push(`アイリスが熱を出した。魔力が溜まりすぎている(あと${B.feverDays}日は祝福が使えない)。隊を出す朝に祝福で抜いてやろう。`);
  }
}
