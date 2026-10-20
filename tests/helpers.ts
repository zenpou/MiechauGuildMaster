import { addStarterParty } from '../scripts/roster';
import { TRAINED_SKILL, UNIQUE, UNIQUES, type UniqueDef } from '../src/core/data';
import { newGame } from '../src/core/game';
import { spawnCandidate } from '../src/core/recruit';
import { rngFor } from '../src/core/rng';
import type { GameState } from '../src/core/types';

/**
 * newGame(初日はティナ・セラ2人、候補なし)からセラを外し、旧来の汎用3人を足して、物語を名簿に合わせる前の
 * 「ティナと汎用3人で隊を組め、候補が2人いる」開始状態にする。候補の乱数は旧 newGame と同じタグなので、候補の中身も当時と同じ。
 * 日は1日目のまま(募集が来はじめる日は各テストで進める)
 */
export function fullGame(seed: number, playerName = ''): GameState {
  // 汎用4人を使う旧来のCore fixtureは、初期セラを外してから補充する。
  // 新規開始そのものは newGame の二人を別テストで検証する。
  const initial = newGame(seed, playerName);
  initial.adventurers = initial.adventurers.filter((a) => a.unique !== 'sera');
  const s = addStarterParty(initial, seed);
  const cr = rngFor(seed, 'recruit', 'init');
  for (let i = 0; i < 2; i++) spawnCandidate(s, cr);
  return s;
}

/** 候補一覧に出る型(minDay・minRep)のユニーク。uniques.json には置かず、テストの間だけ registerUnique で差し込む */
export const U_ALPHA: UniqueDef = {
  id: 'u_alpha', name: 'アルファ(仮)', job: 'scout', personality: 'cautious', age: 24,
  gender: 'male', appearance: 'u_alpha',
  base: { hp: 55, atk: 9, def: 7, mag: 6, spd: 13, dex: 12, scout: 10, gather: 8 },
  apt: { attacker: 40, tank: 20, healer: 15, scout: 90, gatherer: 50 },
  growth: 1.2, salary: 0,
  persona: { hobby: '地図を描く', talent: '耳がいい', likes: '静かな夜', dislikes: '大声' },
  skill: { id: 'u_alpha_skill', name: '仮の目', desc: '固有。偵察+3。', mods: { scout: 3 } },
  join: { minDay: 10, minRep: 8 },
  chain: [
    { kind: 'deliver', item: 'herb', n: 5, text: '薬草を5つ届けてほしい' },
    { kind: 'visit', dungeon: 'old_mine', n: 3, text: '古い坑道へ3回連れて行ってほしい' },
    { kind: 'soloKill', enemy: 'goblin_chief', n: 1, text: 'ゴブリンの頭を1人で討ちたい' },
  ],
  chainLoyalty: 30,
};

/** ユニークの定義を一時的に足す。戻り値を afterEach などで呼んで外す */
export function registerUnique(def: UniqueDef): () => void {
  UNIQUES.push(def);
  UNIQUE[def.id] = def;
  TRAINED_SKILL[def.skill.id] = def.skill;
  return () => {
    UNIQUES.splice(UNIQUES.indexOf(def), 1);
    delete UNIQUE[def.id];
    delete TRAINED_SKILL[def.skill.id];
  };
}
