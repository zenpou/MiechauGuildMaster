// 最初の数日のヒント: いまの状態から「次にやること」を1つだけ出す。閉じたものは二度と出ない。
// 文面は受付のノエルの台詞(docs/story/characters/noel.md: 丁寧語で早口・心配性・一人称「わたし」・カイは「マスター代行」)。
// 操作の名前(「派遣」など)は鉤括弧で残す。世界の言葉だけにすると、どのコマンドを押せばよいか分からなくなる。
// 「結果は出発時に決まる」のような仕組みの説明は書かない。人物の視点では「送り出したら手出しできず、帰るまで分からない」が同じ意味になる
// 状態は flags に持つので、GameState に項目は足さない。
import { facilityLevel } from './base';
import { promotionCost, promotionOptions } from './jobs';
import type { GameState } from './types';

export interface Hint { id: string; text: string }

/** 施設をすすめる資金の目安(いちばん安い施設が建てられる額) */
const FACILITY_GOLD = 300;
const OFF = 'hint:off';
const closedKey = (id: string) => `hint:${id}`;

/** Lvが足りて待機中の下級職の人(転職の先に上級職がある)。費用・訓練所は問わない */
const promotable = (s: GameState) => s.adventurers.some((a) => a.status === 'idle'
  && promotionOptions(a).some((o) => a.level >= (o.requireLevel ?? 0)));

interface Rule extends Hint {
  /** 状態がこの条件を満たすあいだ出す */
  when: (s: GameState) => boolean;
  /** 閉じられない(状態で消える)ヒント */
  sticky?: boolean;
}

/** 並びが優先順。条件を満たす先頭のヒントを出し、閉じると次の条件を満たすものへ進む(赤字は先頭なので割り込む) */
const RULES: Rule[] = [
  {
    id: 'debt', sticky: true, when: (s) => s.gold < 0,
    text: 'マスター代行、帳簿が赤字です! 借りている間は利息が膨らみますし、お給金が滞ると皆さんの忠誠に響きます。依頼の報酬か素材の売却で、どうか早めに立て直してください!',
  },
  {
    id: 'first-dispatch', when: (s) => s.counters.dispatches === 0,
    text: 'マスター代行、まずは「派遣」の窓口から、森の洞窟へ隊を出してみてください。一度送り出したら、こちらから手出しはできません。首尾は帰ってくる日の報告で分かります……それまで、わたしは祈るだけですので。',
  },
  {
    id: 'advance-day', when: (s) => s.expeditions.length > 0 && s.history.length === 0,
    text: '隊が出ています。「次の日へ」で日を進めれば、帰還の日に報告が届きます。それまでは待つしかありません……気が気ではありませんが。',
  },
  {
    id: 'quests', when: (s) => s.history.length > 0 && !s.quests.some((q) => q.status !== 'posted'),
    text: '「依頼」の掲示には報酬と評判がかかっています。納期に遅れると評判が下がりますので、日数を見て受けてください。無理なものは断ってよいと、マスター代行ご自身がおっしゃっていましたよね?',
  },
  {
    id: 'promote', when: (s) => promotable(s) && facilityLevel(s, 'training') >= 1 && s.gold >= promotionCost(s),
    text: 'Lvの上がった方がいます。「拠点」の名簿でお名前を押すと、上級職へ転職できます(費用はかかります)。できる役割が広がりますので、ご検討ください。',
  },
  {
    id: 'promote-need-training', when: (s) => promotable(s) && facilityLevel(s, 'training') < 1,
    text: 'Lvの上がった方がいますが、上級職への転職には訓練所が要ります。「施設」の区画に建てていただけますか?',
  },
  {
    id: 'facility', when: (s) => s.history.length > 0 && s.gold >= FACILITY_GOLD && s.base.facilities.length === 0,
    text: '資金に余裕が出ました。「施設」の区画に工房を建てれば、素材から装備を作れます。隣り合う施設は互いに効きます(シナジー)ので、置き場所もご検討を。',
  },
];

/** いま出すヒント。無ければ null */
export function hintFor(s: GameState): Hint | null {
  if (s.flags[OFF]) return null;
  for (const r of RULES) {
    if (!r.sticky && s.flags[closedKey(r.id)]) continue;
    if (r.when(s)) return { id: r.id, text: r.text };
  }
  return null;
}

export function dismissHint(s: GameState, id: string): void {
  if (RULES.some((r) => r.id === id && !r.sticky)) s.flags[closedKey(id)] = true;
}

export function hintsOff(s: GameState): void {
  s.flags[OFF] = true;
}
