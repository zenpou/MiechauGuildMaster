import { describe, expect, it } from 'vitest';
import { addExp, generateAdventurer } from '../src/core/adventurer';
import { assignWorker } from '../src/core/base';
import { startCraft } from '../src/core/craft';
import { DUNGEON, JOB } from '../src/core/data';
import { parseFloor } from '../src/core/dungeon';
import { advanceDay, buyItem, dispatch, exploredRateOf, newGame, recall, sellMaterial } from '../src/core/game';
import { rngFor } from '../src/core/rng';
import type { DispatchOrder, Expedition, GameState } from '../src/core/types';

function order(s: GameState, o: Partial<DispatchOrder> = {}): DispatchOrder {
  const ids = s.adventurers.map((a) => a.id);
  return {
    partyIds: ids, leaderId: ids[0], action: 'explore',
    target: { dungeon: 'forest_cave', floor: 'f1' },
    policy: 'standard', days: 2, items: { potion: 1 },
    ...o,
  };
}

function sent(s: GameState, o: Partial<DispatchOrder> = {}): Expedition {
  const r = dispatch(s, order(s, o));
  if (!r.ok) throw new Error(r.reason);
  return r.expedition;
}

const wages = (s: GameState) => s.adventurers.reduce((t, a) => t + a.salary, 0);

describe('newGame', () => {
  it('固定4人(剣士・戦士・僧侶・斥候)・500G・回復薬2・森の洞窟の進捗0', () => {
    const s = newGame(7);
    expect(s.gold).toBe(500);
    expect(s.adventurers.map((a) => a.job)).toEqual(['fighter', 'warrior', 'priest', 'scout']);
    for (const a of s.adventurers) {
      for (const r of JOB[a.job].roles) expect(a.apt[r]).toBeGreaterThanOrEqual(70);
      expect(a.history.hiredDay).toBe(1);
      expect(a.unique).toBeUndefined();
      expect(a.status).toBe('idle');
    }
    expect(new Set(s.adventurers.map((a) => a.name)).size).toBe(4);
    expect(s.inventory.potion).toBe(2);
    expect(s.dungeons.forest_cave).toEqual({ confirmed: true, floors: { f1: { visited: [], hiddenFound: [] } }, bossDefeated: 0, fullCleared: false });
    expect(s.world.visitedNodes).toEqual(['base']);
    expect(s.ledger.some((l) => l.amount === 500)).toBe(true);
    expect(exploredRateOf(s, 'forest_cave', 'f1')).toBe(0);
  });
});

describe('dispatch の検証', () => {
  it('重複・0人・5人・在庫不足・隊長が隊外・日数外・負傷者は ok:false で、状態を変えない', () => {
    const s = newGame(3);
    const ids = s.adventurers.map((a) => a.id);
    s.adventurers.push(generateAdventurer(rngFor(3, 'extra'), { id: 'x5' }));
    const before = structuredClone(s);
    expect(dispatch(s, order(s, { partyIds: [ids[0], ids[0]] })).ok).toBe(false);
    expect(dispatch(s, order(s, { partyIds: [] })).ok).toBe(false);
    expect(dispatch(s, order(s, { partyIds: [...ids, 'x5'] })).ok).toBe(false);
    expect(dispatch(s, order(s, { partyIds: ids, items: { potion: 3 } })).ok).toBe(false);
    expect(dispatch(s, order(s, { partyIds: ids.slice(1), leaderId: ids[0] })).ok).toBe(false);
    expect(dispatch(s, order(s, { partyIds: ids, days: 0 })).ok).toBe(false);
    expect(dispatch(s, order(s, { partyIds: ids, days: 8 })).ok).toBe(false);
    expect(s).toEqual(before);
    s.adventurers[1].injuryDays = 2;
    expect(dispatch(s, order(s, { partyIds: ids })).ok).toBe(false);
  });

  it('派遣中の者は重ねて出せない', () => {
    const s = newGame(3);
    const ids = s.adventurers.map((a) => a.id);
    sent(s, { partyIds: ids.slice(0, 2), items: {} });
    expect(dispatch(s, order(s, { partyIds: [ids[1], ids[2]], leaderId: ids[1], items: {} })).ok).toBe(false);
  });

  it('出発後、隊員は away になり持ち物が在庫から減る。地図は帰還日まで変わらない', () => {
    const s = newGame(5);
    const e = sent(s, { days: 3, items: { potion: 1 } });
    expect(s.adventurers.every((a) => a.status === 'away')).toBe(true);
    expect(s.inventory.potion).toBe(1);
    expect(e.startDay).toBe(1);
    expect(e.returnDay).toBe(4);
    expect(s.expeditions).toHaveLength(1);
    expect(s.counters.dispatches).toBe(1);
    expect(s.dungeons.forest_cave.floors.f1.visited).toEqual([]);
  });

  it('呼び戻しはフェーズ1では不可', () => {
    const s = newGame(5);
    const e = sent(s);
    expect(recall(s, e.id).ok).toBe(false);
  });
});

