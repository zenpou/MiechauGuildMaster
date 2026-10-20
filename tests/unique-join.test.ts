import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateAdventurer } from '../src/core/adventurer';
import { TUNING, UNIQUE, type UniqueDef } from '../src/core/data';
import { dispatch, newGame } from '../src/core/game';
import { applyResignations, checkMails } from '../src/core/mail';
import { arriveCandidates } from '../src/core/recruit';
import { rngFor } from '../src/core/rng';
import { migrate } from '../src/core/save';
import { STORY, markStorySeen, readDueStories, storyDue } from '../src/core/story';
import type { GameState } from '../src/core/types';
import { registerUnique } from './helpers';

const UNIQUE_T = TUNING.game;
const roundTrip = (s: GameState) => migrate(JSON.parse(JSON.stringify(s)))!;
const countUnique = (s: GameState, id: string) => s.adventurers.filter((a) => a.unique === id).length;

/** 台本の最初の章を読むと加入するユニーク。JSON には足さず、テストの間だけ定義に差し込む */
function storyFixture(id: string, join: UniqueDef['join']): UniqueDef {
  return { ...UNIQUE.tina, id, name: `テスト${id}`, appearance: id, join, chain: [], skill: { ...UNIQUE.tina.skill, id: `${id}_skill` } };
}

const FIXTURES = [
  storyFixture('test_story', { story: STORY[0].id }),
  storyFixture('test_later', { story: STORY[1].id }),
];

let unregister: (() => void)[] = [];
beforeEach(() => { unregister = FIXTURES.map(registerUnique); });
afterEach(() => { for (const u of unregister) u(); });

describe('初日の名簿', () => {
  it('初日の名簿は initial のユニーク(ティナ・セラ)2人だけ', () => {
    const s = newGame(1);
    expect(s.adventurers).toHaveLength(2);
    expect(s.adventurers.map((a) => a.unique)).toEqual(['tina', 'sera']);
    const [t, sera] = s.adventurers;
    expect(t).toMatchObject({ unique: 'tina', appearance: 'tina', history: { hiredDay: 1 } });
    expect(sera).toMatchObject({ unique: 'sera', appearance: 'sera', history: { hiredDay: 1 } });
    expect(s.flags['unique:tina']).toBe(true);
    expect(s.flags['unique:tina:hired']).toBe(1);
    expect(s.flags['unique:sera']).toBe(true);
    expect(s.flags['unique:sera:hired']).toBe(1);
  });

  it('初日の名簿の者には挨拶メールを出し直さない', () => {
    const s = newGame(1);
    expect(s.flags[`greeted:${s.adventurers[0].id}`]).toBeTruthy();
  });
});

describe('章の読了で加入', () => {
  it('story の章を読み終えると、そのユニークが雇用費なしで名簿に入り、お知らせが出る', () => {
    const s = newGame(1);
    const gold = s.gold;
    markStorySeen(s, STORY[0].id, s.day);
    const u = s.adventurers.find((a) => a.unique === 'test_story');
    expect(u).toBeDefined();
    expect(u!.history.hiredDay).toBe(s.day);
    expect(s.gold).toBe(gold);
    expect(s.flags['unique:test_story']).toBe(true);
    expect(s.flags['unique:test_story:hired']).toBe(s.day);
    expect(s.notices.some((n) => n.text.includes('テストtest_story') && n.text.includes('加入'))).toBe(true);
    expect(countUnique(s, 'test_later')).toBe(0);
  });

  it('宿舎の定員を超えていても加入する', () => {
    const s = newGame(1);
    for (let i = 0; i < 20; i++) s.adventurers.push({ ...s.adventurers[0], id: `x${i}`, unique: undefined });
    markStorySeen(s, STORY[0].id, s.day);
    expect(countUnique(s, 'test_story')).toBe(1);
  });

  it('同じ章を二度既読にしても二人目は入らない', () => {
    const s = newGame(1);
    markStorySeen(s, STORY[0].id, s.day);
    delete s.flags[`story:${STORY[0].id}`];
    markStorySeen(s, STORY[0].id, s.day);
    expect(countUnique(s, 'test_story')).toBe(1);
  });

  it('候補一覧にいた同じユニークは、名簿に入ったら候補から消える', () => {
    const s = newGame(1);
    s.candidates.push({ adv: { ...s.adventurers[0], id: 'c1', unique: 'test_story' }, arrivedDay: 1, expiresDay: 9 });
    markStorySeen(s, STORY[0].id, s.day);
    expect(s.candidates.some((c) => c.adv.unique === 'test_story')).toBe(false);
  });
});

describe('readDueStories', () => {
  it('前章の読了で開く章も、出なくなるまで続けて既読にする', () => {
    const s = newGame(1);
    s.day = 2;
    expect(storyDue(s).map((c) => c.id)).toEqual(['prologue']);
    readDueStories(s);
    expect(storyDue(s)).toHaveLength(0);
    expect(s.flags['story:prologue']).toBe(2);
    expect(s.flags['story:ch1']).toBe(2);
    expect(s.flags['story:ch2']).toBeUndefined();
  });
});

describe('arriveCandidates とユニーク', () => {
  it('initial・story のユニークは条件をいくら満たしても候補に出ない', () => {
    const s = newGame(1);
    s.day = 999;
    s.rep = 99999;
    s.candidates = [];
    for (let i = 0; i < 5; i++) arriveCandidates(s, rngFor(1, 'test-arrive', i));
    expect(s.candidates.some((c) => c.adv.unique)).toBe(false);
  });

  it('minDay・minRep のユニークは今までどおり候補に出る', () => {
    const unregisterBoard = registerUnique(storyFixture('test_board', { minDay: 1, minRep: 0 }));
    try {
      const s = newGame(1);
      s.candidates = [];
      s.day = UNIQUE_T.candidateFromDay;
      arriveCandidates(s, rngFor(1, 'test-arrive', 0));
      expect(s.candidates.some((c) => c.adv.unique === 'test_board')).toBe(true);
    } finally {
      unregisterBoard();
    }
  });
});

