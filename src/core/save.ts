// セーブの直列化と読み込み。DOM非依存にするため、保存先は Storage 風の口を外から渡す。
import { emptyState, initialDungeonProgress } from './state';
import { genericAppearance } from './adventurer';
import { DUNGEONS, UNIQUE } from './data';
import { hashSeed, Rng } from './rng';
import { joinInitialUniques, joinStoryUniques } from './events';
import { markStorySeen, STORY, storySeen, storySeenDay, triggerMet } from './story';
import { captureDragonVictory, isDragonVictory, isStoryParty } from './dragonStory';
import { isJourneyRecord } from './journey';
import { packJourney, unpackJourney } from './journeyStorage';
import { isReturnReport } from './returnReport';
import { normalizePartyPlans } from './partyPlans';
import { SAVE_VERSION, type Adventurer, type GameState } from './types';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SAVE_KEY = 'miechau-guild-master.save.v1';

/**
 * 読み込んだ状態に、後から足した項目の既定値を埋める。
 * GameState に項目を足したら、ここに既定値を書く。版番号を上げたら移行処理も書く。
 */
/** 冒険者に後から足した項目の既定値。skills・persona などが無い古いセーブで、能力計算やメールが落ちないようにする */
function fillAdventurer(a: Adventurer) {
  a.skills ??= [];
  a.persona ??= { hobby: '', talent: '', likes: '', dislikes: '' };
  a.equipment ??= { weapon: null, armor: null, accessory: null };
  a.assignment ??= null;
  a.history ??= { hiredDay: 0, expeditions: 0, kills: 0, visits: {}, raisesRefused: 0, warnedDay: null };
  a.history.visits ??= {};
  a.history.raisesRefused ??= 0;
  a.history.warnedDay ??= null;
}

/** 版1には性別・外見が無い。seed と id の hash で決めるのは、読み込むたびに性別が変わらないようにするため */
function fillLooks(a: Adventurer, seed: number) {
  const def = a.unique ? UNIQUE[a.unique] : undefined;
  if (!a.gender) a.gender = def?.gender ?? (new Rng(hashSeed(seed, 'appearance', a.id)).chance(0.5) ? 'female' : 'male');
  if (!a.appearance) a.appearance = def?.appearance ?? a.unique ?? genericAppearance(a.personality, a.gender);
}

/** 観察記録は任意の後付けデータ。壊れた/未完成の記録は捨て、結果本体を読み込めるようにする。 */
function fillJourney(e: GameState['expeditions'][number]) {
  if (e.journey === undefined) return;
  const record = unpackJourney(e.journey);
  if (record) e.journey = record;
  else delete e.journey;
}

/** 帰還報告は後付けの任意データ。壊れていれば遠征結果本体を残して削除する。 */
function fillReturnReport(e: GameState['expeditions'][number]) {
  if (e.returnReport === undefined) return;
  if (!isReturnReport(e.returnReport)) delete e.returnReport;
}

export function migrate(raw: unknown): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<GameState>;
  if (typeof s.seed !== 'number' || typeof s.day !== 'number') return null;
  const base = emptyState(s.seed, s.playerName ?? '');
  const merged: GameState = { ...base, ...(s as GameState) };
  // 入れ子の既定値
  merged.base = { ...base.base, ...(s.base ?? {}) };
  merged.world = { ...base.world, ...(s.world ?? {}) };
  merged.counters = { ...base.counters, ...(s.counters ?? {}) };
  merged.blessing = { ...base.blessing, ...(s.blessing ?? {}) };
  // 編成は後付け任意データ。壊れた編成だけ捨て、名簿や本体のセーブは保持する。
  merged.partyPlans = normalizePartyPlans((s as Partial<GameState>).partyPlans);
  for (const e of [...merged.expeditions, ...merged.history]) {
    e.result.maxDepth ??= 0;
    e.result.daysSpent ??= e.returnDay - e.startDay;
    e.result.returnDialogue ??= [];
    fillJourney(e);
    fillReturnReport(e);
    if (e.storyParty !== undefined && !isStoryParty(e.storyParty)) delete e.storyParty;
  }
  for (const a of [...merged.adventurers, ...merged.candidates.map((c) => c.adv)]) {
    fillAdventurer(a);
    fillLooks(a, merged.seed);
  }
  // 後から足したダンジョンは、古いセーブでは進捗が無いので初期値(噂)で埋める
  merged.dungeons = { ...merged.dungeons };
  for (const d of DUNGEONS) merged.dungeons[d.id] ??= initialDungeonProgress(d.id);
  // 物語の導入前から遊んでいたセーブ(章の旗が1つも無く、1日目を過ぎている)は、過ぎた章を開いた直後に
  // 連続で出さず、既読にする。出す・出さないを章ごとに選ばせないのは、台本があとから増えても同じ扱いで済ませるため
  if (merged.day > 1 && !Object.keys(merged.flags).some((k) => k.startsWith('story:'))) {
    // 新しく追加した人物別の会話まで既読にしない。本編だけ従来どおり補完する。
    for (const c of STORY) if (storySeenDay(merged, c.id) === null && triggerMet(merged, c.trigger)) markStorySeen(merged, c.id, 0);
  }
  // 名簿を物語に合わせる前のセーブ(汎用4人で始めた)にも、初日の仲間と既読の章で加入する者を入れる。汎用の者はそのまま残す
  for (const a of joinInitialUniques(merged)) merged.notices.unshift({ day: merged.day, text: `${a.name}がギルドに加入した。` });
  for (const c of storySeen(merged)) joinStoryUniques(merged, c.id);
  if (!isDragonVictory(merged.dragonVictory)) {
    const firstWin = merged.history.find(e => e.returnDay === merged.flags.clearDay && (e.result.kills.dragon ?? 0) > 0);
    merged.dragonVictory = merged.dragonDefeated && firstWin ? captureDragonVictory(merged, firstWin) : null;
  }
  merged.version = SAVE_VERSION;
  return merged;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state, (key, value) => key === 'journey' && isJourneyRecord(value) ? packJourney(value) : value);
}

export function deserialize(text: string): GameState | null {
  try { return migrate(JSON.parse(text)); } catch { return null; }
}

export function load(store: KeyValueStore, key = SAVE_KEY): GameState | null {
  try {
    const raw = store.getItem(key);
    return raw ? deserialize(raw) : null;
  } catch { return null; }
}

/** 保存できたら true。容量不足などで失敗したら false(呼び出し側が警告を出す) */
export function save(store: KeyValueStore, state: GameState, key = SAVE_KEY): boolean {
  try { store.setItem(key, serialize(state)); return true; } catch { return false; }
}
