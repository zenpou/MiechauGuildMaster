import { describe, expect, it } from 'vitest';
import { DUNGEONS, ENEMIES, ENEMY, FACILITIES, FACILITY, ITEM, JOBS, LOWER_JOBS, PERSONALITIES, RECIPES, ROLE_SKILLS, SYNERGIES, TUNING, UPPER_JOBS, upperJobsFrom } from '../src/core/data';
import { Rng, rngFor } from '../src/core/rng';
import { deserialize, load, migrate, save, serialize, type KeyValueStore } from '../src/core/save';
import { newGame } from '../src/core/game';
import { ROLE_IDS, SAVE_VERSION } from '../src/core/types';

describe('rng', () => {
  it('同seedで同じ列を返す', () => {
    const a = new Rng(42), b = new Rng(42);
    expect(Array.from({ length: 10 }, () => a.next())).toEqual(Array.from({ length: 10 }, () => b.next()));
  });
  it('タグが違えば別の列になる', () => {
    expect(rngFor(1, 'a').next()).not.toBe(rngFor(1, 'b').next());
  });
});

describe('職業(第6節)', () => {
  it('下級5・上級5', () => {
    expect(LOWER_JOBS).toHaveLength(5);
    expect(UPPER_JOBS).toHaveLength(5);
  });
  it('下級は役割1つで、5役を1つずつ受け持つ', () => {
    const roles = LOWER_JOBS.map((j) => j.roles).flat();
    expect(LOWER_JOBS.every((j) => j.roles.length === 1)).toBe(true);
    expect([...roles].sort()).toEqual([...ROLE_IDS].sort());
  });
  it('上級は隣り合う2役で、入口は役割に対応する下級2つ', () => {
    for (const u of UPPER_JOBS) {
      expect(u.roles).toHaveLength(2);
      expect(u.from).toHaveLength(2);
      const fromRoles = u.from!.map((f) => LOWER_JOBS.find((l) => l.id === f)!.roles[0]);
      expect([...fromRoles].sort()).toEqual([...u.roles].sort());
    }
  });
  it('五角形: 各下級から分岐2つ、各上級へ入口2つ', () => {
    for (const l of LOWER_JOBS) expect(upperJobsFrom(l.id)).toHaveLength(2);
    const pairs = new Set(UPPER_JOBS.map((u) => [...u.roles].sort().join('+')));
    expect(pairs.size).toBe(5);
  });
  it('idが重複しない', () => {
    expect(new Set(JOBS.map((j) => j.id)).size).toBe(JOBS.length);
  });
});

describe('性格(第6節)', () => {
  it('6種それぞれに探索挙動がある', () => {
    expect(PERSONALITIES).toHaveLength(6);
    for (const p of PERSONALITIES) {
      expect(p.explore.venture).toBeGreaterThanOrEqual(0);
      expect(p.explore.venture).toBeLessThanOrEqual(1);
      expect(p.explore.thorough).toBeGreaterThanOrEqual(0);
      expect(p.explore.thorough).toBeLessThanOrEqual(1);
      expect(p.explore.speed).toBeGreaterThan(0);
    }
  });
  it('好き嫌いは実在する性格を指す', () => {
    const ids = new Set(PERSONALITIES.map((p) => p.id));
    for (const p of PERSONALITIES) for (const x of [...p.likes, ...p.dislikes]) expect(ids.has(x)).toBe(true);
  });
});

describe('save', () => {
  const memStore = (): KeyValueStore & { data: Record<string, string> } => {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  };
  it('直列化して戻すと同じ状態', () => {
    const s = newGame(7, 'テスト');
    s.gold = 123;
    expect(deserialize(serialize(s))).toEqual(s);
  });
  it('足りない項目は既定値で埋まる(セーブ互換)', () => {
    const old = { seed: 3, day: 5, gold: 10 };
    const s = migrate(old)!;
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.day).toBe(5);
    expect(s.gold).toBe(10);
    expect(s.mails).toEqual([]);
    expect(s.base.width).toBe(5);
  });
  it('古いセーブに無いダンジョンの進捗は初期値で埋まる(forest_cave は確認済み、他は噂)', () => {
    const s = migrate({ seed: 3, day: 5, dungeons: { forest_cave: { confirmed: true, floors: { f1: { visited: [0, 1], hiddenFound: [] } }, bossDefeated: 0, fullCleared: false } } })!;
    expect(s.dungeons.forest_cave.floors.f1.visited).toEqual([0, 1]);
    expect(s.dungeons.old_mine).toBeDefined();
    expect(s.dungeons.old_mine.confirmed).toBe(false);
    expect(s.dungeons.old_mine.floors.f1.visited).toEqual([]);
  });
  it('壊れたデータは null', () => {
    expect(deserialize('{nope')).toBeNull();
    expect(migrate({})).toBeNull();
  });
  it('store に保存して読み戻せる', () => {
    const store = memStore();
    const s = newGame(9);
    expect(save(store, s)).toBe(true);
    expect(load(store)).toEqual(s);
  });
});

