import { describe, expect, it } from 'vitest';
import { advanceDay, dispatch, newGame } from '../src/core/game';
import { deserialize, serialize } from '../src/core/save';
import {
  acknowledgeTutorial, skipTutorial, tutorialDispatchReason, tutorialFeatureUnlocked, tutorialFor, tutorialTabUnlocked,
  type TutorialTab,
} from '../src/core/tutorial';
import type { DispatchOrder, GameState } from '../src/core/types';

const tabs: TutorialTab[] = ['home', 'inbox', 'quests', 'dispatch', 'world', 'recruit', 'base', 'map', 'log', 'records'];

function introOrder(s: GameState): DispatchOrder {
  const tina = s.adventurers.find((a) => a.unique === 'tina')!;
  const sera = s.adventurers.find((a) => a.unique === 'sera')!;
  return {
    partyIds: [tina.id, sera.id], leaderId: tina.id, action: 'explore',
    target: { dungeon: 'forest_cave', floor: 'f1' }, policy: 'standard', days: 7, items: {},
  };
}

function secondOrder(s: GameState): DispatchOrder {
  const tina = s.adventurers.find((a) => a.unique === 'tina')!;
  const sera = s.adventurers.find((a) => a.unique === 'sera')!;
  return {
    partyIds: [tina.id, sera.id], leaderId: tina.id, action: 'explore',
    target: { dungeon: 'forest_cave', floor: 'f1' }, policy: 'safe', days: 1, items: {},
  };
}

function waitForReturn(s: GameState): void {
  while (s.expeditions.length > 0) advanceDay(s);
}

