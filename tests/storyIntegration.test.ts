import { describe, expect, it } from 'vitest';
import { DUNGEON, ITEM, LOWER_JOBS, WORLD } from '../src/core/data';
import { parseFloor } from '../src/core/dungeon';
import { captureDragonVictory, dragonBattleLines, isDragonVictory, storyPartyFor } from '../src/core/dragonStory';
import { endingPages, onDragonDefeated } from '../src/core/ending';
import { advanceDay, dispatch, newGame } from '../src/core/game';
import { canChangeJob } from '../src/core/jobs';
import { deserialize, migrate, serialize } from '../src/core/save';
import { markStorySeen, presentChapter, readDueStories, STORY, storyDue, storySeenDay } from '../src/core/story';
import type { DispatchOrder, GameState, JourneyFrame } from '../src/core/types';

const text = (s: GameState) => presentChapter(s, STORY.find(c => c.id === 'epilogue')!).lines.map(l => l.text).join('\n');
const order = (s: GameState, dungeon = 'forest_cave'): DispatchOrder => ({
  partyIds: s.adventurers.slice(0, 2).map(a => a.id), leaderId: s.adventurers[0].id,
  action: 'explore', target: { dungeon, floor: 'f1' }, policy: 'standard', days: 1, items: {},
});
function openLair(s: GameState) {
  s.world.foundEdges = WORLD.edges.map(e => e.id);
  s.dungeons.dragon_lair.confirmed = true;
  for (const f of DUNGEON.dragon_lair.floors) {
    const cells = parseFloor(f).cells;
    s.dungeons.dragon_lair.floors[f.id] = { visited: cells.flatMap((c, i) => c.kind === 'wall' ? [] : [i]), hiddenFound: [] };
  }
  for (const item of Object.values(ITEM)) if (item.kind === 'key') s.inventory[item.id] = 1;
}
function winFixture() {
  const s = newGame(810);
  const sent = dispatch(s, order(s));
  if (!sent.ok) throw new Error(sent.reason);
  const e = sent.expedition;
  e.order.target = { dungeon: 'dragon_lair', floor: 'f2' };
  e.order.blessed = false;
  e.storyParty = storyPartyFor(s.adventurers);
  e.result.kills = { dragon: 1 };
  e.result.wiped = false;
  e.result.injuries = {};
  const frame = (seq: number, part: Partial<JourneyFrame>): JourneyFrame => ({
    seq, day: 3, cell: 234, phase: 'dungeon', kind: 'combat_action', battleEnemy: 'dragon', ...part,
  });
  e.journey!.frames = [
    frame(0, { combatKind: 'heal', actorId: 'unrelated', actorName: '別の戦闘', battleEnemy: 'drake' }),
    frame(1, { combatKind: 'heal', actorId: s.adventurers[1].id, actorName: 'セラ', targetId: s.adventurers[0].id, targetName: 'ティナ' }),
    frame(2, { combatKind: 'attack', actorId: s.adventurers[0].id, actorName: 'ティナ', targetId: 'e_dragon_0', targetName: '火竜' }),
    frame(3, { combatKind: 'down', actorId: 'e_dragon_0', actorName: '火竜' }),
  ];
  s.day = e.returnDay;
  return { s, e };
}

