import { describe, expect, it } from 'vitest';
import { NODE, WORLD } from '../src/core/data';
import { hit, layoutWorld, placePartyLabel, type Box } from '../src/ui/worldLayout';

// テストリスト
// - [x] 道のラベル同士は重ならない(隠れた近道を見つけた後の、全部の道を並べた状態で)
// - [x] 道のラベルはノードの円に重ならない
// - [x] ノード名は、道のラベル・ノードの円・ほかのノード名に重ならない
// - [x] 道のラベルは、その道の中点の近くに置く(どの道のラベルか分かる)
// - [x] 同じ2点を結ぶ道は2本目以降が弧になる

// いちばん長い表示(危険度が3桁)で、最悪の幅を見る
const worst = (e: { days: number }) => `${e.days}日 危100%`;
const layout = layoutWorld(WORLD.nodes, WORLD.edges, worst);

const pairs = <T>(xs: T[]) => xs.flatMap((a, i) => xs.slice(i + 1).map((b) => [a, b] as const));
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

describe('ワールド地図の配置', () => {
  it('道のラベル同士は重ならない', () => {
    const clash = pairs(layout.roads).filter(([a, b]) => hit(a.label.box, b.label.box)).map(([a, b]) => `${a.edge.id} × ${b.edge.id}`);
    expect(clash).toEqual([]);
  });

  it('道のラベルはノードの円に重ならない', () => {
    const clash = layout.roads.filter((r) => layout.circles.some((c) => hit(r.label.box, c))).map((r) => r.edge.id);
    expect(clash).toEqual([]);
  });

  it('ノード名は、道のラベル・ノードの円・ほかのノード名に重ならない', () => {
    const named = WORLD.nodes.map((n) => ({ id: n.id, box: layout.nodeLabels.get(n.id)!.box }));
    const clash: string[] = [];
    for (const n of named) {
      for (const r of layout.roads) if (hit(n.box, r.label.box)) clash.push(`${n.id} × ${r.edge.id}`);
      WORLD.nodes.forEach((m, i) => { if (hit(n.box, layout.circles[i])) clash.push(`${n.id} × 円 ${m.id}`); });
    }
    for (const [a, b] of pairs(named)) if (hit(a.box, b.box)) clash.push(`${a.id} × ${b.id}`);
    expect(clash).toEqual([]);
  });

  it('道のラベルは、その道の中点の近くに置く(どの道のラベルか分かる)', () => {
    for (const r of layout.roads) {
      const [x, y] = [(r.label.box.x1 + r.label.box.x2) / 2, (r.label.box.y1 + r.label.box.y2) / 2];
      expect(Math.hypot(x - r.mx, y - r.my), r.edge.id).toBeLessThan(16);
    }
  });

  it('同じ2点を結ぶ道は、2本目以降が弧になる(重なって見えなくならない)', () => {
    const shortcut = layout.roads.find((r) => r.edge.id === 'mountain_village__old_mine_short')!;
    const main = layout.roads.find((r) => r.edge.id === 'mountain_village__old_mine')!;
    expect(Math.hypot(shortcut.mx - main.mx, shortcut.my - main.my)).toBeGreaterThan(3);
    expect(overlap(shortcut.label.box, main.label.box)).toBe(0);
    expect(NODE[shortcut.edge.a]).toBeDefined();
  });
});

describe('派遣中の隊の名前(地図の上)', () => {
  // 名前は2〜4字(names.json の最長)。いちばん長い4字で見る
  const name = 'ヨシュア';

  it('置きたい側が埋まっていれば、ほかの側へずらす', () => {
    const blocked: Box = { x1: 40, y1: 40, x2: 70, y2: 49 };
    const lb = placePartyLabel(50, 50, name, 3.8, 0, [blocked]);
    expect(hit(lb.box, blocked)).toBe(false);
  });

  it('どの道の上にいても、道のラベル・ノード名・ノードの円に重ならない', () => {
    const avoid = [...layout.circles, ...layout.boxes, ...WORLD.nodes.map((n) => layout.nodeLabels.get(n.id)!.box)];
    const clash: string[] = [];
    for (const r of layout.roads) {
      const lb = placePartyLabel(r.mx, r.my, name, -r.ox * 1.2, -r.oy * 1.2, avoid);
      if (avoid.some((b) => hit(lb.box, b))) clash.push(r.edge.id);
    }
    expect(clash).toEqual([]);
  });

  it('隊が2つ重なっても、お互いの名前が重ならない', () => {
    const avoid = [...layout.boxes];
    // 地図の外れの空いた所で、同じ場所の2隊を置く
    const a = placePartyLabel(200, 200, name, 3.8, 0, avoid);
    avoid.push(a.box);
    const b = placePartyLabel(200, 200, name, 3.8, 0, avoid);
    expect(hit(a.box, b.box)).toBe(false);
  });
});
