import { describe, expect, it } from 'vitest';
import { dismissHint, hintFor, hintsOff } from '../src/core/hints';
import { newGame } from '../src/core/game';
import type { GameState } from '../src/core/types';

// テストリスト
// - [x] 何もしていない新規開始 → 最初の派遣をすすめる
// - [x] 派遣中で、まだ1度も帰っていない → 次の日へをすすめる
// - [x] 1度帰還したが依頼を受けていない → 依頼をすすめる
// - [x] 依頼を受けたことがあれば、依頼のヒントは出ない
// - [x] 資金に余裕があり施設が無い → 施設をすすめる
// - [x] 赤字のあいだは赤字のヒント(消せない)
// - [x] 閉じたヒントは二度と出ない。次のヒントへ進む
// - [x] ヒントを全部切れる
// - [x] 先のヒントの条件を満たしていても、順番は守る(前のヒントが閉じるまで次は出ない)

const fresh = () => newGame(1);
const sent = (s: GameState) => { s.counters.dispatches = 1; return s; };
const returned = (s: GameState) => { s.history.push({} as GameState['history'][number]); return sent(s); };

describe('hintFor', () => {
  it('何もしていない新規開始では、最初の派遣をすすめる', () => {
    expect(hintFor(fresh())?.id).toBe('first-dispatch');
    expect(hintFor(fresh())?.text).toContain('派遣');
  });

  it('派遣中でまだ帰っていなければ、次の日へをすすめる', () => {
    const s = sent(fresh());
    s.expeditions.push({} as GameState['expeditions'][number]);
    expect(hintFor(s)?.id).toBe('advance-day');
  });

  it('1度帰還したが依頼を受けていなければ、依頼をすすめる', () => {
    const s = returned(fresh());
    s.quests = [];
    expect(hintFor(s)?.id).toBe('quests');
  });

  it('依頼を受けたことがあれば、依頼のヒントは出ない', () => {
    const s = returned(fresh());
    s.quests = [{ status: 'accepted' } as GameState['quests'][number]];
    expect(hintFor(s)?.id).not.toBe('quests');
  });

  it('資金に余裕があり施設が無ければ、施設をすすめる', () => {
    const s = returned(fresh());
    s.quests = [{ status: 'done' } as GameState['quests'][number]];
    s.gold = 1000;
    s.base.facilities = [];
    expect(hintFor(s)?.id).toBe('facility');
    s.gold = 50;
    expect(hintFor(s)).toBeNull();
  });

  it('赤字のあいだは赤字のヒントが最優先で、閉じられない', () => {
    const s = fresh();
    s.gold = -100;
    expect(hintFor(s)?.id).toBe('debt');
    dismissHint(s, 'debt');
    expect(hintFor(s)?.id).toBe('debt');
  });

  it('閉じたヒントは二度と出ず、次のヒントへ進む', () => {
    const s = fresh();
    dismissHint(s, 'first-dispatch');
    expect(hintFor(s)?.id).not.toBe('first-dispatch');
  });

  it('ヒントを全部切れる', () => {
    const s = fresh();
    s.gold = -100;
    hintsOff(s);
    expect(hintFor(s)).toBeNull();
  });

  it('順番は守る: 前のヒントが閉じるまで、後のヒントは出ない', () => {
    const s = returned(fresh());
    s.quests = [];
    s.gold = 1000;
    s.base.facilities = [];
    expect(hintFor(s)?.id).toBe('quests');
    dismissHint(s, 'quests');
    expect(hintFor(s)?.id).toBe('facility');
  });
});
