import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PERSONALITIES, UNIQUES } from '../src/core/data';
import { MAP_FACES, mapFaceAsset } from '../src/ui/mapFaceData';

describe('地図専用の顔アイコン', () => {
  it('全ユニークと汎用外見に、実在する専用透過素材を割り当てる', () => {
    const ids = [...UNIQUES.map(u => u.appearance),
      ...PERSONALITIES.flatMap(p => ['female', 'male'].map(g => `adv_${p.id}_${g}`))];
    for (const id of ids) {
      const asset = MAP_FACES[id];
      expect(asset, id).toBeDefined();
      expect(existsSync(`public/art/${asset.file}`), id).toBe(true);
      expect(asset.x).toBeGreaterThanOrEqual(0);
      expect(asset.y).toBeGreaterThanOrEqual(0);
      expect(asset.x + asset.size).toBeLessThanOrEqual(asset.atlasSize);
      expect(asset.y + asset.size).toBeLessThanOrEqual(asset.atlasSize);
    }
  });
  it('履歴に保存した外見を優先し、不明な顔は安全な代替表示に渡す', () => {
    expect(mapFaceAsset({ name: 'A', appearance: 'tina', unique: 'sera', personality: 'brave', gender: 'female' })).toBe(MAP_FACES.tina);
    expect(mapFaceAsset({ name: 'A', appearance: 'missing', personality: 'missing', gender: 'female' })).toBeUndefined();
  });
});
