// コマンド10個の線画アイコン。24×24、stroke=currentColor なので色は CSS で変わる
import type { Tab } from './app';
import { sv } from './dom';

export const ICON_PATHS: Record<Tab, string> = {
  home: 'M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10',
  inbox: 'M3 6h18v12H3zM3 7l9 6 9-6',
  quests: 'M6 4h10a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2H8a2 2 0 0 1-2-2zM18 20a2 2 0 0 0 2-2v-2h-4M9 9h6M9 13h6',
  dispatch: 'M5 21V3M5 4h13l-3 4 3 4H5',
  world: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z',
  recruit: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21c0-4 4-6 8-6s8 2 8 6',
  base: 'M3 21h18M4 21V10l4-3v14M8 21V7l4-3 4 3v14M16 21V10l4 3v8M11 12h2M11 16h2',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  log: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  records: 'M8 21h8M12 17v4M5 4h14v5a7 7 0 0 1-14 0zM5 6H2v2a3 3 0 0 0 3 3M19 6h3v2a3 3 0 0 1-3 3',
};

export function icon(id: Tab): SVGElement {
  return sv('svg', {
    class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true',
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }, sv('path', { d: ICON_PATHS[id] }));
}
