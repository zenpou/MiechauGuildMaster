import { describe, expect, it } from 'vitest';
import { addExp, generateAdventurer } from '../src/core/adventurer';
import { assignWorker } from '../src/core/base';
import { startCraft } from '../src/core/craft';
import { DUNGEON, FACILITY, ITEM, RECIPES, TUNING } from '../src/core/data';

const G0 = TUNING.game.startGold;
const SUP = TUNING.game.supportGold;
import { parseFloor } from '../src/core/dungeon';
import {
  acceptQuest, advanceDay, buildFacility, buyItem, dispatch, exploredRateOf, newGame, recall, sellGold, sellItem,
} from '../src/core/game';
import { availableRecipes, canCraft } from '../src/core/craft';
import { createQuest, deliver } from '../src/core/quests';
import { hire } from '../src/core/recruit';
import { rngFor } from '../src/core/rng';
import { planSteps, route } from '../src/core/world';
import { trainSkill } from '../src/core/training';
import { pairKey } from '../src/core/relations';
import { fullGame } from './helpers';
import { DUNGEON as DUNGEONS_T } from '../src/core/data';
import type { DispatchOrder, Expedition, GameState, Quest } from '../src/core/types';

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
  it('名簿はティナ1人・初期資金・回復薬2・森の洞窟の進捗0', () => {
    const s = newGame(7);
    expect(s.gold).toBe(G0);
    expect(s.adventurers).toHaveLength(1);
    expect(s.adventurers[0]).toMatchObject({ unique: 'tina', appearance: 'tina', job: 'fighter', status: 'idle' });
    expect(s.adventurers[0].history.hiredDay).toBe(1);
    expect(s.inventory.potion).toBe(2);
    expect(s.dungeons.forest_cave).toEqual({ confirmed: true, floors: { f1: { visited: [], hiddenFound: [] } }, bossDefeated: 0, fullCleared: false });
    expect(s.world.visitedNodes).toEqual(['base', 'forest_cave']);
    expect(s.ledger.some((l) => l.amount === G0)).toBe(true);
    expect(exploredRateOf(s, 'forest_cave', 'f1')).toBe(0);
  });
});

describe('dispatch の検証', () => {
  it('重複・0人・5人・在庫不足・隊長が隊外・日数外・負傷者は ok:false で、状態を変えない', () => {
    const s = fullGame(3);
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
    const s = fullGame(3);
    const ids = s.adventurers.map((a) => a.id);
    sent(s, { partyIds: ids.slice(0, 2), items: {} });
    expect(dispatch(s, order(s, { partyIds: [ids[1], ids[2]], leaderId: ids[1], items: {} })).ok).toBe(false);
  });

  it('出発後、隊員は away になり持ち物が在庫から減る。地図は帰還日まで変わらない', () => {
    const s = fullGame(5);
    const e = sent(s, { days: 3, items: { potion: 1 } });
    expect(s.adventurers.every((a) => a.status === 'away')).toBe(true);
    expect(s.inventory.potion).toBe(1);
    expect(e.startDay).toBe(1);
    expect(e.returnDay).toBe(4);
    expect(s.expeditions).toHaveLength(1);
    expect(s.counters.dispatches).toBe(1);
    expect(s.dungeons.forest_cave.floors.f1.visited).toEqual([]);
  });

});

