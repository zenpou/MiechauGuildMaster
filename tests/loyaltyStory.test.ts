import { describe, expect, it } from 'vitest';
import { LOYALTY_STORIES } from '../src/core/loyaltyStory';
import { ART, CAST } from '../src/core/presentation';

const uniques = ['tina', 'sera', 'viola', 'ruu', 'fine', 'aurelia'];
const thresholds = [50, 120, 255];
const ids = uniques.flatMap((unique) => thresholds.map((threshold) => `loyalty:${unique}:${threshold}`));

describe('人物別忠誠ストーリー', () => {
  it('6人それぞれに50/120/255の3章がある', () => {
    expect(LOYALTY_STORIES.map((s) => s.id)).toEqual(ids);
    expect(LOYALTY_STORIES).toHaveLength(18);
  });

  it('各章は4〜8行で、既存の背景・立ち絵語彙だけを使う', () => {
    const cast = new Map(CAST.map((c) => [c.id, c]));
    for (const chapter of LOYALTY_STORIES) {
      expect(chapter.lines.length, chapter.id).toBeGreaterThanOrEqual(4);
      expect(chapter.lines.length, chapter.id).toBeLessThanOrEqual(8);
      expect(chapter.lines.some((line) => line.speaker), chapter.id).toBe(true);
      expect(chapter.lines.some((line) => /\d/.test(line.text)), chapter.id).toBe(false);
      for (const line of chapter.lines) {
        if (line.background) expect(ART.backgrounds[line.background], `${chapter.id}: ${line.background}`).toBeDefined();
        for (const actor of line.cast ?? []) {
          const member = cast.get(actor.character);
          expect(member, `${chapter.id}: ${actor.character}`).toBeDefined();
          expect(member!.poses, `${chapter.id}: ${actor.character}/${actor.pose}`).toContain(actor.pose);
        }
      }
    }
  });

  it('忠誠イベントは拠点・街の会話として再生し、遠征現地にカイを立たせない', () => {
    for (const chapter of LOYALTY_STORIES) {
      for (const line of chapter.lines) {
        expect(line.background, chapter.id).not.toMatch(/^bg_dungeon_/);
        if (line.background?.startsWith('bg_dungeon_')) {
          expect(line.cast?.some((actor) => actor.character === 'kai'), chapter.id).toBe(false);
        }
      }
    }
    const sera50 = LOYALTY_STORIES.find((s) => s.id === 'loyalty:sera:50')!;
    expect(sera50.lines.flatMap((line) => line.cast ?? []).some((actor) => actor.character === 'iris')).toBe(false);
    expect(sera50.lines.map((line) => line.text).join('\n')).toContain('あの日');
  });

  it('50は導入章・加入7日経過・回復済み、120/255は直前章の読了を待つ', () => {
    for (const unique of uniques) {
      const first = LOYALTY_STORIES.find((s) => s.id === `loyalty:${unique}:50`)!;
      const later = [120, 255].map((threshold) => LOYALTY_STORIES.find((s) => s.id === `loyalty:${unique}:${threshold}`)!);
      const all = (first.trigger as { all: unknown[] }).all as Record<string, unknown>[];
      expect(all).toEqual(expect.arrayContaining([
        { loyalty: { unique, value: 50 } },
        { joinedDays: { unique, days: 7 } },
        { recovered: unique },
      ]));
      expect(all.some((x) => typeof x.flag === 'string' && x.flag.startsWith('story:'))).toBe(true);
      expect((later[0].trigger as { all: unknown[] }).all).toEqual(expect.arrayContaining([
        { loyalty: { unique, value: 120 } },
        { flag: `story:loyalty:${unique}:50` },
      ]));
      expect((later[1].trigger as { all: unknown[] }).all).toEqual(expect.arrayContaining([
        { loyalty: { unique, value: 255 } },
        { flag: `story:loyalty:${unique}:120` },
      ]));
    }
  });

  it('人物ごとの口調の目印が会話にある', () => {
    const text = (unique: string) => LOYALTY_STORIES.filter((s) => s.id.startsWith(`loyalty:${unique}:`)).flatMap((s) => s.lines.map((l) => l.text)).join('\n');
    expect(text('tina')).toContain('あたし');
    expect(text('sera')).toContain('セラ');
    expect(text('viola')).toContain('あなた');
    expect(text('ruu')).toContain('ボク');
    expect(text('fine')).toContain('お姉さん');
    expect(text('aurelia')).toContain('我');
  });
});
