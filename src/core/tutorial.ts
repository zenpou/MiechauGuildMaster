import { isIntroExploration } from './introExploration';
import type { DispatchOrder, GameState, Result } from './types';

/** 新規開始時だけ使う段階式チュートリアルの進行位置。 */
export type TutorialStage =
  | 'dispatch'
  | 'return'
  | 'report'
  | 'map'
  | 'quests'
  | 'second-dispatch'
  | 'second-return'
  | 'recruit'
  | 'facilities'
  | 'overview'
  | 'complete';

/** UI 側の10タブと同じ文字列を、Core から参照できる形で持つ。 */
export type TutorialTab =
  | 'home'
  | 'inbox'
  | 'quests'
  | 'dispatch'
  | 'world'
  | 'recruit'
  | 'base'
  | 'map'
  | 'log'
  | 'records';

export type TutorialFeature = 'preparation' | 'planning' | 'travel';

export interface TutorialPrompt {
  id: Exclude<TutorialStage, 'complete'>;
  title: string;
  text: string;
  target: TutorialTab;
  actionLabel: string;
  canAdvanceDay: boolean;
}

const VERSION = 1;
const COMPLETE = 'tutorial:complete';
const ACK_PREFIX = 'tutorial:ack:';

const ACK_STAGES: readonly Exclude<TutorialStage, 'dispatch' | 'return' | 'second-dispatch' | 'second-return' | 'complete'>[] = [
  'report', 'map', 'quests', 'recruit', 'facilities', 'overview',
];

const STAGE_ORDER: readonly TutorialStage[] = [
  'dispatch', 'return', 'report', 'map', 'quests', 'second-dispatch', 'second-return',
  'recruit', 'facilities', 'overview', 'complete',
];

const PROMPTS: Record<Exclude<TutorialStage, 'complete'>, TutorialPrompt> = {
  dispatch: {
    id: 'dispatch', title: '最初の派遣',
    text: 'マスター代行、まずはティナさんとセラさんで森の洞窟の入口を確かめ、薬草を1個持ち帰りましょう。次は「派遣」です。',
    target: 'dispatch', actionLabel: '隊を出す', canAdvanceDay: false,
  },
  return: {
    id: 'return', title: '帰還を待つ',
    text: '隊が出ています。今日は休んで、帰還を待ちましょう。次は「次の日へ」です。',
    target: 'home', actionLabel: '帰還を待つ', canAdvanceDay: true,
  },
  report: {
    id: 'report', title: '帰還報告',
    text: '隊が帰還しました。成長した仲間と持ち帰ったものを確認しましょう。次は「帰還報告」です。',
    target: 'home', actionLabel: '報告を確認', canAdvanceDay: false,
  },
  map: {
    id: 'map', title: '地図を確認',
    text: '歩いた道は地図に残ります。再び探索すれば、その先へ進めます。次は「地図」を確認してください。',
    target: 'map', actionLabel: '地図を開く', canAdvanceDay: false,
  },
  quests: {
    id: 'quests', title: '依頼を確認',
    text: '依頼には納期と報酬があります。受けられるものだけ選べば大丈夫です。次は「依頼」を確認してください。',
    target: 'quests', actionLabel: '依頼を開く', canAdvanceDay: false,
  },
  'second-dispatch': {
    id: 'second-dispatch', title: '2回目の派遣',
    text: '次はティナさんとセラさんで、森の洞窟1階へ日帰りの探索です。回復薬は2個がおすすめです。方針と見込みを確かめて出発しましょう。休養しても構いません。',
    target: 'dispatch', actionLabel: '2回目を出す', canAdvanceDay: true,
  },
  'second-return': {
    id: 'second-return', title: '2回目の帰還',
    text: '2回目の派遣に出ています。帰還を待ちましょう。次は「次の日へ」です。',
    target: 'home', actionLabel: '帰還を待つ', canAdvanceDay: true,
  },
  recruit: {
    id: 'recruit', title: '仲間を確認',
    text: '2回目の隊が帰還しました。募集には契約金と日給がかかりますが、雇用は必須ではありません。受信箱も開きます。次は「募集」を確認してください。',
    target: 'recruit', actionLabel: '募集を開く', canAdvanceDay: false,
  },
  facilities: {
    id: 'facilities', title: '施設を確認',
    text: '施設では素材と費用、建てた後の維持費を確認できます。建設はまだ必要ありません。次は「施設」を確認してください。',
    target: 'base', actionLabel: '施設を開く', canAdvanceDay: false,
  },
  overview: {
    id: 'overview', title: '全体を確認',
    text: '遠出の行き先はワールドで、台帳や実績は記録で確認できます。次は「ワールド」を確認すれば案内は終わりです。',
    target: 'world', actionLabel: 'ワールドを確認', canAdvanceDay: false,
  },
};

const flagIsTrue = (s: GameState, key: string): boolean => s.flags[key] === true || s.flags[key] === 1;

/** チュートリアルを使う新規セーブか。版を知らないセーブは互換モードにする。 */
function managed(s: GameState): boolean {
  return s.flags?.['tutorial:version'] === VERSION;
}

function ackKey(stage: Exclude<TutorialStage, 'complete'>): string {
  return `${ACK_PREFIX}${stage}`;
}

