// 序盤の比較。能力・資金を変更せず、初回に指定する日数だけを変える。
// 初回の安全な行程は1日に正規化されるので、保存された指示日数も記録する。
import { advanceDay, dispatch, exploredRateOf, newGame } from '../src/core/game';
import { readDueStories } from '../src/core/story';

const seeds = Number(process.argv[2] ?? 30);
const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100;
const rows = [3, 1].map((days) => {
  const runs = Array.from({ length: seeds }, (_, i) => {
    const s = newGame(i + 1);
    readDueStories(s);
    const tina = s.adventurers.find((a) => a.unique === 'tina')!;
    const sera = s.adventurers.find((a) => a.unique === 'sera')!;
    const seraPresentFromStart = !!sera;
    const sent = dispatch(s, {
      partyIds: [tina.id, sera.id], leaderId: tina.id, action: 'explore',
      target: { dungeon: 'forest_cave', floor: 'f1' }, policy: 'standard', days, items: {},
    });
    if (!sent.ok) throw new Error(sent.reason);
    while (!sent.expedition.claimed && s.day < 20) {
      advanceDay(s);
      readDueStories(s);
    }
    if (!sent.expedition.claimed) throw new Error('帰還しない');
    return {
      seed: s.seed, firstReturnDay: s.day, wiped: sent.expedition.result.wiped,
      actualDays: sent.expedition.order.days,
      herbs: sent.expedition.result.materials.herb ?? 0,
      mapRate: exploredRateOf(s, 'forest_cave', 'f1'), gold: s.gold,
      seraPresentFromStart,
      seraJoined: !seraPresentFromStart && s.adventurers.some((a) => a.unique === 'sera'),
      injuries: { tina: tina.injuryDays, sera: sera.injuryDays },
      injury: tina.injuryDays,
    };
  });
  return {
    days, seeds, averageReturnDay: mean(runs.map((r) => r.firstReturnDay)),
    wipes: runs.filter((r) => r.wiped).length,
    injured: runs.filter((r) => Object.values(r.injuries).some((days) => days > 0)).length,
    averageMapPercent: mean(runs.map((r) => r.mapRate * 100)),
    averageGold: mean(runs.map((r) => r.gold)),
    averageInjuryDays: mean(runs.map((r) => Object.values(r.injuries).reduce((sum, days) => sum + days, 0) / 2)),
    seraPresentFromStart: runs.filter((r) => r.seraPresentFromStart).length,
    seraJoinedOnReturn: runs.filter((r) => r.seraJoined).length,
    runs,
  };
});
console.log(JSON.stringify(rows, null, 2));
