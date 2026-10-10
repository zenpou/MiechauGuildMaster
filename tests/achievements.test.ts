import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { achievementExpMult, achievementProgress, achievementStage, checkAchievements } from '../src/core/achievements';
import { ACHIEVEMENT, ACHIEVEMENTS, DUNGEON, DUNGEONS, ITEM, TUNING, UPPER_JOBS } from '../src/core/data';
import { parseFloor } from '../src/core/dungeon';
import { newGame } from '../src/core/game';
import type { DungeonProgress, GameState, ItemDef, Quest, QuestType } from '../src/core/types';

/** 条件を何も満たさない状態 */
function blank(): GameState {
  const s = newGame(1);
  s.gold = 0;
  s.rep = 0;
  s.quests = [];
  s.counters.dispatches = 0;
  s.adventurers = [];
  s.base.facilities = [];
  s.inventory = {};
  s.flags = {};
  s.achievements = [];
  s.dragonDefeated = false;
  for (const d of Object.values(s.dungeons)) d.confirmed = false;
  return s;
}

const newly = (s: GameState) => checkAchievements(s, []);

function quest(i: number, type: QuestType, status: Quest['status'] = 'done'): Quest {
  return {
    id: `q${i}`, templateId: null, type, town: null, name: '', desc: '', target: {} as Quest['target'],
    rewardGold: 0, rewardRep: 0, postedDay: 1, acceptBy: null, dueDay: null, departDay: null,
    status, progress: 0, unlocks: [],
  };
}

function progress(over: Partial<DungeonProgress>): DungeonProgress {
  return { confirmed: false, floors: {}, bossDefeated: 0, fullCleared: false, ...over };
}

/** 全フロアの通行可能マスを踏んだことにする。最後のフロアだけ leave マス残す */
function visitAll(s: GameState, dungeonId: string, leave = 0) {
  const floors = DUNGEON[dungeonId].floors;
  floors.forEach((f, k) => {
    const open = parseFloor(f).cells.flatMap((c, i) => (c.kind === 'wall' ? [] : [i]));
    const visited = k === floors.length - 1 ? open.slice(leave) : open;
    s.dungeons[dungeonId].floors[f.id] = { visited, hiddenFound: [] };
  });
}

function hire(s: GameState, n: number, level = 1, job = 'fighter') {
  const base = newGame(1).adventurers[0];
  for (let i = 0; i < n; i++) s.adventurers.push({ ...structuredClone(base), id: `x${s.adventurers.length}`, level, job });
}

function build(s: GameState, id: string, x: number, y: number, level = 1) {
  s.base.facilities.push({ id, level, x, y, builtDay: 1, construction: null });
}

describe('実績の定義', () => {
  it('30項目・6系統×5で、IDが重ならない', () => {
    expect(ACHIEVEMENTS).toHaveLength(30);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(30);
    const byCat = new Map<string, number>();
    for (const a of ACHIEVEMENTS) byCat.set(a.category, (byCat.get(a.category) ?? 0) + 1);
    expect([...byCat.values()]).toEqual([5, 5, 5, 5, 5, 5]);
    for (const a of ACHIEVEMENTS) {
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.desc.length).toBeGreaterThan(0);
    }
  });

  it('参照するダンジョンは実在する', () => {
    for (const a of ACHIEVEMENTS) if (a.cond.dungeon) expect(DUNGEON[a.cond.dungeon]).toBeDefined();
  });

  it('段の節目と1段の倍率は tuning にある', () => {
    expect(TUNING.achievements).toEqual({ stages: [5, 10, 20, 30], expPerStage: 0.1 });
  });

  it('何もしていない状態では1つも達成しない', () => {
    expect(newly(blank())).toEqual([]);
  });

  it('全項目の進捗が数で返る(条件の種類の書き間違いが無い)', () => {
    const s = blank();
    for (const a of ACHIEVEMENTS) {
      const p = achievementProgress(s, a.id);
      expect(Number.isFinite(p.value) && Number.isFinite(p.target) && p.target > 0, a.id).toBe(true);
    }
  });
});

