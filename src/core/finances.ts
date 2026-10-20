// 日送りの支払いと、将来の資金見通し。ここは GameState を読むだけにして、
// 実際の課金は game.ts がこの計算結果を台帳へ適用する。
import { completeConstructions, facilityUpkeep } from './base';
import { TUNING } from './data';
import { emptyState } from './state';
import type { GameState } from './types';

/** 画面から指定できる見通し期間の上限。日送りの派遣日数上限とは別にする。 */
export const FINANCE_FORECAST_MAX_DAYS = 365;

export interface DailyExpenses {
  wages: number;
  guild: number;
  facilities: number;
  /** 利息を含まない、その日の支払い合計。 */
  total: number;
}

export interface DayCashFlow extends DailyExpenses {
  support: number;
  interest: number;
  /** 支援を加え、利息前の支払いと利息を引いた翌朝の残高。 */
  afterCharges: number;
}

export interface FinanceForecastRow extends DayCashFlow {
  /** 支払い後に迎える翌朝の日付。 */
  day: number;
}

export interface FinanceForecast {
  rows: FinanceForecastRow[];
  /** その日の支払いを終えた時点で初めて赤字になる翌朝の日付。 */
  firstDebtDay: number | null;
  closingGold: number;
  totalCost: number;
  totalInterest: number;
  totalSupport: number;
  /** 利息を考えず、期間中の支払いを赤字にしないための開始時現金。 */
  requiredReserve: number;
  /** 現在の残高に追加すれば、支援金を含めて各朝の支払いを賄える金額。 */
  additionalReserve: number;
}

function supportForDay(day: number): number {
  return day <= TUNING.game.supportDays ? TUNING.game.supportGold : 0;
}

/** 現在の名簿と完成済み施設から、その日の固定支出を求める。 */
export function dailyExpenses(s: GameState): DailyExpenses {
  const wages = s.adventurers.reduce((total, adventurer) => total + adventurer.salary, 0);
  const guild = TUNING.game.upkeepPerDay;
  const facilities = facilityUpkeep(s);
  return { wages, guild, facilities, total: wages + guild + facilities };
}

/** 現在の資金を起点に、日送り1回分の純粋な入出金を求める。 */
export function dayCashFlow(s: GameState): DayCashFlow {
  const expenses = dailyExpenses(s);
  const support = supportForDay(s.day);
  const beforeInterest = s.gold + support - expenses.total;
  const interest = beforeInterest < 0 ? Math.ceil(-beforeInterest * TUNING.game.debtInterest) : 0;
  return { ...expenses, support, interest, afterCharges: beforeInterest - interest };
}

function validateDays(days: number): void {
  if (!Number.isInteger(days) || days < 0 || days > FINANCE_FORECAST_MAX_DAYS) {
    throw new RangeError(`資金見通しの日数は0〜${FINANCE_FORECAST_MAX_DAYS}の整数で指定してください`);
  }
}

/**
 * 固定支出だけを先へ延ばした見通し。売買・依頼報酬・遠征結果・加入や辞職は考慮しない。
 * 工事は、日送りで日付が進んだ直後に完成する現行順序を clone 上で再現する。
 */
export function forecastFinances(s: GameState, days: number): FinanceForecast {
  validateDays(days);
  const rows: FinanceForecastRow[] = [];
  if (days === 0) {
    return {
      rows, firstDebtDay: null, closingGold: s.gold,
      totalCost: 0, totalInterest: 0, totalSupport: 0, requiredReserve: 0, additionalReserve: 0,
    };
  }

  // 見通しは支払いに必要な最小状態だけを使う。全 GameState を clone すると、
  // 遠征の行程・結果や履歴まで複製するうえ、そこに依存する契約になってしまう。
  // 名簿は salary を読むだけ、拠点は工事を進めるために clone する。
  const future = emptyState(0);
  future.day = s.day;
  future.gold = s.gold;
  future.adventurers = s.adventurers;
  future.base = structuredClone(s.base);
  let requiredReserve = 0;
  let additionalReserve = 0;
  let cumulative = 0;
  let firstDebtDay: number | null = null;
  let totalCost = 0;
  let totalInterest = 0;
  let totalSupport = 0;

  for (let i = 0; i < days; i++) {
    const flow = dayCashFlow(future);
    const day = future.day + 1;
    rows.push({ day, ...flow });
    totalCost += flow.total;
    totalInterest += flow.interest;
    totalSupport += flow.support;
    cumulative += flow.total - flow.support;
    requiredReserve = Math.max(requiredReserve, cumulative);
    additionalReserve = Math.max(additionalReserve, cumulative - s.gold);
    if (firstDebtDay === null && flow.afterCharges < 0) firstDebtDay = day;

    future.gold = flow.afterCharges;
    future.day++;
    // advanceDay と同じく、支払い後に迎えた日付で工事を完成させる。
    completeConstructions(future, []);
  }

  return {
    rows,
    firstDebtDay,
    closingGold: rows[rows.length - 1].afterCharges,
    totalCost,
    totalInterest,
    totalSupport,
    requiredReserve: Math.max(0, requiredReserve),
    additionalReserve,
  };
}
