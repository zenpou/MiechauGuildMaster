import { describe, expect, it } from 'vitest';
import { DUNGEON, ITEM } from '../src/core/data';
import { newGame } from '../src/core/game';
import {
  ART, backgroundArt, CAST, characterArt, EFFECTS, MOTIONS, POSITIONS, SOUND_CUES, speakerCharacter, stillArt, TRANSITIONS,
} from '../src/core/presentation';
import { markStorySeen, STORY, storyDue, storySeen, storySeenDay, triggerMet } from '../src/core/story';
import type { StoryTrigger } from '../src/core/story';
import type { GameState } from '../src/core/types';
import { SOUND_PARTS } from '../src/ui/storyAudio';

function triggerProblems(t: unknown, where: string): string[] {
  if (typeof t !== 'object' || t === null || Array.isArray(t)) return [`${where}: trigger がオブジェクトでない`];
  const keys = Object.keys(t);
  if (keys.length !== 1) return [`${where}: trigger のキーが1つでない (${keys.join(',')})`];
  const [key] = keys;
  const v = (t as Record<string, unknown>)[key];
  switch (key) {
    case 'day':
    case 'questsDone':
      return Number.isInteger(v) && (v as number) >= 0 ? [] : [`${where}: ${key} が0以上の整数でない`];
    case 'flag':
      return typeof v === 'string' && v.length > 0 ? [] : [`${where}: flag が空`];
    case 'dungeonConfirmed':
      return typeof v === 'string' && DUNGEON[v] ? [] : [`${where}: 知らないダンジョン ${String(v)}`];
    case 'keyHeld':
      return typeof v === 'string' && ITEM[v]?.kind === 'key' ? [] : [`${where}: 鍵でないアイテム ${String(v)}`];
    case 'dragonDefeated':
    case 'endingSeen':
      return typeof v === 'boolean' ? [] : [`${where}: ${key} が真偽値でない`];
    case 'all':
      return Array.isArray(v) && v.length > 0
        ? v.flatMap((c, i) => triggerProblems(c, `${where}.all[${i}]`))
        : [`${where}: all が空`];
    default:
      return [`${where}: 語彙にないキー ${key}`];
  }
}

const ids = (chapters: { id: string }[]) => chapters.map((c) => c.id);
const lines = () => STORY.flatMap((c) => c.lines.map((l, i) => ({ at: `${c.id}[${i}]`, l })));

function confirmDungeon(s: GameState, id: string): void {
  s.dungeons[id].confirmed = true;
}

function finishQuests(s: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    s.quests.push({
      id: `test-done-${s.quests.length}`, templateId: null, type: 'deliver', town: null, name: '試しの依頼', desc: '',
      target: {}, rewardGold: 0, rewardRep: 0, postedDay: s.day, acceptBy: null, dueDay: null, departDay: null,
      status: 'done', progress: 0, unlocks: [],
    });
  }
}

