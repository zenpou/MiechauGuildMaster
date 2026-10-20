import { describe, expect, it } from 'vitest';
import { effectiveStats } from '../src/core/adventurer';
import { LOWER_JOBS, UNIQUE } from '../src/core/data';
import { equip, unequip } from '../src/core/equipment';
import { advanceDay, dispatch, newGame } from '../src/core/game';
import { changeJob } from '../src/core/jobs';
import { deserialize, migrate, serialize } from '../src/core/save';
import { markStorySeen, storyDue } from '../src/core/story';
import { SAVE_VERSION, type Adventurer, type GameState } from '../src/core/types';
import { fullGame } from './helpers';

const clone = (s: GameState) => JSON.parse(JSON.stringify(s));

/** フェーズ4以前のセーブ: 冒険者に skills / persona / equipment / assignment と history の後付け項目が無い */
function oldSave() {
  const old = clone(fullGame(5));
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
      // 旧fixtureに無かった初期セラは、移行時に定義どおり加入するため固有スキルを持つ。
      const seraAddedByMigration = a.unique === 'sera';
      expect(a.skills).toEqual(seraAddedByMigration ? ['sera_skill'] : []);
      expect(a.persona).toEqual(seraAddedByMigration ? UNIQUE.sera.persona : { hobby: '', talent: '', likes: '', dislikes: '' });
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
    // 章は鎖なので、読む前は序章しか出ない。読み込みでは鎖をたどって過ぎた章を全部既読にする
    expect(storyDue(old).map((c) => c.id)).toEqual(['prologue']);
    const s = migrate(old)!;
    expect(storyDue(s).filter(c => !c.id.startsWith('loyalty:'))).toEqual([]);
    expect(storyFlags(s)).toEqual(['story:prologue', 'story:ch1', 'story:ch2']);
    // 読んでいない章に「読んだ日」を付けない。0 は「読んだ日は不明の既読」
    for (const k of storyFlags(s)) expect(s.flags[k], k).toBe(0);
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
    expect(storyDue(s).map((c) => c.id)).toEqual(['ch1']);
  });
});

describe('セーブの書き出しと読み込み(deserialize / serialize)', () => {
  it('書き出した文字列を読み込むと、同じ状態に戻る', () => {
    const s = newGame(7);
    // 画面は序章を読み終えてから日を送れる。読み込みは、章の旗が無い途中のセーブだけ過ぎた章を既読にするので、旗を付けておく
    markStorySeen(s, 'prologue');
    for (let i = 0; i < 12; i++) advanceDay(s);
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('セーブでない JSON・壊れた文字列・空は null(上書きしない)', () => {
    for (const bad of ['', 'not json', '{}', '[]', 'null', '{"seed": "x", "day": 1}', '{"seed": 1}', '123']) {
      expect(deserialize(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('性別と外見(版1 → 版2)', () => {
  /** 版1のセーブ: 冒険者に gender / appearance が無く、名簿は汎用の者だけ */
  function v1Save() {
    const s = fullGame(5);
    s.adventurers = s.adventurers.filter((a) => !a.unique);
    const old = clone(s);
    old.version = 1;
    for (const a of [...old.adventurers, ...old.candidates.map((c: { adv: unknown }) => c.adv)] as Record<string, any>[]) {
      delete a.gender;
      delete a.appearance;
    }
    return old;
  }
  const everyone = (s: GameState): Adventurer[] => [...s.adventurers, ...s.candidates.map((c) => c.adv)];
  const looks = (s: GameState) => everyone(s).map((a) => [a.id, a.gender, a.appearance]);

  it('版1のセーブを読むと、名簿と応募者の全員に性別と外見が入り、版が2になる', () => {
    const s = migrate(v1Save())!;
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(2);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.candidates.length).toBeGreaterThan(0);
    for (const a of everyone(s).filter((x) => !x.unique)) {
      expect(['male', 'female']).toContain(a.gender);
      expect(a.appearance).toBe(`adv_${a.personality}_${a.gender}`);
    }
    expect(s.adventurers.find((a) => a.unique === 'tina')).toMatchObject({ gender: 'female', appearance: 'tina' });
  });

  it('同じ古いセーブを何度読んでも同じ性別と外見になる', () => {
    expect(looks(migrate(v1Save())!)).toEqual(looks(migrate(v1Save())!));
  });

  it('補完した値は書き出して読み直しても変わらない', () => {
    const s = migrate(v1Save())!;
    expect(looks(deserialize(serialize(s))!)).toEqual(looks(s));
  });

  it('すでに性別と外見がある冒険者は上書きしない', () => {
    const src = v1Save();
    src.adventurers[0].gender = 'female';
    src.adventurers[0].appearance = 'custom_look';
    src.candidates[0].adv.gender = 'male';
    src.candidates[0].adv.appearance = 'other_look';
    const s = migrate(src)!;
    expect([s.adventurers[0].gender, s.adventurers[0].appearance]).toEqual(['female', 'custom_look']);
    expect([s.candidates[0].adv.gender, s.candidates[0].adv.appearance]).toEqual(['male', 'other_look']);
  });

  it('ユニークの性別と外見は定義の値になる(hash で決めない)', () => {
    const src = v1Save();
    src.adventurers[0].unique = 'tina';
    const s = migrate(src)!;
    expect([s.adventurers[0].gender, s.adventurers[0].appearance]).toEqual(['female', 'tina']);
  });

  it('定義が見つからないユニークの外見は unique の値になる', () => {
    const src = v1Save();
    src.adventurers[0].unique = 'u_missing';
    const s = migrate(src)!;
    expect(s.adventurers[0].appearance).toBe('u_missing');
    expect(['male', 'female']).toContain(s.adventurers[0].gender);
  });

  it('転職・装備の付け外し・書き出しと読み直しの前後で、性別と外見は変わらない', () => {
    const s = newGame(5);
    markStorySeen(s, 'prologue');
    const a = s.adventurers[0];
    const before = [a.gender, a.appearance];
    const other = LOWER_JOBS.find((j) => j.id !== a.job)!.id;
    expect(changeJob(s, a.id, other)).toEqual({ ok: true });
    s.inventory.iron_sword = 1;
    expect(equip(s, a.id, 'iron_sword')).toEqual({ ok: true });
    expect(unequip(s, a.id, 'weapon')).toEqual({ ok: true });
    expect([a.gender, a.appearance]).toEqual(before);
    const back = deserialize(serialize(s))!.adventurers[0];
    expect([back.gender, back.appearance]).toEqual(before);
  });
});
