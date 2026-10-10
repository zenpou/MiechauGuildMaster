import { ITEM, JOB, PERSONALITY, ROLE_SKILL } from './data';
import type { Rng } from './rng';
import { equipResist } from './adventurer';
import type { Adventurer, ElementId, EnemyDef, LogKind, Resist, RoleId, Stats } from './types';

export interface Unit {
  id: string; name: string; side: 'ally' | 'enemy';
  hp: number; maxHp: number; atk: number; def: number; mag: number; spd: number;
  /** 味方: 職の roles。敵: [] */
  roles: RoleId[];
  /** 味方のみ */
  personality?: string;
  /** 敵のみ */
  enemy?: EnemyDef;
  /** スキルIDごとの残りCT。0または未設定なら使える */
  skillCd: Record<string, number>;
  down: boolean;
  /** 被弾側の属性耐性。味方は装備の合計、敵は定義 */
  resist: Resist;
}

export interface CombatCtx {
  rng: Rng;
  say(kind: LogKind, text: string): void;
  /** 回復薬(アイテムID potion) */
  potions: { n: number; used: number };
  rel(a: string, b: string, delta: number, reason: string): void;
  /** 戦闘中の撤退しやすさ。平均HP割合がこれを下回ると撤退を試みる */
  fleeBelow: number;
  canFlee: boolean;
}

export interface CombatResult {
  outcome: 'won' | 'lost' | 'fled';
  kills: Record<string, number>;
  rounds: number;
  downed: string[];
}

const ENEMY_SKILL = 'enemy';

const alive = (us: Unit[]) => us.filter((u) => !u.down);

/** ユニットは roles に含まれる役割のスキルを全部持つ */
export const hasSkill = (u: Unit, skillId: string): boolean => {
  const s = ROLE_SKILL[skillId];
  return !!s && u.roles.includes(s.role);
};

export function makeAllyUnit(a: Adventurer, stats: Stats): Unit {
  const job = JOB[a.job];
  return {
    id: a.id, name: a.name, side: 'ally',
    hp: stats.hp, maxHp: stats.hp, atk: stats[job.attackStat], def: stats.def, mag: stats.mag, spd: stats.spd,
    roles: [...job.roles], personality: a.personality, skillCd: {}, down: false, resist: equipResist(a),
  };
}

export function makeEnemies(def: EnemyDef, count: number): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `e_${def.id}_${i}`, name: count > 1 ? `${def.name}${String.fromCharCode(65 + i)}` : def.name, side: 'enemy',
      hp: def.hp, maxHp: def.hp, atk: def.atk, def: def.def, mag: def.mag, spd: def.spd, roles: [], enemy: def,
      skillCd: def.skill ? { [ENEMY_SKILL]: def.skill.cd } : {}, down: false, resist: { ...def.resist },
    });
  }
  return out;
}

const ready = (u: Unit, skillId: string) => hasSkill(u, skillId) && (u.skillCd[skillId] ?? 0) <= 0;

/** 自分の手番の頭でCTを1減らす。使った手番から数えて cd 手番目にまた使える */
function tickCooldowns(u: Unit) {
  for (const k of Object.keys(u.skillCd)) if (u.skillCd[k] > 0) u.skillCd[k]--;
}

/** 敵AIの狙い。weakest=HP最小 / strongest=攻撃力最大 / random */
export function enemyTarget(ai: EnemyDef['ai'], mates: Unit[], rng: Rng): Unit {
  if (ai === 'weakest') return [...mates].sort((a, b) => a.hp - b.hp)[0];
  if (ai === 'strongest') return [...mates].sort((a, b) => b.atk - a.atk)[0];
  return rng.pick(mates);
}

/** 行動順。1ターン目は first_strike 持ちが先頭、あとは素早さ順。同速はシャッフルで決める */
export function actionOrder(units: Unit[], round: number, rng: Rng): Unit[] {
  const first = (u: Unit) => (round === 1 && hasSkill(u, 'first_strike') ? 1 : 0);
  return rng.shuffle(units).sort((a, b) => first(b) - first(a) || b.spd - a.spd);
}