describe('台本データ', () => {
  it('章の id が重複しない', () => {
    const all = ids(STORY);
    expect(new Set(all).size).toBe(all.length);
  });

  it('trigger は語彙の中で書かれ、実在するダンジョンと鍵だけを指す', () => {
    expect(STORY.flatMap((c) => triggerProblems(c.trigger, c.id))).toEqual([]);
  });

  it('どの章も本文のある行を持つ', () => {
    for (const c of STORY) {
      expect(c.lines.length).toBeGreaterThan(0);
      for (const l of c.lines) expect(l.text.length).toBeGreaterThan(0);
    }
  });

  it('台詞の話し手は cast.json の名前(地の文は話し手なし)', () => {
    const names = new Set(CAST.map((c) => c.name));
    expect(lines().filter(({ l }) => l.speaker !== undefined && !names.has(l.speaker)).map(({ at, l }) => `${at}: ${l.speaker}`)).toEqual([]);
  });

  it('立ち絵と顔の人物・ポーズは cast.json にある', () => {
    const poses = new Map(CAST.map((c) => [c.id, new Set(c.poses)]));
    const known = (a: { character: string; pose: string }) => poses.get(a.character)?.has(a.pose) === true;
    const bad = lines().flatMap(({ at, l }) => [...(l.cast ?? []), ...(l.portrait ? [l.portrait] : [])]
      .filter((a) => !known(a)).map((a) => `${at}: ${a.character}/${a.pose}`));
    expect(bad).toEqual([]);
  });

  it('背景は art.json の backgrounds に、一枚絵と章の扉絵は stills にある', () => {
    const bad = [
      ...STORY.filter((c) => c.art !== undefined && !(c.art in ART.stills)).map((c) => `${c.id}: art ${c.art}`),
      ...lines().filter(({ l }) => l.background !== undefined && !(l.background in ART.backgrounds)).map(({ at, l }) => `${at}: background ${l.background}`),
      ...lines().filter(({ l }) => l.still !== undefined && !(l.still in ART.stills)).map(({ at, l }) => `${at}: still ${l.still}`),
    ];
    expect(bad).toEqual([]);
  });

  it('演出の値は語彙の中(位置・動き・効果音・効果・遷移)', () => {
    const bad = lines().flatMap(({ at, l }) => [
      ...(l.sfx !== undefined && !SOUND_CUES.includes(l.sfx) ? [`${at}: sfx ${l.sfx}`] : []),
      ...(l.effect !== undefined && !EFFECTS.includes(l.effect) ? [`${at}: effect ${l.effect}`] : []),
      ...(l.transition !== undefined && !TRANSITIONS.includes(l.transition) ? [`${at}: transition ${l.transition}`] : []),
      ...(l.cast ?? []).flatMap((a) => [
        ...(!POSITIONS.includes(a.position) ? [`${at}: position ${a.position}`] : []),
        ...(a.motion !== undefined && !MOTIONS.includes(a.motion) ? [`${at}: motion ${a.motion}`] : []),
      ]),
    ]);
    expect(bad).toEqual([]);
  });

  it('効果音・効果・動きのきっかけの語句は、その行の本文の中にある', () => {
    const bad = lines().flatMap(({ at, l }) => [l.sfxAt, l.effectAt, ...(l.cast ?? []).map((a) => a.motionAt)]
      .filter((a): a is string => a !== undefined && !l.text.includes(a)).map((a) => `${at}: ${a}`));
    expect(bad).toEqual([]);
  });

  it('cast.json の id と名前が重複せず、色は #rrggbb、全員 neutral のポーズを持つ', () => {
    expect(new Set(CAST.map((c) => c.id)).size).toBe(CAST.length);
    expect(new Set(CAST.map((c) => c.name)).size).toBe(CAST.length);
    for (const c of CAST) {
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.poses).toContain('neutral');
    }
  });

  it('art.json の立ち絵は cast.json の全員・全ポーズの枠を持つ', () => {
    expect(Object.keys(ART.characters).sort()).toEqual(CAST.map((c) => c.id).sort());
    for (const c of CAST) expect(Object.keys(ART.characters[c.id]).sort()).toEqual([...c.poses].sort());
  });
});

describe('speakerCharacter', () => {
  it('cast.json の名前から人物の id を引く', () => {
    for (const c of CAST) expect(speakerCharacter(c.name)).toBe(c.id);
  });

  it('知らない名前と地の文は null', () => {
    expect(speakerCharacter('通りすがり')).toBeNull();
    expect(speakerCharacter(undefined)).toBeNull();
  });
});