describe('段階式チュートリアル', () => {
  it('新規開始は派遣から始まり、初回の導入条件だけを受け付ける', () => {
    const s = newGame(1);
    const intro = introOrder(s);
    expect(s.flags['tutorial:version']).toBe(1);
    expect(tutorialFor(s)).toMatchObject({ id: 'dispatch', target: 'dispatch', canAdvanceDay: false });
    expect(tutorialTabUnlocked(s, 'home')).toBe(true);
    expect(tutorialTabUnlocked(s, 'dispatch')).toBe(true);
    expect(tutorialTabUnlocked(s, 'map')).toBe(false);
    expect(tutorialFeatureUnlocked(s, 'preparation')).toBe(false);
    expect(tutorialDispatchReason(s, intro)).toBeNull();
    expect(tutorialDispatchReason(s, { ...intro, partyIds: [intro.partyIds[0]] })).toBeTruthy();
    expect(tutorialDispatchReason(s, { ...intro, target: { dungeon: 'old_mine', floor: 'f1' } })).toBeTruthy();
  });

  it('実際の初回帰還と確認操作で順番に進み、途中の早送りを拒否する', () => {
    const s = newGame(1);
    const first = dispatch(s, introOrder(s));
    expect(first.ok).toBe(true);
    expect(tutorialFor(s)).toMatchObject({ id: 'return', canAdvanceDay: true });
    expect(acknowledgeTutorial(s, 'report', 'home')).toEqual({ ok: false, reason: expect.any(String) });

    waitForReturn(s);
    expect(s.history).toHaveLength(1);
    expect(tutorialFor(s)).toMatchObject({ id: 'report', target: 'home', canAdvanceDay: false });
    expect(acknowledgeTutorial(s, 'report', 'dispatch')).toEqual({ ok: false, reason: expect.any(String) });
    expect(acknowledgeTutorial(s, 'report', 'home')).toEqual({ ok: true });
    expect(tutorialFor(s)?.id).toBe('map');
    expect(acknowledgeTutorial(s, 'quests', 'quests')).toEqual({ ok: false, reason: expect.any(String) });
    expect(acknowledgeTutorial(s, 'map', 'map')).toEqual({ ok: true });
    expect(acknowledgeTutorial(s, 'map', 'map')).toEqual({ ok: false, reason: expect.any(String) });
    expect(acknowledgeTutorial(s, 'quests', 'quests')).toEqual({ ok: true });
    expect(tutorialFor(s)).toMatchObject({ id: 'second-dispatch', target: 'dispatch', canAdvanceDay: true });
    expect(tutorialFeatureUnlocked(s, 'preparation')).toBe(true);
    expect(tutorialFeatureUnlocked(s, 'planning')).toBe(false);
    expect(tutorialDispatchReason(s, { ...secondOrder(s), target: { dungeon: 'forest_cave', floor: 'f2' } })).toBeTruthy();
    expect(tutorialDispatchReason(s, { ...secondOrder(s), days: 3 })).toBeTruthy();
    expect(tutorialDispatchReason(s, { ...secondOrder(s), action: 'gather' })).toBeTruthy();
    expect(tutorialDispatchReason(s, { ...secondOrder(s), policy: 'standard', items: { potion: 1 } })).toBeNull();
    expect(tutorialDispatchReason(s, secondOrder(s))).toBeNull();
  });

  it('2回目の実派遣・帰還後も確認順を守り、最後に完了する', () => {
    const s = newGame(2);
    dispatch(s, introOrder(s));
    waitForReturn(s);
    expect(acknowledgeTutorial(s, 'report', 'home')).toEqual({ ok: true });
    expect(acknowledgeTutorial(s, 'map', 'map')).toEqual({ ok: true });
    expect(acknowledgeTutorial(s, 'quests', 'quests')).toEqual({ ok: true });

    const second = dispatch(s, secondOrder(s));
    expect(second.ok).toBe(true);
    expect(tutorialFor(s)).toMatchObject({ id: 'second-return', canAdvanceDay: true });
    expect(acknowledgeTutorial(s, 'recruit', 'recruit')).toEqual({ ok: false, reason: expect.any(String) });
    waitForReturn(s);
    expect(s.history).toHaveLength(2);
    expect(tutorialFor(s)?.id).toBe('recruit');
    expect(acknowledgeTutorial(s, 'recruit', 'recruit')).toEqual({ ok: true });
    expect(tutorialFeatureUnlocked(s, 'planning')).toBe(true);
    expect(acknowledgeTutorial(s, 'facilities', 'base')).toEqual({ ok: true });
    expect(tutorialFor(s)?.id).toBe('overview');
    expect(tutorialFor(s)).toMatchObject({ target: 'world' });
    expect(tutorialTabUnlocked(s, 'world')).toBe(true);
    expect(tutorialTabUnlocked(s, 'records')).toBe(true);
    expect(acknowledgeTutorial(s, 'overview', 'world')).toEqual({ ok: true });
    expect(tutorialFor(s)).toBeNull();
    expect(tutorialFeatureUnlocked(s, 'travel')).toBe(true);
    expect(tutorialDispatchReason(s, { ...secondOrder(s), target: { dungeon: 'unknown', floor: 'f1' } })).toBeNull();
  });

  it('確認途中の保存を読み直して進行を保持する', () => {
    const s = newGame(3);
    dispatch(s, introOrder(s));
    waitForReturn(s);
    expect(acknowledgeTutorial(s, 'report', 'home')).toEqual({ ok: true });
    const loaded = deserialize(serialize(s));
    expect(loaded).not.toBeNull();
    expect(tutorialFor(loaded!)).toMatchObject({ id: 'map', target: 'map' });
    expect(loaded!.flags['tutorial:ack:report']).toBe(true);
    expect(tutorialTabUnlocked(loaded!, 'map')).toBe(true);
    expect(tutorialTabUnlocked(loaded!, 'quests')).toBe(false);
  });

  it('チュートリアル旗のない旧セーブは全機能を開き、skipはどの段階からでも完了する', () => {
    const old = newGame(4);
    delete old.flags['tutorial:version'];
    expect(tutorialFor(old)).toBeNull();
    expect(tabs.every((tab) => tutorialTabUnlocked(old, tab))).toBe(true);
    expect(tutorialFeatureUnlocked(old, 'preparation')).toBe(true);
    expect(tutorialFeatureUnlocked(old, 'planning')).toBe(true);
    expect(tutorialFeatureUnlocked(old, 'travel')).toBe(true);
    expect(tutorialDispatchReason(old, { ...introOrder(old), target: { dungeon: 'unknown' } })).toBeNull();

    const fresh = newGame(5);
    skipTutorial(fresh);
    expect(tutorialFor(fresh)).toBeNull();
    expect(tabs.every((tab) => tutorialTabUnlocked(fresh, tab))).toBe(true);
    expect(tutorialDispatchReason(fresh, { ...introOrder(fresh), target: { dungeon: 'unknown' } })).toBeNull();
  });
});
