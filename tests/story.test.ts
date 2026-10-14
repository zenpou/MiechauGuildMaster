import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUNGEON, ITEM } from '../src/core/data';
import { newGame } from '../src/core/game';
import {
  ART, backgroundArt, CAST, characterArt, characterFace, EFFECTS, figureDisplay, linePortrait, MOTIONS, POSITIONS, SOUND_CUES,
  speakerCharacter, stillArt, TRANSITIONS,
} from '../src/core/presentation';
import type { CastMember, CharacterArt } from '../src/core/presentation';
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

  it('cast.json の display・poseDisplay は倍率が正、上端のずれは数で、poseDisplay のキーはその人物のポーズ', () => {
    const bad = CAST.flatMap((c) => {
      const shapes = [
        ...(c.display ? [{ at: `${c.id}.display`, d: c.display }] : []),
        ...Object.entries(c.poseDisplay ?? {}).map(([pose, d]) => ({ at: `${c.id}.poseDisplay.${pose}`, d })),
      ];
      return [
        ...Object.keys(c.poseDisplay ?? {}).filter((pose) => !c.poses.includes(pose)).map((pose) => `${c.id}: 知らないポーズ ${pose}`),
        ...shapes.filter(({ d }) => d.scale !== undefined && !(typeof d.scale === 'number' && d.scale > 0)).map(({ at }) => `${at}: scale`),
        ...shapes.filter(({ d }) => d.top !== undefined && !(typeof d.top === 'number' && Number.isFinite(d.top))).map(({ at }) => `${at}: top`),
      ];
    });
    expect(bad).toEqual([]);
  });

  it('art.json の立ち絵は cast.json の全員・全ポーズの枠を持つ', () => {
    expect(Object.keys(ART.characters).sort()).toEqual(CAST.map((c) => c.id).sort());
    for (const c of CAST) expect(Object.keys(ART.characters[c.id]).sort()).toEqual([...c.poses].sort());
  });

  it('art.json の立ち絵の値は null・パスの文字列・image と face の両方が文字列のオブジェクトのどれか', () => {
    const ok = (v: unknown) => v === null || typeof v === 'string'
      || (typeof v === 'object' && !Array.isArray(v)
        && typeof (v as Record<string, unknown>).image === 'string' && typeof (v as Record<string, unknown>).face === 'string');
    const bad = Object.entries(ART.characters).flatMap(([id, poses]) =>
      Object.entries(poses).filter(([, v]) => !ok(v)).map(([pose]) => `${id}/${pose}`));
    expect(bad).toEqual([]);
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
    const keep = ART.backgrounds.bg_guild_office;
    ART.backgrounds.bg_guild_office = 'backgrounds/guild.webp';
    try {
      expect(backgroundArt('bg_guild_office')).toBe('backgrounds/guild.webp');
    } finally {
      ART.backgrounds.bg_guild_office = keep;
    }
  });
});

describe('顔の引き当て', () => {
  const withArt = (pose: string, art: CharacterArt, check: (id: string) => void) => {
    const [c] = CAST;
    const keep = ART.characters[c.id][pose];
    ART.characters[c.id][pose] = art;
    try {
      check(c.id);
    } finally {
      ART.characters[c.id][pose] = keep;
    }
  };

  it('image と face があれば、立ち絵は image、顔は face をそのまま出す', () => {
    withArt('neutral', { image: 'characters/x/neutral.webp', face: 'faces/x/neutral.webp' }, (id) => {
      expect(characterArt(id, 'neutral')).toBe('characters/x/neutral.webp');
      expect(characterFace(id, 'neutral')).toEqual({ path: 'faces/x/neutral.webp', crop: false });
    });
  });

  it('パスの文字列だけなら、顔は立ち絵から切り出す', () => {
    withArt('neutral', 'characters/x/neutral.webp', (id) => {
      expect(characterArt(id, 'neutral')).toBe('characters/x/neutral.webp');
      expect(characterFace(id, 'neutral')).toEqual({ path: 'characters/x/neutral.webp', crop: true });
    });
  });

  it('null・知らない人物・知らないポーズは null', () => {
    withArt('neutral', null, (id) => {
      expect(characterFace(id, 'neutral')).toBeNull();
      expect(characterFace(id, 'no-such-pose')).toBeNull();
      expect(characterFace('nobody', 'neutral')).toBeNull();
    });
  });
});