describe('物語と派遣の接続', () => {
  it('竜の寝床は踏査も第五章待ち。既読日が0の旧セーブでも解禁できる', () => {
    for (const action of ['explore', 'survey', 'boss'] as const) {
      const s = newGame(811);
      openLair(s);
      s.dungeons.dragon_lair.confirmed = action !== 'survey';
      const o = { ...order(s, 'dragon_lair'), action };
      const before = serialize(s);
      expect(dispatch(s, o)).toMatchObject({ ok: false, reason: expect.stringContaining('第五章') });
      expect(serialize(s)).toBe(before);
    }
    const s = newGame(811);
    openLair(s);
    markStorySeen(s, 'ch5', 0);
    expect(dispatch(s, order(s, 'dragon_lair')).ok).toBe(true);
  });

  it('第五章の読了は装備や祝福を勝手に支給・消費せず、出発時の装備を記録する', () => {
    const s = newGame(812);
    openLair(s);
    const inventory = structuredClone(s.inventory);
    const blessing = structuredClone(s.blessing);
    const equipment = s.adventurers.map(a => structuredClone(a.equipment));
    markStorySeen(s, 'ch5');
    expect(s.inventory).toEqual(inventory);
    expect(s.blessing).toEqual(blessing);
    expect(s.adventurers.slice(0, 2).map(a => a.equipment)).toEqual(equipment);
    const sent = dispatch(s, order(s, 'dragon_lair'));
    if (!sent.ok) throw new Error(sent.reason);
    expect(sent.expedition.storyParty).toEqual(storyPartyFor(s.adventurers.slice(0, 2)));
    expect(sent.expedition.storyParty!.every(m => m.fireResist === 0)).toBe(true);
  });

  it('実際に竜へ出発・勝利・帰還した時点で、隊と竜戦だけを終章用に確定する', () => {
    const s = newGame(813);
    openLair(s);
    markStorySeen(s, 'ch5');
    // 戦闘のバランスではなく、Coreの出発→記録→帰還→物語の接続を検証する強化隊。
    for (const a of s.adventurers) a.base = { hp: 100000, atk: 100000, def: 100000, mag: 100000, spd: 1000, dex: 1000, scout: 1000, gather: 1000 };
    const sent = dispatch(s, { ...order(s, 'dragon_lair'), action: 'boss', days: 7, target: { dungeon: 'dragon_lair', floor: 'f2' } });
    if (!sent.ok) throw new Error(sent.reason);
    expect(sent.expedition.result.kills.dragon).toBe(1);
    expect(s.dragonVictory).toBeNull();
    while (s.day < sent.expedition.returnDay) advanceDay(s);
    expect(s.dragonDefeated).toBe(true);
    expect(s.dragonVictory!.members.map(m => m.id)).toEqual(sent.expedition.order.partyIds);
    expect(s.dragonVictory!.combat.length).toBeGreaterThan(0);
    expect(s.dragonVictory!.combat.every(f => f.battleEnemy === 'dragon')).toBe(true);
    expect(isDragonVictory(s.dragonVictory)).toBe(true);
  });

  it('ルゥは救出後2日休み、回復後に出発できる。読み返し・再読込で再負傷しない', () => {
    const s = newGame(814);
    markStorySeen(s, 'ch3');
    const ruu = s.adventurers.find(a => a.unique === 'ruu')!;
    const o = { ...order(s), partyIds: [ruu.id], leaderId: ruu.id };
    expect(ruu.injuryDays).toBe(2);
    expect(dispatch(s, o)).toMatchObject({ ok: false, reason: expect.stringContaining('負傷') });
    advanceDay(s);
    expect(ruu.injuryDays).toBe(1);
    expect(dispatch(s, o).ok).toBe(false);
    advanceDay(s);
    expect(ruu.injuryDays).toBe(0);
    markStorySeen(s, 'ch3');
    const loaded = deserialize(serialize(s))!;
    expect(loaded.adventurers.find(a => a.id === ruu.id)!.injuryDays).toBe(0);
    expect(dispatch(loaded, o).ok).toBe(true);
  });

  it('終章でアウレリアが一度だけ加入し、古い読了セーブにも補われる。固有職への転職はできない', () => {
    const s = newGame(815);
    markStorySeen(s, 'epilogue');
    const a = s.adventurers.find(a => a.unique === 'aurelia')!;
    expect(a.job).toBe('ancient_dragon');
    expect(LOWER_JOBS.some(j => j.id === a.job)).toBe(false);
    expect(canChangeJob(s, a.id, 'warrior').ok).toBe(false);
    expect(canChangeJob(s, s.adventurers[0].id, a.job).ok).toBe(false);
    s.adventurers = s.adventurers.filter(a => a.unique !== 'aurelia');
    const once = deserialize(serialize(s))!;
    const twice = deserialize(serialize(once))!;
    expect(twice.adventurers.filter(a => a.unique === 'aurelia')).toHaveLength(1);
  });
});