describe('絵の引き当て', () => {
  it('art.json が null・キーが無いときは null(仮の見た目を出す)', () => {
    const [c] = CAST;
    const keep = ART.characters[c.id].neutral;
    ART.characters[c.id].neutral = null;
    try {
      expect(characterArt(c.id, 'neutral')).toBeNull();
      expect(characterArt('nobody', 'neutral')).toBeNull();
      expect(characterArt(c.id, 'no-such-pose')).toBeNull();
      expect(backgroundArt('no-such-background')).toBeNull();
      expect(stillArt('no-such-still')).toBeNull();
    } finally {
      ART.characters[c.id].neutral = keep;
    }
  });

  it('パスを入れるとそのパスを返す', () => {
    const keep = ART.backgrounds.guild;
    ART.backgrounds.guild = 'backgrounds/guild.webp';
    try {
      expect(backgroundArt('guild')).toBe('backgrounds/guild.webp');
    } finally {
      ART.backgrounds.guild = keep;
    }
  });
});

describe('trigger の評価', () => {
  it('day: N日目以降で満たす', () => {
    const s = newGame(1);
    s.day = 4;
    expect(triggerMet(s, { day: 5 })).toBe(false);
    s.day = 5;
    expect(triggerMet(s, { day: 5 })).toBe(true);
    s.day = 9;
    expect(triggerMet(s, { day: 5 })).toBe(true);
  });

  it('flag: 立っていれば満たす', () => {
    const s = newGame(1);
    expect(triggerMet(s, { flag: 'test:seen' })).toBe(false);
    s.flags['test:seen'] = 3;
    expect(triggerMet(s, { flag: 'test:seen' })).toBe(true);
  });

  it('dungeonConfirmed: 入口を確認したダンジョン', () => {
    const s = newGame(1);
    expect(triggerMet(s, { dungeonConfirmed: 'old_mine' })).toBe(false);
    confirmDungeon(s, 'old_mine');
    expect(triggerMet(s, { dungeonConfirmed: 'old_mine' })).toBe(true);
    expect(triggerMet(s, { dungeonConfirmed: 'no_such_dungeon' })).toBe(false);
  });

  it('keyHeld: 鍵を持っているあいだ満たす', () => {
    const s = newGame(1);
    expect(triggerMet(s, { keyHeld: 'ruin_key' })).toBe(false);
    s.inventory.ruin_key = 1;
    expect(triggerMet(s, { keyHeld: 'ruin_key' })).toBe(true);
    expect(triggerMet(s, { keyHeld: 'dragon_crest' })).toBe(false);
  });

  it('questsDone: 達成した依頼が N 件以上', () => {
    const s = newGame(1);
    expect(triggerMet(s, { questsDone: 1 })).toBe(false);
    finishQuests(s, 1);
    expect(triggerMet(s, { questsDone: 1 })).toBe(true);
    expect(triggerMet(s, { questsDone: 2 })).toBe(false);
    finishQuests(s, 1);
    expect(triggerMet(s, { questsDone: 2 })).toBe(true);
  });

  it('dragonDefeated・endingSeen: 竜の討伐とエンディングの既読', () => {
    const s = newGame(1);
    expect(triggerMet(s, { dragonDefeated: true })).toBe(false);
    expect(triggerMet(s, { endingSeen: true })).toBe(false);
    s.dragonDefeated = true;
    s.flags['ending:seen'] = true;
    expect(triggerMet(s, { dragonDefeated: true })).toBe(true);
    expect(triggerMet(s, { endingSeen: true })).toBe(true);
  });

  it('all: すべて満たすときだけ満たす', () => {
    const s = newGame(1);
    const t: StoryTrigger = { all: [{ day: 3 }, { keyHeld: 'ruin_key' }] };
    s.day = 3;
    expect(triggerMet(s, t)).toBe(false);
    s.inventory.ruin_key = 1;
    expect(triggerMet(s, t)).toBe(true);
    s.day = 2;
    expect(triggerMet(s, t)).toBe(false);
  });

  it('語彙にない条件は満たさない', () => {
    const s = newGame(1);
    expect(triggerMet(s, { typo: 1 } as unknown as StoryTrigger)).toBe(false);
  });
});

