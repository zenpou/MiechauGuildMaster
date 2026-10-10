// ワールド地図の配置。DOM に触れない計算だけを置く(重なりを tests/world-layout.test.ts で確かめるため)。
import type { WorldEdgeDef, WorldNodeDef } from '../core/types';

export const SCALE = 10;
export const PAD = 6;
export const px = (n: WorldNodeDef) => PAD + n.x * SCALE;
export const py = (n: WorldNodeDef) => PAD + n.y * SCALE;
export const NODE_R = 3.2;
export const NODE_FONT = 3.2;
export const ROAD_FONT = 2.6;
export const PARTY_FONT = 2.8;

export type Anchor = 'start' | 'middle' | 'end';
export type Box = { x1: number; y1: number; x2: number; y2: number };
export type Label = { x: number; y: number; anchor: Anchor; box: Box };

// 描画前なので getBBox は使えない。全角1字=1em、半角0.6em、高さは Chrome で測った字形の枠(基線の上1.12em・下0.26em)に余裕を足して見積もる
const textWidth = (t: string, fs: number) => [...t].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) < 0x80 ? 0.6 : 1) * fs, 0);
export function textBox(x: number, y: number, t: string, fs: number, anchor: Anchor): Box {
  const w = textWidth(t, fs);
  const x1 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x1, y1: y - fs * 1.15, x2: x1 + w, y2: y + fs * 0.3 };
}
export const hit = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

export const anchorFor = (ox: number, oy: number): Anchor => (Math.abs(ox) > Math.abs(oy) ? (ox > 0 ? 'start' : 'end') : 'middle');

// 下を最初に試すのは、これまでの見た目(名前はノードの下)をなるべく変えないため
const LABEL_SPOTS: [number, number, Anchor][] = [[0, 7, 'middle'], [0, -4.6, 'middle'], [4.6, 1.1, 'start'], [-4.6, 1.1, 'end']];

