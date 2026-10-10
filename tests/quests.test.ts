import { describe, expect, it } from 'vitest';
import { parseFloor } from '../src/core/dungeon';
import { DUNGEON, ENEMY, ITEM, QUEST_TEMPLATE, TUNING } from '../src/core/data';
import {
  ACTIVE_MAX, accept, activeMax, completeQuest, createQuest, deliver, expireQuests, generateDailyQuests, progressFromReturn,
  questRewardGold, recipeUnlocked, repLevel, seedUnlockQuests, visibleBoards, visibleQuests, type RoadInfo,
} from '../src/core/quests';
import { rngFor } from '../src/core/rng';
import { emptyState } from '../src/core/state';
import type { Expedition, ExpeditionResult, GameState, Quest } from '../src/core/types';

const road: RoadInfo = (from, to) => {
  const table: Record<string, { days: number; danger: number }> = {
    'base>mountain_village': { days: 1, danger: 0.15 },
    'base>forge_town': { days: 2, danger: 0.2 },
    'base>forest_cave': { days: 0, danger: 0.05 },
    'base>old_mine': { days: 2, danger: 0.4 },
  };
  return table[`${from}>${to}`] ?? table[`${to}>${from}`] ?? null;
};

/** 出た依頼を全部返す(期限切れで消えたものも含む) */
function runDays(s: GameState, days: number, expire = false): Quest[] {
  const out: Quest[] = [];
  for (let i = 0; i < days; i++) {
    s.day++;
    if (expire) expireQuests(s, []);
    out.push(...generateDailyQuests(s, rngFor(s.seed, 'quests', s.day), road));
  }
  return out;
}

function make(s: GameState, templateId: string, seed = 1): Quest {
  const q = createQuest(s, templateId, rngFor(seed, 'make', templateId), road);
  s.quests.push(q);
  return q;
}

function result(over: Partial<ExpeditionResult> = {}): ExpeditionResult {
  return {
    success: true, retreated: false, wiped: false, log: [], mapDeltas: [], maxDepth: 0, daysSpent: 1,
    materials: {}, items: {}, gold: 0, injuries: {}, expGain: {}, fatigue: {}, relationDeltas: [],
    revealedTraits: [], kills: {}, itemsUsed: {}, repGain: 0, rescueCost: 0, lostMaterials: {},
    questProgress: {}, returnDialogue: [], ...over,
  };
}

function expedition(s: GameState, over: Partial<ExpeditionResult> = {}, order: Partial<Expedition['order']> = {}): Expedition {
  return {
    id: 'e1',
    order: { partyIds: [], leaderId: '', action: 'explore', target: { dungeon: 'forest_cave' }, policy: 'balanced', days: 1, items: {}, ...order },
    startDay: s.day, returnDay: s.day, steps: [], result: result(over), recalledDay: null, claimed: false,
  };
}

