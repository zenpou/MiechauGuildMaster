import { DUNGEON, EDGE, NODE, WORLD } from '../core/data';
import { acceptQuest, exploredRateOf } from '../core/game';
import { visibleBoards } from '../core/quests';
import { travelDays } from '../core/world';
import type { NodeKind, WorldEdgeDef, WorldNodeDef } from '../core/types';
import { commit, edgeName, nameOf, positionText, render, state, stepToday, toast, ui } from './app';
import { div, h, span, sv } from './dom';
import { questLine } from './questsTab';

const SCALE = 10;
const PAD = 6;
const px = (n: WorldNodeDef) => PAD + n.x * SCALE;
const py = (n: WorldNodeDef) => PAD + n.y * SCALE;

export const KIND_NAME: Record<NodeKind, string> = { base: '拠点', town: '街', village: '村', dungeon: 'ダンジョン', waypoint: '中継地' };

const isRumored = (n: WorldNodeDef) => n.kind === 'dungeon' && !!n.dungeon && !state.dungeons[n.dungeon]?.confirmed;
const edgeKnown = (e: WorldEdgeDef) => !e.hidden || state.world.foundEdges.includes(e.id);

function dangerText(e: WorldEdgeDef): string {
  const m = state.world.measuredDanger[e.id];
  return m === undefined ? '?' : `${Math.round(m * 100)}%`;
}

const anchorFor = (ox: number, oy: number) => (Math.abs(ox) > Math.abs(oy) ? (ox > 0 ? 'start' : 'end') : 'middle');

export function worldTab(): HTMLElement {
  const visited = new Set(state.world.visitedNodes);
  const edges = WORLD.edges.filter(edgeKnown);
  // 同じ2点を結ぶ道(近道)が重なって見えなくならないよう、2本目以降は弧で描く
  const pairSeen = new Map<string, number>();
  const geo = new Map<string, { mx: number; my: number; ox: number; oy: number }>();
  const edgeEls = edges.map((e) => {
    const a = NODE[e.a];
    const b = NODE[e.b];
    const key = [e.a, e.b].sort().join('|');
    const nth = pairSeen.get(key) ?? 0;
    pairSeen.set(key, nth + 1);
    const [x1, y1, x2, y2] = [px(a), py(a), px(b), py(b)];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const bend = nth * 7;
    const cx = (x1 + x2) / 2 + ((y2 - y1) / len) * bend;
    const cy = (y1 + y2) / 2 - ((x2 - x1) / len) * bend;
    // ラベルは道の脇に寄せ、ノード名と重ならないようにする
    const ox = ((y2 - y1) / len) * 3.2;
    const oy = (-(x2 - x1) / len) * 3.2;
    const mx = ((x1 + x2) / 2 + cx) / 2;
    const my = ((y1 + y2) / 2 + cy) / 2;
    geo.set(e.id, { mx, my, ox, oy });
    return sv('g', null,
      sv('path', { d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, class: `road${e.hidden ? ' short' : ''}` }),
      sv('text', { x: mx + ox, y: my + oy + 0.9, 'text-anchor': anchorFor(ox, oy), class: 'road-label' }, `${e.days}日 危${dangerText(e)}`),
    );
  });

  const nodeEls = WORLD.nodes.map((n) => {
    const cls = ['node', `k-${n.kind}`, visited.has(n.id) ? 'visited' : 'unvisited', isRumored(n) ? 'rumored' : '', ui.selNode === n.id ? 'sel' : ''].join(' ');
    return sv('g', { class: cls, onclick: () => pickNode(n.id) },
      sv('circle', { cx: px(n), cy: py(n), r: 3.2 }),
      sv('text', { x: px(n), y: py(n) + 7, class: 'node-label' }, n.name),
    );
  });

  const partyEls = state.expeditions.map((e, i) => {
    const st = stepToday(e);
    const at = st?.edge ? EDGE[st.edge] : null;
    const g = at ? geo.get(at.id) : undefined;
    // 名前は道のラベルと反対側に出し、重ならないようにする
    let [x, y, ox, oy] = [0, 0, 2.4, 0];
    if (g) [x, y, ox, oy] = [g.mx, g.my, -g.ox * 1.2, -g.oy * 1.2];
    else if (st?.node && NODE[st.node]) [x, y] = [px(NODE[st.node]) + 4.5, py(NODE[st.node]) - 3];
    y -= i * 5;
    return sv('g', { class: 'party' },
      sv('rect', { x: x - 1.6, y: y - 1.6, width: 3.2, height: 3.2, transform: `rotate(45 ${x} ${y})` }),
      sv('text', { x: x + ox, y: y + oy + 1, 'text-anchor': anchorFor(ox, oy), class: 'party-label' }, nameOf(e.order.leaderId)),
    );
  });

  return div('tab-body',
    h('h2', null, 'ワールド'),
    div('world', sv('svg', { viewBox: '0 0 110 90', class: 'world-map', role: 'img', 'aria-label': 'ワールドの地図' }, ...edgeEls, ...nodeEls, ...partyEls)),
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
  return div(null,
    prog.confirmed
      ? div('small', `探索率(${def.floors[0]?.name ?? '1階'}) ${Math.round(exploredRateOf(state, dungeonId, 'f1') * 100)}%`)
      : div('small', '噂だけで入口が分かりません。踏査で確認できます。'),
    h('button', { class: 'small', onclick: () => goDispatch(dungeonId) }, 'ここへ派遣する'),
  );
}

function goDispatch(dungeonId: string) {
  ui.d.dungeon = dungeonId;
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
