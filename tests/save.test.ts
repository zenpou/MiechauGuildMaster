import { describe, expect, it } from 'vitest';
import { effectiveStats } from '../src/core/adventurer';
import { advanceDay, dispatch, newGame } from '../src/core/game';
import { migrate } from '../src/core/save';
import { storyDue } from '../src/core/story';
import type { GameState } from '../src/core/types';

const clone = (s: GameState) => JSON.parse(JSON.stringify(s));

/** フェーズ4以前のセーブ: 冒険者に skills / persona / equipment / assignment と history の後付け項目が無い */
function oldSave() {
  const old = clone(newGame(5));
  for (const a of [...old.adventurers, ...old.candidates.map((c: { adv: unknown }) => c.adv)] as Record<string, any>[]) {
    delete a.skills;
    delete a.persona;
    delete a.equipment;
    delete a.assignment;
    delete a.history.visits;
    delete a.history.raisesRefused;
    delete a.history.warnedDay;
  }
  return old;
}

describe('古いセーブの読み込み(セーブ互換)', () => {
  it('冒険者の後から足した項目に既定値が入り、能力の計算も日送りも落ちない', () => {
    const s = migrate(oldSave())!;
    for (const a of s.adventurers) {
      expect(a.skills).toEqual([]);
      expect(a.persona).toEqual({ hobby: '', talent: '', likes: '', dislikes: '' });
      expect(a.equipment).toEqual({ weapon: null, armor: null, accessory: null });
      expect(a.assignment).toBeNull();
      expect(a.history.visits).toEqual({});
      expect(a.history.raisesRefused).toBe(0);
      expect(a.history.warnedDay).toBeNull();
      expect(() => effectiveStats(a)).not.toThrow();
    }
    expect(() => { for (let i = 0; i < 10; i++) advanceDay(s); }).not.toThrow();
  });

  it('応募者の冒険者にも同じ既定値が入る', () => {
    const s = migrate(oldSave())!;
    expect(s.candidates.length).toBeGreaterThan(0);
    for (const c of s.candidates) {
      expect(c.adv.skills).toEqual([]);
      expect(c.adv.equipment).toEqual({ weapon: null, armor: null, accessory: null });
      expect(c.adv.history.raisesRefused).toBe(0);
    }
  });

  it('すでにある値は上書きしない', () => {
    const src = oldSave();
    src.adventurers[0].skills = ['might'];
    src.adventurers[0].persona = { hobby: '釣り', talent: '', likes: '', dislikes: '' };
    const s = migrate(src)!;
    expect(s.adventurers[0].skills).toEqual(['might']);
    expect(s.adventurers[0].persona.hobby).toBe('釣り');
  });

  it('帰還済みの遠征に、後から足した結果の項目が無くても読める', () => {
    const s0 = newGame(6);
    const ids = s0.adventurers.map((a) => a.id);
    const r = dispatch(s0, { partyIds: ids, leaderId: ids[0], action: 'explore', target: { dungeon: 'forest_cave', floor: 'f1' }, policy: 'standard', days: 1, items: {} });
    expect(r.ok).toBe(true);
    for (let i = 0; i < 6 && s0.expeditions.length; i++) advanceDay(s0);
    const old = clone(s0);
    for (const e of old.history) {
      delete e.result.returnDialogue;
      delete e.result.maxDepth;
      delete e.result.daysSpent;
    }
    const s = migrate(old)!;
    expect(s.history.length).toBeGreaterThan(0);
    for (const e of s.history) {
      expect(e.result.returnDialogue).toEqual([]);
      expect(e.result.maxDepth).toBe(0);
      expect(e.result.daysSpent).toBe(e.returnDay - e.startDay);
    }
  });
});

describe('物語の導入前から遊んでいたセーブ', () => {
  const storyFlags = (s: GameState) => Object.keys(s.flags).filter((k) => k.startsWith('story:'));

  it('章の旗が1つも無く1日目を過ぎているセーブは、すでに過ぎた章を連続で出さない', () => {
    const old = clone(newGame(5));
    old.day = 60;
    old.dungeons.old_mine.confirmed = true;
    expect(storyDue(old).length).toBeGreaterThan(1);
    const s = migrate(old)!;
    expect(storyDue(s)).toEqual([]);
    expect(storyFlags(s).length).toBeGreaterThan(1);
  });

  it('1日目の新規セーブは序章がまだ出る', () => {
    const s = migrate(clone(newGame(5)))!;
    expect(storyDue(s).map((c) => c.id)).toEqual(['prologue']);
  });

  it('章の旗がすでにあるセーブには手を付けない(あとから足した章は出る)', () => {
    const old = clone(newGame(5));
    old.day = 60;
    old.flags['story:prologue'] = 1;
    old.dungeons.old_mine.confirmed = true;
    const s = migrate(old)!;
    expect(storyDue(s).map((c) => c.id)).toEqual(['ch2']);
  });
});
