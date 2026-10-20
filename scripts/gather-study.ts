// 同じ進行状態・隊員で、採集の役割分担と指示を比較する。
// 入力は通常プレイ/既存botのセーブ。乱数seedだけを変え、能力・地図・資金は上乗せしない。
// node node_modules/tsx/dist/cli.mjs scripts/gather-study.ts <save.json> [runs=100]
import { readFileSync } from 'node:fs';
import { carryCapacity, effectiveStats } from '../src/core/adventurer';
import { dispatch } from '../src/core/game';
import { deserialize } from '../src/core/save';
import type { ActionKind } from '../src/core/types';

const file = process.argv[2];
const runs = Number(process.argv[3] ?? 100);
if (!file || !Number.isInteger(runs) || runs < 1) throw new Error('セーブのパスと正の試行数を指定してください');
const source = deserialize(readFileSync(file, 'utf8'));
if (!source) throw new Error('セーブを読み込めません');
const find = (job: string) => {
  const a = source.adventurers.find((m) => m.job === job && m.status === 'idle');
  if (!a) throw new Error(`待機中の ${job} がいません`);
  return a;
};
const gatherer = find('gatherer'), guard = find('warrior'), scout = find('scout');
const mean = (xs: number[]) => Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2));
const specs: { name: string; ids: string[]; leader?: string; action?: ActionKind; policy?: string; days?: number }[] = [
  { name: '採取士+戦士 / 採集1日', ids: [gatherer.id, guard.id] },
  { name: '採取士+戦士 / 戦士が隊長', ids: [gatherer.id, guard.id], leader: guard.id },
  { name: '斥候+戦士 / 採集1日', ids: [scout.id, guard.id] },
  { name: '採取士+斥候 / 採集1日', ids: [gatherer.id, scout.id] },
  { name: '採取士+戦士 / 探索1日', ids: [gatherer.id, guard.id], action: 'explore' },
  { name: '採取士+戦士 / 採集2日', ids: [gatherer.id, guard.id], days: 2 },
  { name: '採取士+戦士 / 採集3日', ids: [gatherer.id, guard.id], days: 3 },
  { name: '採取士+戦士 / 安全第一', ids: [gatherer.id, guard.id], policy: 'safe' },
  { name: '採取士+戦士 / 探索優先', ids: [gatherer.id, guard.id], policy: 'explore' },
  { name: '採取士+戦士 / 報酬優先', ids: [gatherer.id, guard.id], policy: 'reward' },
];
const rows = specs.map((spec) => {
  const results = Array.from({ length: runs }, (_, index) => {
    const s = structuredClone(source);
    s.seed = index + 1;
    const action = spec.action ?? 'gather';
    const sent = dispatch(s, {
      partyIds: spec.ids, leaderId: spec.leader ?? spec.ids[0], action,
      target: { dungeon: 'forest_cave', floor: 'f1', ...(action === 'gather' ? { item: 'herb' } : {}) },
      policy: spec.policy ?? 'standard', days: spec.days ?? 1, items: {}, blessed: false,
    });
    if (!sent.ok) throw new Error(`${spec.name}: ${sent.reason}`);
    const e = sent.expedition, r = e.result;
    return {
      seed: s.seed, herbs: r.materials.herb ?? 0, days: e.returnDay - e.startDay,
      wiped: r.wiped, retreated: r.retreated,
      fatigue: mean(spec.ids.map((id) => r.fatigue[id] ?? 0)),
      injuries: Object.values(r.injuries).reduce((a, b) => a + b, 0),
      gatherAttempts: e.journey?.frames.filter((f) => f.kind === 'gather').length ?? 0,
    };
  });
  return {
    ...spec, runs,
    meanHerbs: mean(results.map((r) => r.herbs)),
    noHerbs: results.filter((r) => !r.herbs).length,
    meanDays: mean(results.map((r) => r.days)),
    meanFatigue: mean(results.map((r) => r.fatigue)),
    meanInjuryDays: mean(results.map((r) => r.injuries)),
    wipes: results.filter((r) => r.wiped).length,
    retreats: results.filter((r) => r.retreated).length,
    meanGatherAttempts: mean(results.map((r) => r.gatherAttempts)),
  };
});
console.log(JSON.stringify({
  source: file, day: source.day, sourceSeed: source.seed,
  note: '同じ進行状態で乱数seedのみ変更した比較。100通りの通常プレイの集計ではない。',
  members: [gatherer, guard, scout].map((a) => ({
    name: a.name, job: a.job, level: a.level, gather: effectiveStats(a).gather,
    fatigue: a.fatigue, capacity: carryCapacity(a),
  })),
  rows,
}, null, 2));
