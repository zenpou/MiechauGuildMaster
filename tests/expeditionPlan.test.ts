import { describe, expect, it } from 'vitest';
import { advanceDay, dispatch } from '../src/core/game';
import { draftFromExpedition } from '../src/core/expeditionPlan';
import { fullGame } from './helpers';

function returned() {
  const s = fullGame(7);
  const ids = s.adventurers.map((a) => a.id);
  const sent = dispatch(s, {
    partyIds: ids, leaderId: ids[0], action: 'explore', policy: 'standard',
    target: { dungeon: 'forest_cave', floor: 'f1' }, days: 1, items: { potion: 1 },
  });
  if (!sent.ok) throw new Error(sent.reason);
  while (!sent.expedition.claimed) advanceDay(s);
  return { s, e: sent.expedition };
}

describe('帰還から次の派遣を準備する', () => {
  it('準備は派遣や消耗品使用をせず、帰還前の結果も読ませない', () => {
    const { s, e } = returned();
    const before = structuredClone(s);
    const draft = draftFromExpedition(s, e);
    expect(draft.ok).toBe(true);
    expect(s).toEqual(before);
    expect(draftFromExpedition(s, { ...e, claimed: false }).ok).toBe(false);
  });

  it('負傷中・不在の人を外して理由を出し、薬は在庫まで、祝福は再選択にする', () => {
    const { s, e } = returned();
    for (const m of s.adventurers) { m.status = 'idle'; m.injuryDays = 0; }
    s.adventurers[0].injuryDays = 2;
    s.adventurers[1].status = 'away';
    s.inventory.potion = 0;
    e.order.blessed = true;
    const draft = draftFromExpedition(s, e);
    if (!draft.ok) throw new Error(draft.reason);
    expect(draft.order.partyIds).toEqual(s.adventurers.slice(2).map((m) => m.id));
    expect(draft.order.leaderId).toBe(s.adventurers[2].id);
    expect(draft.order.items).toEqual({});
    expect(draft.order.blessed).toBe(false);
    expect(draft.notes.join(' ')).toContain('負傷');
    expect(draft.notes.join(' ')).toContain('派遣中');
    expect(draft.notes.join(' ')).toContain('回復薬');
  });

  it('発見していない採取点や未解禁の階へは案内しない', () => {
    const { s, e } = returned();
    expect(draftFromExpedition(s, e, { dungeon: 'forest_cave', floor: 'f1', action: 'gather', item: 'crystal' }).ok).toBe(false);
    expect(draftFromExpedition(s, e, { dungeon: 'ruined_tower', floor: 'f2', action: 'explore' }).ok).toBe(false);
  });
});
