// 最初の数日のヒント: いまの状態から「次にやること」を1つだけ出す。閉じたものは二度と出ない。
// 文面は受付のノエルの台詞(口調は docs/story/characters/noel.md)。操作の名前(「派遣」など)は鉤括弧で残し、押す先が分かるようにする
// 状態は flags に持つので、GameState に項目は足さない。
import { canBless } from './blessing';
import { facilityLevel } from './base';
import { promotionCost, promotionOptions } from './jobs';
import { getIntroExploration } from './introExploration';
import type { GameState } from './types';

export interface Hint { id: string; text: string }

/** 施設をすすめる資金の目安(いちばん安い施設が建てられる額) */
const FACILITY_GOLD = 300;
const OFF = 'hint:off';
const closedKey = (id: string) => `hint:${id}`;

/** Lvが足りて待機中の下級職の人(転職の先に上級職がある)。費用・訓練所は問わない */
const promotable = (s: GameState) => s.adventurers.some((a) => a.status === 'idle'
  && promotionOptions(a).some((o) => a.level >= (o.requireLevel ?? 0)));

interface Rule extends Omit<Hint, 'text'> {
  text: string | ((s: GameState) => string);
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
    text: (s) => {
      const tina = s.adventurers.find((a) => a.unique === 'tina');
      const sera = s.adventurers.find((a) => a.unique === 'sera');
      const intro = tina && getIntroExploration(s, {
        partyIds: sera ? [tina.id, sera.id] : [tina.id], leaderId: tina.id, action: 'explore',
        target: { dungeon: 'forest_cave', floor: 'f1' }, policy: 'standard', days: 1, items: {},
      });
      return intro
        ? `マスター代行、まずは「派遣」から${sera ? '剣士のティナさんと、回復役のセラさんを二人で' : 'ティナさんを'}森の洞窟へ。初回は安全を確かめた入口付近で薬草を採り、日帰りで戻る行程です。回復薬は不要です。「次の日へ」で探索を見守り、明日の朝の報告をお待ちください。`
        : 'マスター代行、まずは「派遣」の窓口から隊を出してみてください。「見込みを見る」で戦力と消耗を確かめ、仲間と回復薬を整えて出発しましょう。';
    },
  },
  {
    id: 'advance-day', when: (s) => s.expeditions.length > 0 && s.history.length === 0,
    text: '隊が出ています。「次の日へ」で日を進めると、現地での探索を見守れます。帰還したら「帰還報告」で成長と発見を確かめて、次の編成や行き先をご検討ください。',
  },
  {
    id: 'second-party',
    when: (s) => s.counters.dispatches === 1 && s.history.length > 0
      && ['tina', 'sera'].every((id) => s.adventurers.some((a) => a.unique === id && a.status === 'idle' && a.injuryDays === 0)),
    text: '次は「帰還報告」の「この隊を組み直す」から、ティナさんとセラさんの装備や隊長を見直してみてください。入口より奥には魔物や罠があります。回復役がいても無理は禁物です。「見込みを見る」で消耗を確かめ、回復薬も持たせましょう。',
  },
  {
    id: 'quests', when: (s) => s.history.length > 0 && !s.quests.some((q) => q.status !== 'posted'),
    text: '「依頼」の掲示には報酬と評判がかかっています。納期に遅れると評判が下がりますので、日数を見て受けてください。無理なものは断ってよいと、マスター代行ご自身がおっしゃっていましたよね?',
  },
  {
    id: 'blessing', when: (s) => canBless(s) && !s.history.some((e) => e.order.blessed) && !s.expeditions.some((e) => e.order.blessed),
    text: 'お嬢様の『祝福』が使えるようになりました。「派遣」の窓口で出発する隊に掛けると、皆さん疲れにくくなります。お嬢様の魔力は日ごとに溜まり、溜まりきったまま日が経つと熱を出されますので、どうか毎日……いえ、隊を出す朝には必ず!',
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
    if (r.when(s)) return { id: r.id, text: typeof r.text === 'function' ? r.text(s) : r.text };
  }
  return null;
}

export function dismissHint(s: GameState, id: string): void {
  if (RULES.some((r) => r.id === id && !r.sticky)) s.flags[closedKey(id)] = true;
}

export function hintsOff(s: GameState): void {
  s.flags[OFF] = true;
}