describe('repLevel', () => {
  it('しきい値 0/8/20/35/55 の境で段が上がる', () => {
    expect([0, 7, 8, 19, 20, 34, 35, 54, 55, 999].map(repLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});

describe('依頼の生成', () => {
  it('同じseed・同じ日付なら同じ依頼が出る', () => {
    const a = emptyState(5);
    const b = emptyState(5);
    a.rep = b.rep = 20;
    runDays(a, 30);
    runDays(b, 30);
    expect(a.quests.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.quests)).toBe(JSON.stringify(b.quests));
  });

  it('掲示板の上限(拠点4・街3・村2)を超えない', () => {
    const s = emptyState(7);
    s.rep = 60;
    runDays(s, 120);
    const posted = (town: string) => s.quests.filter((q) => q.status === 'posted' && q.town === town && q.type !== 'unlock').length;
    expect(posted('base')).toBe(4);
    expect(posted('forge_town')).toBeLessThanOrEqual(3);
    expect(posted('academy_town')).toBeLessThanOrEqual(3);
    expect(posted('mountain_village')).toBeLessThanOrEqual(2);
  });

  it('評判が足りないテンプレートは出ず、評判が上がると出る', () => {
    const low = emptyState(3);
    const lowQs = runDays(low, 120, true);
    const lowIds = new Set(lowQs.map((q) => q.templateId));
    expect(lowIds.has('t_hunt_goblin')).toBe(true);
    for (const id of ['t_deliver_ore', 't_hunt_skeleton', 't_explore_mine', 't_escort_forge']) expect(lowIds.has(id)).toBe(false);
    expect(lowQs.filter((q) => q.type === 'explore').every((q) => q.target.percent === 50)).toBe(true);

    const high = emptyState(3);
    high.rep = 20;
    const highQs = runDays(high, 120, true);
    const highIds = new Set(highQs.map((q) => q.templateId));
    for (const id of ['t_deliver_ore', 't_hunt_skeleton', 't_explore_mine', 't_escort_forge']) expect(highIds.has(id)).toBe(true);
    expect(highQs.some((q) => q.templateId === 't_explore_cave' && q.target.percent === 100)).toBe(true);
  });

  it('受注期限は 納品・討伐 5〜7日、探索 7〜10日、護衛は出発日 3〜5日後', () => {
    const s = emptyState(11);
    s.rep = 20;
    const qs = runDays(s, 80, true);
    expect(qs.length).toBeGreaterThan(20);
    for (const q of qs) {
      const span = q.acceptBy! - q.postedDay;
      if (q.type === 'explore') expect([7, 8, 9, 10]).toContain(span);
      if (q.type === 'deliver' || q.type === 'hunt') expect([5, 6, 7]).toContain(span);
      if (q.type === 'escort') {
        expect([3, 4, 5]).toContain(q.departDay! - q.postedDay);
        expect(q.acceptBy!).toBeLessThanOrEqual(q.departDay!);
      }
    }
  });

  it('報酬: 納品=売値×係数、討伐=exp×係数、護衛=日額×日数×(1+danger)、運搬=日額×日数(係数は tuning.quests)', () => {
    const Q = TUNING.quests;
    const s = emptyState(1);
    const d = make(s, 't_deliver_fang');
    expect(d.rewardGold).toBe(Math.round(ITEM.fang.price * d.target.n! * Q.deliverPriceMul));
    const h = make(s, 't_hunt_goblin');
    expect(h.rewardGold).toBe(Math.round(ENEMY.goblin.exp * h.target.n! * Q.huntExpMul));
    const e = make(s, 't_escort_village');
    expect(e.rewardGold).toBe(Math.round(Q.escortGoldPerDay * 1 * 1.15));
    const t = make(s, 't_transport_village');
    expect(t.rewardGold).toBe(Q.transportGoldPerDay);
    const noRoad = createQuest(s, 't_escort_forge', rngFor(1, 'x'));
    expect(noRoad.rewardGold).toBe(Math.round(Q.escortGoldPerDay * 1 * 1.2));
  });
});

describe('解放依頼', () => {
  it('最初から掲示板にあり締め切りがない。二重に置かない', () => {
    const s = emptyState(1);
    seedUnlockQuests(s);
    seedUnlockQuests(s);
    const u = s.quests.filter((q) => q.templateId === 'u_forge_iron');
    expect(u).toHaveLength(1);
    expect(u[0].acceptBy).toBeNull();
    expect(u[0].status).toBe('posted');
    s.day = 500;
    expireQuests(s, []);
    expect(s.quests.some((q) => q.templateId === 'u_forge_iron')).toBe(true);
  });

  it('鉄鉱石5個を納めると unlocks のレシピが開く', () => {
    const s = emptyState(1);
    seedUnlockQuests(s);
    const u = s.quests.find((q) => q.templateId === 'u_forge_iron')!;
    expect(QUEST_TEMPLATE.u_forge_iron.unlocks).toEqual(['r_iron_sword', 'r_iron_armor']);
    expect(recipeUnlocked(s, 'r_iron_sword')).toBe(false);
    expect(recipeUnlocked(s, 'r_bone_dagger')).toBe(true);
    s.world.visitedNodes = ['forge_town'];
    expect(accept(s, u.id, road).ok).toBe(true);
    expect(u.dueDay).toBeNull();
    s.inventory.iron_ore = 5;
    expect(deliver(s, u.id).ok).toBe(true);
    expect(s.inventory.iron_ore).toBeUndefined();
    expect(recipeUnlocked(s, 'r_iron_sword')).toBe(true);
    expect(recipeUnlocked(s, 'r_iron_armor')).toBe(true);
    expect(s.flags['unlock:r_iron_sword']).toBe(true);
    expect(s.gold).toBe(100);
  });
});

describe('可視と受注', () => {
  it('拠点の依頼は常に見え、他の街は訪れてから。受注中は全部見える', () => {
    const s = emptyState(1);
    const b = make(s, 't_hunt_goblin');
    const a = make(s, 't_deliver_herb');
    expect(visibleQuests(s).map((q) => q.id)).toEqual([b.id]);
    expect(accept(s, a.id, road).ok).toBe(false);
    s.world.visitedNodes = ['academy_town'];
    expect(visibleQuests(s).map((q) => q.id).sort()).toEqual([a.id, b.id].sort());
    expect(visibleBoards(s).map((x) => x.town)).toEqual(['base', 'academy_town']);
    expect(accept(s, a.id, road).ok).toBe(true);
    s.world.visitedNodes = [];
    expect(visibleQuests(s).map((q) => q.id)).toContain(a.id);
  });

  it('同時受注は3件まで。討伐の納期は最短所要×1.5、護衛は出発日', () => {
    const s = emptyState(1);
    const qs = [make(s, 't_hunt_goblin'), make(s, 't_deliver_fang'), make(s, 't_escort_village'), make(s, 't_hunt_goblin', 2)];
    expect(accept(s, qs[0].id, road).ok).toBe(true);
    expect(qs[0].dueDay).toBe(s.day + Math.ceil(3 * 1.5));
    expect(accept(s, qs[1].id, road).ok).toBe(true);
    expect(accept(s, qs[2].id, road).ok).toBe(true);
    const r = accept(s, qs[3].id, road);
    expect(r.ok).toBe(false);
    expect(qs[3].status).toBe('posted');
    expect(qs[2].dueDay).toBe(qs[2].departDay);
  });

  it('納品の納期は素材の産地までの往復+3日の2倍', () => {
    const s = emptyState(1);
    s.rep = 8;
    s.world.visitedNodes = ['forge_town'];
    const q = make(s, 't_deliver_ore');
    accept(s, q.id, road);
    const src = ITEM[q.target.item!].source;
    const lead = src && road('base', src) ? road('base', src)!.days * 2 + 3 : 3;
    expect(q.dueDay).toBe(s.day + lead * 2);
  });
});

describe('期限切れ', () => {
  it('受注前に acceptBy を過ぎると消え、評判は変わらない', () => {
    const s = emptyState(1);
    s.rep = 5;
    const q = make(s, 't_hunt_goblin');
    s.day = q.acceptBy!;
    expireQuests(s, []);
    expect(s.quests).toContain(q);
    s.day = q.acceptBy! + 1;
    expireQuests(s, []);
    expect(s.quests).not.toContain(q);
    expect(s.rep).toBe(5);
  });

  it('受注後に dueDay を過ぎると失敗・評判−1・お知らせ', () => {
    const s = emptyState(1);
    s.rep = 5;
    const q = make(s, 't_hunt_goblin');
    accept(s, q.id, road);
    s.day = q.dueDay! + 1;
    const notices: string[] = [];
    expireQuests(s, notices);
    expect(q.status).toBe('failed');
    expect(s.rep).toBe(4);
    expect(notices).toHaveLength(1);
  });

  it('依頼のために出ている隊がいる間は納期切れにしない', () => {
    const s = emptyState(1);
    const q = make(s, 't_escort_village');
    accept(s, q.id, road);
    s.day = q.departDay!;
    s.expeditions.push(expedition(s, {}, { action: 'escort', target: { questId: q.id, route: ['base', 'mountain_village'] } }));
    s.day = q.dueDay! + 2;
    expireQuests(s, []);
    expect(q.status).toBe('accepted');
  });
});

describe('納品', () => {
  it('在庫が足りなければ理由を返し、足りれば在庫が減って報酬が入る', () => {
    const s = emptyState(1);
    const q = make(s, 't_deliver_fang');
    accept(s, q.id, road);
    const n = q.target.n!;
    s.inventory.fang = n - 1;
    const r = deliver(s, q.id);
    expect(r.ok).toBe(false);
    s.inventory.fang = n + 2;
    expect(deliver(s, q.id).ok).toBe(true);
    expect(s.inventory.fang).toBe(2);
    expect(s.gold).toBe(q.rewardGold);
    expect(s.rep).toBe(q.rewardRep);
    expect(s.ledger[0].amount).toBe(q.rewardGold);
    expect(q.status).toBe('done');
    expect(deliver(s, q.id).ok).toBe(false);
  });
});

describe('帰還での進捗', () => {
  it('討伐は帰還ごとに kills を累計し、目標数で達成', () => {
    const s = emptyState(1);
    const q = make(s, 't_hunt_goblin');
    q.target.n = 5;
    accept(s, q.id, road);
    progressFromReturn(s, expedition(s, { kills: { goblin: 3, wolf: 2 } }));
    expect(q.progress).toBe(3);
    expect(q.status).toBe('accepted');
    progressFromReturn(s, expedition(s, { kills: { goblin: 3 } }));
    expect(q.status).toBe('done');
    expect(s.gold).toBe(q.rewardGold);
  });

  it('探索は指定ダンジョンの探索率が percent 以上で達成', () => {
    const s = emptyState(1);
    const q = make(s, 't_explore_cave');
    s.world.visitedNodes = ['academy_town'];
    accept(s, q.id, road);
    expect(q.target.percent).toBe(50);
    const floor = DUNGEON.forest_cave.floors[0];
    const grid = parseFloor(floor);
    const open = grid.cells.map((c, i) => (c.kind === 'wall' ? -1 : i)).filter((i) => i >= 0);
    s.dungeons.forest_cave.floors[floor.id].visited = open.slice(0, Math.floor(open.length * 0.3));
    progressFromReturn(s, expedition(s));
    expect(q.status).toBe('accepted');
    expect(q.progress).toBe(Math.floor((Math.floor(open.length * 0.3) / open.length) * 100));
    s.dungeons.forest_cave.floors[floor.id].visited = open.slice(0, Math.ceil(open.length * 0.5));
    progressFromReturn(s, expedition(s));
    expect(q.status).toBe('done');
  });

  it('護衛・運搬は対応する行動で全滅せず着けば達成、全滅なら未達', () => {
    const s = emptyState(1);
    const e = make(s, 't_escort_village');
    const t = make(s, 't_transport_village');
    s.world.visitedNodes = ['mountain_village'];
    accept(s, e.id, road);
    accept(s, t.id, road);
    progressFromReturn(s, expedition(s, { wiped: true }, { action: 'escort', target: { questId: e.id, route: ['base', 'mountain_village'] } }));
    expect(e.status).toBe('accepted');
    progressFromReturn(s, expedition(s, {}, { action: 'escort', target: { questId: e.id, route: ['base', 'mountain_village'] } }));
    expect(e.status).toBe('done');
    progressFromReturn(s, expedition(s, {}, { action: 'escort', target: { questId: t.id } }));
    expect(t.status).toBe('accepted');
    progressFromReturn(s, expedition(s, {}, { action: 'transport', target: { questId: t.id, route: ['mountain_village', 'base'] } }));
    expect(t.status).toBe('done');
  });

  it('completeQuest は評判Lvが上がると rep_milestone を積む', () => {
    const s = emptyState(1);
    s.rep = 7;
    const q = make(s, 't_hunt_goblin');
    accept(s, q.id, road);
    const notices: string[] = [];
    completeQuest(s, q, notices);
    expect(s.rep).toBeGreaterThanOrEqual(8);
    expect(s.pendingTags).toContain('rep_milestone');
    expect(s.repMilestones).toContain(2);
    expect(notices.length).toBeGreaterThan(0);
  });
});

describe('受付・見張り台', () => {
  const put = (s: GameState, id: string, x: number, level = 1) => {
    s.base.facilities.push({ id, level, x, y: 0, builtDay: 1, construction: null });
  };

  it('同時受注の上限は 3 + 受付(Lv1 で+1、Lv2 で+2)+ 市場と隣り合う帳場(+1)', () => {
    const s = emptyState(1);
    expect(ACTIVE_MAX).toBe(3);
    expect(activeMax(s)).toBe(3);
    put(s, 'reception', 0);
    expect(activeMax(s)).toBe(4);
    s.base.facilities[0].level = 2;
    expect(activeMax(s)).toBe(5);
    put(s, 'market', 1);
    expect(activeMax(s)).toBe(6);
  });

  it('受付 Lv1 なら4件目まで受けられ、5件目で断る', () => {
    const s = emptyState(1);
    put(s, 'reception', 0);
    const qs = [
      make(s, 't_hunt_goblin'), make(s, 't_deliver_fang'), make(s, 't_escort_village'), make(s, 't_hunt_goblin', 2),
      make(s, 't_deliver_fang', 2),
    ];
    for (const q of qs.slice(0, 4)) expect(accept(s, q.id, road), q.id).toEqual({ ok: true });
    expect(accept(s, qs[4].id, road)).toEqual({ ok: false, reason: '同時に受けられる依頼は4件までです' });
    expect(qs[4].status).toBe('posted');
  });

  it('拠点の掲示板は受付があると1件多く貼られる', () => {
    const posted = (withReception: boolean) => {
      const s = emptyState(3);
      if (withReception) put(s, 'reception', 0);
      runDays(s, 60);
      return s.quests.filter((q) => q.status === 'posted' && q.town === 'base' && q.type !== 'unlock').length;
    };
    expect(posted(false)).toBe(4);
    expect(posted(true)).toBe(5);
  });

  it('護衛・運搬の達成報酬は見張り台で1割増し、受付と隣り合う(護衛の手配)とさらに15%増し。他の依頼は変わらない', () => {
    const s = emptyState(1);
    put(s, 'watchtower', 0);
    const e = make(s, 't_escort_village');
    const notices: string[] = [];
    let g = s.gold;
    const paid = Math.round(e.rewardGold * 1.1);
    expect(paid).toBeGreaterThan(e.rewardGold);
    expect(questRewardGold(s, e)).toBe(paid);
    completeQuest(s, e, notices);
    expect(s.gold - g).toBe(paid);
    expect(s.ledger[0]).toMatchObject({ label: `依頼達成: ${e.name}`, amount: paid });
    expect(notices[0]).toContain(`報酬 ${paid}G`);
    put(s, 'reception', 1);
    const t = make(s, 't_transport_village');
    g = s.gold;
    completeQuest(s, t, []);
    expect(s.gold - g).toBe(Math.round(t.rewardGold * 1.25));
    const d = make(s, 't_deliver_fang');
    expect(questRewardGold(s, d)).toBe(d.rewardGold);
    g = s.gold;
    completeQuest(s, d, []);
    expect(s.gold - g).toBe(d.rewardGold);
  });
});
