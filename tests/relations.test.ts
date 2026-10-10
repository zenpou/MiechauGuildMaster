import { describe, expect, it } from 'vitest';
import { generateAdventurer } from '../src/core/adventurer';
import { addRelation, compatBase, getRelation, pairKey, relationLabel, relationMark } from '../src/core/relations';
import { rngFor } from '../src/core/rng';

const adv = (id: string, personality: string) => {
  const a = generateAdventurer(rngFor(1, id), { id });
  a.personality = personality;
  return a;
};

describe('関係値', () => {
  it('ペアのキーは順序に依らない', () => {
    expect(pairKey('a', 'b')).toBe(pairKey('b', 'a'));
  });
  it('性格の好き嫌いが初期値になる(片思いは+8、相思相愛は+16、嫌いは−8)', () => {
    expect(compatBase('cautious', 'caring')).toBe(16);   // 慎重→仲間思い 好き、仲間思い→慎重 好き
    expect(compatBase('greedy', 'proud')).toBe(16);      // 強欲→自信家 好き、自信家→強欲 好き
    expect(compatBase('cautious', 'brave')).toBe(-8);    // 慎重→勇敢 嫌い、勇敢→慎重 なし
    expect(compatBase('cautious', 'greedy')).toBe(-16);  // 互いに嫌い
  });
  it('未記録のペアは初期値を返し、加算すると記録される', () => {
    const rel: Record<string, number> = {};
    const a = adv('a', 'cautious'), b = adv('b', 'caring');
    expect(getRelation(rel, a, b)).toBe(16);
    expect(addRelation(rel, a, b, 5)).toBe(21);
    expect(getRelation(rel, b, a)).toBe(21);
  });
  it('−100〜100 に収まる', () => {
    const rel: Record<string, number> = {};
    const a = adv('a', 'brave'), b = adv('b', 'timid');
    expect(addRelation(rel, a, b, 500)).toBe(100);
    expect(addRelation(rel, a, b, -500)).toBe(-100);
  });
  it('ラベルと記号は段階で変わる', () => {
    expect(relationLabel(60)).toBe('親友');
    expect(relationLabel(0)).toBe('普通');
    expect(relationLabel(-30)).toBe('犬猿の仲');
    expect(relationMark(30)).toBe('◎');
    expect(relationMark(-30)).toBe('×');
  });
});
