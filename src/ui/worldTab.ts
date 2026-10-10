import { DUNGEON, EDGE, NODE, WORLD } from '../core/data';
import { acceptQuest, exploredRateOf } from '../core/game';
import { dungeonRate, visibleBoards } from '../core/quests';
import { travelDays } from '../core/world';
import type { NodeKind, WorldEdgeDef, WorldNodeDef } from '../core/types';
import { commit, edgeName, nameOf, positionText, render, state, stepToday, toast, ui } from './app';
import { div, h, span, sv } from './dom';
import { questLine } from './questsTab';
import { layoutWorld, NODE_R, placePartyLabel, px, py } from './worldLayout';

const MARGIN = 1.5;
const pct = (x: number) => Math.floor(x * 100 + 1e-9);

export const KIND_NAME: Record<NodeKind, string> = { base: '拠点', town: '街', village: '村', dungeon: 'ダンジョン', waypoint: '中継地' };

const isRumored = (n: WorldNodeDef) => n.kind === 'dungeon' && !!n.dungeon && !state.dungeons[n.dungeon]?.confirmed;
const edgeKnown = (e: WorldEdgeDef) => !e.hidden || state.world.foundEdges.includes(e.id);

function dangerText(e: WorldEdgeDef): string {
  const m = state.world.measuredDanger[e.id];
  return m === undefined ? '?' : `${Math.round(m * 100)}%`;
}

export function worldTab(): HTMLElement {
  const visited = new Set(state.world.visitedNodes);
  const edges = WORLD.edges.filter(edgeKnown);
  const layout = layoutWorld(WORLD.nodes, edges, (e) => `${e.days}日 危${dangerText(e)}`);
  const geo = new Map(layout.roads.map((r) => [r.edge.id, r]));
  const edgeEls = layout.roads.map((r) => sv('g', null,
    sv('path', { d: `M${r.x1},${r.y1} Q${r.cx},${r.cy} ${r.x2},${r.y2}`, class: `road${r.edge.hidden ? ' short' : ''}` }),
    sv('text', { x: r.label.x, y: r.label.y, 'text-anchor': r.label.anchor, class: 'road-label' }, `${r.edge.days}日 危${dangerText(r.edge)}`),
  ));
  const nodeEls = WORLD.nodes.map((n) => {
    const cls = ['node', `k-${n.kind}`, visited.has(n.id) ? 'visited' : 'unvisited', isRumored(n) ? 'rumored' : '', ui.selNode === n.id ? 'sel' : ''].join(' ');
    const lb = layout.nodeLabels.get(n.id)!;
    return sv('g', { class: cls, onclick: () => pickNode(n.id) },
      sv('circle', { cx: px(n), cy: py(n), r: NODE_R }),
      sv('text', { x: lb.x, y: lb.y, 'text-anchor': lb.anchor, class: 'node-label' }, n.name),
    );
  });
  // 隊の名前は、円・道のラベル・ノード名・先に置いた隊の名前を避けて置く
  const partyAvoid = [...layout.boxes];
  const partyEls = state.expeditions.map((e, i) => {
    const st = stepToday(e);
    const at = st?.edge ? EDGE[st.edge] : null;
    const g = at ? geo.get(at.id) : undefined;
    // 名前はまず道のラベルと反対側に出す
    let [x, y, ox, oy] = [0, 0, 2.4, 0];
    if (g) [x, y, ox, oy] = [g.mx, g.my, -g.ox * 1.2, -g.oy * 1.2];
    else if (st?.node && NODE[st.node]) [x, y] = [px(NODE[st.node]) + 4.5, py(NODE[st.node]) - 3];
    y -= i * 5;
    const name = nameOf(e.order.leaderId);
    const lb = placePartyLabel(x, y, name, ox, oy, partyAvoid);
    partyAvoid.push(lb.box);
    return sv('g', { class: 'party' },
      sv('rect', { x: x - 1.6, y: y - 1.6, width: 3.2, height: 3.2, transform: `rotate(45 ${x} ${y})` }),
      sv('text', { x: lb.x, y: lb.y, 'text-anchor': lb.anchor, class: 'party-label' }, name),
    );
  });

  // ノードを足しても名前や道のラベルが切れないよう、描く物全体の外枠から viewBox を決める
  const all = partyAvoid;
  const vx = Math.floor(Math.min(...all.map((b) => b.x1)) - MARGIN);
  const vy = Math.floor(Math.min(...all.map((b) => b.y1)) - MARGIN);
  const vw = Math.ceil(Math.max(...all.map((b) => b.x2)) + MARGIN) - vx;
  const vh = Math.ceil(Math.max(...all.map((b) => b.y2)) + MARGIN) - vy;

  return div('tab-body',
    h('h2', null, 'ワールド'),
    div('world', sv('svg', { viewBox: `${vx} ${vy} ${vw} ${vh}`, class: 'world-map', role: 'img', 'aria-label': 'ワールドの地図' }, ...edgeEls, ...nodeEls, ...partyEls)),
    div('legend small',
      span('lg w-visited', ''), '訪問済み ',
      span('lg w-unvisited', ''), '未訪問 ',
      span('lg w-rumored', ''), '噂のダンジョン ',
      span('lg w-party', ''), '派遣中の隊',
    ),
    div('dim small', '道のラベルは「片道の日数 危=危険度」。危険度は隊が通ると実測値になります(未測は ?)。'),
    state.expeditions.length ? h('ul', { class: 'plain small' }, ...state.expeditions.map((e) => h('li', null,
      `隊長 ${nameOf(e.order.leaderId)}: ${positionText(stepToday(e))}`, span('dim', ` / ${e.returnDay}日目に帰還予定`)))) : null,
    ui.selNode && NODE[ui.selNode] ? nodePanel(NODE[ui.selNode]) : div('dim small', '地点を押すと詳細が出ます。'),
  );
}

