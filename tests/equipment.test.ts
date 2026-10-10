import { describe, expect, it } from 'vitest';
import { effectiveStats, generateAdventurer } from '../src/core/adventurer';
import { ITEM, ITEMS } from '../src/core/data';
import { canEquip, equip, unequip } from '../src/core/equipment';
import { runExploration } from '../src/core/explore';
import { rngFor } from '../src/core/rng';
import type { Adventurer, DungeonDef, GameState } from '../src/core/types';

// テストリスト
// [x] items.json に装備6種と上回復薬が表どおりある
// [x] 装備で atk/def が増える
// [x] 重装(鉄の鎧)は僧侶に着けられない
// [x] 派遣中は付け替え不可
// [x] 装備すると在庫が減り、外すと戻る。付け替えで前の物は在庫へ
// [x] 在庫が無い・装備品でない物は断る
// [x] gather 効果で採取量+1
// [x] equipment が無い旧データでも装備できる

function adv(id: string, job: string): Adventurer {
  const a = generateAdventurer(rngFor(1, 'eq', id), { id });
  a.job = job;
  a.status = 'idle';
  a.equipment = { weapon: null, armor: null, accessory: null };
  return a;
}

/** equip / unequip が触るのは adventurers と inventory だけ */
function state(advs: Adventurer[], inventory: Record<string, number>): GameState {
  return { adventurers: advs, inventory } as unknown as GameState;
}

describe('装備の定義', () => {
  it('装備6種と上回復薬が表どおり', () => {
    const want: Record<string, [string, Record<string, number>]> = {
      bone_dagger: ['weapon', { atk: 3, spd: 1 }],
      iron_sword: ['weapon', { atk: 5 }],
      leather_armor: ['armor', { def: 3 }],
      iron_armor: ['armor', { def: 6, spd: -1 }],
      fang_necklace: ['accessory', { atk: 1 }],
      moss_charm: ['accessory', { scout: 2 }],
    };
    for (const [id, [slot, mods]] of Object.entries(want)) {
      const it = ITEM[id];
      expect(it.kind).toBe(slot);
      expect(it.equip!.slot).toBe(slot);
      expect(it.equip!.mods).toEqual(mods);
      expect(it.weight).toBeGreaterThanOrEqual(1);
      expect(it.weight).toBeLessThanOrEqual(3);
      expect(it.price).toBeGreaterThan(0);
    }
    expect(ITEM.leather_armor.equip!.armorClass).toBe('light');
    expect(ITEM.iron_armor.equip!.armorClass).toBe('heavy');
    expect(ITEM.iron_armor.equip!.resist).toEqual({ earth: 0.2 });
    expect(ITEM.moss_charm.equip!.resist).toEqual({ dark: 0.3 });
    expect(ITEM.fang_necklace.equip!.effects).toEqual({ gather: 1 });
    expect(ITEM.hi_potion.consumable).toEqual({ effect: 'heal', params: { ratio: 0.7 } });
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });
});

