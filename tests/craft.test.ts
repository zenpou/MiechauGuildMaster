import { describe, expect, it } from 'vitest';
import { activeSynergies, assignWorker } from '../src/core/base';
import { availableRecipes, canCraft, craftDays, craftGold, startCraft } from '../src/core/craft';
import { FACILITY, RECIPE, RECIPES } from '../src/core/data';
import { advanceDay, newGame } from '../src/core/game';
import { recipeUnlocked } from '../src/core/quests';
import type { GameState } from '../src/core/types';

function rich(seed = 9): GameState {
  const s = newGame(seed);
  s.gold = 5000;
  s.inventory = { ...s.inventory, iron_ore: 20, fang: 20, herb: 20, slime_gel: 20, bone_shard: 20, moss_ore: 20, glow_moss: 20 };
  // 鉄の装備は鍛冶の街の解放依頼で開く。ここは製作の仕組みのテストなので解放済みにする
  s.flags['unlock:u_forge_iron'] = true;
  s.flags['unlock:r_iron_sword'] = true;
  s.flags['unlock:r_iron_armor'] = true;
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
    // 装備が増えるたびに固定の一覧を書き直さない。工房のレシピのうち、解放済みのものが全部出ればよい
    const ids = availableRecipes(s).map((r) => r.id);
    expect(ids).toEqual(RECIPES.filter((r) => r.facility === 'workshop' && recipeUnlocked(s, r.id)).map((r) => r.id));
    expect(ids).toContain('r_iron_sword');
    // 竜を倒すまでは竜鱗の装備が出ない
    expect(ids).not.toContain('r_scale_mail');
    expect(ids).not.toContain('r_dragon_blade');
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

describe('鍛冶場の製作費の割引', () => {
  it('鍛冶場 Lv1 で15%引き、Lv2 で30%引き、工房と隣り合う(鍛冶と細工)とさらに10%引き。端数は四捨五入', () => {
    const s = rich();
    const r = RECIPE.r_iron_sword;
    place(s, 'workshop', 0, 0);
    expect(craftGold(s, r.id)).toBe(r.gold);
    place(s, 'smithy', 2, 0);
    expect(craftGold(s, r.id)).toBe(Math.round(r.gold * 0.85));
    s.base.facilities[1].level = 2;
    expect(craftGold(s, r.id)).toBe(Math.round(r.gold * 0.7));
    s.base.facilities[1].x = 1;
    expect(activeSynergies(s).map((x) => x.id)).toEqual(['forge_works']);
    expect(craftGold(s, r.id)).toBe(Math.round(r.gold * 0.6));
    // 割引は工房の品に限らない
    place(s, 'alchemy', 4, 4);
    const potion = RECIPES.find((x) => x.facility === 'alchemy')!;
    expect(craftGold(s, potion.id)).toBe(Math.round(potion.gold * 0.6));
  });

  it('割り引いた額で足りるなら作れて、その額を払う(台帳も同じ額)', () => {
    const s = rich();
    const r = RECIPE.r_iron_sword;
    place(s, 'workshop', 0, 0);
    place(s, 'smithy', 0, 1, 2);
    const price = craftGold(s, r.id);
    expect(price).toBeLessThan(r.gold);
    s.gold = price;
    expect(canCraft(s, r.id)).toEqual({ ok: true });
    expect(startCraft(s, r.id)).toEqual({ ok: true });
    expect(s.gold).toBe(0);
    expect(s.ledger[0]).toMatchObject({ label: `製作: ${r.name}`, amount: -price });
    s.gold = price - 1;
    s.crafts = [];
    expect(canCraft(s, r.id)).toEqual({ ok: false, reason: '資金が足りません' });
  });

  it('割引は8割で頭打ち', () => {
    const s = rich();
    const r = RECIPE.r_iron_sword;
    place(s, 'workshop', 0, 0);
    place(s, 'smithy', 0, 1, 2);
    const eff = FACILITY.smithy.effects[1];
    const saved = eff.craftGoldOff;
    eff.craftGoldOff = 0.95;
    try {
      expect(craftGold(s, r.id)).toBe(Math.round(r.gold * 0.2));
    } finally {
      eff.craftGoldOff = saved;
    }
  });
});
