import { afterEach, describe, expect, it } from 'vitest';
import { bestJob, powerOf, salaryOf } from '../src/core/adventurer';
import { facilityUpkeep } from '../src/core/base';
import { FACILITY, TUNING } from '../src/core/data';
import { newGame, sellGold } from '../src/core/game';

// 経済の傾きは tuning で振る(scripts/dragon.ts の --set)。値を書き換えたテストは、必ず元に戻す
const orig = { wage: TUNING.growth.wageSlope, sell: TUNING.game.sellScale, upkeep: TUNING.game.facilityUpkeepScale };
afterEach(() => {
  TUNING.growth.wageSlope = orig.wage;
  TUNING.game.sellScale = orig.sell;
  TUNING.game.facilityUpkeepScale = orig.upkeep;
});

describe('経済の調整値', () => {
  it('日給の傾き(wageSlope)が戦力の高い人ほど効く', () => {
    const s = newGame(1);
    const a = s.adventurers[0];
    a.level = 12;
    const p = powerOf(a, bestJob(a), false);
    TUNING.growth.wageSlope = 0.6;
    const steep = salaryOf(a);
    TUNING.growth.wageSlope = 0.3;
    const gentle = salaryOf(a);
    expect(steep).toBe(Math.max(8, Math.round(10 + (p - 50) * 0.6 + (a.growth - 1) * 14)));
    expect(gentle).toBeLessThan(steep);
    expect(gentle).toBe(Math.max(8, Math.round(10 + (p - 50) * 0.3 + (a.growth - 1) * 14)));
  });

  it('素材の売却額に sellScale が掛かる', () => {
    const s = newGame(1);
    TUNING.game.sellScale = 1;
    const one = sellGold(s, 'fang', 10);
    TUNING.game.sellScale = 2;
    expect(sellGold(s, 'fang', 10)).toBe(one * 2);
  });

  it('施設の維持費に facilityUpkeepScale が掛かる', () => {
    const s = newGame(1);
    s.base.facilities.push({ id: 'workshop', level: 1, x: 0, y: 0, builtDay: 1, construction: null });
    s.base.facilities.push({ id: 'clinic', level: 1, x: 1, y: 0, builtDay: 1, construction: null });
    TUNING.game.facilityUpkeepScale = 1;
    expect(facilityUpkeep(s)).toBe(FACILITY.workshop.upkeep + FACILITY.clinic.upkeep);
    TUNING.game.facilityUpkeepScale = 0.5;
    expect(facilityUpkeep(s)).toBe(Math.round((FACILITY.workshop.upkeep + FACILITY.clinic.upkeep) * 0.5));
  });
});