describe('データの整合(JSON同士の参照)', () => {
  it('役割スキルは5役に1つずつ', () => {
    expect([...ROLE_SKILLS.map((s) => s.role)].sort()).toEqual([...ROLE_IDS].sort());
  });
  it('敵のドロップは実在するアイテム', () => {
    for (const e of ENEMIES) for (const l of e.loot) expect(ITEM[l.item], `${e.id} の loot ${l.item}`).toBeDefined();
  });
  it('レシピの施設・出力・素材、施設の建材、シナジーの施設は実在するIDを指す', () => {
    for (const r of RECIPES) {
      expect(FACILITY[r.facility], `${r.id} の facility`).toBeDefined();
      expect(ITEM[r.output.item], `${r.id} の output`).toBeDefined();
      for (const i of r.inputs) expect(ITEM[i.item], `${r.id} の input ${i.item}`).toBeDefined();
    }
    for (const f of FACILITIES) for (const c of f.costs) for (const m of Object.keys(c.materials)) expect(ITEM[m], `${f.id} の建材 ${m}`).toBeDefined();
    for (const sy of SYNERGIES) { expect(FACILITY[sy.a], sy.id).toBeDefined(); expect(FACILITY[sy.b], sy.id).toBeDefined(); }
  });
  it('ダンジョンの巣・シンボル・採取点・敵表は実在するIDを指す', () => {
    for (const d of DUNGEONS) {
      for (const e of d.enemies) expect(ENEMY[e.id], `${d.id} の enemies ${e.id}`).toBeDefined();
      for (const f of d.floors) for (const c of Object.values(f.legend)) {
        if (c.enemy) expect(ENEMY[c.enemy], `${d.id}/${f.id} の enemy ${c.enemy}`).toBeDefined();
        if (c.item) expect(ITEM[c.item], `${d.id}/${f.id} の item ${c.item}`).toBeDefined();
      }
    }
  });
  it('扉の鍵は kind: key のアイテム、階段の行き先は同じダンジョンの実在する階', () => {
    for (const d of DUNGEONS) for (const f of d.floors) for (const c of Object.values(f.legend)) {
      if (c.kind === 'door') expect(ITEM[c.key!]?.kind, `${d.id}/${f.id} の key ${c.key}`).toBe('key');
      if (c.to) expect(d.floors.some((x) => x.id === c.to!.floor), `${d.id}/${f.id} の to ${c.to.floor}`).toBe(true);
    }
  });
});

