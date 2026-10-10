import { describe, expect, it } from 'vitest';
import { effectiveStats } from '../src/core/adventurer';
import { FACILITY, TUNING } from '../src/core/data';
import { newGame } from '../src/core/game';
import { canTrain, completeTraining, trainDays, trainSkill, trainableSkills } from '../src/core/training';
import type { GameState } from '../src/core/types';

const T = TUNING.training;

function withTrainingYard(): GameState {
  const s = newGame(1);
  s.base.facilities.push({ id: 'training', level: 1, x: 0, y: 0, builtDay: 1, construction: null });
  s.gold = 10000;
  return s;
}

describe('スキル訓練', () => {
  it('訓練所が無いと訓練できない', () => {
    const s = newGame(1);
    const a = s.adventurers[0];
    expect(canTrain(s, a.id, 'tough').ok).toBe(false);
    expect(trainableSkills(s, a.id)).toEqual([]);
  });

  it('待機中の者だけが訓練できる', () => {
    const s = withTrainingYard();
    const a = s.adventurers[0];
    a.status = 'away';
    expect(canTrain(s, a.id, 'tough').ok).toBe(false);
  });

  it('日数と費用が掛かり、台帳に載り、訓練中になる', () => {
    const s = withTrainingYard();
    const a = s.adventurers[0];
    const gold = s.gold;
    expect(trainSkill(s, a.id, 'tough').ok).toBe(true);
    expect(s.gold).toBe(gold - T.gold);
    expect(s.ledger.some((l) => l.amount === -T.gold)).toBe(true);
    expect(a.status).toBe('training');
    expect(a.assignment).toEqual({ training: 'tough', untilDay: s.day + T.days });
    expect(T.days).toBe(3);
    expect(T.gold).toBe(150);
  });

  it('期日が来るとスキルが付き、能力が上がって待機に戻る', () => {
    const s = withTrainingYard();
    const a = s.adventurers[0];
    const before = effectiveStats(a).hp;
    trainSkill(s, a.id, 'tough');
    const notices: string[] = [];
    s.day += T.days - 1;
    completeTraining(s, notices);
    expect(a.skills).not.toContain('tough');
    s.day += 1;
    completeTraining(s, notices);
    expect(a.skills).toContain('tough');
    expect(a.status).toBe('idle');
    expect(a.assignment).toBeNull();
    expect(notices.length).toBe(1);
    expect(effectiveStats(a).hp).toBeGreaterThan(before);
  });

  it('1人2つまで', () => {
    const s = withTrainingYard();
    const a = s.adventurers[0];
    a.skills.push('tough', 'might');
    expect(canTrain(s, a.id, 'fleet').ok).toBe(false);
    expect(trainableSkills(s, a.id)).toEqual([]);
  });

  it('習得済みのスキルは訓練できない', () => {
    const s = withTrainingYard();
    const a = s.adventurers[0];
    a.skills.push('might');
    expect(canTrain(s, a.id, 'might').ok).toBe(false);
    expect(trainableSkills(s, a.id).map((d) => d.id)).not.toContain('might');
  });

  it('所持金が足りないと訓練できない', () => {
    const s = withTrainingYard();
    s.gold = T.gold - 1;
    expect(canTrain(s, s.adventurers[0].id, 'tough').ok).toBe(false);
  });
});

describe('図書室で訓練日数が縮む', () => {
  const library = (s: GameState, level: number, x: number) => {
    s.base.facilities.push({ id: 'library', level, x, y: 0, builtDay: 1, construction: null });
  };

  it('図書室 Lv1 は縮まず、Lv2 で−1日、訓練所と隣り合う(学び舎)とさらに−1日。訓練の期日に反映される', () => {
    const s = withTrainingYard();
    expect(trainDays(s)).toBe(T.days);
    library(s, 1, 2);
    expect(trainDays(s)).toBe(T.days);
    s.base.facilities[1].level = 2;
    expect(trainDays(s)).toBe(Math.max(1, T.days - 1));
    s.base.facilities[1].x = 1;
    expect(trainDays(s)).toBe(Math.max(1, T.days - 2));
    const a = s.adventurers[0];
    expect(trainSkill(s, a.id, 'tough')).toEqual({ ok: true });
    expect(a.assignment).toEqual({ training: 'tough', untilDay: s.day + Math.max(1, T.days - 2) });
  });

  it('1日より短くはならない', () => {
    const s = withTrainingYard();
    library(s, 2, 1);
    const eff = FACILITY.library.effects[1];
    const saved = eff.trainDaysOff;
    eff.trainDaysOff = 10;
    try {
      expect(trainDays(s)).toBe(1);
    } finally {
      eff.trainDaysOff = saved;
    }
  });
});