// どこに置いても重なるときは下に置く(名前を消すよりは読める)
export function placeNodeLabels(nodes: WorldNodeDef[], circles: Box[], taken: Box[]): Map<string, Label> {
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

const dot = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;

/** 道の中点からのずれの候補。(nx, ny) は道の法線、(tx, ty) は道に沿う向き。道の脇 → 反対側 → 道に沿ってずらす → 少し離す */
function roadLabelSpots(nx: number, ny: number, tx: number, ty: number): [number, number][] {
  const near = 3.2;
  const far = 6;
  const slide = 7;
  return [
    [near * nx, near * ny], [-near * nx, -near * ny],
    [near * nx + slide * tx, near * ny + slide * ty], [near * nx - slide * tx, near * ny - slide * ty],
    [-near * nx + slide * tx, -near * ny + slide * ty], [-near * nx - slide * tx, -near * ny - slide * ty],
    [far * nx, far * ny], [-far * nx, -far * ny],
  ];
}

export interface RoadGeo {
  edge: WorldEdgeDef;
  /** 道の線(2次ベジェ) */
  x1: number; y1: number; x2: number; y2: number; cx: number; cy: number;
  /** 道の中点と、ラベルを寄せた側(隊の名前は反対側に出す) */
  mx: number; my: number; ox: number; oy: number;
  label: Label;
}

export interface WorldLayout {
  roads: RoadGeo[];
  circles: Box[];
  nodeLabels: Map<string, Label>;
  /** 描く物の外枠(ラベル・ノードの円)。viewBox の元 */
  boxes: Box[];
}

/**
 * 道・ノード・ラベルの配置。同じ2点を結ぶ道(近道)は2本目以降を弧にして重ならないようにする。
 * 道のラベルは道の脇に寄せる。
 */
export function layoutWorld(nodes: WorldNodeDef[], edges: WorldEdgeDef[], text: (e: WorldEdgeDef) => string): WorldLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pairSeen = new Map<string, number>();
  const circles = nodes.map((n) => ({ x1: px(n) - NODE_R, y1: py(n) - NODE_R, x2: px(n) + NODE_R, y2: py(n) + NODE_R }));
  const taken: Box[] = [];
  const roads: RoadGeo[] = edges.map((e) => {
    const a = byId.get(e.a)!;
    const b = byId.get(e.b)!;
    const key = [e.a, e.b].sort().join('|');
    const nth = pairSeen.get(key) ?? 0;
    pairSeen.set(key, nth + 1);
    const [x1, y1, x2, y2] = [px(a), py(a), px(b), py(b)];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const bend = nth * 7;
    const cx = (x1 + x2) / 2 + ((y2 - y1) / len) * bend;
    const cy = (y1 + y2) / 2 - ((x2 - x1) / len) * bend;
    const [tx, ty] = [(x2 - x1) / len, (y2 - y1) / len];
    const mx = ((x1 + x2) / 2 + cx) / 2;
    const my = ((y1 + y2) / 2 + cy) / 2;
    // 道の脇(法線の向き)に寄せる。ほかの道のラベルやノードの円と重なるときは、反対側・道に沿ってずらした位置を順に試す。
    // 重ならない所が無いときは最初の位置(道の脇)に置く(ラベルを消すより、重なっても読める)
    const label = text(e);
    const spots = roadLabelSpots(ty, -tx, tx, ty).map(([ox, oy]) => {
      const [lx, ly] = [mx + ox, my + oy + 0.9];
      const anchor = anchorFor(ox, oy);
      return { ox, oy, x: lx, y: ly, anchor, box: textBox(lx, ly, label, ROAD_FONT, anchor) };
    });
    const pick = spots.find((sp) => ![...circles, ...taken].some((b) => hit(sp.box, b))) ?? spots[0];
    taken.push(pick.box);
    return {
      edge: e, x1, y1, x2, y2, cx, cy, mx, my,
      // 隊の名前は、道のラベルと反対側に出す。道に沿ったずれは側の判断に混ぜない
      ox: pick.ox - dot(pick.ox, pick.oy, tx, ty) * tx, oy: pick.oy - dot(pick.ox, pick.oy, tx, ty) * ty,
      label: { x: pick.x, y: pick.y, anchor: pick.anchor, box: pick.box },
    };
  });
  const nodeLabels = placeNodeLabels(nodes, circles, taken);
  return { roads, circles, nodeLabels, boxes: [...circles, ...taken] };
}

// 太字なので見積もりの幅を少し広げる
const PARTY_WIDTH_FACTOR = 1.1;

const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

/**
 * 派遣中の隊の名前。隊の印(x, y)のまわりで、avoid(円・道のラベル・ノード名・先に置いた隊の名前)に重ならない位置を探す。
 * 最初は (ox, oy)(道のラベルと反対側)、次にその反対、そのあと印から遠い位置へ広げる。
 * どこも空いていなければ、重なる面積がいちばん小さい位置に置く(名前を消すより、少し重なっても読める)。
 * y には字の基線の分(+1)が入る
 */
export function placePartyLabel(x: number, y: number, name: string, ox: number, oy: number, avoid: Box[]): Label {
  const ring = (r: number): [number, number][] => [[r, 0], [-r, 0], [0, -r], [0, r + 1.5], [r, -r * 0.7], [-r, -r * 0.7], [r, r * 0.9], [-r, r * 0.9]];
  const spots: [number, number][] = [[ox, oy], [-ox, -oy], ...ring(4.2), ...ring(7), ...ring(10.5)];
  const placed = spots.map(([dx, dy]) => {
    const anchor = anchorFor(dx, dy);
    const [lx, ly] = [x + dx, y + dy + 1];
    const box = textBox(lx, ly, name, PARTY_FONT * PARTY_WIDTH_FACTOR, anchor);
    return { x: lx, y: ly, anchor, box, area: avoid.reduce((s, b) => s + overlapArea(box, b), 0) };
  });
  const free = placed.find((p) => p.area === 0);
  const pick = free ?? placed.reduce((best, p) => (p.area < best.area ? p : best));
  return { x: pick.x, y: pick.y, anchor: pick.anchor, box: pick.box };
}
