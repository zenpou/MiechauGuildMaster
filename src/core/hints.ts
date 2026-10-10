// 最初の数日のヒント: いまの状態から「次にやること」を1つだけ出す。閉じたものは二度と出ない。
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
    text: '資金が赤字です。依頼の報酬や素材の売却で立て直しましょう。借金のあいだは利息がつき、冒険者の忠誠が下がります。',
  },
  {
    id: 'first-dispatch', when: (s) => s.counters.dispatches === 0,
    text: 'まず「派遣」タブで、森の洞窟へ隊員を送り出してみましょう。探索の結果は出発した時点で決まり、帰ってくる日に分かります。',
  },
  {
    id: 'advance-day', when: (s) => s.expeditions.length > 0 && s.history.length === 0,
    text: '隊が出ています。「次の日へ」で日を進めると、帰還の日に結果が届きます。',
  },
  {
    id: 'quests', when: (s) => s.history.length > 0 && !s.quests.some((q) => q.status !== 'posted'),
    text: '「依頼」タブの依頼を受けると、報酬と評判が手に入ります。納期に間に合わないと評判が下がるので、日数を見て選びましょう。',
  },
  {
    id: 'promote', when: (s) => promotable(s) && facilityLevel(s, 'training') >= 1 && s.gold >= promotionCost(s),
    text: 'Lvが上がった人がいます。ホームの名簿で名前を押すと、上級職へ転職できます(費用あり)。転職すると、できる役割が広がります。',
  },
  {
    id: 'promote-need-training', when: (s) => promotable(s) && facilityLevel(s, 'training') < 1,
    text: 'Lvが上がった人がいます。上級職への転職には、「施設」タブで訓練所を建てる必要があります。',
  },
  {
    id: 'facility', when: (s) => s.history.length > 0 && s.gold >= FACILITY_GOLD && s.base.facilities.length === 0,
    text: '資金に余裕が出ました。「施設」タブで工房を建てると、素材から装備を作れます。隣り合う施設にはシナジーがあります。',
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