describe('フェーズ6の装備とレシピ(工房)', () => {
  const table = [
    { id: 'crystal_blade', name: '水晶の刃', slot: 'weapon', mods: { atk: 9 }, inputs: { crystal: 3, iron_ore: 2 }, gold: 120, days: 3 },
    { id: 'cloth_robe', name: '古布のローブ', slot: 'armor', armorClass: 'light', mods: { def: 8 }, resist: { dark: 0.4 }, inputs: { ancient_cloth: 4, slime_gel: 2 }, gold: 100, days: 3 },
    { id: 'ember_ring', name: '熾火の指輪', slot: 'accessory', mods: { atk: 1 }, resist: { fire: 0.35 }, inputs: { wisp_ember: 3, crystal: 1 }, gold: 90, days: 2 },
    { id: 'frost_edge', name: '霜の刃', slot: 'weapon', mods: { atk: 12 }, inputs: { frost_iron: 3, ice_shard: 2 }, gold: 220, days: 4 },
    { id: 'frost_mail', name: '霜鉄の鎧', slot: 'armor', armorClass: 'heavy', mods: { def: 15, spd: -1 }, resist: { ice: 0.4 }, inputs: { frost_iron: 4, iron_ore: 2 }, gold: 200, days: 4 },
    { id: 'pelt_cloak', name: '毛皮の外套', slot: 'armor', armorClass: 'medium', mods: { def: 11 }, resist: { ice: 0.35 }, inputs: { snow_pelt: 4, fang: 2 }, gold: 150, days: 3 },
    { id: 'ice_charm', name: '氷のお守り', slot: 'accessory', mods: { scout: 1 }, resist: { ice: 0.4 }, inputs: { ice_shard: 3 }, gold: 100, days: 2 },
    { id: 'ruin_amulet', name: '遺跡の護符', slot: 'accessory', mods: { def: 2 }, resist: { earth: 0.3, dark: 0.3, fire: 0.2 }, inputs: { relic_shard: 3, moon_stone: 1 }, gold: 200, days: 3 },
    { id: 'moon_blade', name: '月長の剣', slot: 'weapon', mods: { atk: 15 }, inputs: { moon_stone: 2, relic_shard: 3, frost_iron: 1 }, gold: 300, days: 5 },
    { id: 'guardian_plate', name: '守護の板金', slot: 'armor', armorClass: 'heavy', mods: { def: 18, spd: -1 }, resist: { earth: 0.4, fire: 0.2 }, inputs: { relic_shard: 4, frost_iron: 3, iron_ore: 4 }, gold: 350, days: 5 },
    { id: 'scale_mail', name: '竜鱗の鎧', slot: 'armor', armorClass: 'heavy', mods: { def: 24 }, resist: { fire: 0.6 }, inputs: { dragon_scale: 3, relic_shard: 2 }, gold: 600, days: 6, unlockedBy: 'dragon_slain' },
    { id: 'dragon_blade', name: '竜牙の剣', slot: 'weapon', mods: { atk: 22 }, inputs: { dragon_scale: 2, ember_fang: 3 }, gold: 600, days: 6, unlockedBy: 'dragon_slain' },
  ];
  it('装備12種の枠・補正・耐性がプランの表どおり', () => {
    for (const t of table) {
      const item = ITEM[t.id];
      expect(item, t.id).toBeDefined();
      expect([item.name, item.kind, item.equip?.slot, item.equip?.armorClass, item.equip?.mods, item.equip?.resist], t.id)
        .toEqual([t.name, t.slot, t.slot, t.armorClass, t.mods, t.resist]);
    }
  });
  it('重さは1〜3、売値は素材の売値合計の半分(±5)', () => {
    for (const t of table) {
      const item = ITEM[t.id];
      expect(item.weight, t.id).toBeGreaterThanOrEqual(1);
      expect(item.weight, t.id).toBeLessThanOrEqual(3);
      const sum = Object.entries(t.inputs).reduce((s, [id, n]) => s + ITEM[id].price * n, 0);
      expect(Math.abs(item.price - sum / 2), t.id).toBeLessThanOrEqual(5);
    }
  });
  it('レシピは r_<装備ID>・工房、素材・資金・日数が表どおり。竜鱗の2つだけ竜の討伐で解放', () => {
    for (const t of table) {
      const r = RECIPES.find((x) => x.id === `r_${t.id}`);
      expect(r, t.id).toBeDefined();
      expect([r!.name, r!.facility, r!.output, r!.gold, r!.days, r!.unlockedBy], t.id)
        .toEqual([t.name, 'workshop', { item: t.id, n: 1 }, t.gold, t.days, t.unlockedBy]);
      expect(Object.fromEntries(r!.inputs.map((i) => [i.item, i.n])), t.id).toEqual(t.inputs);
    }
  });
});

describe('tuning', () => {
  it('全値が number か number[]', () => {
    for (const section of [TUNING.explore, TUNING.game, TUNING.readiness, TUNING.equipment, TUNING.craft, TUNING.combat, TUNING.quests, TUNING.growth]) {
      for (const [key, v] of Object.entries(section)) {
        const ok = typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number'));
        expect(ok, key).toBe(true);
      }
    }
  });

  it('baseSteps > 0、costUnknown >= costKnown', () => {
    expect(TUNING.explore.baseSteps).toBeGreaterThan(0);
    expect(TUNING.explore.costUnknown).toBeGreaterThanOrEqual(TUNING.explore.costKnown);
  });
});
