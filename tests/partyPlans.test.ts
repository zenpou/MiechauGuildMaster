import { describe, expect, it } from 'vitest';
import { advanceDay, dailyRestRecovery } from '../src/core/game';
import { draftFromPartyPlan, memberUnavailableReason } from '../src/core/expeditionPlan';
import { deserialize, migrate, serialize } from '../src/core/save';
import { savePartyPlan, deletePartyPlan } from '../src/core/partyPlans';
import type { DispatchOrder } from '../src/core/types';
import { fullGame } from './helpers';

function order(s: ReturnType<typeof fullGame>, partyIds = s.adventurers.map((a) => a.id)): DispatchOrder {
  return {
    partyIds,
    leaderId: partyIds[0],
    action: 'explore',
    target: { dungeon: 'forest_cave', floor: 'f1' },
    policy: 'standard',
    days: 2,
    items: { potion: 1 },
    blessed: true,
  };
}

describe('保存編成', () => {
  it('深いコピーで保存し、出発に関わる値を変えない', () => {
    const s = fullGame(31);
    const before = { gold: s.gold, inventory: structuredClone(s.inventory), blessing: structuredClone(s.blessing), counters: structuredClone(s.counters) };
    const source = order(s);
    const result = savePartyPlan(s, '  探索隊  ', source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    source.partyIds.reverse();
    source.items.potion = 99;
    source.target.floor = 'f2';
    expect(result.plan.name).toBe('探索隊');
    expect(result.plan.order.partyIds).toEqual(s.adventurers.map((a) => a.id));
    expect(result.plan.order.items).toEqual({ potion: 1 });
    expect(result.plan.order.target.floor).toBe('f1');
    expect(result.plan.order.blessed).toBe(false);
    expect(s.gold).toBe(before.gold);
    expect(s.inventory).toEqual(before.inventory);
    expect(s.blessing).toEqual(before.blessing);
    expect(s.counters).toEqual(before.counters);
  });

  it('4件を上限にし、既存IDの置き換えと削除を行う', () => {
    const s = fullGame(32);
    for (let i = 1; i <= 4; i++) expect(savePartyPlan(s, `隊${i}`, order(s)).ok).toBe(true);
    expect(s.partyPlans.map((p) => p.id)).toEqual(['party-plan-1', 'party-plan-2', 'party-plan-3', 'party-plan-4']);
    expect(savePartyPlan(s, '5隊', order(s)).ok).toBe(false);
    const replaced = savePartyPlan(s, '変更後', order(s, [s.adventurers[1].id]), 'party-plan-2');
    expect(replaced.ok).toBe(true);
    expect(s.partyPlans[1].name).toBe('変更後');
    expect(deletePartyPlan(s, 'party-plan-4')).toEqual({ ok: true });
    expect(deletePartyPlan(s, 'party-plan-4')).toEqual({ ok: false, reason: 'その編成はありません' });
  });

  it('依頼行動・重複隊員・未知の指定を保存しない', () => {
    const s = fullGame(33);
    expect(savePartyPlan(s, '護衛', { ...order(s), action: 'escort' }).ok).toBe(false);
    expect(savePartyPlan(s, '重複', order(s, [s.adventurers[0].id, s.adventurers[0].id])).ok).toBe(false);
    expect(savePartyPlan(s, '不明', { ...order(s), target: { dungeon: 'missing', floor: 'f1' } }).ok).toBe(false);
    expect(savePartyPlan(s, '長すぎる名前'.repeat(10), order(s)).ok).toBe(false);
    expect(savePartyPlan(s, '欠員', order(s, ['missing'])).ok).toBe(false);
  });

  it('忙しい・負傷・名簿から消えた隊員を下書きから外し、隊長を繰り上げる', () => {
    const s = fullGame(34);
    const ids = s.adventurers.map((a) => a.id);
    s.adventurers[0].status = 'working';
    s.adventurers[1].injuryDays = 2;
    const saved = savePartyPlan(s, '再派遣', order(s, ids));
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.reason);
    s.adventurers.splice(2, 1);
    s.inventory.potion = 0;
    const draft = draftFromPartyPlan(s, saved.plan.id);
    expect(draft.ok).toBe(true);
    if (!draft.ok) throw new Error(draft.reason);
    expect(draft.order.partyIds).toEqual([ids[3]]);
    expect(draft.order.leaderId).toBe(ids[3]);
    expect(draft.order.items).toEqual({});
    expect(draft.notes.join(' ')).toContain('施設勤務中');
    expect(draft.notes.join(' ')).toContain('負傷');
    expect(draft.notes.join(' ')).toContain('名簿にいない');
    expect(draft.notes.join(' ')).toContain('回復薬');
    expect(memberUnavailableReason(s, s.adventurers[0])).toContain('施設勤務中');
  });

  it('全員が派遣中・訓練中・休暇約束なら空の下書きになり、stateと保存編成を変えない', () => {
    const s = fullGame(341);
    const ids = s.adventurers.slice(0, 3).map((a) => a.id);
    const saved = savePartyPlan(s, '全員不在', order(s, ids));
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.reason);
    s.adventurers.find((a) => a.id === ids[0])!.status = 'away';
    const training = s.adventurers.find((a) => a.id === ids[1])!;
    training.status = 'training';
    training.assignment = { training: 'tough', untilDay: s.day + 3 };
    s.flags[`rest:${ids[2]}`] = s.day;
    const before = structuredClone(s);
    const draft = draftFromPartyPlan(s, saved.plan.id);
    expect(draft.ok).toBe(true);
    if (!draft.ok) throw new Error(draft.reason);
    expect(draft.order.partyIds).toEqual([]);
    expect(draft.order.leaderId).toBe('');
    expect(draft.notes.join(' ')).toContain('派遣中');
    expect(draft.notes.join(' ')).toContain('訓練中');
    expect(draft.notes.join(' ')).toContain('休ませています');
    expect(draft.notes.join(' ')).toContain('出発できる隊員を選んでください');
    expect(s).toEqual(before);
    expect(s.partyPlans[0]).toEqual(saved.plan);
  });

  it('噂の survey は維持し、確認後は explore に変える', () => {
    const s = fullGame(35);
    const source = order(s, [s.adventurers[0].id]);
    source.action = 'survey';
    source.target = { dungeon: 'old_mine', floor: 'f1' };
    const saved = savePartyPlan(s, '踏査', source);
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.reason);
    const rumor = draftFromPartyPlan(s, saved.plan.id);
    expect(rumor.ok).toBe(true);
    if (!rumor.ok) throw new Error(rumor.reason);
    expect(rumor.order.action).toBe('survey');
    s.dungeons.old_mine.confirmed = true;
    const confirmed = draftFromPartyPlan(s, saved.plan.id);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error(confirmed.reason);
    expect(confirmed.order.action).toBe('explore');
  });
});