describe('台詞枠の顔(linePortrait)', () => {
  const [first, second] = CAST;
  const withFaces = (faces: Record<string, CharacterArt>, check: () => void) => {
    const keep = Object.keys(faces).map((key) => {
      const [id, pose] = key.split('/');
      return { id, pose, v: ART.characters[id][pose] };
    });
    for (const [key, v] of Object.entries(faces)) {
      const [id, pose] = key.split('/');
      ART.characters[id][pose] = v;
    }
    try {
      check();
    } finally {
      for (const { id, pose, v } of keep) ART.characters[id][pose] = v;
    }
  };
  const face = (id: string, pose: string): CharacterArt => ({ image: `characters/${id}/${pose}.webp`, face: `faces/${id}/${pose}.webp` });

  it('portrait を書いた行はその人物とポーズ(絵が無くても出す)。立ち絵から外す印が付く', () => {
    withFaces({ [`${first.id}/neutral`]: null }, () => {
      expect(linePortrait({ text: '…', portrait: { character: first.id, pose: 'neutral' } }))
        .toEqual({ character: first.id, pose: 'neutral', explicit: true });
    });
  });

  it('話し手が舞台にいれば、その行のポーズの顔を出す。立ち絵には残す', () => {
    const [, pose] = first.poses;
    withFaces({ [`${first.id}/${pose}`]: face(first.id, pose) }, () => {
      expect(linePortrait({
        speaker: first.name, text: '…',
        cast: [{ character: second.id, pose: 'neutral', position: 'left' }, { character: first.id, pose, position: 'right' }],
      })).toEqual({ character: first.id, pose, explicit: false });
    });
  });

  it('話し手が舞台にいなければ neutral の顔', () => {
    withFaces({ [`${first.id}/neutral`]: face(first.id, 'neutral') }, () => {
      expect(linePortrait({ speaker: first.name, text: '…', cast: [{ character: second.id, pose: 'neutral', position: 'left' }] }))
        .toEqual({ character: first.id, pose: 'neutral', explicit: false });
      expect(linePortrait({ speaker: first.name, text: '…' })).toEqual({ character: first.id, pose: 'neutral', explicit: false });
    });
  });

  it('話し手の顔の絵が無ければ出さない', () => {
    withFaces({ [`${first.id}/neutral`]: null }, () => {
      expect(linePortrait({ speaker: first.name, text: '…' })).toBeNull();
    });
  });

  it('地の文と cast.json に無い話し手は出さない', () => {
    expect(linePortrait({ text: '…' })).toBeNull();
    expect(linePortrait({ speaker: '通りすがり', text: '…' })).toBeNull();
  });
});