describe('初勝利の回想とセーブ互換', () => {
  it('同日・同マスの別戦闘を混ぜず、実際に戦った隊と支援だけを描く', () => {
    const { s, e } = winFixture();
    onDragonDefeated(s, [], e);
    expect(s.dragonVictory!.combat.map(f => f.seq)).toEqual([1, 2, 3]);
    const battle = dragonBattleLines(s.dragonVictory);
    const speakers = battle.flatMap(l => l.speaker ? [l.speaker] : []);
    expect(new Set(speakers)).toEqual(new Set(['ティナ', 'セラ', 'アウレリア']));
    const prose = battle.map(l => l.text).join('\n');
    expect(prose).not.toMatch(/祝福|耐火装備|別の戦闘/);
    expect(prose).toContain('セラの祈りがティナを癒す');
    s.dragonVictory!.blessed = true;
    s.dragonVictory!.members[0].fireResist = .2;
    const supported = dragonBattleLines(s.dragonVictory).map(l => l.text).join('\n');
    expect(supported).toContain('アイリスの祝福');
    expect(supported).toContain('ティナの耐火装備');
    expect(supported).not.toContain('セラの耐火装備');
  });

  it('負傷・帰路の救助を終章とエンディングの両方に反映する', () => {
    const { s, e } = winFixture();
    e.result.injuries[s.adventurers[0].id] = 3;
    e.result.wiped = true;
    onDragonDefeated(s, [], e);
    expect(text(s)).toContain('救助されて');
    expect(text(s)).toContain('手当てを頼むわ');
    expect(endingPages(s)[0]).toContain('救助されて');
    s.dragonVictory!.wiped = false;
    expect(endingPages(s)[0]).toContain('傷ついた仲間');
  });

  it('後日の改名・装備変更・履歴削除・再討伐・保存後も最初の記録を保持する', () => {
    const { s, e } = winFixture();
    onDragonDefeated(s, [], e);
    const first = structuredClone(s.dragonVictory);
    const prose = text(s);
    s.adventurers[0].name = '後日変更した名前';
    e.storyParty![0].name = '変更された遠征';
    e.order.blessed = true;
    s.day += 30;
    onDragonDefeated(s, [], e);
    s.history = [];
    s.expeditions = [];
    const restored = deserialize(serialize(s))!;
    expect(restored.dragonVictory).toEqual(first);
    expect(text(restored)).toBe(prose);
  });

  it('汎用の単独隊でも本人の名前で描写し、参加していないヒロインを追加しない', () => {
    const { s, e } = winFixture();
    const generic = { ...e.storyParty![0], unique: undefined, appearance: 'unknown', name: 'レン', id: 'generic' };
    e.storyParty = [generic];
    e.order.leaderId = generic.id;
    delete e.journey;
    const record = captureDragonVictory(s, e);
    expect(dragonBattleLines(record).filter(l => l.speaker).map(l => l.speaker)).toEqual(['レン', 'アウレリア', 'レン', 'レン']);
    expect(dragonBattleLines(record).flatMap(l => l.cast ?? []).every(a => a.character === 'aurelia')).toBe(true);
  });

  it('旧セーブは初勝利日が合う履歴だけから復元し、当時不明の装備を補わない', () => {
    const { s, e } = winFixture();
    onDragonDefeated(s, [], e);
    delete e.storyParty;
    delete e.order.blessed;
    s.history = [e];
    s.expeditions = [];
    const old = JSON.parse(serialize(s));
    delete old.dragonVictory;
    old.version = 3;
    const restored = migrate(old)!;
    expect(restored.dragonVictory!.members.every(m => m.fireResist === null)).toBe(true);
    expect(restored.dragonVictory!.blessed).toBeNull();
    old.flags.clearDay = e.returnDay - 1;
    expect(migrate(old)!.dragonVictory).toBeNull();
    old.dragonVictory = { version: 1, members: [null] };
    const broken = migrate(old)!;
    expect(broken.dragonVictory).toBeNull();
    expect(dragonBattleLines(broken.dragonVictory)).toHaveLength(1);
  });
});