describe('条件の判定', () => {
  it('gold: 資金', () => {
    const s = blank();
    s.gold = 999;
    expect(newly(s)).toEqual([]);
    s.gold = 1000;
    expect(newly(s)).toEqual(['m_gold1']);
    s.gold = 5000;
    expect(newly(s)).toEqual(['m_gold2']);
  });

  it('rep: 評判', () => {
    const s = blank();
    s.rep = 19;
    expect(newly(s)).toEqual([]);
    s.rep = 20;
    expect(newly(s)).toEqual(['m_rep3']);
    s.rep = 54;
    expect(newly(s)).toEqual([]);
    s.rep = 55;
    expect(newly(s)).toEqual(['m_rep5']);
  });

  it('questsDone: 達成した依頼だけを数える', () => {
    const s = blank();
    for (let i = 0; i < 19; i++) s.quests.push(quest(i, 'deliver'));
    s.quests.push(quest(100, 'deliver', 'failed'), quest(101, 'deliver', 'expired'), quest(102, 'deliver', 'accepted'));
    expect(newly(s)).toEqual([]);
    s.quests.push(quest(19, 'hunt'));
    expect(newly(s)).toEqual(['m_quest20']);
  });

  it('questTypeDone: 種類ごとの達成数', () => {
    const s = blank();
    s.quests.push(quest(0, 'escort'), quest(1, 'escort'), quest(2, 'transport'), quest(3, 'escort', 'failed'));
    expect(newly(s)).toEqual([]);
    s.quests.push(quest(4, 'escort'));
    expect(newly(s)).toEqual(['d_escort3']);
    s.quests.push(quest(5, 'transport'), quest(6, 'transport'));
    expect(newly(s)).toEqual(['d_transport3']);
  });

  it('dispatches: 派遣回数', () => {
    const s = blank();
    s.counters.dispatches = 9;
    expect(newly(s)).toEqual([]);
    s.counters.dispatches = 10;
    expect(newly(s)).toEqual(['d_10']);
    s.counters.dispatches = 49;
    expect(newly(s)).toEqual([]);
    s.counters.dispatches = 50;
    expect(newly(s)).toEqual(['d_50']);
    s.counters.dispatches = 150;
    expect(newly(s)).toEqual(['d_150']);
  });

  it('dungeonRate: 探索率100%(全フロア)', () => {
    const s = blank();
    visitAll(s, 'forest_cave', 1);
    expect(newly(s)).toEqual([]);
    visitAll(s, 'forest_cave');
    expect(newly(s)).toEqual(['e_forest100']);
    visitAll(s, 'old_mine');
    expect(newly(s)).toEqual(['e_mine100']);
    visitAll(s, 'ruined_tower', 1);
    expect(newly(s)).toEqual([]);
    visitAll(s, 'ruined_tower');
    expect(newly(s)).toEqual(['e_tower100']);
  });

  it('confirmedCount: 入口を確認したダンジョンの数', () => {
    const s = blank();
    s.dungeons = { a: progress({ confirmed: true }), b: progress({ confirmed: true }), c: progress({ confirmed: true }), d: progress({}) };
    expect(newly(s)).toEqual([]);
    s.dungeons.d.confirmed = true;
    expect(newly(s)).toEqual(['e_confirm4']);
  });

  it('bossCount: 主を倒したダンジョンの数(同じ所で何度倒しても1つ)', () => {
    const s = blank();
    s.dungeons = { a: progress({ bossDefeated: 5 }), b: progress({ bossDefeated: 1 }), c: progress({}) };
    expect(newly(s)).toEqual([]);
    s.dungeons.c.bossDefeated = 1;
    expect(newly(s)).toEqual(['e_boss3']);
  });

  it('roster: 在籍人数', () => {
    const s = blank();
    hire(s, 7);
    expect(newly(s)).toEqual([]);
    hire(s, 1);
    expect(newly(s)).toEqual(['g_roster8']);
  });

  it('levelMax: 最も高いレベル', () => {
    const s = blank();
    hire(s, 2, 9);
    expect(newly(s)).toEqual([]);
    s.adventurers[1].level = 10;
    expect(newly(s)).toEqual(['g_lv10']);
  });

  it('upperJobs: 上級職の人数', () => {
    const s = blank();
    hire(s, 3);
    expect(newly(s)).toEqual([]);
    s.adventurers[0].job = UPPER_JOBS[0].id;
    expect(newly(s)).toEqual(['g_upper1']);
    hire(s, 3, 1, UPPER_JOBS[1].id);
    expect(newly(s)).toEqual(['g_upper4']);
  });

  it('friends: 親友の組の数', () => {
    const s = blank();
    s.flags['friends:a|b'] = false;
    expect(newly(s)).toEqual([]);
    s.flags['friends:a|c'] = true;
    expect(newly(s)).toEqual(['g_friends1']);
  });

  it('facilities: 完成した施設の数(建設中は数えない)', () => {
    const s = blank();
    ['dorm', 'workshop', 'alchemy', 'clinic'].forEach((id, i) => build(s, id, i, 4));
    build(s, 'training', 4, 4, 0);
    expect(newly(s)).toEqual([]);
    s.base.facilities[4].level = 1;
    expect(newly(s)).toEqual(['f_build5']);
    expect(achievementProgress(s, 'f_build10')).toEqual({ value: 5, target: 10 });
  });

  it('facilityLv2: Lv2 の施設の数', () => {
    const s = blank();
    build(s, 'dorm', 0, 0, 2);
    build(s, 'workshop', 2, 0, 2);
    build(s, 'alchemy', 4, 0, 1);
    expect(newly(s)).toEqual([]);
    s.base.facilities[2].level = 2;
    expect(newly(s)).toEqual(['f_lv2_3']);
  });

  it('synergies: 成立しているシナジーの数', () => {
    const s = blank();
    build(s, 'workshop', 0, 0);
    build(s, 'alchemy', 1, 0);
    build(s, 'clinic', 0, 2);
    build(s, 'dorm', 1, 2);
    expect(newly(s)).toEqual([]);
    build(s, 'training', 2, 2);
    expect(newly(s)).toEqual(['f_build5', 'f_syn3']);
    expect(achievementProgress(s, 'f_syn6')).toEqual({ value: 3, target: 6 });
  });

  it('flag: ユニークを雇う・頼みを全部果たす', () => {
    const s = blank();
    s.flags['unique:u_alpha:hired'] = 12;
    expect(newly(s)).toEqual(['s_unique']);
    s.flags['u_alpha:step'] = 2;
    expect(newly(s)).toEqual([]);
    s.flags['u_alpha:step'] = 3;
    expect(newly(s)).toEqual(['s_chain']);
  });

  it('flagPrefix: 解放依頼の達成(レシピや竜の解放は数えない)', () => {
    const s = blank();
    s.flags['unlock:r_iron_sword'] = true;
    s.flags['unlock:dragon_slain'] = true;
    s.flags['unlock:u_forge_iron'] = false;
    expect(newly(s)).toEqual([]);
    s.flags['unlock:u_forge_iron'] = true;
    expect(newly(s)).toEqual(['s_unlock']);
  });

  describe('keysHeld: 鍵を持つ数', () => {
    const stub = (id: string): ItemDef => ({ id, name: id, desc: '', kind: 'key', price: 0, weight: 0 });
    beforeAll(() => {
      ITEM.test_key_a = stub('test_key_a');
      ITEM.test_key_b = stub('test_key_b');
    });
    afterAll(() => {
      delete ITEM.test_key_a;
      delete ITEM.test_key_b;
    });

    it('在庫にある鍵の種類を数える(鍵以外・0個は数えない)', () => {
      const s = blank();
      const material = Object.keys(ITEM).find((id) => ITEM[id].kind === 'material')!;
      s.inventory = { test_key_a: 1, test_key_b: 0, [material]: 5 };
      expect(newly(s)).toEqual([]);
      expect(achievementProgress(s, 's_keys')).toEqual({ value: 1, target: 2 });
      s.inventory.test_key_b = 1;
      expect(newly(s)).toEqual(['s_keys']);
    });
  });

  it('dragon: 竜の討伐', () => {
    const s = blank();
    expect(achievementProgress(s, 's_dragon')).toEqual({ value: 0, target: 1 });
    s.dragonDefeated = true;
    expect(newly(s)).toEqual(['s_dragon']);
  });
});

