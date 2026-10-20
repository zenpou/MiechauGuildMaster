import { describe, expect, it } from 'vitest';
import { actionOrder, enemyTarget, makeAllyUnit, makeEnemies, runCombat, type CombatCtx, type CombatObservation, type Unit } from '../src/core/combat';
import { ENEMIES, ENEMY, ROLE_SKILL, ROLE_SKILLS } from '../src/core/data';
import { rngFor } from '../src/core/rng';
import { ROLE_IDS, type Adventurer, type RoleId, type Stats } from '../src/core/types';

const stats = (v: Partial<Stats> = {}): Stats => ({ hp: 100, atk: 20, def: 10, mag: 10, spd: 10, dex: 10, scout: 10, gather: 10, ...v });

function adv(job: string): Adventurer {
  return {
    id: 'a1', name: 'テスト', age: 20, level: 1, exp: 0, job, base: stats(),
    apt: { attacker: 50, tank: 50, healer: 50, scout: 50, gatherer: 50 }, growth: 1,
    personality: 'cautious', gender: 'male', appearance: 'adv_cautious_male', traits: [], fatigue: 0, injuryDays: 0, salary: 10, loyalty: 50,
    status: 'idle', assignment: null, equipment: { weapon: null, armor: null, accessory: null }, skills: [],
    persona: { hobby: '', talent: '', likes: '', dislikes: '' },
    history: { hiredDay: 0, expeditions: 0, kills: 0, visits: {}, raisesRefused: 0, warnedDay: null },
  };
}

let seq = 0;
function ally(roles: RoleId[], v: Partial<Unit> = {}): Unit {
  const id = v.id ?? `a${seq++}`;
  return {
    id, name: id, side: 'ally', hp: 100, maxHp: 100, atk: 20, def: 10, mag: 10, spd: 10,
    roles, personality: 'cautious', skillCd: {}, down: false, resist: {}, ...v,
  };
}

function foe(v: Partial<Unit> = {}): Unit {
  return { ...makeEnemies(ENEMY.goblin, 1)[0], ...v };
}

function ctx(seed: number, v: Partial<CombatCtx> = {}): CombatCtx & { log: string[]; rels: string[] } {
  const log: string[] = [];
  const rels: string[] = [];
  return {
    rng: rngFor(seed, 'combat-test'),
    say: (_k, t) => log.push(t),
    potions: { n: 0, used: 0 },
    rel: (_a, _b, _d, reason) => rels.push(reason),
    fleeBelow: 0, canFlee: false,
    log, rels, ...v,
  };
}

describe('役割スキルの定義', () => {
  it('5役に1つずつ、共有IDで定義されている', () => {
    expect(ROLE_SKILLS.map((s) => s.role).sort()).toEqual([...ROLE_IDS].sort());
    expect(ROLE_SKILL.power_strike.params).toMatchObject({ mult: 1.7, cd: 3 });
    expect(ROLE_SKILL.guard.params).toMatchObject({ coverBonus: 0.35, damageTaken: 0.7 });
    expect(ROLE_SKILL.heal.params).toMatchObject({ ratio: 0.3, magScale: 0.4, threshold: 0.5, chance: 0.65, cd: 2 });
    expect(ROLE_SKILL.first_strike.kind).toBe('passive');
    expect(ROLE_SKILL.pack.kind).toBe('passive');
  });
});

describe('敵の定義(森の洞窟)', () => {
  it('森の4種を含み、巣の主は symbol', () => {
    expect(ENEMIES.map((e) => e.id)).toEqual(expect.arrayContaining(['goblin', 'goblin_chief', 'slime', 'wolf']));
    expect(ENEMIES.find((e) => e.id === 'goblin_chief')!.symbol).toBe(true);
  });
});

/** ログからスキル名が出たターン番号を拾う。ターンの要約行(【nターン目】)はそのターンの最後に出る */
function skillRounds(log: string[], skillName: string): number[] {
  const out: number[] = [];
  let round = 1;
  for (const line of log) {
    if (line.startsWith('【')) round++;
    else if (line.includes(`の${skillName}!`)) out.push(round);
  }
  return out;
}