describe('advanceDay', () => {
  it('日給と維持費30が引かれ、台帳に載る(1日目は初期支援金60Gが入る)', () => {
    const s = newGame(9);
    const w = wages(s);
    const r = advanceDay(s);
    expect(r.day).toBe(2);
    expect(s.day).toBe(2);
    expect(s.gold).toBe(500 + 60 - w - 30);
    expect(s.ledger.some((l) => l.amount === -w && l.label.includes('日給'))).toBe(true);
    expect(s.ledger.some((l) => l.amount === -30 && l.label.includes('維持費'))).toBe(true);
  });

  it('赤字なら利息2%・忠誠−4・評判−1', () => {
    const s = newGame(9);
    s.gold = -1000;
    s.rep = 5;
    const loyal = s.adventurers.map((a) => a.loyalty);
    const w = wages(s);
    advanceDay(s);
    const deficit = 1000 + w + 30 - 60;
    expect(s.gold).toBe(-deficit - Math.ceil(deficit * 0.02));
    expect(s.rep).toBe(4);
    expect(s.debt).toBe(true);
    s.adventurers.forEach((a, i) => expect(a.loyalty).toBe(loyal[i] - 4 + 1));
  });

  it('忠誠は全員毎日+1(派遣中も)、上限255', () => {
    const s = newGame(11);
    const ids = s.adventurers.map((a) => a.id);
    sent(s, { partyIds: ids.slice(0, 2), days: 5, items: {} });
    s.adventurers[3].loyalty = 255;
    const loyal = s.adventurers.map((a) => a.loyalty);
    advanceDay(s);
    expect(s.adventurers.map((a) => a.loyalty)).toEqual(loyal.map((v) => Math.min(255, v + 1)));
  });

  it('待機者は疲労−25・負傷−1', () => {
    const s = newGame(11);
    s.adventurers[0].fatigue = 30;
    s.adventurers[0].injuryDays = 2;
    advanceDay(s);
    expect(s.adventurers[0].fatigue).toBe(5);
    expect(s.adventurers[0].injuryDays).toBe(1);
  });

  it('帰還日に結果が反映される(素材・持ち物・地図・状態・履歴・お知らせ)', () => {
    const s = newGame(13);
    const e = sent(s, { days: 2 });
    const res = structuredClone(e.result);
    const potionsLeft = res.items.potion ?? 0;
    const r1 = advanceDay(s);
    expect(r1.returned).toHaveLength(0);
    expect(s.adventurers.every((a) => a.status === 'away')).toBe(true);
    const r2 = advanceDay(s);
    expect(r2.day).toBe(3);
    expect(r2.returned.map((x) => x.id)).toEqual([e.id]);
    expect(r2.notices.length).toBeGreaterThan(0);
    expect(s.expeditions).toHaveLength(0);
    expect(s.history[0].id).toBe(e.id);
    expect(s.adventurers.every((a) => a.status === 'idle')).toBe(true);
    expect(s.inventory.potion).toBe(1 + potionsLeft);
    if (!res.wiped) for (const [k, n] of Object.entries(res.materials)) expect(s.inventory[k]).toBe(n);
    const visited = s.dungeons.forest_cave.floors.f1.visited;
    expect(visited.length).toBeGreaterThan(0);
    expect([...visited].sort()).toEqual([...new Set(res.mapDeltas[0].cells)].sort());
    expect(exploredRateOf(s, 'forest_cave', 'f1')).toBeGreaterThan(0);
    for (const a of s.adventurers) {
      expect(a.history.expeditions).toBe(1);
      expect(a.history.visits.forest_cave).toBe(1);
    }
  });

  it('地図の進捗は重複なくマージされる', () => {
    const s = newGame(13);
    const e = sent(s, { days: 1 });
    e.result.mapDeltas = [{ dungeon: 'forest_cave', floor: 'f1', cells: [60, 61, 62], hidden: [67] }];
    s.dungeons.forest_cave.floors.f1 = { visited: [60, 63], hiddenFound: [67] };
    advanceDay(s);
    expect([...s.dungeons.forest_cave.floors.f1.visited].sort((a, b) => a - b)).toEqual([60, 61, 62, 63]);
    expect(s.dungeons.forest_cave.floors.f1.hiddenFound).toEqual([67]);
  });

  it('成功で忠誠+3(+日次1)、負傷で−3', () => {
    const s = newGame(17);
    const e = sent(s, { days: 1 });
    const [a0, a1] = s.adventurers;
    Object.assign(e.result, { success: true, retreated: false, wiped: false, injuries: { [a1.id]: 2 } });
    const l0 = a0.loyalty, l1 = a1.loyalty;
    advanceDay(s);
    expect(a0.loyalty).toBe(l0 + 3 + 1);
    expect(a1.loyalty).toBe(l1 + 3 - 3 + 1);
    expect(a1.injuryDays).toBe(2);
  });

  it('全滅の帰還: 救助費用が引かれ、失った素材は入らず、忠誠−20', () => {
    const s = newGame(19);
    const e = sent(s, { days: 1, items: {} });
    const ids = s.adventurers.map((a) => a.id);
    Object.assign(e.result, {
      success: false, retreated: false, wiped: true,
      materials: {}, lostMaterials: { herb: 3 }, gold: 0, rescueCost: 120,
      injuries: Object.fromEntries(ids.map((id) => [id, 3])),
    });
    const loyal = s.adventurers.map((a) => a.loyalty);
    const w = wages(s);
    advanceDay(s);
    expect(s.gold).toBe(500 + 60 - w - 30 - 120);
    expect(s.ledger.some((l) => l.amount === -120)).toBe(true);
    expect(s.inventory.herb ?? 0).toBe(0);
    s.adventurers.forEach((a, i) => expect(a.loyalty).toBe(loyal[i] - 20 + 1));
    expect(s.adventurers.every((a) => a.injuryDays === 3)).toBe(true);
  });
});