describe('checkAchievements', () => {
  it('新しく達成した分だけを返し、お知らせを出し、二重に達成しない', () => {
    const s = blank();
    s.gold = 6000;
    const notices: string[] = [];
    expect(checkAchievements(s, notices)).toEqual(['m_gold1', 'm_gold2']);
    expect(s.achievements).toEqual(['m_gold1', 'm_gold2']);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain(`実績『${ACHIEVEMENT.m_gold1.name}』を達成`);
    expect(checkAchievements(s, notices)).toEqual([]);
    expect(s.achievements).toEqual(['m_gold1', 'm_gold2']);
    expect(notices).toHaveLength(2);
  });

  it('達成数が節目(5)を越えて段が上がった時は、経験値ボーナスもお知らせする(隠さない)', () => {
    const s = blank();
    s.gold = 6000;
    s.rep = 60;
    s.counters.dispatches = 60;
    const notices: string[] = [];
    checkAchievements(s, notices);
    expect(s.achievements.length).toBeGreaterThanOrEqual(5);
    expect(notices.some((n) => n.includes('実績ボーナス') && n.includes('1段') && n.includes('+10%'))).toBe(true);
    const again: string[] = [];
    checkAchievements(s, again);
    expect(again).toEqual([]);
  });

  it('一度達成したものは、条件を外れても残る', () => {
    const s = blank();
    s.gold = 1000;
    newly(s);
    s.gold = 0;
    expect(newly(s)).toEqual([]);
    expect(s.achievements).toContain('m_gold1');
  });

  it('決定論: 同じ状態からは同じ結果とお知らせ', () => {
    const make = () => {
      const s = blank();
      s.gold = 5000;
      s.rep = 60;
      s.counters.dispatches = 60;
      s.dragonDefeated = true;
      return s;
    };
    const n1: string[] = [];
    const n2: string[] = [];
    const a = make();
    const b = make();
    expect(checkAchievements(a, n1)).toEqual(checkAchievements(b, n2));
    expect(n1).toEqual(n2);
    expect(a.achievements).toEqual(['m_gold1', 'm_gold2', 'm_rep3', 'm_rep5', 'd_10', 'd_50', 's_dragon']);
  });
});