describe('equip / unequip', () => {
  it('装備で atk/def が増え、在庫が減る', () => {
    const a = adv('a', 'fighter');
    const s = state([a], { iron_sword: 1, leather_armor: 2 });
    const before = effectiveStats(a);
    expect(equip(s, 'a', 'iron_sword')).toEqual({ ok: true });
    expect(equip(s, 'a', 'leather_armor')).toEqual({ ok: true });
    expect(a.equipment).toEqual({ weapon: 'iron_sword', armor: 'leather_armor', accessory: null });
    expect(s.inventory.iron_sword ?? 0).toBe(0);
    expect(s.inventory.leather_armor).toBe(1);
    const after = effectiveStats(a);
    expect(after.atk).toBe(before.atk + 5);
    expect(after.def).toBe(before.def + 3);
  });

  it('外すと在庫に戻る。付け替えで前の物も在庫に戻る', () => {
    const a = adv('a', 'fighter');
    const s = state([a], { iron_sword: 1, bone_dagger: 1 });
    equip(s, 'a', 'iron_sword');
    expect(equip(s, 'a', 'bone_dagger')).toEqual({ ok: true });
    expect(a.equipment.weapon).toBe('bone_dagger');
    expect(s.inventory.iron_sword).toBe(1);
    expect(s.inventory.bone_dagger ?? 0).toBe(0);
    expect(unequip(s, 'a', 'weapon')).toEqual({ ok: true });
    expect(a.equipment.weapon).toBeNull();
    expect(s.inventory.bone_dagger).toBe(1);
    expect(unequip(s, 'a', 'weapon').ok).toBe(false);
  });

  it('重装(鉄の鎧)は僧侶に着けられず、戦士には着けられる', () => {
    const priest = adv('p', 'priest');
    const warrior = adv('w', 'warrior');
    const s = state([priest, warrior], { iron_armor: 1 });
    const r = canEquip(priest, 'iron_armor');
    expect(r.ok).toBe(false);
    expect(equip(s, 'p', 'iron_armor').ok).toBe(false);
    expect(s.inventory.iron_armor).toBe(1);
    expect(equip(s, 'w', 'iron_armor')).toEqual({ ok: true });
  });

  it('派遣中・勤務中は付け替えできない', () => {
    const a = adv('a', 'fighter');
    const s = state([a], { iron_sword: 1 });
    equip(s, 'a', 'iron_sword');
    s.inventory.bone_dagger = 1;
    for (const status of ['away', 'working'] as const) {
      a.status = status;
      expect(equip(s, 'a', 'bone_dagger').ok).toBe(false);
      expect(unequip(s, 'a', 'weapon').ok).toBe(false);
    }
    expect(a.equipment.weapon).toBe('iron_sword');
    expect(s.inventory.bone_dagger).toBe(1);
  });

  it('在庫が無い物・装備品でない物は断る', () => {
    const a = adv('a', 'fighter');
    const s = state([a], { herb: 3, potion: 1 });
    expect(equip(s, 'a', 'iron_sword').ok).toBe(false);
    expect(equip(s, 'a', 'herb').ok).toBe(false);
    expect(equip(s, 'a', 'potion').ok).toBe(false);
    expect(equip(s, 'a', 'no_such_item').ok).toBe(false);
    expect(equip(s, 'nobody', 'herb').ok).toBe(false);
    expect(s.inventory).toEqual({ herb: 3, potion: 1 });
  });

  it('equipment が無い旧データでも装備できる', () => {
    const a = adv('a', 'fighter');
    delete (a as Partial<Adventurer>).equipment;
    const s = state([a], { fang_necklace: 1 });
    expect(canEquip(a, 'fang_necklace')).toEqual({ ok: true });
    expect(equip(s, 'a', 'fang_necklace')).toEqual({ ok: true });
    expect(a.equipment).toEqual({ weapon: null, armor: null, accessory: 'fang_necklace' });
  });
});

describe('採取の効果', () => {
  const herbRoad: DungeonDef = {
    id: 'herb_road', name: '薬草の道', desc: '', node: 'herb_road',
    floors: [{ id: 'f1', name: '1階', rows: ['#####', '#E.h#', '#####'],
      legend: { '#': { kind: 'wall' }, '.': { kind: 'floor' }, E: { kind: 'entrance' }, h: { kind: 'gather', item: 'herb' } } }],
    enemies: [], recommended: 1, rescueCost: 0, encounterRate: 0,
  };
  const herbs = (seed: number, accessory: string | null) => {
    const members = ['fighter', 'gatherer'].map((job, i) => adv(`m${i}`, job));
    for (const m of members) m.equipment.accessory = accessory;
    return runExploration({
      rng: rngFor(seed, 'gather-eq'), dungeon: herbRoad, floorId: 'f1', members, leaderId: 'm0', policy: 'standard',
      progress: { confirmed: true, floors: {}, bossDefeated: 0, fullCleared: false },
      days: 1, items: {}, relations: {}, startDay: 0, action: 'explore',
    }).result.materials.herb ?? 0;
  };

  it('牙の首飾りの gather 効果で採取量が隊の合計分だけ増える', () => {
    let hits = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const bare = herbs(seed, null);
      if (bare === 0) continue;
      hits++;
      // 2人とも首飾りで +2
      expect(herbs(seed, 'fang_necklace')).toBe(bare + 2);
    }
    expect(hits).toBeGreaterThan(0);
  });
});
