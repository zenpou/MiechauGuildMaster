import { DUNGEON, FACILITY, JOB } from '../core/data';
import { memberUnavailableReason } from '../core/expeditionPlan';
import { dailyRestRecovery } from '../core/game';
import { journeyFrameAbsoluteDay } from '../core/journeyPlayback';
import type { Adventurer, Expedition } from '../core/types';
import { actionText, destText, nameOf, positionText, render, state, stepToday, ui } from './app';
import { div, h, span } from './dom';
import { openJourney } from './journeyHost';
import { mapFace } from './mapFace';
import { financeOutlook } from './financeOutlook';
import './operations.css';

/** 確定済みの予定だけを使い、未公開の行程・帰還結果は読まない。 */
export function operationsBlock(): HTMLElement | null {
  if (state.adventurers.length < 3 && !state.expeditions.length && !state.partyPlans.length) return null;
  const home = state.adventurers.filter((a) => a.status !== 'away');
  const available = home.filter((a) => !memberUnavailableReason(state, a));
  const tomorrow = state.expeditions.filter((e) => e.returnDay === state.day + 1).length;
  const working = home.filter((a) => a.status === 'working').length;
  const training = home.filter((a) => a.status === 'training').length;
  return h('section', { class: 'operations', 'aria-label': '仲間と隊の予定' },
    h('h2', null, '仲間と隊の予定'),
    financeOutlook(),
    div('operations-summary',
      span(null, `派遣中 ${state.expeditions.length}隊`),
      span(null, `出発できる仲間 ${available.length}人`),
      working ? span(null, `勤務 ${working}人`) : null,
      training ? span(null, `訓練 ${training}人`) : null,
      tomorrow ? span('pos', `明日 ${tomorrow}隊が帰還予定`) : null,
    ),
    state.expeditions.length ? div('operation-teams', ...state.expeditions.map(teamCard)) : null,
    home.length ? h('details', { open: true },
      h('summary', null, `拠点にいる仲間 ${home.length}人`),
      div('small dim', `今の施設では、1日休むと疲労が${dailyRestRecovery(state)}回復します。勤務・訓練中も回復します。`),
      div('operation-members', ...home.map(memberCard)),
    ) : div('small dim', '仲間は全員、派遣に出ています。'),
    div('row', h('button', { onclick: () => { ui.tab = 'dispatch'; render(); } }, '隊を準備する')),
  );
}

function teamCard(e: Expedition): HTMLElement {
  const leader = state.adventurers.find((a) => a.id === e.order.leaderId);
  const floor = DUNGEON[e.order.target.dungeon ?? '']?.floors.find((f) => f.id === e.order.target.floor);
  const lastDay = state.day - 1;
  const observable = e.journey?.frames.some((f) => journeyFrameAbsoluteDay(e.journey!, f) <= lastDay);
  return h('article', { class: 'operation-team' },
    div('operation-title', leader ? mapFace(leader) : null,
      div(null, h('strong', null, `${nameOf(e.order.leaderId)}隊`),
        div('small dim', e.order.partyIds.map(nameOf).join('・')))),
    div('small', `${destText(e)}${floor ? `・${floor.name}` : ''} / ${actionText(e.order)}`),
    div('small', `${e.returnDay}日目に帰還予定（あと${Math.max(0, e.returnDay - state.day)}日）`),
    div('small dim', positionText(stepToday(e))),
    observable ? h('button', { class: 'small', onclick: () => openJourney(e) }, 'これまでの道中') : null,
  );
}

function memberCard(a: Adventurer): HTMLElement {
  const reason = memberUnavailableReason(state, a);
  const afterRest = Math.max(0, a.fatigue - dailyRestRecovery(state));
  const assignment = a.assignment;
  const trainingUntil = assignment && 'training' in assignment ? assignment.untilDay : null;
  const facility = assignment && 'facility' in assignment
    ? state.base.facilities.find((f) => f.id === assignment.facility) : undefined;
  return div('operation-member',
    div('operation-title', mapFace(a),
      div(null, h('button', { class: 'link', onclick: () => openMember(a.id) }, a.name),
        div('small dim', `${JOB[a.job]?.name ?? a.job} Lv${a.level}`))),
    div(reason ? 'small' : 'small pos', reason ?? '出発できます'),
    div(a.fatigue > 40 ? 'small neg' : 'small dim', `疲労 ${a.fatigue} → 休養1日で ${afterRest}`),
    a.injuryDays ? div('small dim', `療養はあと${a.injuryDays}日`) : null,
    trainingUntil ? div('small dim', `${trainingUntil}日目に訓練が終わる予定`) : null,
    facility ? h('button', { class: 'small', onclick: () => {
      ui.selCell = { x: facility.x, y: facility.y }; ui.tab = 'base'; render();
    } }, `${FACILITY[facility.id]?.name ?? facility.id}を開く`) : null,
  );
}

function openMember(id: string) {
  ui.selAdv = id;
  ui.tab = 'home';
  render();
  document.querySelector('.equip')?.scrollIntoView({ block: 'center' });
}