describe('achievementProgress', () => {
  it('{ value, target } を返す', () => {
    const s = blank();
    s.gold = 300;
    expect(achievementProgress(s, 'm_gold1')).toEqual({ value: 300, target: 1000 });
    s.counters.dispatches = 7;
    expect(achievementProgress(s, 'd_10')).toEqual({ value: 7, target: 10 });
    s.flags['u_alpha:step'] = 1;
    expect(achievementProgress(s, 's_chain')).toEqual({ value: 1, target: 3 });
    expect(achievementProgress(s, 's_unique')).toEqual({ value: 0, target: 1 });
  });

  it('探索率は百分率の切り捨て', () => {
    const s = blank();
    const open = parseFloor(DUNGEON.forest_cave.floors[0]).cells.filter((c) => c.kind !== 'wall').length;
    visitAll(s, 'forest_cave', 1);
    expect(achievementProgress(s, 'e_forest100')).toEqual({ value: Math.floor(((open - 1) * 100) / open), target: 100 });
    visitAll(s, 'forest_cave');
    expect(achievementProgress(s, 'e_forest100')).toEqual({ value: 100, target: 100 });
  });

  it('知らないIDは 0 / 1', () => {
    expect(achievementProgress(blank(), 'nope')).toEqual({ value: 0, target: 1 });
  });
});

describe('達成数の段と経験値ボーナス', () => {
  it.each([
    [0, 0], [4, 0], [5, 1], [9, 1], [10, 2], [19, 2], [20, 3], [29, 3], [30, 4],
  ])('%i 個で %i 段', (n, stage) => {
    const s = blank();
    s.achievements = ACHIEVEMENTS.slice(0, n).map((a) => a.id);
    expect(achievementStage(s)).toBe(stage);
    expect(achievementExpMult(s)).toBeCloseTo(1 + 0.1 * stage, 10);
  });

  it('知らないIDは数えない', () => {
    const s = blank();
    s.achievements = [...ACHIEVEMENTS.slice(0, 4).map((a) => a.id), 'removed_long_ago'];
    expect(achievementStage(s)).toBe(0);
    expect(achievementExpMult(s)).toBe(1);
  });
});

describe('ダンジョンの数に依らない', () => {
  it('全ダンジョンを踏破しても、増えるのは探索の系統だけ', () => {
    const s = blank();
    for (const d of DUNGEONS) visitAll(s, d.id);
    expect(newly(s).every((id) => ACHIEVEMENT[id].category === ACHIEVEMENT.e_forest100.category)).toBe(true);
  });
});