describe('advanceDay', () => {
  it('日給と維持費30が引かれ、台帳に載る(1日目は初期支援金が入る)', () => {
    const s = fullGame(9);
    const w = wages(s);
    const r = advanceDay(s);
    expect(r.day).toBe(2);
    expect(s.day).toBe(2);
    expect(s.gold).toBe(G0 + SUP - w - 30);
    expect(s.ledger.some((l) => l.amount === -w && l.label.includes('日給'))).toBe(true);
    expect(s.ledger.some((l) => l.amount === -30 && l.label.includes('維持費'))).toBe(true);
  });

  it('赤字なら利息(debtInterest)・忠誠(debtLoyalty)・評判−1', () => {
    const s = fullGame(9);
    s.gold = -1000;
    s.rep = 5;
    const loyal = s.adventurers.map((a) => a.loyalty);
    const w = wages(s);
    advanceDay(s);
    const deficit = 1000 + w + 30 - SUP;
    expect(s.gold).toBe(-deficit - Math.ceil(deficit * TUNING.game.debtInterest));
    expect(s.rep).toBe(4);
    expect(s.debt).toBe(true);
    s.adventurers.forEach((a, i) => expect(a.loyalty).toBe(loyal[i] + TUNING.game.debtLoyalty + 1));
  });

  describe('再建支援(全員が去ったあとに詰まない)', () => {
    const empty = (gold: number) => {
      const s = fullGame(9);
      s.adventurers = [];
      s.gold = gold;
      return s;
    };

    it('名簿が空で資金がマイナスのとき、借金を帳消しにして reliefGold に戻し、台帳とお知らせに残す', () => {
      const s = empty(-150_000);
      advanceDay(s);
      expect(s.gold).toBe(TUNING.game.reliefGold);
      expect(s.debt).toBe(false);
      expect(s.ledger[0].label).toContain('再建支援');
      expect(s.ledger[0].amount).toBeGreaterThan(150_000);
      expect(s.notices[0].text).toContain('帳消し');
    });

    it('そのあと候補者を雇って立て直せる', () => {
      const s = empty(-150_000);
      s.day = Math.max(s.day, TUNING.game.candidateFromDay);
      advanceDay(s);
      const cand = s.candidates[0];
      expect(hire(s, cand.adv.id)).toEqual({ ok: true });
      expect(s.adventurers).toHaveLength(1);
    });

    it('名簿が空でも、資金が0以上のあいだは何もしない(空の名簿で日を送るたびにお知らせを出さない)', () => {
      const s = empty(100);
      advanceDay(s);
      expect(s.ledger.some((l) => l.label.includes('再建支援'))).toBe(false);
      expect(s.gold).toBe(100 + SUP - 30);
      expect(empty(TUNING.game.reliefGold + 5000).gold).toBeGreaterThan(TUNING.game.reliefGold);
    });

    it('名簿に人がいるあいだは、借金が深くても何もしない(派遣で稼いで返せる)', () => {
      const s = fullGame(9);
      s.gold = -50_000;
      advanceDay(s);
      expect(s.gold).toBeLessThan(0);
      expect(s.ledger.some((l) => l.label.includes('再建支援'))).toBe(false);
    });

    it('idle のまま長く放置しても、名簿が空になった日以降は資金がマイナスのまま残らず、借金が膨らみ続けない', () => {
      const s = fullGame(9);
      // ユニークは去らないので、名簿が空になる状況は汎用の者だけで作る
      s.adventurers = s.adventurers.filter((a) => !a.unique);
      let emptyDays = 0;
      for (let d = 0; d < 400; d++) {
        advanceDay(s);
        if (s.adventurers.length === 0) {
          emptyDays++;
          expect(s.gold, `${s.day}日目`).toBeGreaterThanOrEqual(0);
        }
      }
      expect(emptyDays).toBeGreaterThan(0);
    });
  });

  it('忠誠は全員毎日+1(派遣中も)、上限255', () => {
    const s = fullGame(11);
    const ids = s.adventurers.map((a) => a.id);
    sent(s, { partyIds: ids.slice(0, 2), days: 5, items: {} });
    s.adventurers[3].loyalty = 255;
    const loyal = s.adventurers.map((a) => a.loyalty);
    advanceDay(s);
    expect(s.adventurers.map((a) => a.loyalty)).toEqual(loyal.map((v) => Math.min(255, v + 1)));
  });

  it('待機者は疲労−25・負傷−1', () => {
    const s = fullGame(11);
    s.adventurers[0].fatigue = 30;
    s.adventurers[0].injuryDays = 2;
    advanceDay(s);
    expect(s.adventurers[0].fatigue).toBe(5);
    expect(s.adventurers[0].injuryDays).toBe(1);
  });

  it('帰還日に結果が反映される(素材・持ち物・地図・状態・履歴・お知らせ)', () => {
    const s = fullGame(13);
    // ティナの頼み(牙の納品)が帰還の素材を在庫から引くので、名簿から外して素材の反映だけを見る
    s.adventurers = s.adventurers.filter((a) => !a.unique);
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
    const s = fullGame(13);
    const e = sent(s, { days: 1 });
    e.result.mapDeltas = [{ dungeon: 'forest_cave', floor: 'f1', cells: [60, 61, 62], hidden: [67] }];
    s.dungeons.forest_cave.floors.f1 = { visited: [60, 63], hiddenFound: [67] };
    advanceDay(s);
    expect([...s.dungeons.forest_cave.floors.f1.visited].sort((a, b) => a - b)).toEqual([60, 61, 62, 63]);
    expect(s.dungeons.forest_cave.floors.f1.hiddenFound).toEqual([67]);
  });

  it('成功で忠誠+3(+日次1)、負傷で−3', () => {
    const s = fullGame(17);
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
    const s = fullGame(19);
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
    expect(s.gold).toBe(G0 + SUP - w - 30 - 120);
    expect(s.ledger.some((l) => l.amount === -120)).toBe(true);
    expect(s.inventory.herb ?? 0).toBe(0);
    s.adventurers.forEach((a, i) => expect(a.loyalty).toBe(loyal[i] - 20 + 1));
    expect(s.adventurers.every((a) => a.injuryDays === 3)).toBe(true);
  });
});

