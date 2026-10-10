import { describe, expect, it } from 'vitest';
import { DUNGEONS, ENEMIES, ENEMY, FACILITIES, FACILITY, ITEM, JOBS, LOWER_JOBS, PERSONALITIES, RECIPES, ROLE_SKILLS, SYNERGIES, TUNING, UPPER_JOBS, upperJobsFrom } from '../src/core/data';
import { Rng, rngFor } from '../src/core/rng';
import { deserialize, load, migrate, save, serialize, type KeyValueStore } from '../src/core/save';
import { emptyState } from '../src/core/state';
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
    const s = emptyState(7, 'テスト');
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
    const s = emptyState(9);
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
});

describe('tuning', () => {
  it('全値が number か number[]', () => {
    for (const section of [TUNING.explore, TUNING.game, TUNING.readiness, TUNING.equipment, TUNING.craft, TUNING.combat, TUNING.quests]) {
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
