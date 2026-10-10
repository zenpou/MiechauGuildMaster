import { describe, expect, it } from 'vitest';
import { endingPages, endingPending, markEndingSeen, onDragonDefeated } from '../src/core/ending';
import { newGame } from '../src/core/game';

describe('竜の討伐', () => {
  it('討伐済み・クリア日・竜鱗の解放・お知らせを記録する', () => {
    const s = newGame(1);
    s.day = 42;
    const notices: string[] = [];
    onDragonDefeated(s, notices);
    expect(s.dragonDefeated).toBe(true);
    expect(s.flags.clearDay).toBe(42);
    expect(s.flags['unlock:dragon_slain']).toBe(true);
    expect(notices).toHaveLength(1);
  });

  it('二度目は何も変えない', () => {
    const s = newGame(1);
    s.day = 42;
    const notices: string[] = [];
    onDragonDefeated(s, notices);
    s.day = 60;
    onDragonDefeated(s, notices);
    expect(s.flags.clearDay).toBe(42);
    expect(notices).toHaveLength(1);
  });

  it('決定論: 同じ状態からは同じ結果', () => {
    const run = () => {
      const s = newGame(7);
      s.day = 30;
      const notices: string[] = [];
      onDragonDefeated(s, notices);
      return { flags: s.flags, notices };
    };
    expect(run()).toEqual(run());
  });
});

describe('エンディング', () => {
  it('討伐前は出ない', () => {
    const s = newGame(1);
    expect(endingPending(s)).toBe(false);
  });

  it('討伐後、読むまでの間だけ出る', () => {
    const s = newGame(1);
    onDragonDefeated(s, []);
    expect(endingPending(s)).toBe(true);
    markEndingSeen(s);
    expect(s.flags['ending:seen']).toBeTruthy();
    expect(endingPending(s)).toBe(false);
    onDragonDefeated(s, []);
    expect(endingPending(s)).toBe(false);
  });

  it('文は3ページ', () => {
    const pages = endingPages();
    expect(pages).toHaveLength(3);
    for (const p of pages) expect(p.length).toBeGreaterThan(0);
  });

  it('返したページを書き換えても次の呼び出しに響かない', () => {
    endingPages().pop();
    expect(endingPages()).toHaveLength(3);
  });
});