describe('古いセーブの読み込み', () => {
  /** 汎用4人で始めた、ユニーク導入前の状態 */
  function oldSave(): GameState {
    const s = newGame(1);
    s.adventurers = [];
    for (const k of Object.keys(s.flags)) if (k.startsWith('unique:')) delete s.flags[k];
    return s;
  }

  it('initial のユニークが名簿にいなければ足し、二度読んでも増えない', () => {
    const once = roundTrip(oldSave());
    expect(countUnique(once, 'tina')).toBe(1);
    expect(countUnique(once, 'sera')).toBe(1);
    expect(countUnique(roundTrip(once), 'tina')).toBe(1);
    expect(countUnique(roundTrip(once), 'sera')).toBe(1);
  });

  it('旧ティナだけのセーブを第一章既読で読み直しても、セラを重複加入させない', () => {
    const s = newGame(2);
    s.adventurers = s.adventurers.filter((a) => a.unique === 'tina');
    delete s.flags['unique:sera'];
    delete s.flags['unique:sera:hired'];
    s.flags['story:ch1'] = 2;
    const once = roundTrip(s);
    const twice = roundTrip(once);
    expect(countUnique(once, 'tina')).toBe(1);
    expect(countUnique(once, 'sera')).toBe(1);
    expect(countUnique(twice, 'tina')).toBe(1);
    expect(countUnique(twice, 'sera')).toBe(1);
  });

  it('既存セラのID・装備・成長・派遣中状態・遠征履歴を保持する', () => {
    const s = newGame(3);
    const sera = s.adventurers.find((a) => a.unique === 'sera')!;
    sera.id = 'legacy-sera';
    sera.level = 4;
    sera.exp = 37;
    sera.equipment.weapon = 'bone_dagger';
    const sent = dispatch(s, {
      partyIds: [sera.id], leaderId: sera.id, action: 'explore',
      target: { dungeon: 'forest_cave', floor: 'f1' }, policy: 'standard', days: 1, items: {},
    });
    expect(sent.ok).toBe(true);
    const before = structuredClone(s.adventurers.find((a) => a.unique === 'sera')!);
    const beforeExpeditions = structuredClone(s.expeditions);
    const loaded = roundTrip(s);
    const restored = loaded.adventurers.find((a) => a.unique === 'sera')!;
    expect(restored).toMatchObject({
      id: before.id, level: before.level, exp: before.exp, status: 'away',
      equipment: before.equipment, history: before.history,
    });
    expect(loaded.expeditions).toEqual(beforeExpeditions);
    expect(loaded.expeditions.every((e) => e.order.partyIds.includes('legacy-sera'))).toBe(true);
    expect(countUnique(loaded, 'sera')).toBe(1);
  });

  it('既読の章(読んだ日不明の 0 を含む)のユニークを補い、二度読んでも増えない', () => {
    const s = oldSave();
    s.flags[`story:${STORY[0].id}`] = 0;
    const once = roundTrip(s);
    expect(countUnique(once, 'test_story')).toBe(1);
    expect(countUnique(once, 'test_later')).toBe(0);
    expect(countUnique(roundTrip(once), 'test_story')).toBe(1);
  });

  it('物語導入前のセーブで過ぎた章を既読にしたら、その章のユニークも加入する', () => {
    const s = oldSave();
    s.day = 400;
    for (const k of Object.keys(s.flags)) if (k.startsWith('story:')) delete s.flags[k];
    const once = roundTrip(s);
    expect(countUnique(once, 'test_story')).toBe(1);
  });
});

describe('ユニークは退職しない', () => {
  it('忠誠が低くても、昇給を断り続けても、退職警告は届かない', () => {
    const s = newGame(1);
    const t = s.adventurers[0];
    t.loyalty = 0;
    t.history.raisesRefused = 5;
    const mails = checkMails(s, rngFor(1, 'mail', s.day), []);
    expect(mails.some((m) => m.kind === 'warning' && m.from === t.id)).toBe(false);
    expect(t.history.warnedDay).toBeNull();
  });

  it('汎用の冒険者は同じ条件で退職警告が届く', () => {
    const s = newGame(1);
    const g = generateAdventurer(rngFor(1, 'test-generic', 0), { id: 'g1' });
    g.loyalty = 0;
    s.adventurers = [g];
    const mails = checkMails(s, rngFor(1, 'mail', s.day), []);
    expect(mails.some((m) => m.kind === 'warning' && m.from === 'g1')).toBe(true);
  });

  it('古いセーブで警告済みになっていても、ユニークは去らない', () => {
    const s = newGame(1);
    const t = s.adventurers[0];
    t.history.warnedDay = 1;
    s.day = 100;
    applyResignations(s, []);
    expect(countUnique(s, 'tina')).toBe(1);
  });
});

describe('ユニークの解雇', () => {
  it('待機中でも解雇できない(RULES 3-4)', async () => {
    const { dismiss } = await import('../src/core/recruit');
    const s = newGame(1);
    const tina = s.adventurers.find((a) => a.unique === 'tina')!;
    expect(dismiss(s, tina.id)).toEqual({ ok: false, reason: 'ティナはギルドを離れません' });
    expect(countUnique(s, 'tina')).toBe(1);
  });
});
