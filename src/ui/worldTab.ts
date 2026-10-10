import { DUNGEON, EDGE, NODE, WORLD } from '../core/data';
import { acceptQuest, exploredRateOf } from '../core/game';
import { dungeonRate, visibleBoards } from '../core/quests';
import { travelDays } from '../core/world';
import type { NodeKind, WorldEdgeDef, WorldNodeDef } from '../core/types';
import { commit, edgeName, nameOf, positionText, render, state, stepToday, toast, ui } from './app';
import { div, h, span, sv } from './dom';
import { questLine } from './questsTab';

const SCALE = 10;
const PAD = 6;
const px = (n: WorldNodeDef) => PAD + n.x * SCALE;
const py = (n: WorldNodeDef) => PAD + n.y * SCALE;
const NODE_R = 3.2;
const NODE_FONT = 3.2;
const ROAD_FONT = 2.6;
const MARGIN = 1.5;
const pct = (x: number) => Math.floor(x * 100 + 1e-9);

type Anchor = 'start' | 'middle' | 'end';
type Box = { x1: number; y1: number; x2: number; y2: number };
type Label = { x: number; y: number; anchor: Anchor; box: Box };

// 描画前なので getBBox は使えない。全角1字=1em、半角0.6em、高さは Chrome で測った字形の枠(基線の上1.12em・下0.26em)に余裕を足して見積もる
const textWidth = (t: string, fs: number) => [...t].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) < 0x80 ? 0.6 : 1) * fs, 0);
function textBox(x: number, y: number, t: string, fs: number, anchor: Anchor): Box {
  const w = textWidth(t, fs);
  const x1 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x1, y1: y - fs * 1.15, x2: x1 + w, y2: y + fs * 0.3 };
}
const hit = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

// 下を最初に試すのは、これまでの見た目(名前はノードの下)をなるべく変えないため
const LABEL_SPOTS: [number, number, Anchor][] = [[0, 7, 'middle'], [0, -4.6, 'middle'], [4.6, 1.1, 'start'], [-4.6, 1.1, 'end']];

// どこに置いても重なるときは下に置く(名前を消すよりは読める)
function placeNodeLabels(nodes: WorldNodeDef[], circles: Box[], taken: Box[]): Map<string, Label> {
  const out = new Map<string, Label>();
  for (const n of nodes) {
    const spots = LABEL_SPOTS.map(([dx, dy, anchor]) => {
      const [x, y] = [px(n) + dx, py(n) + dy];
      return { x, y, anchor, box: textBox(x, y, n.name, NODE_FONT, anchor) };
    });
    const pick = spots.find((sp) => ![...circles, ...taken].some((b) => hit(sp.box, b))) ?? spots[0];
    taken.push(pick.box);
    out.set(n.id, pick);
  }
  return out;
}

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
  const taken: Box[] = [];
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
    const label = `${e.days}日 危${dangerText(e)}`;
    const [lx, ly, anchor] = [mx + ox, my + oy + 0.9, anchorFor(ox, oy)] as const;
    taken.push(textBox(lx, ly, label, ROAD_FONT, anchor));
    return sv('g', null,
      sv('path', { d: `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`, class: `road${e.hidden ? ' short' : ''}` }),
      sv('text', { x: lx, y: ly, 'text-anchor': anchor, class: 'road-label' }, label),
    );
  });

  const circles = WORLD.nodes.map((n) => ({ x1: px(n) - NODE_R, y1: py(n) - NODE_R, x2: px(n) + NODE_R, y2: py(n) + NODE_R }));
  const labels = placeNodeLabels(WORLD.nodes, circles, taken);
  const nodeEls = WORLD.nodes.map((n) => {
    const cls = ['node', `k-${n.kind}`, visited.has(n.id) ? 'visited' : 'unvisited', isRumored(n) ? 'rumored' : '', ui.selNode === n.id ? 'sel' : ''].join(' ');
    const lb = labels.get(n.id)!;
    return sv('g', { class: cls, onclick: () => pickNode(n.id) },
      sv('circle', { cx: px(n), cy: py(n), r: NODE_R }),
      sv('text', { x: lb.x, y: lb.y, 'text-anchor': lb.anchor, class: 'node-label' }, n.name),
    );
  });
  // ノードを足しても名前や道のラベルが切れないよう、描く物全体の外枠から viewBox を決める
  const all = [...circles, ...taken];
  const vx = Math.floor(Math.min(...all.map((b) => b.x1)) - MARGIN);
  const vy = Math.floor(Math.min(...all.map((b) => b.y1)) - MARGIN);
  const vw = Math.ceil(Math.max(...all.map((b) => b.x2)) + MARGIN) - vx;
  const vh = Math.ceil(Math.max(...all.map((b) => b.y2)) + MARGIN) - vy;

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
