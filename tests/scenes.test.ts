import { describe, expect, it } from 'vitest';
import { MISUNDERSTANDINGS } from '../src/core/data';
import { rngFor } from '../src/core/rng';
import { resolveScenes } from '../src/core/scenes';
import { emptyState } from '../src/core/state';

describe('勘違いイベント', () => {
  it('台詞は5件、すべて(仮)付き', () => {
    expect(MISUNDERSTANDINGS.map((m) => m.tag).sort()).toEqual(
      ['dispatch_safe_weak', 'facility_built', 'hire_talent', 'rep_milestone', 'return_first_success'],
    );
    for (const m of MISUNDERSTANDINGS) expect([...m.scene, m.thought].every((l) => l.includes('(仮)'))).toBe(true);
  });

  it('同じseed・同じタグなら同じ場面。1日1件、評判が増え、タグは空になる', () => {
    const run = () => {
      const s = emptyState(4);
      s.day = 9;
      s.pendingTags = ['hire_talent', 'facility_built', 'hire_talent'];
      const sc = resolveScenes(s, rngFor(s.seed, 'scenes', s.day));
      return { s, sc };
    };
    const a = run();
    const b = run();
    expect(a.sc).not.toBeNull();
    expect(a.sc).toEqual(b.sc);
    expect(a.s.scenes).toHaveLength(1);
    expect(a.s.scenes[0]).toEqual(a.sc);
    expect(a.s.rep).toBe(a.sc!.rep);
    expect(a.sc!.rep).toBeGreaterThanOrEqual(2);
    expect(a.sc!.rep).toBeLessThanOrEqual(5);
    expect(a.s.seenScenes).toEqual([a.sc!.id]);
    expect(a.s.pendingTags).toEqual([]);
  });

  it('見た勘違いは二度出ず、合うものが無ければ何も起きない', () => {
    const s = emptyState(4);
    s.pendingTags = ['hire_talent'];
    expect(resolveScenes(s, rngFor(1, 'a'))).not.toBeNull();
    s.pendingTags = ['hire_talent', 'no_such_tag'];
    expect(resolveScenes(s, rngFor(1, 'b'))).toBeNull();
    expect(s.scenes).toHaveLength(1);
    expect(s.pendingTags).toEqual([]);
  });

  it('新しい場面は先頭に入る', () => {
    const s = emptyState(4);
    s.pendingTags = ['hire_talent'];
    resolveScenes(s, rngFor(1, 'a'));
    s.pendingTags = ['facility_built'];
    const sc = resolveScenes(s, rngFor(1, 'b'));
    expect(s.scenes[0]).toEqual(sc);
    expect(s.scenes).toHaveLength(2);
  });
});
