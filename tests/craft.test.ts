import { describe, expect, it } from 'vitest';
import { assignWorker } from '../src/core/base';
import { availableRecipes, canCraft, craftDays, startCraft } from '../src/core/craft';
import { advanceDay, newGame } from '../src/core/game';
import type { GameState } from '../src/core/types';

function rich(seed = 9): GameState {
  const s = newGame(seed);
  s.gold = 5000;
  s.inventory = { ...s.inventory, iron_ore: 20, fang: 20, herb: 20, slime_gel: 20, bone_shard: 20, moss_ore: 20, glow_moss: 20 };
  return s;
}

function place(s: GameState, id: string, x: number, y: number, level = 1) {
  s.base.facilities.push({ id, level, x, y, builtDay: 1, construction: null });
}

describe('レシピ', () => {
  it('施設が無ければ作れず、完成済みの施設のレシピだけ出る', () => {
    const s = rich();
    expect(availableRecipes(s)).toEqual([]);
    expect(canCraft(s, 'r_iron_sword').ok).toBe(false);
    place(s, 'workshop', 0, 0);
    expect(availableRecipes(s).map((r) => r.id)).toEqual([
      'r_bone_dagger', 'r_iron_sword', 'r_leather_armor', 'r_iron_armor', 'r_fang_necklace', 'r_moss_charm',
    ]);
    s.base.facilities.push({ id: 'alchemy', level: 0, x: 3, y: 3, builtDay: 1, construction: { toLevel: 1, untilDay: 9 } });
    expect(availableRecipes(s).some((r) => r.facility === 'alchemy')).toBe(false);
  });
});

describe('craftDays', () => {
  it('基本日数 − 施設Lv2 − 勤務者の能力12以上 − 職人通り、最低1日', () => {
    const s = rich();
    place(s, 'workshop', 0, 0);
    expect(craftDays(s, 'r_iron_sword')).toBe(3);
    s.base.facilities[0].level = 2;
    expect(craftDays(s, 'r_iron_sword')).toBe(2);
    const w = s.adventurers[0];
    w.base.dex = 99;
    expect(assignWorker(s, w.id, 'workshop').ok).toBe(true);
    expect(craftDays(s, 'r_iron_sword')).toBe(1);
    expect(craftDays(s, 'r_iron_armor')).toBe(2);
    place(s, 'alchemy', 1, 0);
    expect(craftDays(s, 'r_iron_armor')).toBe(1);
    expect(craftDays(s, 'r_fang_necklace')).toBe(1);
    expect(craftDays(s, 'r_potion')).toBe(1);
  });

  it('勤務者の能力が12未満なら短くならない。シナジーは工房側にも効く', () => {
    const s = rich();
    place(s, 'workshop', 0, 0);
    const w = s.adventurers[0];
    w.base.dex = 1;
    assignWorker(s, w.id, 'workshop');
    expect(craftDays(s, 'r_iron_armor')).toBe(4);
    place(s, 'alchemy', 0, 1);
    expect(craftDays(s, 'r_iron_armor')).toBe(3);
    expect(craftDays(s, 'r_potion')).toBe(1);
  });
});

describe('startCraft', () => {
  it('素材と資金を引き、完成日に在庫へ入る。同じ施設は同時に1件', () => {
    const s = rich();
    place(s, 'workshop', 0, 0);
    expect(startCraft(s, 'r_iron_sword').ok).toBe(true);
    expect(s.gold).toBe(5000 - 80);
    expect(s.inventory.iron_ore).toBe(17);
    expect(s.inventory.fang).toBe(18);
    expect(s.crafts).toHaveLength(1);
    expect(s.crafts[0]).toMatchObject({ recipeId: 'r_iron_sword', startDay: 1, doneDay: 4 });
    expect(canCraft(s, 'r_bone_dagger').ok).toBe(false);
    advanceDay(s);
    advanceDay(s);
    expect(s.inventory.iron_sword).toBeUndefined();
    advanceDay(s);
    expect(s.inventory.iron_sword).toBe(1);
    expect(s.crafts).toEqual([]);
    expect(s.notices.some((n) => n.text.includes('鉄の剣'))).toBe(true);
    expect(canCraft(s, 'r_bone_dagger').ok).toBe(true);
  });

  it('素材・資金が足りなければ断り、状態を変えない', () => {
    const s = rich();
    place(s, 'workshop', 0, 0);
    s.inventory.iron_ore = 2;
    const before = structuredClone(s);
    expect(startCraft(s, 'r_iron_sword').ok).toBe(false);
    expect(s).toEqual(before);
    s.inventory.iron_ore = 20;
    s.gold = 79;
    const before2 = structuredClone(s);
    expect(startCraft(s, 'r_iron_sword').ok).toBe(false);
    expect(s).toEqual(before2);
    expect(startCraft(s, 'nope').ok).toBe(false);
  });

  it('回復薬は2個、調合所Lv2で産出+1', () => {
    const s = rich();
    place(s, 'alchemy', 0, 0);
    const p0 = s.inventory.potion ?? 0;
    expect(startCraft(s, 'r_potion').ok).toBe(true);
    advanceDay(s);
    expect(s.inventory.potion).toBe(p0 + 2);
    s.base.facilities[0].level = 2;
    expect(startCraft(s, 'r_potion').ok).toBe(true);
    advanceDay(s);
    expect(s.inventory.potion).toBe(p0 + 5);
  });

  it('工房と調合所は並行して作れる', () => {
    const s = rich();
    place(s, 'workshop', 0, 0);
    place(s, 'alchemy', 4, 4);
    expect(startCraft(s, 'r_fang_necklace').ok).toBe(true);
    expect(startCraft(s, 'r_potion').ok).toBe(true);
    expect(s.crafts).toHaveLength(2);
  });
});