describe('runCombat', () => {
  it('同seed・同ユニットで同じ結果', () => {
    const run = () => {
      const allies = [ally(['attacker'], { id: 'x' }), ally(['tank'], { id: 'y' })];
      const c = ctx(7);
      const r = runCombat(allies, makeEnemies(ENEMY.goblin, 3), c);
      return { r, log: c.log, hp: allies.map((u) => u.hp) };
    };
    expect(run()).toEqual(run());
  });
  it('観測には行動種別・名前とクランプ後の実量を渡す', () => {
    const attackActions: CombatObservation[] = [];
    const attacker = ally(['attacker'], { id: 'a', name: '攻撃役', atk: 2000, spd: 99 });
    const enemy = foe({ id: 'e', name: '小鬼', hp: 1, maxHp: 1, def: 0, spd: 1 });
    runCombat([attacker], [enemy], ctx(1, { observe: (action) => attackActions.push(action) }));
    const attack = attackActions.find((action) => action.kind === 'attack' && action.targetId === 'e');
    expect(attack).toMatchObject({ actorId: 'a', actorName: '攻撃役', targetId: 'e', targetName: '小鬼', amount: 1 });
    expect(enemy.hp).toBe(0);
    expect(attackActions.find((action) => action.kind === 'down' && action.targetId === 'e')).toMatchObject({ targetName: '小鬼' });

    const healActions: CombatObservation[] = [];
    const healer = ally(['healer'], { id: 'h', name: '癒し手', mag: 500, spd: 99 });
    const hurt = ally(['attacker'], { id: 'w', name: '負傷者', hp: 1, maxHp: 100, spd: 1 });
    runCombat([healer, hurt], [foe({ hp: 99999, maxHp: 99999, atk: 1, spd: 1 })], ctx(1, { observe: (action) => healActions.push(action) }));
    const heal = healActions.find((action) => action.kind === 'heal');
    expect(heal).toMatchObject({ actorId: 'h', actorName: '癒し手', targetId: 'w', targetName: '負傷者' });
    expect(heal!.amount).toBe(99);
    expect(hurt.hp).toBeLessThanOrEqual(hurt.maxHp);
  });
  it('味方が圧倒的に強ければ勝つ', () => {
    const allies = [ally(['attacker'], { atk: 200, spd: 50, hp: 500, maxHp: 500 })];
    const r = runCombat(allies, makeEnemies(ENEMY.goblin, 2), ctx(1));
    expect(r.outcome).toBe('won');
    expect(r.kills.goblin).toBe(2);
  });
  it('敵が圧倒的なら負け、味方は全員 down', () => {
    const allies = [ally(['attacker'], { id: 'p' }), ally(['healer'], { id: 'q' })];
    const r = runCombat(allies, [foe({ atk: 500, hp: 5000, maxHp: 5000, spd: 50 })], ctx(1));
    expect(r.outcome).toBe('lost');
    expect(allies.every((u) => u.down)).toBe(true);
    expect([...r.downed].sort()).toEqual(['p', 'q']);
  });
  it('power_strike は CT3 で、連続ターンでは発動しない', () => {
    const name = ROLE_SKILL.power_strike.name;
    const c = ctx(3);
    runCombat([ally(['attacker'], { personality: 'brave' })], [foe({ hp: 99999, maxHp: 99999, atk: 1 })], c);
    const rounds = skillRounds(c.log, name);
    expect(rounds.slice(0, 4)).toEqual([1, 4, 7, 10]);
  });
  it('power_strike はアタッカー役を持たなければ使わない', () => {
    const c = ctx(3);
    runCombat([ally(['tank'], { personality: 'brave' })], [foe({ hp: 99999, maxHp: 99999, atk: 1 })], c);
    expect(skillRounds(c.log, ROLE_SKILL.power_strike.name)).toEqual([]);
  });
  it('heal は HP50%未満の味方がいる時だけ発動する', () => {
    const name = ROLE_SKILL.heal.name;
    const tough = () => foe({ hp: 99999, maxHp: 99999, atk: 1 });
    // 誰も半分を切らない戦闘では一度も使わない
    for (let seed = 0; seed < 10; seed++) {
      const c = ctx(seed);
      runCombat([ally(['healer']), ally(['attacker'])], [tough()], c);
      expect(skillRounds(c.log, name)).toEqual([]);
    }
    // 半分を切った仲間がいれば使い、その仲間のHPが戻る
    const c = ctx(1);
    const hurt = ally(['attacker'], { hp: 30 });
    runCombat([ally(['healer'], { mag: 20 }), hurt], [tough()], c);
    expect(skillRounds(c.log, name).length).toBeGreaterThan(0);
    expect(hurt.hp).toBeGreaterThan(30);
  });
  it('heal は CT2 で、連続ターンでは発動しない', () => {
    const c = ctx(5);
    const hurt = () => ally(['attacker'], { hp: 1, maxHp: 1000 });
    const allies = [ally(['healer'], { personality: 'brave' }), hurt(), hurt()];
    runCombat(allies, [foe({ hp: 99999, maxHp: 99999, atk: 1 })], c);
    const rounds = skillRounds(c.log, ROLE_SKILL.heal.name);
    expect(rounds.length).toBeGreaterThan(2);
    for (let i = 1; i < rounds.length; i++) expect(rounds[i] - rounds[i - 1]).toBeGreaterThanOrEqual(2);
  });
  /** 弱った仲間を weakest の敵が殴り続ける戦闘を回し、かばった回数と、かばった側の被ダメを数える */
  function coverTrial(roles: RoleId[], personality: string, enemyAtk: number, combats: number) {
    let covers = 0, taken = 0;
    for (let seed = 0; seed < combats; seed++) {
      const coverer = ally(roles, { id: 'c', personality, hp: 100000, maxHp: 100000, atk: 1 });
      const target = ally(['attacker'], { id: 't', personality: 'greedy', hp: 60000, maxHp: 100000, atk: 1 });
      const c = ctx(seed);
      const enemy = foe({ hp: 99999, maxHp: 99999, atk: enemyAtk, enemy: { ...ENEMY.goblin, ai: 'weakest' } });
      runCombat([coverer, target], [enemy], c);
      covers += c.rels.filter((r) => r.includes('かばった')).length;
      taken += coverer.maxHp - coverer.hp;
    }
    return { rate: covers / (combats * 30), perCover: taken / covers };
  }
  it('guard を持つユニットはかばう率が高い', () => {
    // 1戦30ターン×34戦 ≒ 1000回の被弾機会。慎重(cover 0.05)で、タンクは +0.35
    const tank = coverTrial(['tank'], 'cautious', 1, 34);
    const other = coverTrial(['attacker'], 'cautious', 1, 34);
    expect(tank.rate).toBeGreaterThan(0.3);
    expect(other.rate).toBeLessThan(0.12);
  });
  it('guard でかばった時の被ダメは約0.7倍', () => {
    const tank = coverTrial(['tank'], 'caring', 60, 20);
    const other = coverTrial(['attacker'], 'caring', 60, 20);
    const ratio = tank.perCover / other.perCover;
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(0.8);
  });
  it('fleeBelow を高くすると撤退しやすい', () => {
    const fled = (fleeBelow: number) => {
      let n = 0;
      for (let seed = 0; seed < 100; seed++) {
        const allies = [ally(['attacker']), ally(['tank'])];
        const r = runCombat(allies, makeEnemies(ENEMY.wolf, 3), ctx(seed, { canFlee: true, fleeBelow }));
        if (r.outcome === 'fled') n++;
      }
      return n;
    };
    expect(fled(0)).toBe(0);
    expect(fled(0.9)).toBeGreaterThan(60);
  });
  it('canFlee が false なら撤退しない', () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = runCombat([ally(['attacker'])], makeEnemies(ENEMY.wolf, 3), ctx(seed, { canFlee: false, fleeBelow: 1 }));
      expect(r.outcome).not.toBe('fled');
    }
  });
  it('回復薬は heal より先に使う', () => {
    const c = ctx(1, { potions: { n: 1, used: 0 } });
    const hurt = ally(['attacker'], { id: 'h', hp: 10 });
    runCombat([ally(['healer'], { id: 'p', spd: 99 }), hurt], [foe({ hp: 99999, maxHp: 99999, atk: 1, spd: 1 })], c);
    expect(c.potions).toEqual({ n: 0, used: 1 });
    expect(c.log[0]).toContain('回復薬');
  });
});