function pickNode(id: string) {
  ui.selNode = ui.selNode === id ? null : id;
  render();
}

function nodePanel(n: WorldNodeDef): HTMLElement {
  const visited = state.world.visitedNodes.includes(n.id);
  const days = travelDays('base', n.id, state.world);
  const board = visibleBoards(state).find((b) => b.town === n.id);
  const roads = WORLD.edges.filter((e) => edgeKnown(e) && (e.a === n.id || e.b === n.id));
  return div('detail',
    div('row tight', span('big', n.name), span('badge', KIND_NAME[n.kind] ?? n.kind),
      isRumored(n) ? span('badge rumor', '噂') : null, span('dim small', visited ? '訪問済み' : '未訪問')),
    div('dim small', n.desc),
    div('small', n.id === 'base' ? 'ギルドのある街' : days === null ? '拠点からの道が分かりません' : `拠点から片道${days}日(往復${days * 2}日)`),
    roads.length ? div('small dim', '道: ', roads.map((e) => `${edgeName(e.id)} ${e.days}日 危${dangerText(e)}`).join(' / ')) : null,
    n.kind === 'dungeon' && n.dungeon ? dungeonBlock(n.dungeon) : null,
    n.town ? (board
      ? div(null,
        h('h3', null, `掲示板(${board.quests.length}/${n.town.boardMax})`),
        board.quests.length
          ? h('ul', { class: 'plain' }, ...board.quests.map((q) => h('li', null, questLine(q),
            h('button', { class: 'small', onclick: () => accept(q.id, q.name) }, '受注'))))
          : div('dim small', '今は依頼がありません'))
      : div('dim small', '掲示板は、隊がこの街を通るか滞在すると見えるようになります。')) : null,
  );
}

function dungeonBlock(dungeonId: string): HTMLElement {
  const def = DUNGEON[dungeonId];
  const prog = state.dungeons[dungeonId];
  if (!def || !prog) return div('dim small', 'ダンジョンの情報がありません');
  const rates = def.floors.map((f) => `${f.name} ${pct(exploredRateOf(state, dungeonId, f.id))}%`).join(' / ');
  return div(null,
    prog.confirmed
      ? div('small', def.floors.length > 1 ? `探索率 全体 ${pct(dungeonRate(state, dungeonId))}%(${rates})` : `探索率(${rates})`)
      : div('small', '噂だけで入口が分かりません。踏査で確認できます。'),
    h('button', { class: 'small', onclick: () => goDispatch(dungeonId) }, 'ここへ派遣する'),
  );
}

function goDispatch(dungeonId: string) {
  ui.d.dungeon = dungeonId;
  ui.d.floor = 'f1';
  ui.d.questId = '';
  ui.tab = 'dispatch';
  render();
}

function accept(id: string, name: string) {
  const r = acceptQuest(state, id);
  if (!r.ok) return toast(r.reason, true);
  commit();
  toast(`「${name}」を受けました`);
}