describe('storyDue', () => {
  it('新規開始の1日目はプロローグだけが出る', () => {
    const s = newGame(1);
    expect(ids(storyDue(s))).toEqual(['prologue']);
  });

  it('未読で条件を満たす章を台本の並び順で返す', () => {
    const s = newGame(1);
    markStorySeen(s, 'prologue');
    expect(storyDue(s)).toEqual([]);
    s.inventory.dragon_crest = 1;
    s.inventory.ruin_key = 1;
    confirmDungeon(s, 'old_mine');
    finishQuests(s, 1);
    expect(ids(storyDue(s))).toEqual(['ch1', 'ch2', 'ch3', 'ch4']);
  });

  it('最終章は竜を倒し、エンディングを読み終えてから', () => {
    const s = newGame(1);
    for (const c of STORY) if (c.id !== 'ch5') markStorySeen(s, c.id);
    s.dragonDefeated = true;
    expect(storyDue(s)).toEqual([]);
    s.flags['ending:seen'] = true;
    expect(ids(storyDue(s))).toEqual(['ch5']);
  });

  it('読み終えた章は条件を満たしたままでも二度と出ない', () => {
    const s = newGame(1);
    markStorySeen(s, 'prologue');
    confirmDungeon(s, 'old_mine');
    markStorySeen(s, 'ch2');
    s.day += 30;
    expect(storyDue(s)).toEqual([]);
  });

  it('決定論: 同じ状態からは同じ章が出る', () => {
    const run = () => {
      const s = newGame(7);
      s.inventory.ruin_key = 1;
      return ids(storyDue(s));
    };
    expect(run()).toEqual(run());
  });
});

describe('markStorySeen', () => {
  it('読んだ日を flags に残す', () => {
    const s = newGame(1);
    s.day = 12;
    markStorySeen(s, 'prologue');
    expect(s.flags['story:prologue']).toBe(12);
    expect(storySeenDay(s, 'prologue')).toBe(12);
    expect(storySeenDay(s, 'ch1')).toBeNull();
  });

  it('冪等: 二度目は何も変えない', () => {
    const s = newGame(1);
    s.day = 12;
    markStorySeen(s, 'prologue');
    const once = structuredClone(s.flags);
    s.day = 40;
    markStorySeen(s, 'prologue');
    expect(s.flags).toEqual(once);
  });

  it('台本にない章は記録しない', () => {
    const s = newGame(1);
    markStorySeen(s, 'no_such_chapter');
    expect(s.flags).toEqual(newGame(1).flags);
  });
});

describe('storySeen', () => {
  it('読み終えた章を台本の並び順で返す(読み返し用)', () => {
    const s = newGame(1);
    expect(storySeen(s)).toEqual([]);
    markStorySeen(s, 'ch2');
    markStorySeen(s, 'prologue');
    expect(ids(storySeen(s))).toEqual(['prologue', 'ch2']);
  });
});

describe('演出の語彙', () => {
  it('動きは既存6語に spin-out・hit・tremble を足した9語', () => {
    expect([...MOTIONS]).toEqual(['enter-left', 'enter-right', 'jump', 'nod', 'shake', 'recoil', 'spin-out', 'hit', 'tremble']);
  });

  it('効果音は既存7語に slash・blow・roar・flame を足した11語', () => {
    expect([...SOUND_CUES]).toEqual(['paper', 'door', 'step', 'bow', 'chime', 'water', 'cup', 'slash', 'blow', 'roar', 'flame']);
  });

  it('どの効果音にも音の部品が1つ以上ある', () => {
    const silent = SOUND_CUES.filter((cue) => (SOUND_PARTS[cue]?.length ?? 0) === 0);
    expect(silent).toEqual([]);
  });

  it('音の部品は周波数・長さ・音量が正で、開始は0以上', () => {
    const bad = SOUND_CUES.flatMap((cue) => SOUND_PARTS[cue].filter((p) => !(p.frequency > 0 && p.duration > 0 && p.gain > 0 && p.start >= 0)).map(() => cue));
    expect(bad).toEqual([]);
  });
});