describe('30ターンで決着がつかない戦い', () => {
  it('どちらも倒れないまま上限に達したら、全滅ではなく撤退(fled)になる', () => {
    // 与ダメージが1でも、回復量が追いつく: 倒しきれず倒されもしない
    const wall = foe({ hp: 100000, maxHp: 100000, def: 9999, atk: 1, spd: 1 });
    const tough = ally(['tank'], { hp: 100000, maxHp: 100000, def: 9999, atk: 1 });
    const r = runCombat([tough], [wall], ctx(1, { canFlee: false, fleeBelow: 0 }));
    expect(r.rounds).toBe(30);
    expect(r.outcome).toBe('fled');
  });

  it('味方が全員倒れたら lost のまま', () => {
    const weakling = ally(['attacker'], { hp: 1, maxHp: 1, def: 0 });
    const boss = foe({ hp: 100000, maxHp: 100000, atk: 999, spd: 99 });
    expect(runCombat([weakling], [boss], ctx(2, { canFlee: false, fleeBelow: 0 })).outcome).toBe('lost');
  });
});

describe('actionOrder', () => {
  it('first_strike 持ちは1ターン目に最初に動く', () => {
    const scout = ally(['scout'], { id: 's', spd: 1 });
    const units = [ally(['attacker'], { spd: 30 }), foe({ spd: 50 }), scout];
    for (let seed = 0; seed < 20; seed++) {
      expect(actionOrder(units, 1, rngFor(seed, 'order'))[0].id).toBe('s');
    }
  });
  it('2ターン目以降は素早さ順', () => {
    const units = [ally(['scout'], { id: 's', spd: 1 }), ally(['attacker'], { id: 'f', spd: 30 }), foe({ id: 'e', spd: 50 })];
    expect(actionOrder(units, 2, rngFor(1, 'order')).map((u) => u.id)).toEqual(['e', 'f', 's']);
  });
});

