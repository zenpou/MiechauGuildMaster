import { achievementExpMult, achievementProgress, achievementStage } from '../core/achievements';
import { ACHIEVEMENTS, TUNING, type AchievementDef } from '../core/data';
import { state } from './app';
import { bar, div, h, span } from './dom';

const CATEGORY_NAME: Record<AchievementDef['category'], string> = {
  manage: '経営', dispatch: '派遣', explore: '探索', growth: '育成', facility: '施設', story: '物語',
};
const CATEGORIES = Object.keys(CATEGORY_NAME) as AchievementDef['category'][];
const LEDGER_MAX = 30;

export function recordsTab(): HTMLElement {
  const s = state;
  const done = new Set(s.achievements);
  const count = ACHIEVEMENTS.filter((a) => done.has(a.id)).length;
  const { stages, expPerStage } = TUNING.achievements;
  const next = stages.find((n) => count < n);
  const bonus = Math.round((achievementExpMult(s) - 1) * 100);
  const clearDay = s.flags.clearDay;
  return div('tab-body',
    s.dragonDefeated ? div('detail cleared', span('big', '竜を討伐しました'), typeof clearDay === 'number' ? span('dim small', ` ${clearDay}日目`) : null) : null,
    h('h2', null, `実績(${count}/${ACHIEVEMENTS.length})`),
    div('summary small',
      span('badge', `段 ${achievementStage(s)}/${stages.length}`),
      span(null, `経験値ボーナス +${bonus}%`),
      span('dim', next === undefined ? '最後の節目に届きました' : `次の節目 ${next}個(あと${next - count}個)`),
    ),
    div('dim small', `達成数が ${stages.join('・')} に届くたびに、遠征で得る経験値が +${Math.round(expPerStage * 100)}% ずつ増えます。`),
    ...CATEGORIES.map((cat) => {
      const list = ACHIEVEMENTS.filter((a) => a.category === cat);
      if (!list.length) return null;
      const got = list.filter((a) => done.has(a.id)).length;
      return div(null,
        h('h3', null, `${CATEGORY_NAME[cat]}(${got}/${list.length})`),
        h('ul', { class: 'plain achievements' }, ...list.map((a) => achievementRow(a, done.has(a.id)))),
      );
    }),
    h('h2', null, `台帳(最近${LEDGER_MAX}件)`),
    s.ledger.length
      ? h('ul', { class: 'plain small' }, ...s.ledger.slice(0, LEDGER_MAX).map((l) =>
        h('li', null, span('dim', `${l.day}日目 `), l.label, ' ', span(l.amount < 0 ? 'neg' : 'pos', `${l.amount > 0 ? '+' : ''}${l.amount}G`))))
      : div('dim', 'まだお金の出入りはありません'),
  );
}

function achievementRow(a: AchievementDef, got: boolean): HTMLElement {
  if (got) return h('li', { class: 'on' }, div('row tight', span('badge', '達成'), span(null, a.name)), div('small', a.desc));
  const p = achievementProgress(state, a.id);
  // 目標を超えた値(資金など)や負の資金でバーがはみ出さないよう、0〜目標に収める
  const value = Math.max(0, Math.min(p.value, p.target));
  const unit = a.cond.type === 'dungeonRate' ? '%' : '';
  return h('li', null,
    div('row tight', span(null, a.name), span('dim small', `${value}${unit} / ${p.target}${unit}`)),
    div('dim small', a.desc),
    bar(value, Math.max(1, p.target)),
  );
}
