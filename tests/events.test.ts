import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectiveStats, generateAdventurer } from '../src/core/adventurer';
import { UNIQUE } from '../src/core/data';
import { advanceUniqueChain, onReturn, uniqueAdventurer, uniqueDef } from '../src/core/events';
import { newGame } from '../src/core/game';
import { pairKey } from '../src/core/relations';
import { rngFor } from '../src/core/rng';
import type { Adventurer, Expedition, ExpeditionResult, GameState } from '../src/core/types';
import { U_ALPHA, registerUnique } from './helpers';

function result(over: Partial<ExpeditionResult> = {}): ExpeditionResult {
  return {
    success: true, retreated: false, wiped: false, log: [],
    mapDeltas: [], maxDepth: 0, daysSpent: 1, materials: {}, items: {}, gold: 0,
    injuries: {}, expGain: {}, fatigue: {}, relationDeltas: [], revealedTraits: [],
    kills: {}, itemsUsed: {}, repGain: 0, rescueCost: 0, lostMaterials: {},
    questProgress: {}, returnDialogue: [], ...over,
  };
}

function exp(partyIds: string[], r: ExpeditionResult, dungeon = 'forest_cave'): Expedition {
  return {
    id: 'x1',
    order: { partyIds, leaderId: partyIds[0], action: 'explore', target: { dungeon }, policy: 'standard', days: 1, items: {} },
    startDay: 1, returnDay: 2, steps: [], result: r,
  } as unknown as Expedition;
}

function twoFriends(rel: number): { s: GameState; a: Adventurer; b: Adventurer } {
  const s = newGame(3);
  s.adventurers = [0, 1].map((i) => generateAdventurer(rngFor(3, 'ev', i), { id: `p${i}` }));
  const [a, b] = s.adventurers;
  a.loyalty = 50;
  b.loyalty = 50;
  s.relations[pairKey(a.id, b.id)] = rel;
  return { s, a, b };
}

describe('組み合わせイベント(親友)', () => {
  it('関係値60以上の2人が同じ隊で5回目に帰還すると親友になる', () => {
    const { s, a, b } = twoFriends(60);
    const notices: string[] = [];
    for (let i = 0; i < 4; i++) onReturn(s, exp([a.id, b.id], result()), notices);
    expect(notices).toEqual([]);
    expect(a.loyalty).toBe(50);
    onReturn(s, exp([a.id, b.id], result()), notices);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('親友');
    expect(a.loyalty).toBe(60);
    expect(b.loyalty).toBe(60);
    expect(s.relations[pairKey(a.id, b.id)]).toBe(80);
    expect(s.flags[`friends:${pairKey(a.id, b.id)}`]).toBe(true);
    // 2度は起きない
    for (let i = 0; i < 5; i++) onReturn(s, exp([a.id, b.id], result()), notices);
    expect(notices).toHaveLength(1);
  });

  it('関係値が60未満の間は数えない', () => {
    const { s, a, b } = twoFriends(59);
    const notices: string[] = [];
    for (let i = 0; i < 6; i++) onReturn(s, exp([a.id, b.id], result()), notices);
    expect(notices).toEqual([]);
    expect(s.flags[`pair:${pairKey(a.id, b.id)}`]).toBeUndefined();
  });
});

describe('ユニーク冒険者', () => {
  let unregister: () => void;
  beforeEach(() => { unregister = registerUnique(U_ALPHA); });
  afterEach(() => unregister());
  it('定義: ティナは剣士・勇敢・固有スキル(攻撃+3)で、初日の名簿に入る', () => {
    const def = uniqueDef('tina');
    expect(def).toBe(UNIQUE.tina);
    expect(def.name).toBe('ティナ');
    expect(def.job).toBe('fighter');
    expect(def.personality).toBe('brave');
    expect(def.skill).toMatchObject({ id: 'tina_skill', mods: { atk: 3 } });
    expect(def.join).toEqual({ initial: true });
    expect(def.chain).toHaveLength(3);
  });

  it('作った冒険者は固定の能力と固有スキルを持ち、スキルぶん偵察が高い', () => {
    const a = uniqueAdventurer(uniqueDef('u_alpha'), 'a99');
    expect(a).toMatchObject({ id: 'a99', unique: 'u_alpha', job: 'scout', personality: 'cautious', skills: ['u_alpha_skill'] });
    expect(a.base).toEqual(uniqueDef('u_alpha').base);
    const without = { ...a, skills: [] };
    expect(effectiveStats(a).scout).toBeGreaterThan(effectiveStats(without).scout);
    expect(a.salary).toBeGreaterThan(0);
  });

  it('依頼チェーンが3段進み、最後に忠誠+30', () => {
    const s = newGame(4);
    const u = uniqueAdventurer(uniqueDef('u_alpha'), 'u1');
    u.loyalty = 40;
    const other = generateAdventurer(rngFor(4, 'ev'), { id: 'o1' });
    s.adventurers = [u, other];
    const notices: string[] = [];

    // 1段目: 薬草5つ。在庫から引く(分けて届けてもよい)
    s.inventory.herb = 3;
    advanceUniqueChain(s, notices);
    expect(s.inventory.herb).toBe(0);
    expect(s.flags['u_alpha:herb']).toBe(3);
    expect(s.flags['u_alpha:step'] ?? 0).toBe(0);
    s.inventory.herb = 4;
    advanceUniqueChain(s, notices);
    expect(s.inventory.herb).toBe(2);
    expect(s.flags['u_alpha:step']).toBe(1);

    // 2段目: 坑道へ3回(本人が行った回だけ数える)
    const mine = result({ mapDeltas: [{ dungeon: 'old_mine', floor: 'f1', cells: [], hidden: [] }] });
    onReturn(s, exp([other.id], mine, 'old_mine'), notices);
    onReturn(s, exp([u.id, other.id], mine, 'old_mine'), notices);
    onReturn(s, exp([u.id], result({ mapDeltas: [{ dungeon: 'forest_cave', floor: 'f1', cells: [], hidden: [] }] })), notices);
    expect(s.flags['u_alpha:step']).toBe(1);
    onReturn(s, exp([u.id], mine, 'old_mine'), notices);
    onReturn(s, exp([u.id], mine, 'old_mine'), notices);
    expect(s.flags['u_alpha:step']).toBe(2);

    // 3段目: 1人でゴブリンの頭。2人で倒しても数えない
    const chief = result({ kills: { goblin_chief: 1 } });
    onReturn(s, exp([u.id, other.id], chief), notices);
    expect(s.flags['u_alpha:step']).toBe(2);
    expect(u.loyalty).toBe(40);
    onReturn(s, exp([u.id], chief), notices);
    expect(s.flags['u_alpha:step']).toBe(3);
    expect(u.loyalty).toBe(70);
    expect(notices.some((n) => n.includes(u.name))).toBe(true);

    // 終わった後は何も起きない
    const before = notices.length;
    onReturn(s, exp([u.id], chief), notices);
    s.inventory.herb = 9;
    advanceUniqueChain(s, notices);
    expect(notices).toHaveLength(before);
    expect(s.inventory.herb).toBe(9);
  });

  it('ユニークが名簿にいなければ薬草を引かない', () => {
    const s = newGame(4);
    s.inventory.herb = 9;
    advanceUniqueChain(s, []);
    expect(s.inventory.herb).toBe(9);
  });
});
