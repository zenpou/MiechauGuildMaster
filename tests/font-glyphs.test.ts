import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MINCHO_TEXT } from '../src/ui/minchoText';
import { TAB_DEFS } from '../src/ui/tabs';

const GLYPHS = 'scripts/font-glyphs.txt';
const WOFF2 = 'public/fonts/shippori-mincho-subset.woff2';

describe('見出し用の明朝のサブセット', () => {
  it('明朝で描く文字(題・コマンド名・HUD の語・数字)はすべて font-glyphs.txt にある', () => {
    const have = new Set(readFileSync(GLYPHS, 'utf8').split('\n').filter((l) => !l.startsWith('#')).join(''));
    const need = [...new Set([...MINCHO_TEXT, ...TAB_DEFS.map((t) => t.label)].join(''))].filter((c) => c.trim());
    expect(need.filter((c) => !have.has(c))).toEqual([]);
  });
  it.skipIf(!existsSync(WOFF2))('生成した woff2 は 100KB 以下', () => {
    expect(statSync(WOFF2).size).toBeLessThanOrEqual(100 * 1024);
  });
});