describe('売買', () => {
  it('素材を売ると価格×個数が入り台帳に載る。持っていない数は売れない', () => {
    const s = newGame(1);
    s.inventory.fang = 3;
    expect(sellMaterial(s, 'fang', 4).ok).toBe(false);
    expect(sellMaterial(s, 'potion', 1).ok).toBe(false);
    expect(sellMaterial(s, 'fang', 2).ok).toBe(true);
    expect(s.inventory.fang).toBe(1);
    expect(s.gold).toBe(500 + 36);
    expect(s.ledger[0].amount).toBe(36);
  });

  it('回復薬だけ買える。資金不足では買えない', () => {
    const s = newGame(1);
    expect(buyItem(s, 'potion', 2).ok).toBe(true);
    expect(s.inventory.potion).toBe(4);
    expect(s.gold).toBe(440);
    expect(buyItem(s, 'herb', 1).ok).toBe(false);
    expect(buyItem(s, 'potion', 100).ok).toBe(false);
    expect(s.inventory.potion).toBe(4);
  });
});

describe('決定論', () => {
  it('同seedで同じ手順なら同じ状態', () => {
    const play = () => {
      const s = newGame(42);
      sent(s, { days: 3 });
      for (let i = 0; i < 4; i++) advanceDay(s);
      sent(s, { days: 2, items: {} });
      for (let i = 0; i < 3; i++) advanceDay(s);
      return s;
    };
    expect(play()).toEqual(play());
  });
});

const caveGrid = parseFloor(DUNGEON.forest_cave.floors[0]);
const caveCells = (pred: (kind: string) => boolean) => caveGrid.cells.flatMap((c, i) => (pred(c.kind) ? [i] : []));
const caveSymbol = caveCells((k) => k === 'symbol')[0];
const caveAll = caveCells((k) => k !== 'wall');

