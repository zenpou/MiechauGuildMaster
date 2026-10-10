import './style.css';
import { endingPages, endingPending, markEndingSeen } from '../core/ending';
import { unreadCount } from '../core/mail';
import { commit, setRender, state, ui, type Tab } from './app';
import { baseTab } from './baseTab';
import { dispatchTab } from './dispatchTab';
import { div, h, span } from './dom';
import { homeTab } from './home';
import { inboxTab } from './inboxTab';
import { logTab } from './logTab';
import { mapTab } from './mapTab';
import { questsTab } from './questsTab';
import { recordsTab } from './recordsTab';
import { recruitTab } from './recruitTab';
import { worldTab } from './worldTab';

const TABS: { id: Tab; label: string; view: () => HTMLElement }[] = [
  { id: 'home', label: '拠点', view: homeTab },
  { id: 'inbox', label: '受信箱', view: inboxTab },
  { id: 'quests', label: '依頼', view: questsTab },
  { id: 'dispatch', label: '派遣', view: dispatchTab },
  { id: 'world', label: 'ワールド', view: worldTab },
  { id: 'recruit', label: '募集', view: recruitTab },
  { id: 'base', label: '施設', view: baseTab },
  { id: 'map', label: '地図', view: mapTab },
  { id: 'log', label: 'ログ', view: logTab },
  { id: 'records', label: '記録', view: recordsTab },
];

function render() {
  const app = document.getElementById('app')!;
  const tab = TABS.find((t) => t.id === ui.tab) ?? TABS[0];
  const unread = unreadCount(state);
  const pages = endingPending(state) ? endingPages() : [];
  const body = [
    h('header', null, h('h1', null, '見えちゃうギルドマスター')),
    h('nav', { class: 'tabs' }, ...TABS.map((t) =>
      h('button', { class: t.id === tab.id ? 'on' : '', onclick: () => { ui.tab = t.id; render(); } }, t.label,
        t.id === 'inbox' && unread ? span('badge unread', unread) : null))),
    ui.saveWarning ? div('warn', ui.saveWarning) : null,
    tab.view(),
  ].filter((x): x is HTMLElement => !!x);
  // モーダルの間は後ろの画面を操作・読み上げの対象から外す
  if (pages.length) for (const el of body) el.inert = true;
  app.replaceChildren(...body,
    ...(pages.length ? [endingModal(pages)] : []),
    ...(ui.toast ? [div(`toast ${ui.toast.err ? 'err' : ''}`, ui.toast.text)] : []));
  if (pages.length) app.querySelector<HTMLButtonElement>('.modal button')?.focus();
}

// render のたびに endingPending を見るので、日送りの後でも読み込み直後でも、未読なら出る
function endingModal(pages: string[]): HTMLElement {
  const i = Math.min(ui.endingPage, pages.length - 1);
  const last = i === pages.length - 1;
  return div('modal-back',
    div('modal ending', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'エンディング' },
      div('dim small', `${i + 1} / ${pages.length}`),
      div('ending-text', pages[i]),
      h('button', { class: 'primary wide', onclick: last ? finishEnding : () => { ui.endingPage = i + 1; render(); } }, last ? '続ける' : '次へ'),
    ),
  );
}

function finishEnding() {
  markEndingSeen(state);
  ui.endingPage = 0;
  commit();
}

setRender(render);
commit();
