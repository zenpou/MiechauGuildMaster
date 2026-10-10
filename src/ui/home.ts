import { advanceDay, buyItem, dailyCost, newGame, sellMaterial } from '../core/game';
import { ITEM, JOB } from '../core/data';
import { commit, replaceState, state, statusText, toast, ui } from './app';
import { div, h, span } from './dom';

export function homeTab(): HTMLElement {
  const s = state;
  const potion = ITEM.potion;
  return div('tab-body',
    div('summary',
      span('big', `${s.day}日目`),
      span(s.gold < 0 ? 'big neg' : 'big', `${s.gold}G`),
      span('dim', `1日の支出 ${dailyCost(s)}G`),
    ),
    h('button', { class: 'primary wide', onclick: nextDay }, '次の日へ'),
    noticesBlock(),
    h('h2', null, '名簿'),
    div('scroll',
      h('table', null,
        h('thead', null, h('tr', null, ...['名前', '職', 'Lv', '疲労', '負傷', '忠誠', '日給', '状態'].map((t) => h('th', null, t)))),
        h('tbody', null, ...s.adventurers.map((a) => h('tr', null,
          h('td', null, a.name),
          h('td', null, JOB[a.job].name),
          h('td', { class: 'num' }, a.level),
          h('td', { class: 'num' }, a.fatigue),
          h('td', { class: 'num' }, a.injuryDays || '-'),
          h('td', { class: 'num' }, a.loyalty),
          h('td', { class: 'num' }, `${a.salary}G`),
          h('td', null, statusText(a)),
        ))),
      ),
    ),
    h('h2', null, '在庫'),
    inventoryBlock(),
    div('row',
      h('button', { onclick: () => buy(1) }, `${potion.name}を買う(${potion.price}G)`),
    ),
    h('h2', null, '台帳(最近10件)'),
    h('ul', { class: 'plain small' }, ...s.ledger.slice(0, 10).map((l) =>
      h('li', null, span('dim', `${l.day}日目 `), l.label, ' ', span(l.amount < 0 ? 'neg' : 'pos', `${l.amount > 0 ? '+' : ''}${l.amount}G`)))),
    div('row footer',
      span('dim small', `seed ${s.seed}`),
      h('button', { class: 'danger', onclick: restart }, '新しく始める'),
    ),
  );
}

function noticesBlock(): HTMLElement | null {
  const list = state.notices.slice(0, 8);
  if (!list.length) return null;
  return div('notices',
    h('h2', null, 'お知らせ'),
    h('ul', { class: 'plain' }, ...list.map((n) => h('li', { class: n.day === state.day ? 'fresh' : 'dim' }, `${n.day}日目 `, n.text))),
  );
}

function inventoryBlock(): HTMLElement {
  const entries = Object.entries(state.inventory).filter(([, n]) => n > 0);
  if (!entries.length) return div('dim', '何も無い');
  return h('ul', { class: 'plain inv' }, ...entries.map(([id, n]) => {
    const def = ITEM[id];
    const sellable = def?.kind === 'material';
    return h('li', null,
      span(null, `${def?.name ?? id} ×${n}`),
      sellable ? span('dim small', ` (${def.price}G)`) : null,
      sellable ? h('button', { class: 'small', onclick: () => sell(id, 1) }, '1つ売る') : null,
      sellable && n > 1 ? h('button', { class: 'small', onclick: () => sell(id, n) }, '全部売る') : null,
    );
  }));
}

function nextDay() {
  const r = advanceDay(state);
  ui.lastReport = r;
  commit();
  if (r.returned.length) toast(`${r.returned.length}隊が帰還しました。ログで報告を読めます。`);
}

function sell(id: string, n: number) {
  const r = sellMaterial(state, id, n);
  if (!r.ok) return toast(r.reason, true);
  commit();
}

function buy(n: number) {
  const r = buyItem(state, 'potion', n);
  if (!r.ok) return toast(r.reason, true);
  commit();
}

function restart() {
  const input = window.prompt('新しく始めます。今の進行は消えます。seed(数字)を入力してください。', String(Date.now() % 100000));
  if (input === null) return;
  const seed = Number.parseInt(input, 10);
  if (!Number.isFinite(seed)) return toast('seed は数字で入力してください', true);
  replaceState(newGame(seed >>> 0, state.playerName));
  toast(`seed ${seed >>> 0} で始めました`);
}