describe('人物別会話の進行', () => {
  it('初回派遣の帰還後2日目は本編を優先し、個別会話を開かない', () => {
    const s = newGame(818);
    markStorySeen(s, 'prologue');
    const sent = dispatch(s, order(s));
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.expedition.returnDay).toBe(2);
    advanceDay(s);
    expect(s.day).toBe(2);
    expect(storyDue(s).map(c => c.id)).toEqual(['ch1']);
  });

  it('加入7日経過までは出ず、8日目と9日目に初回話を1つずつ出す', () => {
    const s = newGame(819);
    markStorySeen(s, 'prologue');
    markStorySeen(s, 'ch1');
    s.adventurers.forEach((a) => { a.loyalty = 50; a.injuryDays = 0; a.status = 'idle'; });
    s.day = 7;
    expect(storyDue(s)).toEqual([]);
    s.day = 8;
    expect(storyDue(s).map(c => c.id)).toEqual(['loyalty:tina:50']);
    markStorySeen(s, 'loyalty:tina:50');
    expect(storyDue(s)).toEqual([]);
    s.day = 9;
    expect(storyDue(s).map(c => c.id)).toEqual(['loyalty:sera:50']);
  });

  it('個別話の解禁後も本編の帰還待ち・読了日は保留し、botや読み返しでも日送りを守る', () => {
    const s = newGame(824);
    markStorySeen(s, 'prologue');
    s.day = 8;
    const sera = s.adventurers.find(a => a.unique === 'sera')!;
    sera.status = 'away';
    expect(storyDue(s)).toEqual([]);
    sera.status = 'idle';
    expect(storyDue(s).map(c => c.id)).toEqual(['ch1']);
    readDueStories(s);
    expect(storySeenDay(s, 'ch1')).toBe(8);
    expect(storySeenDay(s, 'loyalty:tina:50')).toBeNull();
    expect(storyDue(deserialize(serialize(s))!)).toEqual([]);
    s.day = 9;
    readDueStories(s);
    readDueStories(s);
    expect(storySeenDay(s, 'loyalty:tina:50')).toBe(9);
    expect(storySeenDay(s, 'loyalty:sera:50')).toBeNull();
    s.day = 10;
    markStorySeen(s, 'ch1');
    expect(storySeenDay(s, 'ch1')).toBe(8);
    expect(storyDue(s).map(c => c.id)).toEqual(['loyalty:sera:50']);
  });

  it('忠誠255でも台本順の個別話を1日1話に制限する', () => {
    const s = newGame(820);
    markStorySeen(s, 'prologue');
    markStorySeen(s, 'ch1');
    s.adventurers.forEach((a) => { a.loyalty = 255; a.injuryDays = 0; a.status = 'idle'; });
    s.day = 8;
    expect(storyDue(s).map(c => c.id)).toEqual(['loyalty:tina:50']);
    markStorySeen(s, 'loyalty:tina:50');
    expect(storyDue(s)).toEqual([]);
    s.day = 9;
    expect(storyDue(s).map(c => c.id)).toEqual(['loyalty:tina:120']);
  });

  it('保存して読み直しても当日の個別話枠を保持する', () => {
    const s = newGame(821);
    markStorySeen(s, 'prologue');
    markStorySeen(s, 'ch1');
    s.day = 8;
    markStorySeen(s, 'loyalty:tina:50');
    const loaded = deserialize(serialize(s))!;
    expect(storyDue(loaded)).toEqual([]);
    loaded.day = 9;
    expect(storyDue(loaded).map(c => c.id)).toEqual(['loyalty:sera:50']);
  });

  it('派遣中・負傷中の人物別話を保留し、在宅の候補を出す', () => {
    const s = newGame(822);
    markStorySeen(s, 'prologue');
    markStorySeen(s, 'ch1');
    const tina = s.adventurers.find(a => a.unique === 'tina')!;
    s.day = 8;
    tina.status = 'away';
    expect(storyDue(s).map(c => c.id)).toEqual(['loyalty:sera:50']);
    tina.status = 'idle';
    tina.injuryDays = 1;
    expect(storyDue(s).map(c => c.id)).toEqual(['loyalty:sera:50']);
  });

  it('旧セーブの日付不明既読0は当日枠を消費せず、readDueStoriesも個別話を連続解放しない', () => {
    const s = newGame(823);
    markStorySeen(s, 'prologue');
    markStorySeen(s, 'ch1');
    s.day = 8;
    s.flags['story:loyalty:tina:50'] = 0;
    expect(storyDue(s).map(c => c.id)).toEqual(['loyalty:sera:50']);

    delete s.flags['story:loyalty:tina:50'];
    readDueStories(s, 0);
    expect(storySeenDay(s, 'loyalty:tina:50')).toBe(0);
    expect(storySeenDay(s, 'loyalty:sera:50')).toBeNull();
  });

  it('旧メール50の印と関係なく、加入7日経過・導入読了後に会話を開き、読み返しでは再発生しない', () => {
    const s = newGame(816);
    const tina = s.adventurers[0];
    markStorySeen(s, 'prologue');
    expect(s.flags[`loyal:${tina.id}:50`]).toBe(true);
    expect(storyDue(s).some(c => c.id === 'loyalty:tina:50')).toBe(false);
    s.day = 2;
    expect(storyDue(s).map(c => c.id)).toEqual(['ch1']);
    markStorySeen(s, 'ch1');
    expect(storyDue(s).some(c => c.id === 'loyalty:tina:50')).toBe(false);
    s.day = 8;
    expect(storyDue(s).some(c => c.id === 'loyalty:tina:50')).toBe(true);
    tina.status = 'away';
    expect(storyDue(s).some(c => c.id === 'loyalty:tina:50')).toBe(false);
    tina.status = 'idle';
    tina.injuryDays = 1;
    expect(storyDue(s).some(c => c.id === 'loyalty:tina:50')).toBe(false);
    tina.injuryDays = 0;
    tina.loyalty = 255;
    expect(storyDue(s).some(c => c.id === 'loyalty:tina:120')).toBe(false);
    markStorySeen(s, 'loyalty:tina:50');
    s.day = 9;
    expect(storyDue(s).some(c => c.id === 'loyalty:tina:120')).toBe(true);
    markStorySeen(s, 'loyalty:tina:120');
    s.day = 10;
    expect(storyDue(s).some(c => c.id === 'loyalty:tina:255')).toBe(true);
    markStorySeen(s, 'loyalty:tina:255');
    const loyalty = tina.loyalty;
    s.day = 11;
    markStorySeen(s, 'loyalty:tina:50');
    expect(storySeenDay(s, 'loyalty:tina:50')).toBe(8);
    expect(tina.loyalty).toBe(loyalty);
    expect(storyDue(deserialize(serialize(s))!).some(c => c.id.startsWith('loyalty:tina:'))).toBe(false);
  });

  it('物語導入前の移行で本編を補完しても、追加された仲間の会話は未読のまま残す', () => {
    const s = newGame(817);
    s.day = 10;
    const loaded = deserialize(serialize(s))!;
    expect(storySeenDay(loaded, 'prologue')).toBe(0);
    expect(storySeenDay(loaded, 'ch1')).toBe(0);
    expect(storySeenDay(loaded, 'loyalty:tina:50')).toBeNull();
    expect(storyDue(loaded).some(c => c.id === 'loyalty:tina:50')).toBe(true);
  });
});
