// 紙芝居の演出指定。画面・音・セーブの進み具合から独立させ、戻る・飛ばす・読み返しで同じ舞台を再現する。
// 人物と絵は cast.json・art.json から引く。前作のように人物IDを型に埋めると、キャストの差し替えでコードまで直すことになる
import artJson from '../data/art.json';
import castJson from '../data/cast.json';

/** 人物。cast.json の id */
export type CharacterId = string;
/** 表情。cast.json の poses の1つ */
export type CharacterPose = string;
/** 背景。art.json の backgrounds のキー */
export type BackgroundId = string;

export const POSITIONS = ['left', 'center', 'right'] as const;
export type StagePosition = typeof POSITIONS[number];
export const MOTIONS = ['enter-left', 'enter-right', 'jump', 'nod', 'shake', 'recoil', 'spin-out', 'hit', 'tremble'] as const;
export type CharacterMotion = typeof MOTIONS[number];
export const SOUND_CUES = ['paper', 'door', 'step', 'bow', 'chime', 'water', 'cup', 'slash', 'blow', 'roar', 'flame'] as const;
export type SoundCue = typeof SOUND_CUES[number];
export const EFFECTS = ['shake', 'flash', 'impact'] as const;
export type StageEffect = typeof EFFECTS[number];
export const TRANSITIONS = ['fade', 'cut', 'wipe', 'blackout'] as const;
export type StageTransition = typeof TRANSITIONS[number];

export interface StageActor {
  character: CharacterId;
  pose: CharacterPose;
  position: StagePosition;
  /** その行だけの動き */
  motion?: CharacterMotion;
  /** 本文がこの語句まで出たところで motion を始める */
  motionAt?: string;
}

export interface PresentedLine {
  /** 話し手(cast.json の name)。無ければ地の文 */
  speaker?: string;
  text: string;
  /** 行ごとに舞台を丸ごと書く。前の行の状態を引き継がせると、戻る・飛ばすで舞台が食い違う */
  background?: BackgroundId;
  cast?: StageActor[];
  /** 台詞枠の横に出す顔。立ち絵に出さず顔だけ見せたい人物に使う */
  portrait?: { character: CharacterId; pose: CharacterPose };
  /** この行だけ舞台を一枚絵に替える(art.json の stills のキー) */
  still?: string;
  sfx?: SoundCue;
  /** 本文がこの語句まで出たところで sfx を鳴らす */
  sfxAt?: string;
  effect?: StageEffect;
  /** 本文がこの語句まで出たところで effect を始める */
  effectAt?: string;
  transition?: StageTransition;
}

export interface CastMember {
  id: CharacterId;
  name: string;
  /** 立ち絵が無いあいだのシルエットの色 */
  color: string;
  poses: CharacterPose[];
}

/** 絵の置き場所。値は public/art/ からの相対パス。null のあいだは画面が仮の見た目を出す */
export interface ArtManifest {
  backgrounds: Record<BackgroundId, string | null>;
  characters: Record<CharacterId, Record<CharacterPose, string | null>>;
  stills: Record<string, string | null>;
}

export const CAST = castJson as unknown as CastMember[];
export const ART = artJson as unknown as ArtManifest;

const CAST_BY_ID = new Map(CAST.map((c) => [c.id, c]));

export function castMember(id: CharacterId): CastMember | undefined {
  return CAST_BY_ID.get(id);
}

/** 話し手の名前から人物を引く。地の文と cast.json に無い名前は null */
export function speakerCharacter(speaker?: string): CharacterId | null {
  if (!speaker) return null;
  return CAST.find((c) => c.name === speaker)?.id ?? null;
}

export function backgroundArt(id: BackgroundId): string | null {
  return ART.backgrounds[id] ?? null;
}

export function characterArt(id: CharacterId, pose: CharacterPose): string | null {
  return ART.characters[id]?.[pose] ?? null;
}

export function stillArt(id: string): string | null {
  return ART.stills[id] ?? null;
}
