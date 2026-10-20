import { forecastFinances } from '../core/finances';
import { nameOf, state } from './app';
import { div, h, span } from './dom';
import './financeOutlook.css';

/** 帰還の成果を先読みせず、今決まっている支払いを見通す。 */
export function financeOutlook(days = 7, departing = false): HTMLElement {
  const forecast = forecastFinances(state, days);
  const missing = forecast.additionalReserve;
  const until = state.day + days;
  const returnDays = [...new Set(state.expeditions.map((e) => e.returnDay))]
    .filter((day) => day > state.day && day <= until).sort((a, b) => a - b);
  const first = forecast.rows[0];
  return h('section', { class: 'finance-outlook', 'aria-label': '資金の見通し' },
    h('h3', null, departing ? '帰還までの資金（ギルド全体）' : 'これから7日間の資金'),
    div('finance-summary',
      div(null, span('small dim', '今の資金'), h('strong', null, `${state.gold}G`)),
      div(null, span('small dim', `${days}日分の日給・維持費`), h('strong', null, `${forecast.totalCost}G`)),
      div(null, span('small dim', `${until}日目の朝・入金前`),
        h('strong', { class: forecast.closingGold < 0 ? 'neg' : 'pos' }, `${forecast.closingGold}G`)),
    ),
    missing > 0
      ? div('small neg', `${forecast.firstDebtDay}日目の朝までに資金不足。期間中の支払いを賄うには、あと${missing}G必要です。`)
      : div('small pos', 'この見通しでは、期間中の日給・維持費を払えます。'),
    forecast.totalSupport ? div('small', `初期支援金 ${forecast.totalSupport}Gを含みます。`) : null,
    forecast.totalInterest ? div('small', `入金がなければ、この期間の利息は${forecast.totalInterest}Gです。`) : null,
    h('details', null,
      h('summary', null, '支払いと帰還予定を見る'),
      first ? div('small', `次の日送り：日給${first.wages}G / ギルド${first.guild}G / 施設${first.facilities}G`) : null,
      ...returnDays.map((day) => {
        const row = forecast.rows.find((r) => r.day === day)!;
        const teams = state.expeditions.filter((e) => e.returnDay === day).map((e) => `${nameOf(e.order.leaderId)}隊`).join('・');
        return div('finance-return small', `${day}日目：${teams}が帰還予定`,
          span(row.afterCharges < 0 ? 'neg' : '', `入金前 ${row.afterCharges}G`));
      }),
      !returnDays.length ? div('small dim', `この${days}日間に、派遣中の隊の帰還予定はありません。`) : null,
      div('small dim', '現在の日給と、工事が完成した後の維持費で試算しています。新たな購入・製作・雇用などは含みません。'),
    ),
    div('small dim', '日給・維持費の支払いは帰還報酬より先です。依頼報酬・拾得金・素材売却は含まない見通しです。'),
  );
}
