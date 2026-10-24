import './style.css';
import './layout.css';
import { endingPages, endingPending, markEndingSeen } from '../core/ending';
import { dailyCost } from '../core/game';
import { unreadCount } from '../core/mail';
import { REP_LEVELS, repLevel } from '../core/quests';
import { commit, setRender, state, ui, type Tab } from './app';
import { baseTab } from './baseTab';
import { dispatchTab } from './dispatchTab';
import { div, h, span } from './dom';
import { homeTab, nextDay } from './home';
import { icon } from './icons';
import { inboxTab } from './inboxTab';
import { journeyOverlay } from './journeyHost';
import { logTab } from './logTab';
import { mapTab } from './mapTab';
import { initPwa } from './pwa';
import { questsTab } from './questsTab';
import { recordsTab } from './recordsTab';
import { recruitTab } from './recruitTab';
import { storyOverlay } from './storyHost';
import { TAB_DEFS } from './tabs';
import { worldTab } from './worldTab';
import { tutorialFor, tutorialTabUnlocked } from '../core/tutorial';
import { tutorialPanel } from './tutorial';

const VIEWS: Record<Tab, () => HTMLElement> = {
  home: homeTab, inbox: inboxTab, quests: questsTab, dispatch: dispatchTab, world: worldTab,
  recruit: recruitTab, base: baseTab, map: mapTab, log: logTab, records: recordsTab,
};
const TABS = TAB_DEFS.map((t) => ({ ...t, view: VIEWS[t.id] }));

/** 上部に固定の HUD。日数・資金・評判・未読と「次の日へ」をどのタブからでも見せる */
function hud(unread: number): HTMLElement {
  const s = state;
  const guide = tutorialFor(s);
  const lv = repLevel(s.rep);
  const next = REP_LEVELS[lv];
  return h('header', { class: 'hud' },
    h('h1', null, '見えちゃうギルドマスター'),
    div('hud-stats',
      span('hud-day', `${s.day}日目`),
      span(s.gold < 0 ? 'hud-gold neg' : 'hud-gold', `${s.gold}G`, span('hud-sub', ` 1日 −${dailyCost(s)}G`)),
      span('hud-rep', { title: next === undefined ? '評判は最高段階' : `次の段階まで ${next - s.rep}` },
        `評判 Lv${lv}`,
        span('pips', ...REP_LEVELS.map((_, i) => span(i < lv ? 'pip on' : 'pip'))),
      ),
      unread && tutorialTabUnlocked(s, 'inbox') ? h('button', { class: 'hud-unread', onclick: () => { ui.tab = 'inbox'; render(); } }, span('badge unread', `未読${unread}`)) : null,
    ),
    h('button', { class: 'primary hud-next', disabled: guide && !guide.canAdvanceDay, title: guide && !guide.canAdvanceDay ? 'まずはノエルの案内に沿って準備を進めましょう' : '', onclick: nextDay }, '次の日へ'),
  );
}

function render() {
  const app = document.getElementById('app')!;
  const guide = tutorialFor(state);
  // 帰還報告・工房などのショートカットからも、未解放の画面へは入れない。
  if (!tutorialTabUnlocked(state, ui.tab)) ui.tab = 'home';
  const tab = TABS.find((t) => t.id === ui.tab) ?? TABS[0];
  const unread = unreadCount(state);
  const pages = endingPending(state) ? endingPages(state) : [];
  const body = [
    hud(unread),
    h('nav', { class: 'tabs', 'aria-label': 'コマンド' }, ...TABS.map((t) =>
      h('button', { class: `${t.id === tab.id ? 'on' : ''}${guide?.target === t.id ? ' tutorial-next' : ''}`, disabled: !tutorialTabUnlocked(state, t.id), title: tutorialTabUnlocked(state, t.id) ? undefined : 'はじめの案内が進むと使えるようになります', 'aria-current': t.id === tab.id ? 'page' : undefined, onclick: () => { if (!tutorialTabUnlocked(state, t.id)) return; ui.tab = t.id; render(); window.scrollTo(0, 0); } },
        t.label,
        icon(t.id),
        t.id === 'inbox' && unread ? span('badge unread', unread) : null))),
    h('main', { class: 'window' },
      div('window-title', tab.label),
      ui.saveWarning ? div('warn', ui.saveWarning) : null,
      tutorialPanel(nextDay),
      tab.view(),
    ),
  ].filter((x): x is HTMLElement => !!x);
  // 道中の観察は、日送り直後のエンディング・物語より先に見せる。
  const journey = journeyOverlay(render);
  // 物語の章はエンディングの後に重ねる。竜の後の章は、エンディングを読み終えてから開く
  const story = journey || pages.length ? null : storyOverlay(commit);
  const modal = journey !== null || pages.length > 0 || story !== null;
  // モーダルの間は後ろの画面を操作・読み上げの対象から外す
  if (modal) for (const el of body) el.inert = true;
  // 下のバー(インストール・更新)にも、モーダルの後ろからキーボードで届かないようにする
  const bar = document.getElementById('pwa');
  if (bar) bar.inert = modal;
  // 描き直しでプレイヤーを付け直すとフォーカスが外れる。音量などを触っている途中なら、そこへ戻す
  const focused = journey?.contains(document.activeElement)
    ? document.activeElement as HTMLElement
    : story?.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  app.replaceChildren(...body,
    ...(journey ? [journey] : []),
    ...(pages.length && !journey ? [endingModal(pages)] : []),
    ...(story ? [story] : []),
    ...(ui.toast ? [div(`toast ${ui.toast.err ? 'err' : ''}`, ui.toast.text)] : []));
  if (journey) (focused ?? journey.querySelector<HTMLElement>('button:not([disabled])'))?.focus({ preventScroll: true });
  else if (pages.length) app.querySelector<HTMLButtonElement>('.modal button')?.focus();
  else if (story) (focused ?? story.querySelector<HTMLElement>('[data-story-next]'))?.focus({ preventScroll: true });
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
initPwa();
