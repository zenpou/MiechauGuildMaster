import { effectiveStats, growthRank, rankOf } from '../core/adventurer';
import { JOB, PERSONALITY, TRAIT, TUNING } from '../core/data';
import { capacity, hire, hireFee } from '../core/recruit';
import { ROLE_IDS, ROLE_LABEL, STAT_KEYS, type Candidate } from '../core/types';
import { commit, STAT_LABEL, state, toast } from './app';
import { div, h, span } from './dom';

export function recruitTab(): HTMLElement {
  const cap = capacity(state);
  const full = state.adventurers.length >= cap;
  return div('tab-body',
    div('summary',
      span('big', `${state.gold}G`),
      span(full ? 'big neg' : 'big', `雇用 ${state.adventurers.length}/${cap}人`),
    ),
    div('dim small', `候補者は毎日やって来て、期限を過ぎると去ります。雇うと契約金(日給の${TUNING.game.hireSalaryDays}日分)を払い、以後は日給が掛かります。上限は宿舎で増やせます。`),
    h('h2', null, `候補者(${state.candidates.length}人)`),
    state.candidates.length
      ? div('cands', ...state.candidates.map((c) => candCard(c, full)))
      : div('dim', '今は候補者がいません'),
  );
}

function candCard(c: Candidate, full: boolean): HTMLElement {
  const a = c.adv;
  const fee = hireFee(a.salary);
  const st = effectiveStats(a);
  const traits = a.traits.filter((t) => t.revealed);
  const reason = full ? '雇用の上限に達しています' : state.gold < fee ? `契約金が${fee - state.gold}G足りません` : '';
  const leftDays = c.expiresDay - state.day;
  return div('detail cand',
    div('row tight',
      span('big', a.name),
      span('small', `${JOB[a.job]?.name ?? a.job} Lv${a.level} / ${PERSONALITY[a.personality]?.name ?? a.personality} / ${a.age}歳`),
    ),
    div('small stats', ...STAT_KEYS.map((k) => span(null, `${STAT_LABEL[k]}${st[k]}`))),
    div('small stats', '適性: ', ...ROLE_IDS.map((r) => span(null, `${ROLE_LABEL[r]}${rankOf(a.apt[r])}(${a.apt[r]})`))),
    div('small', `成長率 ${growthRank(a.growth)}(×${a.growth.toFixed(2)})`),
    div('small', '特性(判明分): ', traits.length
      ? traits.map((t) => span(null, { title: TRAIT[t.id]?.desc ?? '' }, `${TRAIT[t.id]?.name ?? t.id} `))
      : span('dim', 'なし')),
    div('row tight',
      span('small', `日給 ${a.salary}G / 契約金 `, span(state.gold >= fee ? '' : 'neg', `${fee}G`)),
      span(leftDays <= 1 ? 'small neg' : 'small dim', `${c.expiresDay}日目まで(あと${leftDays}日)`),
    ),
    h('button', { class: 'primary', disabled: !!reason, onclick: () => doHire(c) }, '雇う'),
    reason ? div('small neg', reason) : null,
  );
}

function doHire(c: Candidate) {
  const r = hire(state, c.adv.id);
  if (!r.ok) return toast(r.reason, true);
  commit();
  toast(`${c.adv.name}を雇いました`);
}