describe('enemyTarget', () => {
  it('weakest はHP最小を狙う', () => {
    const mates = [ally(['tank'], { id: 'big', hp: 90 }), ally(['healer'], { id: 'low', hp: 12 }), ally(['attacker'], { id: 'mid', hp: 50 })];
    for (let seed = 0; seed < 20; seed++) {
      expect(enemyTarget('weakest', mates, rngFor(seed, 't')).id).toBe('low');
    }
  });
  it('strongest は攻撃力最大を狙う', () => {
    const mates = [ally(['tank'], { id: 'weak', atk: 5 }), ally(['attacker'], { id: 'strong', atk: 40 })];
    expect(enemyTarget('strongest', mates, rngFor(1, 't')).id).toBe('strong');
  });
});

describe('makeAllyUnit', () => {
  it('職の roles と attackStat を写す', () => {
    const s = stats({ hp: 80, atk: 7, mag: 30, def: 9, spd: 11 });
    const priest = makeAllyUnit(adv('priest'), s);
    expect(priest).toMatchObject({ side: 'ally', hp: 80, maxHp: 80, atk: 30, mag: 30, def: 9, spd: 11, roles: ['healer'], down: false });
    const warlord = makeAllyUnit(adv('warlord'), s);
    expect(warlord.atk).toBe(7);
    expect(warlord.roles).toEqual(['attacker', 'tank']);
  });
});

describe('属性と耐性', () => {
  /** 打たれ強い1人と、倒れない敵1体を30ターン戦わせ、受けた総ダメージを返す */
  function taken(enemyId: string, resist: Unit['resist'], seed: number): { dmg: number; log: string[] } {
    const me = ally(['attacker'], { id: 'me', hp: 100000, maxHp: 100000, resist });
    const e = foe({ ...makeEnemies(ENEMY[enemyId], 1)[0], hp: 100000, maxHp: 100000 });
    const c = ctx(seed);
    runCombat([me], [e], c);
    return { dmg: 100000 - me.hp, log: c.log };
  }

  it('敵の resist は定義から、味方の resist は装備から', () => {
    expect(makeEnemies(ENEMY.skeleton, 1)[0].resist).toEqual({ dark: 0.5 });
    expect(makeEnemies(ENEMY.goblin, 1)[0].resist).toEqual({});
    const a = adv('fighter');
    a.equipment = { weapon: null, armor: 'iron_armor', accessory: 'moss_charm' };
    expect(makeAllyUnit(a, stats()).resist).toEqual({ earth: 0.2, dark: 0.3 });
  });

  it('enemies.json の属性は表どおり', () => {
    expect(ENEMY.skeleton.element).toBe('dark');
    expect(ENEMY.golem.element).toBe('earth');
    expect(ENEMY.golem.resist).toEqual({ earth: 0.5, thunder: 0.3 });
    expect(ENEMY.slime.resist).toEqual({ thunder: -0.5 });
    for (const id of ['goblin', 'wolf', 'goblin_chief', 'cave_bat']) expect(ENEMY[id].element).toBeUndefined();
  });

  it('闇耐性0.5で骸骨兵の与ダメがほぼ半分になる(同seedで決定論)', () => {
    for (const seed of [1, 2, 3]) {
      const bare = taken('skeleton', {}, seed);
      const half = taken('skeleton', { dark: 0.5 }, seed);
      expect(taken('skeleton', { dark: 0.5 }, seed)).toEqual(half);
      expect(bare.dmg).toBeGreaterThan(0);
      // 1発ごとの四捨五入で最大0.5ずれる。30ターン×1発
      expect(Math.abs(half.dmg - bare.dmg / 2)).toBeLessThanOrEqual(15);
    }
  });

  it('負の耐性(弱点)は被ダメを増やす', () => {
    const bare = taken('skeleton', {}, 4);
    const weak = taken('skeleton', { dark: -0.5 }, 4);
    expect(Math.abs(weak.dmg - bare.dmg * 1.5)).toBeLessThanOrEqual(15);
  });

  it('属性の無い攻撃は耐性の影響を受けない', () => {
    expect(taken('goblin', { dark: 0.8, earth: 0.8 }, 5)).toEqual(taken('goblin', {}, 5));
  });

  it('ゴーレムの岩砕き(範囲)も土属性', () => {
    const bare = taken('golem', {}, 6);
    const half = taken('golem', { earth: 0.5 }, 6);
    expect(bare.log.some((l) => l.includes('岩砕き'))).toBe(true);
    expect(Math.abs(half.dmg - bare.dmg / 2)).toBeLessThanOrEqual(15);
  });
});
