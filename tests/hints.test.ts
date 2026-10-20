import { describe, expect, it } from 'vitest';
import { dismissHint, hintFor, hintsOff } from '../src/core/hints';
import { newGame } from '../src/core/game';
import { promotionOptions } from '../src/core/jobs';
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
// - [x] 昇格できる人(待機中・下級職・Lvが足りて訓練所と費用がある)がいれば、転職をすすめる
// - [x] 昇格に届いたが訓練所が無ければ、訓練所をすすめる
// - [x] Lvが足りない・待機中でない・上級職の人だけなら、昇格のヒントは出ない

const fresh = () => newGame(1);
const sent = (s: GameState) => { s.counters.dispatches = 1; return s; };
// 後続のヒントを調べる状態。初回帰還直後の編成案内は確認済みとする。
const returned = (s: GameState) => { s.history.push({} as GameState['history'][number]); s.flags['hint:second-party'] = true; return sent(s); };

describe('hintFor', () => {
  it('何もしていない新規開始では、最初の派遣をすすめる', () => {
    expect(hintFor(fresh())?.id).toBe('first-dispatch');
    expect(hintFor(fresh())?.text).toContain('派遣');
    expect(hintFor(fresh())?.text).toContain('ティナさん');
    expect(hintFor(fresh())?.text).toContain('回復役のセラさん');
  });

  it('初回帰還後は既存の二人の準備を案内し、新規加入として説明しない', () => {
    const s = returned(fresh());
    delete s.flags['hint:second-party'];
    const hint = hintFor(s);
    expect(hint?.id).toBe('second-party');
    expect(hint?.text).toContain('ティナさんとセラさん');
    expect(hint?.text).toContain('回復薬');
    expect(hint?.text).not.toContain('加わりました');
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

describe('昇格のヒント', () => {
  /** 昇格の入口になる下級職の人を1人、必要なLvまで上げて返す */
  const ready = (s: GameState) => {
    const a = s.adventurers.find((x) => promotionOptions(x).length > 0)!;
    a.level = Math.min(...promotionOptions(a).map((o) => o.requireLevel ?? 0));
    return a;
  };
  const afterFirstReturn = (s: GameState) => {
    returned(s);
    s.quests = [{ status: 'done' } as GameState['quests'][number]];
    s.base.facilities = [];
    s.gold = 0;
    return s;
  };
  const withTraining = (s: GameState) => {
    s.base.facilities.push({ id: 'training', level: 1, x: 0, y: 0, builtDay: 1, construction: null });
    return s;
  };

  it('昇格できる人がいれば、転職をすすめる', () => {
    const s = withTraining(afterFirstReturn(fresh()));
    ready(s);
    s.gold = 5000;
    expect(hintFor(s)?.id).toBe('promote');
    expect(hintFor(s)?.text).toContain('転職');
  });

  it('昇格に届いたが訓練所が無ければ、訓練所をすすめる', () => {
    const s = afterFirstReturn(fresh());
    ready(s);
    s.gold = 5000;
    expect(hintFor(s)?.id).toBe('promote-need-training');
    expect(hintFor(s)?.text).toContain('訓練所');
  });

  it('Lvが足りない・待機中でない人しかいなければ、昇格のヒントは出ない', () => {
    const s = withTraining(afterFirstReturn(fresh()));
    s.gold = 5000;
    expect(hintFor(s)?.id).not.toBe('promote');
    const a = ready(s);
    a.status = 'away';
    expect(hintFor(s)?.id).not.toBe('promote');
  });

  it('閉じると二度と出ず、次のヒントへ進む', () => {
    const s = afterFirstReturn(fresh());
    ready(s);
    s.gold = 5000;
    dismissHint(s, 'promote-need-training');
    expect(hintFor(s)?.id).toBe('facility');
  });
});
