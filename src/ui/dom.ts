type Child = Node | string | number | null | undefined | false | Props | Child[];
type Props = { [k: string]: any };

export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  const setProps = (pp: Props) => applyProps(el, pp);
  setProps(props ?? {});
  const add = (c: Child) => {
    if (Array.isArray(c)) c.forEach(add);
    else if (c === null || c === undefined || c === false) return;
    else if (typeof c === 'object' && !(c instanceof Node)) setProps(c as Props);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

function applyProps(el: HTMLElement, props: Props) {
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'disabled') (el as any).disabled = !!v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

export const div = (cls: string | null, ...c: Child[]) => h('div', cls ? { class: cls } : null, ...c);
export const span = (cls: string | null, ...c: Child[]) => h('span', cls ? { class: cls } : null, ...c);

export function bar(value: number, max: number, cls = ''): HTMLElement {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return div(`bar ${cls}`, h('div', { class: 'bar-fill', style: `width:${pct}%` }));
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG 要素。className は SVG では読み取り専用なので、class も属性として書く */
export function sv(tag: string, attrs?: Props | null, ...children: (Node | string | null | undefined | false)[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}