describe('売買', () => {
  it('素材を売ると価格×個数が入り台帳に載る。持っていない数は売れない', () => {
    const s = fullGame(1);
    s.inventory.fang = 3;
    expect(sellItem(s, 'fang', 4).ok).toBe(false);
    expect(sellItem(s, 'potion', 1).ok).toBe(false);
    expect(sellItem(s, 'fang', 2).ok).toBe(true);
    expect(s.inventory.fang).toBe(1);
    const price = Math.round(ITEM.fang.price * 2 * TUNING.game.sellScale);
    expect(s.gold).toBe(G0 + price);
    expect(s.ledger[0].amount).toBe(price);
  });

  describe('装備の中古売却(儲けではなく、使わなくなった装備の処理)', () => {
    const gear = ['bone_dagger', 'iron_armor', 'ember_ring'] as const;

    it('使わなくなった装備(武器・防具・装飾)を、素材と同じ相場の計算で売れる。台帳には「中古売却」で載る', () => {
      for (const id of gear) {
        const s = fullGame(1);
        s.inventory[id] = 2;
        expect(sellItem(s, id, 1)).toEqual({ ok: true });
        const price = Math.round(ITEM[id].price * TUNING.game.sellScale);
        expect(sellGold(s, id, 1), id).toBe(price);
        expect(s.gold, id).toBe(G0 + price);
        expect(s.inventory[id], id).toBe(1);
        expect(s.ledger[0]).toEqual({ day: s.day, label: `中古売却: ${ITEM[id].name}×1`, amount: price });
      }
    });

    it('市場の上乗せは、中古にも同じように掛かる', () => {
      const s = fullGame(1);
      place(s, 'market', 0, 0);
      expect(sellGold(s, 'iron_armor', 1)).toBe(Math.round(ITEM.iron_armor.price * TUNING.game.sellScale * 1.1));
    });

    it('着けている装備は在庫に無いので売れない(外してから)', () => {
      const s = fullGame(1);
      s.adventurers[0].equipment.weapon = 'bone_dagger';
      s.inventory.bone_dagger = 0;
      expect(sellItem(s, 'bone_dagger', 1).ok).toBe(false);
      expect(s.adventurers[0].equipment.weapon).toBe('bone_dagger');
    });

    it('回復薬・鍵・建材・知らない品・持っていない数は売れない(回復薬は買値より高く売れてしまうので特に)', () => {
      const s = fullGame(1);
      s.inventory.ruin_key = 1;
      s.inventory.lumber = 5;
      s.inventory.bone_dagger = 1;
      const before = structuredClone(s);
      for (const id of ['potion', 'hi_potion', 'ruin_key', 'lumber', 'nope']) expect(sellItem(s, id, 1).ok, id).toBe(false);
      expect(sellItem(s, 'bone_dagger', 2).ok).toBe(false);
      expect(s).toEqual(before);
    });

    it('どの装備も、市場の上乗せが最大でも、作るのにかかった費用(原料を素材で売った額+製作費)より安く売れる', () => {
      // 作って売ると必ず損、にしておく。工房を儲けの種にしない(「鍛冶屋に頼めよ」になるため)
      const best = 1 + 0.2 + 0.1;
      for (const r of RECIPES) {
        const out = ITEM[r.output.item];
        if (!['weapon', 'armor', 'accessory'].includes(out.kind)) continue;
        const cost = r.inputs.reduce((t, i) => t + ITEM[i.item].price * i.n * TUNING.game.sellScale, 0) + r.gold;
        const sale = out.price * r.output.n * TUNING.game.sellScale * best;
        expect(sale, `${out.name}: 売値 ${Math.round(sale)}G は費用 ${Math.round(cost)}G 未満`).toBeLessThan(cost);
      }
    });
  });

  it('回復薬だけ買える。資金不足では買えない', () => {
    const s = fullGame(1);
    expect(buyItem(s, 'potion', 2).ok).toBe(true);
    expect(s.inventory.potion).toBe(4);
    expect(s.gold).toBe(G0 - 60);
    expect(buyItem(s, 'herb', 1).ok).toBe(false);
    expect(buyItem(s, 'potion', 100).ok).toBe(false);
    expect(s.inventory.potion).toBe(4);
  });
});

