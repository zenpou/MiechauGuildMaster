import './style.css';
import { div, h } from './dom';
import { JOBS, PERSONALITIES } from '../core/data';
import { emptyState } from '../core/state';
import { load, save } from '../core/save';
import { ROLE_LABEL } from '../core/types';

// フェーズ0の入口。状態の生成・保存・読み込みが動くことだけ確かめる画面。
const state = load(localStorage) ?? emptyState(Date.now() >>> 0);
save(localStorage, state);

function render() {
  const app = document.getElementById('app')!;
  app.replaceChildren(
    h('h1', null, '見えちゃうギルドマスター'),
    div('meta', `seed ${state.seed} / ${state.day}日目 / フェーズ0(土台)`),
    h('h2', null, '職業'),
    h('table', null,
      h('thead', null, h('tr', null, h('th', null, '職業'), h('th', null, '段'), h('th', null, '役割'), h('th', null, '入口'))),
      h('tbody', null, ...JOBS.map((j) => h('tr', null,
        h('td', null, j.name),
        h('td', null, j.tier === 'lower' ? '下級' : '上級'),
        h('td', null, j.roles.map((r) => ROLE_LABEL[r]).join(' + ')),
        h('td', null, (j.from ?? []).map((f) => JOBS.find((x) => x.id === f)?.name ?? f).join(' / ')),
      ))),
    ),
    h('h2', null, '性格と探索挙動'),
    h('table', null,
      h('thead', null, h('tr', null, h('th', null, '性格'), h('th', null, '未踏'), h('th', null, '埋め残し'), h('th', null, '速度'), h('th', null, '休憩'), h('th', null, '迷い'), h('th', null, '寄り道'))),
      h('tbody', null, ...PERSONALITIES.map((p) => h('tr', null,
        h('td', null, p.name),
        h('td', null, p.explore.venture), h('td', null, p.explore.thorough), h('td', null, p.explore.speed),
        h('td', null, `${p.explore.restHp}${p.explore.restMode === 'any' ? '(誰か)' : ''}`),
        h('td', null, p.explore.forkRandom ? '即決(勘)' : p.explore.hesitate),
        h('td', null, p.explore.detour),
      ))),
    ),
  );
}
render();
