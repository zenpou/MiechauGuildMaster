import './style.css';
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
];

function render() {
  const app = document.getElementById('app')!;
  const tab = TABS.find((t) => t.id === ui.tab) ?? TABS[0];
  const unread = unreadCount(state);
  app.replaceChildren(...[
    h('header', null, h('h1', null, '見えちゃうギルドマスター')),
    h('nav', { class: 'tabs' }, ...TABS.map((t) =>
      h('button', { class: t.id === tab.id ? 'on' : '', onclick: () => { ui.tab = t.id; render(); } }, t.label,
        t.id === 'inbox' && unread ? span('badge unread', unread) : null))),
    ui.saveWarning ? div('warn', ui.saveWarning) : null,
    tab.view(),
    ui.toast ? div(`toast ${ui.toast.err ? 'err' : ''}`, ui.toast.text) : null,
  ].filter((x): x is HTMLElement => !!x));
}

setRender(render);
commit();