describe('行動種別の検証', () => {
  it('護衛・輸送はまだ出せない', () => {
    const s = newGame(3);
    expect(dispatch(s, order(s, { action: 'escort' })).ok).toBe(false);
    expect(dispatch(s, order(s, { action: 'transport' })).ok).toBe(false);
  });

  it('踏査は未確認のダンジョンにだけ、他は確認済みにだけ出せる', () => {
    const s = newGame(3);
    expect(s.dungeons.old_mine.confirmed).toBe(false);
    expect(dispatch(s, order(s, { action: 'survey' })).ok).toBe(false);
    expect(dispatch(s, order(s, { target: { dungeon: 'old_mine', floor: 'f1' } })).ok).toBe(false);
    expect(dispatch(s, order(s, { action: 'survey', target: { dungeon: 'old_mine', floor: 'f1' } })).ok).toBe(true);
  });

  it('踏査から帰ると(全滅でも)入口が確認済みになり、お知らせが出る', () => {
    const s = newGame(3);
    const e = sent(s, { action: 'survey', target: { dungeon: 'old_mine', floor: 'f1' }, days: 1, items: {} });
    Object.assign(e.result, { success: false, wiped: true, materials: {}, rescueCost: 0 });
    const r = advanceDay(s);
    expect(s.dungeons.old_mine.confirmed).toBe(true);
    expect(r.notices).toContain('古い坑道の入口を確認した。');
  });

  it('採集は対象素材が必須で、そのフロアの採取点にある素材だけ', () => {
    const s = newGame(3);
    expect(dispatch(s, order(s, { action: 'gather' })).ok).toBe(false);
    expect(dispatch(s, order(s, { action: 'gather', target: { dungeon: 'forest_cave', floor: 'f1', item: 'iron_ore' } })).ok).toBe(false);
    expect(dispatch(s, order(s, { action: 'gather', target: { dungeon: 'forest_cave', floor: 'f1', item: 'herb' } })).ok).toBe(true);
  });

  it('討伐の対象指定は探索率100%から、そのフロアの巣・シンボルの敵だけ', () => {
    const s = newGame(3);
    const hunt = (enemy?: string) => order(s, { action: 'hunt', target: { dungeon: 'forest_cave', floor: 'f1', enemy } });
    expect(dispatch(s, hunt('wolf')).ok).toBe(false);
    s.dungeons.forest_cave.floors.f1.visited = caveAll;
    expect(dispatch(s, hunt('slime')).ok).toBe(false);
    expect(dispatch(s, hunt('wolf')).ok).toBe(true);
    const t = newGame(3);
    expect(dispatch(t, order(t, { action: 'hunt' })).ok).toBe(true);
  });

  it('ボスはシンボルを踏んだことがあるときだけ出せ、直行して戦う', () => {
    const s = newGame(3);
    expect(dispatch(s, order(s, { action: 'boss' })).ok).toBe(false);
    // 隠し通路を開けていないと往復が日数に収まらないので、近道込みの知識にする
    s.dungeons.forest_cave.floors.f1 = { visited: caveAll, hiddenFound: caveCells((k) => k === 'hidden') };
    const e = sent(s, { action: 'boss', days: 3 });
    expect(e.result.mapDeltas[0].cells).toEqual([]);
    expect(e.result.log.some((l) => l.kind === 'combat')).toBe(true);
    expect(caveSymbol).toBeGreaterThan(0);
  });

  it('シンボルの敵を倒すと bossDefeated が増え、全マス踏むと踏破のお知らせ', () => {
    const s = newGame(3);
    const e = sent(s, { days: 1 });
    e.result.kills = { goblin_chief: 1, goblin: 2 };
    e.result.mapDeltas = [{ dungeon: 'forest_cave', floor: 'f1', cells: caveAll, hidden: caveCells((k) => k === 'hidden') }];
    const r = advanceDay(s);
    expect(s.dungeons.forest_cave.bossDefeated).toBe(1);
    expect(s.dungeons.forest_cave.fullCleared).toBe(true);
    expect(r.notices.some((n) => n.includes('踏破'))).toBe(true);
  });
});

function place(s: GameState, id: string, x: number, y: number, level = 1) {
  s.base.facilities.push({ id, level, x, y, builtDay: 1, construction: null });
}

describe('初期支援金', () => {
  it('1〜5日目の日送りで60Gずつ台帳「初期支援金」に載り、6日目からは無い', () => {
    const s = newGame(13);
    for (let i = 0; i < 7; i++) advanceDay(s);
    const support = s.ledger.filter((l) => l.label === '初期支援金');
    expect(support.map((l) => l.day)).toEqual([5, 4, 3, 2, 1]);
    expect(support.every((l) => l.amount === 60)).toBe(true);
  });
});

