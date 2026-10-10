import { ITEM, POLICY } from '../core/data';
import type { Expedition } from '../core/types';
import { actionText, destText, nameOf, render, state, ui } from './app';
import { div, h, span } from './dom';

const outcome = (e: Expedition) => (e.result.wiped ? '全滅' : e.result.retreated ? '撤退' : '成功');
const listItems = (rec: Record<string, number>) =>
  Object.entries(rec).filter(([, n]) => n > 0).map(([k, n]) => `${ITEM[k]?.name ?? k}×${n}`).join('、') || 'なし';

export function logTab(): HTMLElement {
  const list = state.history;
  if (!list.length) return div('tab-body', div('dim', 'まだ帰還した遠征はありません'));
  const sel = list.find((e) => e.id === ui.selLog) ?? null;
  return div('tab-body',
    h('h2', null, '遠征の記録(新しい順)'),
    h('ul', { class: 'plain loglist' }, ...list.map((e) => h('li', null,
      h('button', { class: e.id === ui.selLog ? 'sel' : '', onclick: () => { ui.selLog = e.id === ui.selLog ? null : e.id; render(); } },
        `${e.returnDay}日目 ${destText(e)} ${actionText(e.order)} 隊長${nameOf(e.order.leaderId)} `,
        span(`badge ${outcome(e)}`, outcome(e)),
      ),
    ))),
    sel ? detail(sel) : null,
  );
}

function detail(e: Expedition): HTMLElement {
  const r = e.result;
  return div('detail',
    div('small',
      `隊員: ${e.order.partyIds.map(nameOf).join('・')} / 方針: ${POLICY[e.order.policy]?.name ?? e.order.policy} / ${e.startDay}日目→${e.returnDay}日目`,
    ),
    div('small', `持ち帰り: ${listItems(r.materials)} / 拾得金 ${r.gold}G${r.rescueCost ? ` / 救助費用 ${r.rescueCost}G` : ''}`),
    r.wiped ? div('small neg', `失った素材: ${listItems(r.lostMaterials)}`) : null,
    h('ol', { class: 'log' }, ...r.log.map((l) => h('li', { class: `log-${l.kind}` }, span('dim', `[${l.day}] `), l.text))),
    returnLines(e),
  );
}

/** 帰還のひとこと。フェーズ5より前の記録には無い */
function returnLines(e: Expedition): HTMLElement | null {
  const lines = e.result.returnDialogue ?? [];
  if (!lines.length) return null;
  return div('return-lines',
    h('h3', null, '帰還のひとこと'),
    h('ul', { class: 'plain small' }, ...lines.map((d) => h('li', null, span('talk-name', `${d.name}: `), d.text))),
  );
}
