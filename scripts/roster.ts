// 計測・テスト用の名簿。初日のティナ・セラ2人に汎用の2人を足して4人にする。
// 候補を雇わないのは、雇用の乱数と資金で計測がぶれないようにするため。乱数のタグは旧 newGame の汎用4人と同じ 'init' で、
// 不足する warrior / priest / scout だけを、元の添字の乱数で補う。
import { generateAdventurer, salaryOf } from '../src/core/adventurer';
import { JOB, TUNING } from '../src/core/data';
import { markGreeted } from '../src/core/mail';
import { rngFor } from '../src/core/rng';
import type { GameState } from '../src/core/types';

const EXTRA_JOBS = ['warrior', 'priest', 'scout'];

export function addStarterParty(s: GameState, seed: number): GameState {
  const usedNames = new Set(s.adventurers.map((a) => a.name));
  const present = new Set(s.adventurers.map((a) => a.job));
  const jobs = EXTRA_JOBS.map((job, i) => ({ job, i }))
    .filter(({ job }) => !present.has(job)).slice(0, Math.max(0, 4 - s.adventurers.length));
  jobs.forEach(({ job, i }) => {
    const a = generateAdventurer(rngFor(seed, 'init', i + 1), { id: `a${s.counters.nextId++}`, usedNames });
    a.job = job;
    for (const r of JOB[job].roles) a.apt[r] = Math.max(a.apt[r], TUNING.game.startApt);
    a.salary = salaryOf(a);
    a.history.hiredDay = 1;
    markGreeted(s, a);
    s.adventurers.push(a);
  });
  return s;
}