describe('編成データの互換性', () => {
  it('serialize/deserialize roundtrip と壊れた編成だけの除去を行う', () => {
    const s = fullGame(36);
    const saved = savePartyPlan(s, '保存', order(s));
    expect(saved.ok).toBe(true);
    const loaded = deserialize(serialize(s));
    expect(loaded?.partyPlans).toEqual(s.partyPlans);
    const raw = JSON.parse(serialize(s));
    raw.partyPlans[0].order.partyIds = ['old-member'];
    raw.partyPlans[0].order.leaderId = 'old-member';
    raw.partyPlans = [
      null,
      ...raw.partyPlans,
      { id: 'party-plan-1', name: '重複', order: order(s) },
      { id: 'bad', name: '', order: order(s) },
      { id: 'missing-order', name: '壊れ', order: { action: 'escort' } },
      { id: 'bad-dungeon', name: '壊れた行き先', order: { ...order(s), target: { dungeon: 'constructor' } } },
    ];
    const migrated = migrate(raw)!;
    expect(migrated.partyPlans).toHaveLength(2);
    expect(migrated.partyPlans.some((p) => p.order.partyIds.includes('old-member'))).toBe(true);
    const old = JSON.parse(serialize(s));
    delete old.partyPlans;
    expect(migrate(old)!.partyPlans).toEqual([]);
  });
});

describe('休養見通し', () => {
  it('施設効果を含む予測値が待機・勤務・訓練の日送り結果と一致する', () => {
    const s = fullGame(37);
    s.base.facilities.push({ id: 'bath', level: 1, x: 0, y: 0, builtDay: s.day, construction: null });
    s.adventurers[0].status = 'idle';
    s.adventurers[1].status = 'working';
    s.adventurers[1].assignment = { facility: 'workshop' };
    s.adventurers[2].status = 'training';
    s.adventurers[2].assignment = { training: 'tough', untilDay: s.day + 3 };
    const before = s.adventurers.slice(0, 3).map((a, i) => a.fatigue = [80, 70, 60][i]);
    const recovery = dailyRestRecovery(s);
    expect(recovery).toBe(33);
    advanceDay(s);
    expect(s.adventurers.slice(0, 3).map((a) => a.fatigue)).toEqual(before.map((fatigue) => Math.max(0, fatigue - recovery)));
  });
});