describe('立ち絵の表示の調整', () => {
  const withDisplay = (display: CastMember['display'], poseDisplay: CastMember['poseDisplay'], check: (c: CastMember) => void) => {
    const [c] = CAST;
    const keep = { display: c.display, poseDisplay: c.poseDisplay };
    c.display = display;
    c.poseDisplay = poseDisplay;
    try {
      check(c);
    } finally {
      if (keep.display === undefined) delete c.display; else c.display = keep.display;
      if (keep.poseDisplay === undefined) delete c.poseDisplay; else c.poseDisplay = keep.poseDisplay;
    }
  };

  it('display も poseDisplay も無ければ null(CSS の既定で出す)', () => {
    withDisplay(undefined, undefined, (c) => {
      expect(figureDisplay(c.id, 'neutral')).toBeNull();
    });
  });

  it('知らない人物は null', () => {
    expect(figureDisplay('nobody', 'neutral')).toBeNull();
  });

  it('display だけなら、どのポーズもその人物の値', () => {
    withDisplay({ scale: 2.4, top: -0.1 }, undefined, (c) => {
      expect(figureDisplay(c.id, 'neutral')).toEqual({ scale: 2.4, top: -0.1 });
      expect(figureDisplay(c.id, c.poses[1])).toEqual({ scale: 2.4, top: -0.1 });
    });
  });

  it('poseDisplay はそのポーズだけ上書きし、書いていない値は人物の値のまま', () => {
    const [, pose] = CAST[0].poses;
    withDisplay({ scale: 2.4, top: -0.1 }, { [pose]: { scale: 1 } }, (c) => {
      expect(figureDisplay(c.id, pose)).toEqual({ scale: 1, top: -0.1 });
      expect(figureDisplay(c.id, 'neutral')).toEqual({ scale: 2.4, top: -0.1 });
    });
  });

  it('poseDisplay だけなら、そのポーズは書いた値だけ、他のポーズは null', () => {
    const [, pose] = CAST[0].poses;
    withDisplay(undefined, { [pose]: { scale: 1, top: 0 } }, (c) => {
      expect(figureDisplay(c.id, pose)).toEqual({ scale: 1, top: 0 });
      expect(figureDisplay(c.id, 'neutral')).toBeNull();
    });
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
    // 読んだ日が不明の既読(0)も立っている。false は立っていない
    s.flags['test:seen'] = 0;
    expect(triggerMet(s, { flag: 'test:seen' })).toBe(true);
    s.flags['test:seen'] = false;
    expect(triggerMet(s, { flag: 'test:seen' })).toBe(false);
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

  /** 全章の条件を一度に満たした状態。鎖(前章の読了)だけが章を順に出す */
  function everythingMet(): GameState {
    const s = newGame(1);
    s.day = 2;
    confirmDungeon(s, 'old_mine');
    s.inventory.ruin_key = 1;
    finishQuests(s, 10);
    s.inventory.dragon_crest = 1;
    s.dragonDefeated = true;
    return s;
  }

  it('章は前の章を読み終えるまで出ない(全条件を満たしていても、未読の次の1章だけ)', () => {
    const s = everythingMet();
    for (const id of ['prologue', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'epilogue']) {
      expect(ids(storyDue(s))).toEqual([id]);
      markStorySeen(s, id);
    }
    expect(storyDue(s)).toEqual([]);
  });

  it('第一章は序章読了の翌日(2日目)から', () => {
    const s = newGame(1);
    markStorySeen(s, 'prologue');
    expect(storyDue(s)).toEqual([]);
    s.day = 2;
    expect(ids(storyDue(s))).toEqual(['ch1']);
  });

  it('第四章は第三章読了と依頼10件、第五章は竜の紋章、終章は第五章読了と竜の討伐', () => {
    const s = everythingMet();
    for (const id of ['prologue', 'ch1', 'ch2', 'ch3']) markStorySeen(s, id);
    s.quests = s.quests.filter((q) => !q.id.startsWith('test-done-'));
    finishQuests(s, 9);
    expect(storyDue(s)).toEqual([]);
    finishQuests(s, 1);
    expect(ids(storyDue(s))).toEqual(['ch4']);
    markStorySeen(s, 'ch4');
    s.inventory.dragon_crest = 0;
    expect(storyDue(s)).toEqual([]);
    s.inventory.dragon_crest = 1;
    expect(ids(storyDue(s))).toEqual(['ch5']);
    markStorySeen(s, 'ch5');
    s.dragonDefeated = false;
    expect(storyDue(s)).toEqual([]);
    s.dragonDefeated = true;
    expect(ids(storyDue(s))).toEqual(['epilogue']);
  });

  it('読み終えた章は条件を満たしたままでも二度と出ない', () => {
    const s = newGame(1);
    for (const id of ['prologue', 'ch1', 'ch2']) markStorySeen(s, id);
    confirmDungeon(s, 'old_mine');
    s.day += 30;
    expect(storyDue(s)).toEqual([]);
  });

  it('決定論: 同じ状態からは同じ章が出る', () => {
    const run = () => {
      const s = everythingMet();
      markStorySeen(s, 'prologue');
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

describe('台本(docs/story/scripts)との照合', () => {
  // 台本の表が正本。story.json はそこから起こしたもので、ずれたらここで気づく
  const SCRIPT_FILES: Record<string, string> = {
    prologue: 'prologue_script.md', ch1: 'ch1_script.md', ch2: 'ch2_script.md', ch3: 'ch3_script.md',
    ch4: 'ch4_script.md', ch5: 'ch5_script.md', epilogue: 'epilogue_script.md',
  };
  const NAMES: Record<string, string> = {
    カイ: 'kai', ティナ: 'tina', アイリス: 'iris', ノエル: 'noel', セラ: 'sera', ヴィオラ: 'viola',
    ルゥ: 'ruu', フィーネ: 'fine', アウレリア: 'aurelia', ガルド: 'gald', 母: 'mother', 全員: 'everyone',
  };
  const POSES: Record<string, string> = {
    通常: 'neutral', 喜び: 'happy', 怒り: 'angry', 驚き: 'surprised', 照れ: 'shy', 昼寝: 'sleep', 拗ね: 'sulky',
    ふらつき: 'dizzy', 心配: 'worried', 涙目: 'teary', 動揺: 'flustered', 強がり: 'bluff', 素材に目が光る: 'sparkle',
    竜の姿: 'dragon', '通常・斥候服': 'scout_neutral', '怒り・斥候服': 'scout_angry', '喜び・斥候服': 'scout_happy',
    '動揺・斥候服': 'scout_flustered', '喜び・コートなし': 'coatless_happy', '通常・コートなし': 'coatless_neutral',
  };
  const SIDES: Record<string, string> = { 左: 'left', 中央: 'center', 右: 'right' };
  type Row = { no: number; speaker?: string; text: string; background: string; cast: { character: string; pose: string; position: string; motion?: string }[]; sfx?: string; effect?: string; transition?: string };

  function parseScript(id: string): Row[] {
    const text = readFileSync(resolve(__dirname, '../docs/story/scripts', SCRIPT_FILES[id]), 'utf8');
    const rows: Row[] = [];
    let scene = '';
    for (const raw of text.split('\n')) {
      if (raw.startsWith('### ')) scene = raw;
      if (!raw.startsWith('| ')) continue;
      const cells = raw.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (cells.length !== 7 || !/^\d+$/.test(cells[0])) continue; // 見出し・区切り・汎用差分(No が -)は飛ばす
      const [no, speakerCell, body, bg, castCell, fxCell] = cells;
      const row: Row = { no: Number(no), text: body, background: bg.replace(/`/g, ''), cast: [] };
      if (speakerCell !== '-' && !speakerCell.includes('(独白)')) {
        row.speaker = speakerCell.replace('(声のみ)', '').trim();
        row.text = row.text.replace(/^「+/, '').replace(/」+$/, '');
      }
      // 序章シーン1(門前)は一枚絵 prologue を背景にする(組み込みの決定。台本は bg_street_morning のまま)
      if (id === 'prologue' && scene.includes('シーン1: 実家の前')) row.background = 'bg_street_gate';
      if (!['なし', '', '-'].includes(castCell)) {
        for (const part of castCell.split(/<br\s*\/?>/)) {
          const m = part.trim().match(/^(\S+)\s*\((左|中央|右)\s*\/\s*(.+?)\)$/);
          if (!m) throw new Error(`${id}[${no}]: 立ち絵の書式が読めない: ${part}`);
          row.cast.push({ character: NAMES[m[1]], pose: POSES[m[3]], position: SIDES[m[2]] });
        }
      }
      for (const m of fxCell.matchAll(/`(motion|sfx|effect|transition):\s*([a-z-]+)`\s*(?:\(([^)]*)\))?/g)) {
        const [, kind, value, target] = m;
        if (kind !== 'motion') { (row as Record<string, unknown>)[kind] = value; continue; }
        const targets = target ? target.split('、').map((t) => NAMES[t.trim()]) : null;
        const side = ({ 'enter-left': 'left', 'enter-right': 'right' } as Record<string, string>)[value];
        for (const a of row.cast) {
          if (targets ? targets.includes(a.character) : !side || a.position === side) a.motion = value;
        }
      }
      rows.push(row);
    }
    return rows;
  }

  it('7章が台本の順で並び、解放条件は PLOT.md のとおり', () => {
    expect(ids(STORY)).toEqual(['prologue', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'epilogue']);
    expect(STORY.map((c) => c.trigger)).toEqual([
      { day: 1 },
      { all: [{ flag: 'story:prologue' }, { day: 2 }] },
      { all: [{ flag: 'story:ch1' }, { dungeonConfirmed: 'old_mine' }] },
      { all: [{ flag: 'story:ch2' }, { keyHeld: 'ruin_key' }] },
      { all: [{ flag: 'story:ch3' }, { questsDone: 10 }] },
      { all: [{ flag: 'story:ch4' }, { keyHeld: 'dragon_crest' }] },
      { all: [{ flag: 'story:ch5' }, { dragonDefeated: true }] },
    ]);
  });

  it('各章の行は台本の表と一字一句同じ(話し手・本文・背景・立ち絵・動き・効果音・効果・遷移)', () => {
    for (const c of STORY) {
      const rows = parseScript(c.id);
      expect(c.lines.length, `${c.id} の行数`).toBe(rows.length);
      c.lines.forEach((l, i) => {
        const r = rows[i];
        const where = `${c.id}[${r.no}]`;
        expect({ speaker: l.speaker, text: l.text, background: l.background }, where)
          .toEqual({ speaker: r.speaker, text: r.text, background: r.background });
        expect((l.cast ?? []).map((a) => ({ character: a.character, pose: a.pose, position: a.position, motion: a.motion })), where)
          .toEqual(r.cast.map((a) => ({ character: a.character, pose: a.pose, position: a.position, motion: a.motion })));
        expect({ sfx: l.sfx, effect: l.effect, transition: l.transition }, where)
          .toEqual({ sfx: r.sfx, effect: r.effect, transition: r.transition });
      });
    }
  });

  it('章の扉絵は序章=prologue、終章=dragon、他は無し', () => {
    expect(STORY.map((c) => [c.id, c.art])).toEqual([
      ['prologue', 'prologue'], ['ch1', undefined], ['ch2', undefined], ['ch3', undefined], ['ch4', undefined], ['ch5', undefined], ['epilogue', 'dragon'],
    ]);
  });

  it('仮の台本(draft)は残っていない', () => {
    expect(STORY.filter((c) => c.draft).map((c) => c.id)).toEqual([]);
  });

  it('登場・遷移以外の動きと、効果音・効果には、本文の語句のきっかけがある', () => {
    const bad = lines().flatMap(({ at, l }) => [
      ...(l.sfx && !l.sfxAt && !(l.sfx === 'door' || l.sfx === 'step') ? [`${at}: sfx ${l.sfx}`] : []),
      ...(l.effect && !l.effectAt ? [`${at}: effect ${l.effect}`] : []),
      ...(l.cast ?? []).filter((a) => a.motion && !a.motion.startsWith('enter-') && !a.motionAt).map((a) => `${at}: motion ${a.motion}`),
    ]);
    expect(bad).toEqual([]);
  });
});

describe('art.json の絵のファイル', () => {
  const verification = JSON.parse(readFileSync(resolve(__dirname, '../artifacts/source-art/story-assets-verification.json'), 'utf8')) as {
    assets: { files: { webp: { path: string } } }[]; faces: { assets: { files: { webp: { path: string } } }[] };
  };
  const delivered = new Set([...verification.assets, ...verification.faces.assets].map((a) => a.files.webp.path.replace(/^public\/art\//, '')));
  const paths = (): { at: string; path: string; story: boolean }[] => [
    ...Object.entries(ART.backgrounds).flatMap(([k, v]) => (v ? [{ at: `backgrounds.${k}`, path: v, story: false }] : [])),
    ...Object.entries(ART.stills).flatMap(([k, v]) => (v ? [{ at: `stills.${k}`, path: v, story: true }] : [])),
    ...Object.entries(ART.characters).flatMap(([id, poses]) => Object.entries(poses).flatMap(([pose, v]) => {
      if (v === null) return [];
      if (typeof v === 'string') return [{ at: `characters.${id}.${pose}`, path: v, story: true }];
      return [{ at: `characters.${id}.${pose}.image`, path: v.image, story: true }, { at: `characters.${id}.${pose}.face`, path: v.face, story: true }];
    })),
  ];

  it('指すファイルが public/art/ にある', () => {
    expect(paths().filter((p) => !existsSync(resolve(__dirname, '../public/art', p.path))).map((p) => `${p.at}: ${p.path}`)).toEqual([]);
  });

  it('立ち絵・顔・一枚絵は素材の検証一覧(story-assets-verification.json)にあるものだけ', () => {
    expect(paths().filter((p) => p.story && !delivered.has(p.path)).map((p) => `${p.at}: ${p.path}`)).toEqual([]);
  });

  it('絵のある人物は全ポーズに立ち絵と顔の両方がある', () => {
    const bad = CAST.flatMap((c) => c.poses.flatMap((pose) => {
      const v = ART.characters[c.id]?.[pose];
      return v === null || (typeof v === 'object' && v.image && v.face) ? [] : [`${c.id}/${pose}`];
    }));
    expect(bad).toEqual([]);
  });

  it('絵の無い話し手は「母」と「全員」だけ', () => {
    const silent = CAST.filter((c) => c.poses.every((pose) => ART.characters[c.id]?.[pose] === null)).map((c) => c.id);
    expect(silent).toEqual(['mother', 'everyone']);
  });
});
