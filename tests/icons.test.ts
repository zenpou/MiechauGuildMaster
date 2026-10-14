import { describe, expect, it } from 'vitest';
import { ICON_PATHS } from '../src/ui/icons';
import { TAB_DEFS } from '../src/ui/tabs';

describe('コマンドのアイコン', () => {
  it('10個のコマンドすべてに SVG のパスがあり、M で始まる', () => {
    for (const t of TAB_DEFS) expect(ICON_PATHS[t.id], t.label).toMatch(/^M/);
  });
  it('同じパスを2つのコマンドで使い回していない', () => {
    const paths = TAB_DEFS.map((t) => ICON_PATHS[t.id]);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
