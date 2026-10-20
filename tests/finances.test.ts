import { describe, expect, it } from 'vitest';
import { FACILITY, TUNING } from '../src/core/data';
import { advanceDay, dailyCost } from '../src/core/game';
import { dailyExpenses, dayCashFlow, FINANCE_FORECAST_MAX_DAYS, forecastFinances } from '../src/core/finances';
import type { GameState } from '../src/core/types';
import { fullGame } from './helpers';

function place(s: GameState, id: string, level: number, construction: GameState['base']['facilities'][number]['construction'] = null) {
  s.base.facilities.push({ id, level, x: s.base.facilities.length, y: 0, builtDay: s.day, construction });
}

describe('資金計算', () => {
  it('日々の固定支出と日送り1回の入出金を同じ値で計算する', () => {
    const s = fullGame(401);
    place(s, 'clinic', 1);
    s.gold = 1_000;
    const before = structuredClone(s);
    const expenses = dailyExpenses(s);
    const flow = dayCashFlow(s);

    expect(expenses).toEqual({
      wages: s.adventurers.reduce((total, a) => total + a.salary, 0),
      guild: TUNING.game.upkeepPerDay,
      facilities: Math.round(FACILITY.clinic.upkeep * TUNING.game.facilityUpkeepScale),
      total: expenses.wages + expenses.guild + expenses.facilities,
    });
    expect(flow.support).toBe(TUNING.game.supportGold);
    expect(flow.interest).toBe(0);
    expect(flow.afterCharges).toBe(s.gold + flow.support - flow.total);
    expect(dailyCost(s)).toBe(expenses.total);
    expect(s).toEqual(before);
  });

  it('forecastの翌朝残高は、支援境界と工事完成後の実日送りに一致する', () => {
    const s = fullGame(402);
    s.gold = 100_000;
    s.day = TUNING.game.supportDays;
    place(s, 'clinic', 0, { toLevel: 1, untilDay: s.day + 2 });
    const forecast = forecastFinances(s, 5);
    const actual = structuredClone(s);

    expect(forecast.rows.map((row) => row.day)).toEqual([
      TUNING.game.supportDays + 1,
      TUNING.game.supportDays + 2,
      TUNING.game.supportDays + 3,
      TUNING.game.supportDays + 4,
      TUNING.game.supportDays + 5,
    ]);
    expect(forecast.rows.slice(0, 2).map((row) => row.support)).toEqual([TUNING.game.supportGold, 0]);
    expect(forecast.rows.map((row) => row.facilities)).toEqual([0, 0, Math.round(FACILITY.clinic.upkeep * TUNING.game.facilityUpkeepScale), Math.round(FACILITY.clinic.upkeep * TUNING.game.facilityUpkeepScale), Math.round(FACILITY.clinic.upkeep * TUNING.game.facilityUpkeepScale)]);

    for (const row of forecast.rows) {
      const report = advanceDay(actual);
      expect(actual.day).toBe(row.day);
      expect(actual.gold).toBe(row.afterCharges);
      expect(report.day).toBe(row.day);
    }
    expect(forecast.closingGold).toBe(actual.gold);
  });

  it('ちょうど0では借金にならず、負なら利息を含む翌朝残高になる', () => {
    const exact = fullGame(403);
    const exactExpenses = dailyExpenses(exact);
    exact.gold = exactExpenses.total - TUNING.game.supportGold;
    const exactFlow = dayCashFlow(exact);
    expect(exactFlow.afterCharges).toBe(0);
    expect(exactFlow.interest).toBe(0);
    advanceDay(exact);
    expect(exact.gold).toBe(0);
    expect(exact.debt).toBe(false);

    const debt = fullGame(404);
    const debtExpenses = dailyExpenses(debt);
    debt.gold = debtExpenses.total - TUNING.game.supportGold - 1;
    const debtFlow = dayCashFlow(debt);
    expect(debtFlow.interest).toBe(Math.ceil(TUNING.game.debtInterest));
    expect(debtFlow.afterCharges).toBe(-1 - debtFlow.interest);
    advanceDay(debt);
    expect(debt.gold).toBe(debtFlow.afterCharges);
    expect(debt.debt).toBe(true);
  });

  it('requiredReserveは利息を除く累計支出の最大で、0日にも対応する', () => {
    const s = fullGame(405);
    s.day = TUNING.game.supportDays + 1;
    s.gold = 0;
    const forecast = forecastFinances(s, 3);
    let cumulative = 0;
    let reserve = 0;
    for (const row of forecast.rows) {
      cumulative += row.total - row.support;
      reserve = Math.max(reserve, cumulative);
    }
    expect(forecast.requiredReserve).toBe(reserve);
    expect(forecast.totalCost).toBe(forecast.rows.reduce((total, row) => total + row.total, 0));
    expect(forecast.totalInterest).toBe(forecast.rows.reduce((total, row) => total + row.interest, 0));
    expect(forecast.totalSupport).toBe(0);
    expect(forecastFinances(s, 0)).toEqual({
      rows: [], firstDebtDay: null, closingGold: s.gold,
      totalCost: 0, totalInterest: 0, totalSupport: 0, requiredReserve: 0, additionalReserve: 0,
    });
  });

  it('現在が赤字でも翌朝の支援金で賄える分を追加資金に数えない', () => {
    const s = fullGame(408);
    const netSupport = TUNING.game.supportGold - dailyExpenses(s).total;
    expect(netSupport).toBeGreaterThan(0);
    s.gold = -netSupport + 1;
    const recovered = forecastFinances(s, 1);
    expect(recovered.firstDebtDay).toBeNull();
    expect(recovered.additionalReserve).toBe(0);
    advanceDay(s);
    expect(s.gold).toBe(1);

    s.gold = -netSupport - 10;
    const shortfall = forecastFinances(s, 1);
    expect(shortfall.firstDebtDay).toBe(s.day + 1);
    expect(shortfall.additionalReserve).toBe(10);
    s.gold += shortfall.additionalReserve;
    advanceDay(s);
    expect(s.gold).toBe(0);
  });

  it('遠征結果・行程・履歴を参照せず、状態と乱数に関わる値を変更しない', () => {
    const s = fullGame(406);
    s.gold = 20_000;
    const before = {
      day: s.day,
      gold: s.gold,
      base: structuredClone(s.base),
      adventurers: structuredClone(s.adventurers),
      counters: structuredClone(s.counters),
    };
    const expected = forecastFinances(s, 7);
    Object.defineProperty(s, 'history', {
      configurable: true,
      get: () => { throw new Error('history must not be read'); },
    });
    Object.defineProperty(s, 'expeditions', {
      configurable: true,
      get: () => { throw new Error('expeditions must not be read'); },
    });
    expect(() => forecastFinances(s, 7)).not.toThrow();
    const actual = forecastFinances(s, 7);

    expect(actual).toEqual(expected);
    expect({ day: s.day, gold: s.gold, base: s.base, adventurers: s.adventurers, counters: s.counters }).toEqual(before);
  });

  it('日数の不正値を明示的に拒否する', () => {
    const s = fullGame(407);
    expect(() => forecastFinances(s, -1)).toThrow(RangeError);
    expect(() => forecastFinances(s, 1.5)).toThrow(RangeError);
    expect(() => forecastFinances(s, FINANCE_FORECAST_MAX_DAYS + 1)).toThrow(RangeError);
  });
});
