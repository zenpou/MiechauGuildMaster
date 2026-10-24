import { acknowledgeTutorial, skipTutorial, tutorialFor, type TutorialStage } from '../core/tutorial';
import { commit, render, resetDispatchForm, state, toast, ui } from './app';
import { div, h } from './dom';
import { artUrl } from './storyPlayer';
import './tutorial.css';

const CONFIRM: Partial<Record<TutorialStage, string>> = {
  report: '報告を確認して、地図へ',
  map: '地図を確認して、依頼へ',
  quests: '依頼を確認して、次の探索へ',
  recruit: '募集を確認して、施設へ',
  facilities: '施設を確認して、ワールドへ',
  overview: '案内を終えて、自由に遊ぶ',
};

/** 現在の案内と操作先を全タブ共通で示す。確認操作は対応する画面でだけ行う。 */
export function tutorialPanel(nextDay: () => void): HTMLElement | null {
  const guide = tutorialFor(state);
  if (!guide) return null;
  const confirm = CONFIRM[guide.id];
  const atTarget = ui.tab === guide.target;
  const action = !atTarget
    ? h('button', { class: 'primary', onclick: () => { ui.tab = guide.target; render(); window.scrollTo(0, 0); } }, guide.actionLabel)
    : confirm
      ? h('button', { class: 'primary', onclick: () => {
        const result = acknowledgeTutorial(state, guide.id, ui.tab);
        if (!result.ok) return toast(result.reason, true);
        const next = tutorialFor(state);
        if (next?.id === 'second-dispatch') resetDispatchForm();
        ui.tab = next?.target ?? 'home';
        commit();
        window.scrollTo(0, 0);
        if (!next) toast('案内はここまでです。すべてのメニューが使えるようになりました。');
      } }, confirm)
      : guide.id === 'return' || guide.id === 'second-return'
        ? h('button', { class: 'primary', onclick: nextDay }, '翌朝の様子を見る')
        : null;
  return h('section', { class: 'tutorial hint', 'aria-label': 'はじめの案内', 'data-tutorial-stage': guide.id },
    h('img', { class: 'hint-face', src: artUrl('faces/noel/worried.webp'), alt: '', width: 56, height: 56 }),
    div('hint-body',
      div('hint-name', 'ノエルの はじめの案内'),
      h('h2', null, guide.title),
      h('p', null, guide.text),
      div('tutorial-actions', action,
        h('button', { class: 'link small tutorial-skip', onclick: () => {
          skipTutorial(state); commit(); toast('すべてのメニューを開きました。');
        } }, '案内を終了して全機能を開く')),
    ),
  );
}
