import './style.css';
import { commit, setRender, ui, type Tab } from './app';
import { baseTab } from './baseTab';
import { dispatchTab } from './dispatchTab';
import { div, h } from './dom';
import { homeTab } from './home';
import { logTab } from './logTab';
import { mapTab } from './mapTab';

const TABS: { id: Tab; label: string; view: () => HTMLElement }[] = [
  { id: 'home', label: '拠点', view: homeTab },
  { id: 'base', label: '施設', view: baseTab },
  { id: 'dispatch', label: '派遣', view: dispatchTab },
  { id: 'map', label: '地図', view: mapTab },
  { id: 'log', label: 'ログ', view: logTab },
];

function render() {
  const app = document.getElementById('app')!;
  const tab = TABS.find((t) => t.id === ui.tab) ?? TABS[0];
  app.replaceChildren(...[
    h('header', null, h('h1', null, '見えちゃうギルドマスター')),
    h('nav', { class: 'tabs' }, ...TABS.map((t) =>
      h('button', { class: t.id === tab.id ? 'on' : '', onclick: () => { ui.tab = t.id; render(); } }, t.label))),
    ui.saveWarning ? div('warn', ui.saveWarning) : null,
    tab.view(),
    ui.toast ? div(`toast ${ui.toast.err ? 'err' : ''}`, ui.toast.text) : null,
  ].filter((x): x is HTMLElement => !!x));
}

setRender(render);
commit();