function damage(rng: Rng, atk: number, mult: number, def: number): { dmg: number; crit: boolean } {
  const crit = rng.chance(0.08);
  const raw = atk * mult * (crit ? 1.5 : 1) - def * 0.5;
  return { dmg: Math.max(1, Math.round(raw * rng.range(0.9, 1.1))), crit };
}

/** 属性付きの攻撃は ×(1 − 耐性)。属性なしはそのまま */
function elemental(dmg: number, element: ElementId | undefined, target: Unit): number {
  const r = element ? target.resist[element] ?? 0 : 0;
  return r === 0 ? dmg : Math.max(1, Math.round(dmg * (1 - r)));
}

function hitChance(att: number, def: number, timidBonus = 0): number {
  return Math.max(0.5, Math.min(0.97, 0.85 + (att - def) * 0.01 - timidBonus));
}

export function runCombat(allies: Unit[], enemies: Unit[], ctx: CombatCtx): CombatResult {
  const { rng, say } = ctx;
  const kills: Record<string, number> = {};
  const downed = new Set<string>();
  const avgRatio = () => allies.reduce((s, u) => s + (u.down ? 0 : u.hp / u.maxHp), 0) / allies.length;

  const ko = (u: Unit) => {
    u.down = true;
    u.hp = 0;
    if (u.side === 'ally') {
      downed.add(u.id);
      say('combat', `${u.name}が倒れた!`);
    } else {
      kills[u.enemy!.id] = (kills[u.enemy!.id] ?? 0) + 1;
      say('combat', `${u.name}を倒した。`);
    }
  };

  let round = 0;
  while (alive(allies).length && alive(enemies).length && round < 30) {
    round++;
    const summary: string[] = [];
    const order = actionOrder([...alive(allies), ...alive(enemies)], round, rng);
    const coverUsed = new Set<string>();

    for (const u of order) {
      if (u.down || !alive(allies).length || !alive(enemies).length) continue;
      if (u.side === 'ally') allyAct(u);
      else enemyAct(u);
    }
    if (summary.length) say('combat', `【${round}ターン目】` + summary.join(' / '));

    // 撤退判断
    if (ctx.canFlee && alive(allies).length && alive(enemies).length && avgRatio() < ctx.fleeBelow) {
      const fastest = Math.max(...alive(allies).map((u) => u.spd));
      const chaser = Math.max(...alive(enemies).map((u) => u.spd));
      const p = Math.max(0.35, Math.min(0.9, 0.7 + (fastest - chaser) * 0.03));
      if (rng.chance(p)) {
        say('combat', '撤退を決断。殿をつとめながら、全員でその場を離脱した。');
        return { outcome: 'fled', kills, rounds: round, downed: [...downed] };
      }
      say('combat', '撤退を試みたが、敵に回り込まれて失敗した!');
    }

    function allyAct(u: Unit) {
      tickCooldowns(u);
      const p = PERSONALITY[u.personality!];
      const mates = alive(allies);
      // 回復薬
      const weakest = [...mates].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (ctx.potions.n > 0 && weakest.hp / weakest.maxHp < 0.35) {
        ctx.potions.n--;
        ctx.potions.used++;
        const ratio = ITEM.potion.consumable!.params.ratio;
        const amount = Math.round(weakest.maxHp * ratio);
        weakest.hp = Math.min(weakest.maxHp, weakest.hp + amount);
        say('combat', weakest === u ? `${u.name}は回復薬を飲んだ(HP+${amount})。` : `${u.name}が${weakest.name}に回復薬を使った(HP+${amount})。`);
        if (weakest !== u) ctx.rel(u.id, weakest.id, 2, `${u.name}が${weakest.name}を回復薬で助けた`);
        return;
      }
      const heal = ROLE_SKILL.heal;
      if (ready(u, heal.id) && weakest.hp / weakest.maxHp < heal.params.threshold && rng.chance(heal.params.chance)) {
        u.skillCd[heal.id] = heal.params.cd;
        const amount = Math.round(weakest.maxHp * heal.params.ratio + u.mag * heal.params.magScale);
        weakest.hp = Math.min(weakest.maxHp, weakest.hp + amount);
        say('combat', `${u.name}の${heal.name}!${weakest === u ? '自分' : weakest.name}のHPが${amount}回復した。`);
        if (weakest !== u) ctx.rel(u.id, weakest.id, 1, `${u.name}が${weakest.name}を癒した`);
        return;
      }
      // 臆病による硬直
      if (p.fightBias <= -0.2 && rng.chance(0.12)) {
        say('combat', `${u.name}は恐怖で足がすくみ、動けなかった。`);
        return;
      }
      const foes = alive(enemies);
      const target =
        p.id === 'brave' && rng.chance(0.5)
          ? [...foes].sort((a, b) => b.maxHp - a.maxHp)[0]
          : rng.chance(0.6)
            ? [...foes].sort((a, b) => a.hp - b.hp)[0]
            : rng.pick(foes);
      const strike = ready(u, 'power_strike') ? ROLE_SKILL.power_strike : null;
      if (strike) u.skillCd[strike.id] = strike.params.cd;
      if (!rng.chance(hitChance(u.spd, target.spd))) {
        if (strike) say('combat', `${u.name}の${strike.name}!しかし${target.name}にかわされた。`);
        else summary.push(`${u.name}→${target.name}(外れ)`);
        return;
      }
      const { dmg, crit } = damage(rng, u.atk, strike ? strike.params.mult : 1, target.def);
      target.hp -= dmg;
      if (strike) say('combat', `${u.name}の${strike.name}!${target.name}に${dmg}ダメージ${crit ? '(会心!)' : ''}。`);
      else if (crit) say('combat', `${u.name}の会心の一撃!${target.name}に${dmg}ダメージ。`);
      else summary.push(`${u.name}→${target.name}(-${dmg})`);
      if (target.hp <= 0) ko(target);
    }

    function enemyAct(u: Unit) {
      const def = u.enemy!;
      const mates = alive(allies);
      // 範囲スキル
      if (def.skill?.aoe) {
        if ((u.skillCd[ENEMY_SKILL] ?? 0) <= 0) {
          u.skillCd[ENEMY_SKILL] = def.skill.cd;
          say('combat', `${u.name}の${def.skill.name}!全員が巻き込まれた!`);
          for (const t of mates) {
            // EnemyDef.skill の型に element が無いので、範囲スキルも敵本体の属性で打つ
            const dmg = elemental(damage(rng, u.atk, def.skill.mult, t.def).dmg, def.element, t);
            t.hp -= dmg;
            if (t.hp <= 0) ko(t);
          }
          return;
        }
        u.skillCd[ENEMY_SKILL]--;
      }
      let target = enemyTarget(def.ai, mates, rng);

      // 庇う
      const guard = ROLE_SKILL.guard;
      const coverer = mates.find((m) => {
        if (m.id === target.id || coverUsed.has(m.id)) return false;
        const cp = PERSONALITY[m.personality!].cover + (hasSkill(m, guard.id) ? guard.params.coverBonus : 0);
        return m.hp / m.maxHp > 0.4 && target.hp / target.maxHp < 0.7 && rng.chance(cp);
      });
      if (coverer) {
        coverUsed.add(coverer.id);
        say('combat', `${coverer.name}が${target.name}をかばって前に出た!`);
        ctx.rel(coverer.id, target.id, 3, `${coverer.name}が${target.name}をかばった`);
        target = coverer;
      }
      if (!rng.chance(hitChance(u.spd, target.spd, PERSONALITY[target.personality!].id === 'timid' ? 0.08 : 0))) {
        summary.push(`${u.name}→${target.name}(回避)`);
        return;
      }
      const hit = elemental(damage(rng, u.atk, 1, target.def).dmg, def.element, target);
      const dmg = coverer && hasSkill(coverer, guard.id) ? Math.max(1, Math.round(hit * guard.params.damageTaken)) : hit;
      target.hp -= dmg;
      summary.push(`${u.name}→${target.name}(-${dmg})`);
      if (target.hp <= 0) ko(target);
    }
  }

  const won = alive(enemies).length === 0 && alive(allies).length > 0;
  return { outcome: won ? 'won' : 'lost', kills, rounds: round, downed: [...downed] };
}