/** 実際の派遣回数・帰還履歴と既読フラグから、現在の段階を純粋に求める。 */
function currentStage(s: GameState): TutorialStage {
  if (!managed(s) || flagIsTrue(s, COMPLETE)) return 'complete';

  const dispatches = s.counters?.dispatches ?? 0;
  const returned = s.history?.length ?? 0;
  if (dispatches < 1) return 'dispatch';
  if (returned < 1) return 'return';
  if (!flagIsTrue(s, ackKey('report'))) return 'report';
  if (!flagIsTrue(s, ackKey('map'))) return 'map';
  if (!flagIsTrue(s, ackKey('quests'))) return 'quests';
  if (dispatches < 2) return 'second-dispatch';
  if (returned < 2) return 'second-return';
  if (!flagIsTrue(s, ackKey('recruit'))) return 'recruit';
  if (!flagIsTrue(s, ackKey('facilities'))) return 'facilities';
  if (!flagIsTrue(s, ackKey('overview'))) return 'overview';
  return 'complete';
}

function rank(stage: TutorialStage): number {
  return STAGE_ORDER.indexOf(stage);
}

function atLeast(s: GameState, stage: Exclude<TutorialStage, 'complete'>): boolean {
  const current = currentStage(s);
  return current === 'complete' || rank(current) >= rank(stage);
}

/** 現在の案内。完了済み・旧セーブでは null。 */
export function tutorialFor(s: GameState): TutorialPrompt | null {
  const stage = currentStage(s);
  return stage === 'complete' ? null : PROMPTS[stage];
}

/** 段階解放済みか。いったん開いたタブは後から閉じない。 */
export function tutorialTabUnlocked(s: GameState, tab: TutorialTab): boolean {
  if (!managed(s) || currentStage(s) === 'complete') return true;
  switch (tab) {
    case 'home':
    case 'dispatch':
      return true;
    case 'map':
    case 'log':
      return atLeast(s, 'map');
    case 'quests':
      return atLeast(s, 'quests');
    case 'recruit':
    case 'inbox':
      return atLeast(s, 'recruit');
    case 'base':
      return atLeast(s, 'facilities');
    case 'world':
    case 'records':
      return atLeast(s, 'overview');
  }
}

/** 装備・編成・遠征の補助機能の解放状態。 */
export function tutorialFeatureUnlocked(s: GameState, feature: TutorialFeature): boolean {
  if (!managed(s) || currentStage(s) === 'complete') return true;
  switch (feature) {
    case 'preparation': return atLeast(s, 'quests');
    case 'planning': return atLeast(s, 'recruit');
    case 'travel': return atLeast(s, 'overview');
  }
}

function tinaSeraPair(s: GameState, o: DispatchOrder): boolean {
  if (!o || typeof o !== 'object' || !Array.isArray(o.partyIds) || o.partyIds.length !== 2) return false;
  const uniques = o.partyIds.map((id) => s.adventurers.find((a) => a.id === id)?.unique);
  return new Set(uniques).size === 2 && uniques.includes('tina') && uniques.includes('sera');
}

function secondDispatchAllowed(s: GameState, o: DispatchOrder): boolean {
  if (!o || typeof o !== 'object' || o.target?.dungeon !== 'forest_cave' || (o.target.floor ?? 'f1') !== 'f1') return false;
  return o.action === 'explore' && o.days === 1 && tinaSeraPair(s, o);
}

function introPair(s: GameState, o: DispatchOrder): boolean {
  return isIntroExploration(s, o) && tinaSeraPair(s, o);
}

/** 現段階で派遣してよいかをホストが出発前に示す。Core の dispatch 自体は制限しない。 */
export function tutorialDispatchReason(s: GameState, o: DispatchOrder): string | null {
  if (!managed(s)) return null;
  const stage = currentStage(s);
  if (stage === 'complete') return null;
  if (stage === 'dispatch') {
    return introPair(s, o)
      ? null
      : '最初はティナさんとセラさんの二人で、森の洞窟の入口へ派遣してください。';
  }
  if (stage === 'second-dispatch') {
    return secondDispatchAllowed(s, o)
      ? null
      : '2回目はティナさんとセラさんで、森の洞窟1階へ日帰りの探索に出してください。';
  }
  return 'いまは派遣の段階ではありません。チュートリアルの案内を進めてください。';
}

/** 対象段階・タブが現在の案内と一致するときだけ確認を記録する。 */
export function acknowledgeTutorial(s: GameState, stage: TutorialStage, tab: TutorialTab): Result {
  if (!managed(s) || currentStage(s) === 'complete') return { ok: false, reason: 'チュートリアルは完了しています。' };
  const current = currentStage(s);
  if (stage !== current) return { ok: false, reason: '案内の順番が変わっています。' };
  if (!ACK_STAGES.includes(stage as typeof ACK_STAGES[number])) return { ok: false, reason: 'この段階は確認操作がありません。' };
  const prompt = PROMPTS[stage as Exclude<TutorialStage, 'complete'>];
  if (tab !== prompt.target) return { ok: false, reason: '案内されたタブを確認してください。' };
  s.flags[ackKey(stage as Exclude<TutorialStage, 'complete'>)] = true;
  if (stage === 'overview') s.flags[COMPLETE] = true;
  return { ok: true };
}

/** 案内をいつでも終了し、全機能を開く。 */
export function skipTutorial(s: GameState): void {
  s.flags[COMPLETE] = true;
}