describe('決定論', () => {
  it('同seedで同じ手順なら同じ状態', () => {
    const play = () => {
      const s = fullGame(42);
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
  it('護衛・運搬は受注中の依頼が無ければ出せない', () => {
    const s = fullGame(3);
    expect(dispatch(s, order(s, { action: 'escort' })).ok).toBe(false);
    expect(dispatch(s, order(s, { action: 'transport' })).ok).toBe(false);
    expect(dispatch(s, order(s, { action: 'escort', target: { questId: 'nope' } })).ok).toBe(false);
  });

  it('踏査は未確認のダンジョンにだけ、他は確認済みにだけ出せる', () => {
    const s = fullGame(3);
    expect(s.dungeons.old_mine.confirmed).toBe(false);
    expect(dispatch(s, order(s, { action: 'survey' })).ok).toBe(false);
    expect(dispatch(s, order(s, { target: { dungeon: 'old_mine', floor: 'f1' } })).ok).toBe(false);
    expect(dispatch(s, order(s, { action: 'survey', target: { dungeon: 'old_mine', floor: 'f1' } })).ok).toBe(true);
  });

  it('踏査から帰ると(全滅でも)入口が確認済みになり、お知らせが出る', () => {
    const s = fullGame(3);
    const e = sent(s, { action: 'survey', target: { dungeon: 'old_mine', floor: 'f1' }, days: 1, items: {} });
    expect(e.order.target.route).toEqual(['base', 'mountain_village', 'old_mine']);
    Object.assign(e.result, { success: false, wiped: true, materials: {}, rescueCost: 0 });
    const notices: string[] = [];
    while (s.day < e.returnDay) notices.push(...advanceDay(s).notices);
    expect(s.dungeons.old_mine.confirmed).toBe(true);
    expect(notices).toContain('古い坑道の入口を確認した。');
  });

  it('採集は対象素材が必須で、そのフロアの採取点にある素材だけ', () => {
    const s = fullGame(3);
    expect(dispatch(s, order(s, { action: 'gather' })).ok).toBe(false);
    expect(dispatch(s, order(s, { action: 'gather', target: { dungeon: 'forest_cave', floor: 'f1', item: 'iron_ore' } })).ok).toBe(false);
    expect(dispatch(s, order(s, { action: 'gather', target: { dungeon: 'forest_cave', floor: 'f1', item: 'herb' } })).ok).toBe(true);
  });

  it('討伐の対象指定は探索率100%から、そのフロアの巣・シンボルの敵だけ', () => {
    const s = fullGame(3);
    const hunt = (enemy?: string) => order(s, { action: 'hunt', target: { dungeon: 'forest_cave', floor: 'f1', enemy } });
    expect(dispatch(s, hunt('wolf')).ok).toBe(false);
    s.dungeons.forest_cave.floors.f1.visited = caveAll;
    expect(dispatch(s, hunt('slime')).ok).toBe(false);
    expect(dispatch(s, hunt('wolf')).ok).toBe(true);
    const t = fullGame(3);
    expect(dispatch(t, order(t, { action: 'hunt' })).ok).toBe(true);
  });

  it('ボスはシンボルを踏んだことがあるときだけ出せ、直行して戦う', () => {
    const s = fullGame(3);
    expect(dispatch(s, order(s, { action: 'boss' })).ok).toBe(false);
    // 隠し通路を開けていないと往復が日数に収まらないので、近道込みの知識にする
    s.dungeons.forest_cave.floors.f1 = { visited: caveAll, hiddenFound: caveCells((k) => k === 'hidden') };
    const e = sent(s, { action: 'boss', days: 3 });
    expect(e.result.mapDeltas[0].cells).toEqual([]);
    expect(e.result.log.some((l) => l.kind === 'combat')).toBe(true);
    expect(caveSymbol).toBeGreaterThan(0);
  });

  it('シンボルの敵を倒すと bossDefeated が増え、全マス踏むと踏破のお知らせ', () => {
    const s = fullGame(3);
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
  it('supportDays 日目までの日送りで supportGold ずつ台帳「初期支援金」に載り、その後は無い', () => {
    const s = fullGame(13);
    const days = TUNING.game.supportDays;
    for (let i = 0; i < days + 2; i++) advanceDay(s);
    const support = s.ledger.filter((l) => l.label === '初期支援金');
    expect(support.map((l) => l.day)).toEqual(Array.from({ length: days }, (_, i) => days - i));
    expect(support.every((l) => l.amount === SUP)).toBe(true);
  });
});

describe('施設の維持費', () => {
  it('完成済みの施設の upkeep 合計が台帳「施設維持費」に載る。建設中は掛からない', () => {
    const s = fullGame(13);
    place(s, 'dorm', 0, 0);
    place(s, 'workshop', 1, 0);
    s.base.facilities.push({ id: 'clinic', level: 0, x: 2, y: 0, builtDay: 1, construction: { toLevel: 1, untilDay: 9 } });
    const gold = s.gold;
    const w = wages(s);
    // 完成済みの dorm(5)と workshop(8)。建設中の clinic は数えない
    const upkeep = Math.round((FACILITY.dorm.upkeep + FACILITY.workshop.upkeep) * TUNING.game.facilityUpkeepScale);
    advanceDay(s);
    expect(s.ledger.some((l) => l.label === '施設維持費' && l.amount === -upkeep)).toBe(true);
    expect(s.gold).toBe(gold + SUP - w - 30 - upkeep);
  });
});

describe('施設勤務と派遣', () => {
  it('勤務中の者は派遣できず、待機者と同じく回復する', () => {
    const s = fullGame(17);
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
    const s = fullGame(19);
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
    const s = fullGame(19);
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
      const s = fullGame(23);
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
    const s = fullGame(23);
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
      const s = fullGame(42);
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

describe('fullGame(フェーズ4)', () => {
  it('候補者2人・拠点の依頼2件・解放依頼が置かれる', () => {
    const s = fullGame(7);
    expect(s.candidates.length).toBe(2);
    expect(s.quests.filter((q) => q.town === 'base' && q.status === 'posted').length).toBe(2);
    expect(s.quests.some((q) => q.templateId === 'u_forge_iron')).toBe(true);
    expect(fullGame(7)).toEqual(s);
  });
});

/** 拠点から2日の古い坑道へ出せるようにする */
function mineReady(seed: number): GameState {
  const s = fullGame(seed);
  s.dungeons.old_mine.confirmed = true;
  return s;
}

describe('移動込みの派遣', () => {
  it('returnDay = 出発日 + 往路 + 現地 + 復路、steps は planSteps と同じ', () => {
    const s = mineReady(21);
    const e = sent(s, { target: { dungeon: 'old_mine', floor: 'f1' }, days: 2 });
    const nodes = route('base', 'old_mine', s.world)!;
    expect(nodes).toEqual(['base', 'mountain_village', 'old_mine']);
    expect(e.result.wiped).toBe(false);
    const stay = Math.max(1, e.result.daysSpent);
    expect(e.returnDay).toBe(1 + 2 + stay + 2);
    expect(e.steps).toEqual(planSteps(nodes, stay, 1, s.world));
    expect(e.steps[e.steps.length - 1]).toEqual({ day: e.returnDay, node: 'base', edge: null, phase: 'return' });
  });

  it('森は0日の道なので returnDay は従来どおり', () => {
    const s = fullGame(5);
    const e = sent(s, { days: 3 });
    expect(e.returnDay).toBe(1 + Math.max(1, e.result.daysSpent));
    expect(e.steps.filter((x) => x.phase === 'stay').length).toBe(Math.max(1, e.result.daysSpent));
  });

  it('帰還で経路のノードが訪問済みに、通った道の危険度が実測値になる', () => {
    const s = mineReady(22);
    const e = sent(s, { target: { dungeon: 'old_mine', floor: 'f1' }, days: 1 });
    while (s.day < e.returnDay) advanceDay(s);
    expect(s.world.visitedNodes).toEqual(expect.arrayContaining(['base', 'forest_cave', 'mountain_village']));
    expect(s.world.measuredDanger.base__mountain_village).toBe(0.15);
  });

  it('往路で全滅したら現地に行かず、救助費用付きで引き返す', () => {
    let found: { s: GameState; e: Expedition } | null = null;
    for (let seed = 1; seed < 400 && !found; seed++) {
      const s = mineReady(seed);
      const a = s.adventurers[0];
      a.base = { ...a.base, hp: 1, atk: 1, def: 0, spd: 1 };
      const e = sent(s, { partyIds: [a.id], leaderId: a.id, target: { dungeon: 'old_mine', floor: 'f1' }, days: 3, items: {} });
      if (e.result.wiped && e.result.mapDeltas.length === 0) found = { s, e };
    }
    expect(found).not.toBeNull();
    const { e } = found!;
    expect(e.result.daysSpent).toBe(0);
    expect(e.result.rescueCost).toBeGreaterThan(0);
    expect(e.result.log.some((l) => l.text.includes('道中'))).toBe(true);
    expect(e.steps.some((x) => x.phase === 'stay')).toBe(false);
    expect(e.returnDay).toBeLessThanOrEqual(1 + 4);
    expect(e.steps[e.steps.length - 1]).toMatchObject({ day: e.returnDay, node: 'base' });
  });

  it('行き先のダンジョンが無ければ出せない', () => {
    const s = fullGame(3);
    expect(dispatch(s, order(s, { target: { dungeon: 'nowhere', floor: 'f1' } })).ok).toBe(false);
  });
});

function postQuest(s: GameState, templateId: string): Quest {
  const q = createQuest(s, templateId, rngFor(1, 'test', templateId));
  s.quests.push(q);
  return q;
}

describe('護衛・運搬', () => {
  it('護衛は出発日だけ出せ、拠点→山村→拠点で戻り、着けば達成', () => {
    const s = fullGame(31);
    const q = postQuest(s, 't_escort_village');
    expect(acceptQuest(s, q.id).ok).toBe(true);
    expect(dispatch(s, order(s, { action: 'escort', target: { questId: q.id }, items: {} })).ok).toBe(false);
    while (s.day < q.departDay!) advanceDay(s);
    const r = dispatch(s, order(s, { action: 'escort', target: { questId: q.id }, items: {} }));
    expect(r.ok).toBe(true);
    const e = (r as { expedition: Expedition }).expedition;
    expect(e.returnDay).toBe(s.day + 2);
    expect(e.result.daysSpent).toBe(0);
    expect(e.order.target.route).toEqual(['base', 'mountain_village']);
    while (s.day < e.returnDay) advanceDay(s);
    expect(e.result.wiped).toBe(false);
    expect(s.quests.find((x) => x.id === q.id)!.status).toBe('done');
    expect(s.world.visitedNodes).toContain('mountain_village');
  });

  it('同じ依頼に2隊は出せない', () => {
    const s = fullGame(34);
    s.world.visitedNodes.push('mountain_village');
    const q = postQuest(s, 't_transport_village');
    acceptQuest(s, q.id);
    const ids = s.adventurers.map((a) => a.id);
    sent(s, { partyIds: ids.slice(0, 2), leaderId: ids[0], action: 'transport', target: { questId: q.id }, items: {} });
    expect(dispatch(s, order(s, { partyIds: ids.slice(2), leaderId: ids[2], action: 'transport', target: { questId: q.id }, items: {} })).ok).toBe(false);
  });

  it('運搬は荷の重さが積載を超えると出せず、山村経由で拠点に戻る', () => {
    const s = fullGame(32);
    s.world.visitedNodes.push('mountain_village');
    const q = postQuest(s, 't_transport_village');
    expect(acceptQuest(s, q.id).ok).toBe(true);
    (q.target as { cargo?: number }).cargo = 10000;
    expect(dispatch(s, order(s, { action: 'transport', target: { questId: q.id }, items: {} })).ok).toBe(false);
    (q.target as { cargo?: number }).cargo = 8;
    const r = dispatch(s, order(s, { action: 'transport', target: { questId: q.id }, items: {} }));
    expect(r.ok).toBe(true);
    const e = (r as { expedition: Expedition }).expedition;
    expect(e.order.target.route).toEqual(['base', 'mountain_village', 'base']);
    expect(e.returnDay).toBe(1 + 2);
    expect(e.steps.map((x) => [x.day, x.edge ?? x.node])).toEqual([
      [1, 'base__mountain_village'], [2, 'base__mountain_village'], [3, 'base'],
    ]);
    while (s.day < e.returnDay) advanceDay(s);
    expect(e.result.wiped).toBe(false);
    expect(s.quests.find((x) => x.id === q.id)!.status).toBe('done');
  });

  it('持ち物は道中で使わず、そのまま戻る', () => {
    const s = fullGame(33);
    s.world.visitedNodes.push('mountain_village');
    const q = postQuest(s, 't_transport_village');
    acceptQuest(s, q.id);
    const e = sent(s, { action: 'transport', target: { questId: q.id }, items: { potion: 1 } });
    expect(s.inventory.potion).toBe(1);
    while (s.day < e.returnDay) advanceDay(s);
    expect(s.inventory.potion).toBe(2);
  });
});

describe('呼び戻し', () => {
  it('現地にいる隊は即復路。現地の成果は捨て、ログに「呼び戻し」', () => {
    const s = fullGame(41);
    const e = sent(s, { days: 3 });
    expect(recall(s, e.id)).toEqual({ ok: true });
    expect(e.recalledDay).toBe(1);
    expect(e.returnDay).toBe(2);
    expect(e.steps[e.steps.length - 1]).toEqual({ day: 2, node: 'base', edge: null, phase: 'return' });
    expect(e.result.mapDeltas).toEqual([]);
    expect(e.result.daysSpent).toBe(0);
    expect(e.result.success).toBe(false);
    expect(e.result.log.some((l) => l.text.includes('呼び戻し'))).toBe(true);
    expect(recall(s, e.id).ok).toBe(false);
    advanceDay(s);
    expect(s.expeditions).toEqual([]);
    expect(s.dungeons.forest_cave.floors.f1.visited).toEqual([]);
    expect(s.adventurers.every((a) => a.status === 'idle')).toBe(true);
  });

  it('往路の隊は今日の位置から引き返す', () => {
    const s = mineReady(42);
    const e = sent(s, { target: { dungeon: 'old_mine', floor: 'f1' }, days: 2, items: {} });
    expect(e.result.wiped).toBe(false);
    expect(recall(s, e.id).ok).toBe(true);
    expect(e.steps.map((x) => [x.day, x.edge ?? x.node, x.phase])).toEqual([
      [1, 'base__mountain_village', 'outbound'], [2, 'base__mountain_village', 'return'], [3, 'base', 'return'],
    ]);
    expect(e.returnDay).toBe(3);
    expect(e.order.target.route).toEqual(['base']);
  });

  it('派遣中でない隊は呼び戻せない', () => {
    const s = fullGame(43);
    expect(recall(s, 'nope').ok).toBe(false);
  });
});

describe('依頼の日次処理', () => {
  it('日送りで依頼が出て、受注期限を過ぎた掲示は消える', () => {
    const s = fullGame(51);
    s.gold = 100000;
    const first = s.quests.find((q) => q.town === 'base')!;
    first.acceptBy = s.day;
    for (let i = 0; i < 6; i++) advanceDay(s);
    expect(s.quests.some((q) => q.id === first.id)).toBe(false);
    expect(s.quests.some((q) => q.postedDay > 1)).toBe(true);
  });

  it('帰還で討伐の進捗が進む', () => {
    const s = fullGame(52);
    const q = postQuest(s, 't_hunt_goblin');
    expect(acceptQuest(s, q.id).ok).toBe(true);
    const e = sent(s, { days: 3 });
    while (s.day < e.returnDay) advanceDay(s);
    const kills = e.result.kills.goblin ?? 0;
    const after = s.quests.find((x) => x.id === q.id)!;
    expect(after.status).toBe(kills >= q.target.n! ? 'done' : 'accepted');
    expect(after.progress).toBe(kills);
  });

  it('評判Lvが上がった日にお知らせが出る', () => {
    const s = fullGame(53);
    s.rep = 8;
    const r = advanceDay(s);
    expect(r.notices.some((n) => n.includes('評判'))).toBe(true);
    expect(advanceDay(s).notices.some((n) => n.includes('評判'))).toBe(false);
  });

  it('候補者は日送りで到着し、期限で入れ替わる', () => {
    const s = fullGame(54);
    const firstIds = s.candidates.map((c) => c.adv.id);
    s.day = TUNING.game.candidateFromDay - 1;
    advanceDay(s);
    expect(s.candidates.length).toBeGreaterThan(2);
    for (let i = 0; i < TUNING.game.candidateDays; i++) advanceDay(s);
    expect(s.candidates.some((c) => firstIds.includes(c.adv.id))).toBe(false);
  });
});

describe('解放依頼とレシピ', () => {
  it('解放前は鉄の剣が作れず、鉄鉱石5個を納めると作れる', () => {
    const s = fullGame(61);
    s.gold = 5000;
    s.inventory = { ...s.inventory, iron_ore: 20, fang: 20, bone_shard: 20, slime_gel: 20, moss_ore: 20 };
    s.base.facilities.push({ id: 'workshop', level: 1, x: 0, y: 0, builtDay: 1, construction: null });
    expect(canCraft(s, 'r_iron_sword').ok).toBe(false);
    expect(availableRecipes(s).some((r) => r.id === 'r_iron_sword')).toBe(false);
    s.world.visitedNodes.push('forge_town');
    const u = s.quests.find((q) => q.templateId === 'u_forge_iron')!;
    expect(acceptQuest(s, u.id).ok).toBe(true);
    expect(deliver(s, u.id).ok).toBe(true);
    expect(canCraft(s, 'r_iron_sword').ok).toBe(true);
    expect(canCraft(s, 'r_iron_armor').ok).toBe(true);
    expect(availableRecipes(s).some((r) => r.id === 'r_iron_sword')).toBe(true);
  });
});

describe('勘違いの種', () => {
  it('buildFacility は建てて facility_built を積み、日送りで噂になる', () => {
    const s = fullGame(71);
    s.gold = 5000;
    s.inventory = { ...s.inventory, moss_ore: 20, iron_ore: 20, slime_gel: 20, glow_moss: 20, herb: 20 };
    expect(buildFacility(s, 'dorm', 0, 0)).toEqual({ ok: true });
    expect(s.pendingTags).toContain('facility_built');
    advanceDay(s);
    expect(s.scenes.length).toBe(1);
    expect(buildFacility(s, 'dorm', 1, 1).ok).toBe(false);
  });

  it('安全第一で低Lvの隊を出すと dispatch_safe_weak', () => {
    const s = fullGame(72);
    sent(s, { policy: 'safe' });
    expect(s.pendingTags).toContain('dispatch_safe_weak');
  });
});

describe('フェーズ4込みの決定論', () => {
  it('護衛・運搬・呼び戻し・候補者・依頼を混ぜても同seedで同じ状態', () => {
    const play = () => {
      const s = fullGame(77);
      s.gold = 5000;
      s.world.visitedNodes.push('mountain_village');
      const q = postQuest(s, 't_transport_village');
      acceptQuest(s, q.id);
      const ids = s.adventurers.map((a) => a.id);
      sent(s, { partyIds: ids.slice(0, 2), leaderId: ids[0], action: 'transport', target: { questId: q.id }, items: {} });
      const e = sent(s, { partyIds: ids.slice(2), leaderId: ids[2], days: 3, items: {} });
      advanceDay(s);
      recall(s, e.id);
      for (let i = 0; i < 12; i++) advanceDay(s);
      return s;
    };
    expect(play()).toEqual(play());
  });
});

describe('近道の発見', () => {
  it('山村を3回訪れると、山村と古い坑道の近道が開く', () => {
    const s = fullGame(21);
    s.gold = 5000;
    const go = () => {
      const ids = s.adventurers.filter((a) => a.status === 'idle' && a.injuryDays === 0).map((a) => a.id);
      const r = dispatch(s, { partyIds: ids, leaderId: ids[0], action: 'survey', target: { dungeon: 'old_mine', floor: 'f1' }, policy: 'safe', days: 1, items: {} });
      if (!r.ok) throw new Error(r.reason);
      while (s.expeditions.length) advanceDay(s);
      for (const a of s.adventurers) { a.injuryDays = 0; a.fatigue = 0; }
      if (s.dungeons.old_mine.confirmed) { /* 2回目以降は探索でよい */ }
    };
    for (let i = 0; i < 3; i++) {
      // 2回目以降は確認済みなので探索に切り替える
      const ids = s.adventurers.map((a) => a.id);
      const action = s.dungeons.old_mine.confirmed ? 'explore' : 'survey';
      const r = dispatch(s, { partyIds: ids, leaderId: ids[0], action, target: { dungeon: 'old_mine', floor: 'f1' }, policy: 'safe', days: 1, items: {} });
      if (!r.ok) throw new Error(r.reason);
      while (s.expeditions.length) advanceDay(s);
      for (const a of s.adventurers) { a.injuryDays = 0; a.fatigue = 0; a.status = 'idle'; }
      if (i < 2) expect(s.world.foundEdges).not.toContain('mountain_village__old_mine_short');
    }
    void go;
    expect(s.world.foundEdges).toContain('mountain_village__old_mine_short');
    expect(s.notices.some((n) => n.text.includes('近道'))).toBe(true);
  });
});

describe('訓練・親友・ユニークの日送りへの組み込み', () => {
  it('訓練は日数後に完了してスキルが付き、訓練中も疲労は回復する', () => {
    const s = fullGame(31);
    place(s, 'training', 0, 0);
    const a = s.adventurers[0];
    a.fatigue = 60;
    expect(trainSkill(s, a.id, 'might').ok).toBe(true);
    expect(a.status).toBe('training');
    advanceDay(s);
    expect(a.fatigue).toBeLessThan(60);
    advanceDay(s);
    advanceDay(s);
    expect(a.status).toBe('idle');
    expect(a.skills).toContain('might');
  });

  it('関係値60以上の2人は、同じ隊で5回目に帰還すると親友になる', () => {
    const s = fullGame(32);
    const [a, b] = s.adventurers;
    s.relations[pairKey(a.id, b.id)] = 70;
    s.flags[`pair:${pairKey(a.id, b.id)}`] = 4;
    const r = dispatch(s, order(s, { partyIds: [a.id, b.id], leaderId: a.id, days: 1 }));
    expect(r.ok).toBe(true);
    for (let i = 0; i < 6 && s.expeditions.length; i++) advanceDay(s);
    expect(s.flags[`friends:${pairKey(a.id, b.id)}`]).toBe(true);
  });

  it('ユニークの最初の頼み(ティナの牙の納品)は、在庫があれば日送りで進む', () => {
    const s = fullGame(33);
    s.inventory.fang = 5;
    advanceDay(s);
    expect(s.flags['tina:step']).toBe(1);
    expect(s.inventory.fang ?? 0).toBe(0);
  });

  it('帰還のひとことは最終結果で全員分作られる(現地なしの護衛・呼び戻しでも空にならない)', () => {
    const s = fullGame(34);
    const r = dispatch(s, order(s, { days: 1 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expedition.result.returnDialogue).toHaveLength(s.adventurers.length);
  });
});

describe('実績・竜の討伐の組み込み', () => {
  const totalExp = (a: { level: number; exp: number }) => a.exp + Array.from({ length: a.level - 1 }, (_, i) => 40 * (i + 1)).reduce((t, n) => t + n, 0);
  const FIVE = ['m_gold1', 'm_gold2', 'm_rep3', 'm_rep5', 'd_10'];

  const returnWithExp = (stageIds: string[]) => {
    const s = fullGame(41);
    s.achievements = [...stageIds];
    const r = dispatch(s, order(s, { days: 1 }));
    expect(r.ok).toBe(true);
    const e = s.expeditions[0];
    for (const id of e.order.partyIds) e.result.expGain[id] = 100;
    for (let i = 0; i < 6 && s.expeditions.length; i++) advanceDay(s);
    return totalExp(s.adventurers[0]);
  };

  it('日送りで実績が判定される', () => {
    const s = fullGame(40);
    s.gold = 2000;
    advanceDay(s);
    expect(s.achievements).toContain('m_gold1');
    expect(s.notices.some((n) => n.text.includes('実績'))).toBe(true);
  });

  it('実績が5つ以上あると、帰還の経験値が+10%になる', () => {
    const base = returnWithExp([]);
    const boosted = returnWithExp(FIVE);
    expect(boosted - base).toBeGreaterThanOrEqual(10 * 0.5);
    expect(boosted).toBeGreaterThan(base);
  });

  it('竜を倒した帰還で討伐済みになり、竜鱗装備が解放され、同じ日に s_dragon が付く', () => {
    const s = fullGame(42);
    const r = dispatch(s, order(s, { days: 1 }));
    expect(r.ok).toBe(true);
    s.expeditions[0].result.kills = { dragon: 1 };
    for (let i = 0; i < 6 && s.expeditions.length; i++) advanceDay(s);
    expect(s.dragonDefeated).toBe(true);
    expect(s.flags['unlock:dragon_slain']).toBe(true);
    expect(s.achievements).toContain('s_dragon');
  });
});

describe('複数フロア・鍵の組み込み', () => {
  const walkable = (dungeonId: string, floor = 0) => {
    const g = parseFloor(DUNGEONS_T[dungeonId].floors[floor]);
    return g.cells.flatMap((c, i) => (c.kind !== 'wall' && c.kind !== 'hidden' ? [i] : []));
  };
  const toFloor2 = (s: GameState, dungeonId: string): DispatchOrder =>
    order(s, { target: { dungeon: dungeonId, floor: 'f2' }, days: 7 });

  it('2階は、前の階の下り階段を踏んでいないと出せない', () => {
    const s = fullGame(60);
    s.dungeons.ruined_tower.confirmed = true;
    const r = dispatch(s, toFloor2(s, 'ruined_tower'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('階段');
  });

  it('階段を踏んでいれば2階へ出せて、前の階を抜ける歩数を払う', () => {
    const s = fullGame(60);
    s.dungeons.ruined_tower.confirmed = true;
    s.dungeons.ruined_tower.floors.f1.visited = walkable('ruined_tower');
    const r = dispatch(s, toFloor2(s, 'ruined_tower'));
    expect(r.ok).toBe(true);
    if (r.ok && !r.expedition.result.wiped) {
      expect(r.expedition.result.log.some((l) => l.text.includes('前の階を抜けて'))).toBe(true);
    }
  });

  it('階段までの道に鍵の扉があるなら、鍵を持っていないと2階へ出せない(持っていれば出せる)', () => {
    const s = fullGame(61);
    s.dungeons.sunken_ruins.confirmed = true;
    s.dungeons.sunken_ruins.floors.f1.visited = walkable('sunken_ruins');
    expect(dispatch(s, toFloor2(s, 'sunken_ruins')).ok).toBe(false);
    s.inventory.ruin_key = 1;
    expect(dispatch(s, toFloor2(s, 'sunken_ruins')).ok).toBe(true);
  });

  it('帰還で持ち帰った鍵は在庫に入り、すでに持っていれば増えない(最大1個)', () => {
    const keyReturn = (have: number) => {
      const s = fullGame(62);
      if (have) s.inventory.ruin_key = have;
      const r = dispatch(s, order(s, { days: 1 }));
      expect(r.ok).toBe(true);
      s.expeditions[0].result.items = { ...s.expeditions[0].result.items, ruin_key: 1 };
      for (let i = 0; i < 6 && s.expeditions.length; i++) advanceDay(s);
      return s.inventory.ruin_key ?? 0;
    };
    expect(keyReturn(0)).toBe(1);
    expect(keyReturn(1)).toBe(1);
  });
});

describe('新しい施設の効果(売却・日送りの産出・派遣)', () => {
  it('市場で素材の売却額が増える: Lv1 で1割、Lv2 で2割、鍛冶場と隣り合う(商い)とさらに1割。端数は四捨五入', () => {
    const s = fullGame(3);
    s.inventory.fang = 30;
    const p = ITEM.fang.price;
    const sell = (n: number) => {
      const g = s.gold;
      expect(sellItem(s, 'fang', n)).toEqual({ ok: true });
      return s.gold - g;
    };
    const k = TUNING.game.sellScale;
    expect(sell(3)).toBe(Math.round(p * 3 * k));
    place(s, 'market', 0, 0);
    expect(sellGold(s, 'fang', 3)).toBe(Math.round(p * 3 * k * 1.1));
    expect(sell(3)).toBe(Math.round(p * 3 * k * 1.1));
    expect(s.ledger[0]).toMatchObject({ label: `素材売却: ${ITEM.fang.name}×3`, amount: Math.round(p * 3 * k * 1.1) });
    s.base.facilities[0].level = 2;
    expect(sell(1)).toBe(Math.round(p * k * 1.2));
    place(s, 'smithy', 1, 0);
    expect(sell(5)).toBe(Math.round(p * 5 * k * 1.3));
  });

  it('日送りで製材所・石切場の産出が在庫に入る。完成した日から産み、台帳とお知らせには出ない', () => {
    const s = fullGame(3);
    s.gold = 5000;
    expect(buildFacility(s, 'sawmill', 0, 0)).toEqual({ ok: true });
    place(s, 'quarry', 4, 4, 2);
    advanceDay(s);
    expect(s.inventory.lumber ?? 0).toBe(0);
    expect(s.inventory.stone).toBe(2);
    advanceDay(s);
    advanceDay(s);
    expect(s.base.facilities[0].level).toBe(1);
    expect([s.inventory.lumber, s.inventory.stone]).toEqual([1, 6]);
    expect(s.ledger.some((l) => /木材|石材/.test(l.label))).toBe(false);
    expect(s.notices.some((n) => /木材|石材/.test(n.text))).toBe(false);
  });

  it('地図室の発見率が派遣の探索に渡り、隠し通路が多く見つかる(固定seed)', () => {
    const found = (withMap: boolean) => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const s = fullGame(seed);
        if (withMap) {
          place(s, 'map_room', 0, 0, 2);
          place(s, 'tavern', 1, 0);
        }
        const e = sent(s, { days: 3, items: {} });
        n += e.result.mapDeltas.reduce((t, d) => t + d.hidden.length, 0);
      }
      return n;
    };
    const plain = found(false);
    expect(found(true)).toBeGreaterThan(plain);
  });

  it('見張り台で派遣の道中の遭遇が減る(往路・復路とも倍率が渡る)', () => {
    const encounters = (withTower: boolean) => {
      let n = 0;
      for (let seed = 1; seed <= 100; seed++) {
        const s = fullGame(seed);
        s.dungeons.old_mine = { confirmed: true, floors: { f1: { visited: [], hiddenFound: [] } }, bossDefeated: 0, fullCleared: false };
        if (withTower) {
          place(s, 'watchtower', 0, 0, 2);
          place(s, 'reception', 1, 0);
        }
        const e = sent(s, { target: { dungeon: 'old_mine', floor: 'f1' }, days: 1, items: {} });
        const legs = (e as unknown as { legs: { out: { encounters: number }; back: { encounters: number } } }).legs;
        n += legs.out.encounters + legs.back.encounters;
      }
      return n;
    };
    // 見張り台 Lv2(−25%)と護衛の手配(−10%)で、遭遇はおよそ 0.65 倍になる
    const plain = encounters(false);
    expect(plain).toBeGreaterThan(30);
    expect(encounters(true)).toBeLessThan(plain * 0.85);
  });
});
