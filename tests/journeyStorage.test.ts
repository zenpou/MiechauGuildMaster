import { describe, expect, it } from 'vitest';
import { packJourney, unpackJourney } from '../src/core/journeyStorage';
import { dispatch } from '../src/core/game';
import { deserialize, serialize } from '../src/core/save';
import { fullGame } from './helpers';

function expedition() {
  const state = fullGame(271);
  const ids = state.adventurers.map(m => m.id);
  const result = dispatch(state, {
    partyIds: ids, leaderId: ids[0], action: 'explore', target: { dungeon: 'forest_cave', floor: 'f1' },
    policy: 'standard', days: 7, items: {},
  });
  if (!result.ok) throw new Error(result.reason);
  return { state, journey: result.expedition.journey! };
}

describe('行程記録の保存形式', () => {
  it('文字数を減らしても、HP・顔・移動・文章を欠落なく復元する', () => {
    const { journey, state } = expedition();
    const before = JSON.stringify(journey);
    const packed = JSON.stringify(packJourney(journey));
    expect(packed.length).toBeLessThan(before.length * .8);
    expect(unpackJourney(JSON.parse(packed))).toEqual(JSON.parse(before));
    expect(JSON.stringify(journey)).toBe(before);
    expect(deserialize(serialize(state))!.expeditions[0].journey).toEqual(JSON.parse(before));
  });
  it('初期版・破損した圧縮記録・非連続の順序番号を扱う', () => {
    const { journey } = expedition();
    expect(unpackJourney(journey)).toBe(journey);
    const sparse = { ...journey, frames: journey.frames.filter((_, i) => i % 2 === 0) };
    expect(unpackJourney(packJourney(sparse))).toEqual(sparse);
    expect(unpackJourney({ ...packJourney(journey) as object, frames: [null] })).toBeUndefined();
    expect(unpackJourney({ encoding: 'unknown' })).toBeUndefined();
  });
});