describe('施設の維持費', () => {
  it('完成済みの施設の upkeep 合計が台帳「施設維持費」に載る。建設中は掛からない', () => {
    const s = newGame(13);
    place(s, 'dorm', 0, 0);
    place(s, 'workshop', 1, 0);
    s.base.facilities.push({ id: 'clinic', level: 0, x: 2, y: 0, builtDay: 1, construction: { toLevel: 1, untilDay: 9 } });
    const gold = s.gold;
    const w = wages(s);
    advanceDay(s);
    expect(s.ledger.some((l) => l.label === '施設維持費' && l.amount === -13)).toBe(true);
    expect(s.gold).toBe(gold + 60 - w - 30 - 13);
  });
});

describe('施設勤務と派遣', () => {
  it('勤務中の者は派遣できず、待機者と同じく回復する', () => {
    const s = newGame(17);
    place(s, 'workshop', 0, 0);
    const a = s.adventurers[0];
    expect(assignWorker(s, a.id, 'workshop').ok).toBe(true);
    expect(dispatch(s, order(s)).ok).toBe(false);
    a.fatigue = 50;
    a.injuryDays = 2;
    advanceDay(s);
    expect(a.fatigue).toBe(25);
    expect(a.injuryDays).toBe(1);
    expect(a.status).toBe('working');
  });
});

describe('治療所', () => {
  it('帰還時の負傷日数を −Lv(最低1)、待機者の疲労回復 +5×Lv', () => {
    const s = newGame(19);
    place(s, 'clinic', 0, 0);
    const ids = s.adventurers.map((a) => a.id);
    const e = sent(s, { partyIds: ids.slice(0, 2), days: 1, items: {} });
    e.result.injuries = { [ids[0]]: 3, [ids[1]]: 1 };
    s.adventurers[3].fatigue = 50;
    advanceDay(s);
    expect(s.adventurers[0].injuryDays).toBe(2);
    expect(s.adventurers[1].injuryDays).toBe(1);
    expect(s.adventurers[3].fatigue).toBe(50 - 25 - 5);
    s.base.facilities[0].level = 2;
    s.adventurers[3].fatigue = 50;
    advanceDay(s);
    expect(s.adventurers[3].fatigue).toBe(50 - 25 - 10);
  });

  it('静かな寮(治療所×宿舎)で待機者の疲労回復がさらに+10', () => {
    const s = newGame(19);
    place(s, 'clinic', 0, 0);
    place(s, 'dorm', 0, 1);
    s.adventurers[0].fatigue = 60;
    advanceDay(s);
    expect(s.adventurers[0].fatigue).toBe(60 - 25 - 5 - 10);
  });
});

describe('訓練所', () => {
  it('帰還時の経験値が ×(1+0.2×Lv)', () => {
    const run = (level: number) => {
      const s = newGame(23);
      if (level) place(s, 'training', 0, 0, level);
      const ids = s.adventurers.map((a) => a.id);
      const e = sent(s, { partyIds: ids.slice(0, 1), days: 1, items: {} });
      e.result.expGain = { [ids[0]]: 50 };
      const ref = structuredClone(s.adventurers[0]);
      advanceDay(s);
      return { got: s.adventurers[0], ref };
    };
    for (const [level, gain] of [[0, 50], [1, 60], [2, 70]]) {
      const { got, ref } = run(level);
      addExp(ref, gain);
      expect([got.level, got.exp]).toEqual([ref.level, ref.exp]);
    }
  });

  it('朝練(訓練所×宿舎)で待機者に毎日経験値+2', () => {
    const s = newGame(23);
    place(s, 'training', 0, 0);
    place(s, 'dorm', 1, 0);
    const exp = s.adventurers.map((a) => a.exp);
    advanceDay(s);
    s.adventurers.forEach((a, i) => expect(a.exp).toBe(exp[i] + 2));
  });
});

describe('施設込みの決定論', () => {
  it('建設・クラフト・勤務・派遣を混ぜても同seedで同じ状態', () => {
    const play = () => {
      const s = newGame(42);
      s.gold = 3000;
      s.inventory = { ...s.inventory, moss_ore: 10, herb: 10, slime_gel: 5 };
      place(s, 'alchemy', 2, 2);
      assignWorker(s, s.adventurers[3].id, 'alchemy');
      startCraft(s, 'r_potion');
      const ids = s.adventurers.map((a) => a.id).slice(0, 3);
      sent(s, { partyIds: ids, leaderId: ids[0], days: 3, items: {} });
      for (let i = 0; i < 5; i++) advanceDay(s);
      return s;
    };
    expect(play()).toEqual(play());
  });
});
