// 勘違いイベント: 行動タグ → 日送り時に抽選 → 噂として評判が上がる → 主人公の本音。
// 仕組みは前作 GuildQuest の移植。台詞はフェーズ4では仮。
import { MISUNDERSTANDINGS } from './data';
import { addRep } from './quests';
import type { Rng } from './rng';
import type { GameState, Scene } from './types';

/** 1日に出す勘違いの上限 */
const SCENES_PER_DAY = 1;

/** 日送りで呼ぶ。積まれたタグから未見の勘違いを1件引き、s.scenes の先頭に入れる。タグは空にする */
export function resolveScenes(s: GameState, rng: Rng): Scene | null {
  const tags = [...new Set(s.pendingTags)];
  // 評判の加算で rep_milestone が積まれ直すので、先に空にしておき翌日へ回す
  s.pendingTags = [];
  const out: Scene[] = [];
  for (const tag of tags) {
    if (out.length >= SCENES_PER_DAY) break;
    const pool = MISUNDERSTANDINGS.filter((m) => m.tag === tag && !s.seenScenes.includes(m.id));
    if (!pool.length) continue;
    const m = rng.pick(pool);
    const scene: Scene = { id: m.id, day: s.day, lines: [...m.scene], thought: m.thought, rep: m.rep };
    s.seenScenes.push(m.id);
    s.scenes.unshift(scene);
    addRep(s, m.rep);
    out.push(scene);
  }
  return out[0] ?? null;
}
