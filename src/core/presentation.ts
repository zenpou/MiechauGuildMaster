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

/**
 * 立ち絵の収め方。scale は枠の高さに対する絵の高さの倍率、top は枠の高さに対する上端のずれ(負で上へ)、
 * width は舞台の幅に対する絵の最大の幅(0〜1。省略時は CSS の既定で、2人までは 0.5)。
 * 高さだけで決めると縦に広い窓で絵が舞台の幅を超えて左右が切れるので、幅の上限を別に持つ
 */
export interface FigureDisplay {
  scale?: number;
  top?: number;
  width?: number;
}

export interface CastMember {
  id: CharacterId;
  name: string;
  /** 立ち絵が無いあいだのシルエットの色 */
  color: string;
  poses: CharacterPose[];
  /** 無ければ CSS の既定。既定を TS に写すと、CSS と二重に持つことになる */
  display?: FigureDisplay;
  /** ポーズごとに display を上書きする。横長の絵(竜の姿)など、そのポーズだけ収め方が違うときに使う */
  poseDisplay?: Record<CharacterPose, FigureDisplay>;
}

/**
 * 人物1ポーズぶんの絵。文字列は立ち絵だけの旧形式で、顔は立ち絵から切り出して代用する。
 * 旧形式を残すのは、顔の絵が揃う前の人物も止めずに出すため
 */
export type CharacterArt = string | { image: string; face: string } | null;

/** 絵の置き場所。値は public/art/ からの相対パス。null のあいだは画面が仮の見た目を出す */
export interface ArtManifest {
  backgrounds: Record<BackgroundId, string | null>;
  characters: Record<CharacterId, Record<CharacterPose, CharacterArt>>;
  stills: Record<string, string | null>;
}

/** 台詞枠の横に出す顔。explicit は台本の portrait で指定した顔で、その人物を立ち絵に重ねない */
export interface LinePortrait {
  character: CharacterId;
  pose: CharacterPose;
  explicit: boolean;
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

/** 人物の display にポーズの poseDisplay を重ねる。どちらも無ければ null */
export function figureDisplay(id: CharacterId, pose: CharacterPose): FigureDisplay | null {
  const member = castMember(id);
  const base = member?.display;
  const override = member?.poseDisplay?.[pose];
  if (!base && !override) return null;
  return { ...base, ...override };
}

export function backgroundArt(id: BackgroundId): string | null {
  return ART.backgrounds[id] ?? null;
}

export function characterArt(id: CharacterId, pose: CharacterPose): string | null {
  const art = ART.characters[id]?.[pose] ?? null;
  return typeof art === 'string' || art === null ? art : art.image;
}

/** 顔の絵。crop は立ち絵から切り出して代用するとき */
export function characterFace(id: CharacterId, pose: CharacterPose): { path: string; crop: boolean } | null {
  const art = ART.characters[id]?.[pose] ?? null;
  if (art === null) return null;
  return typeof art === 'string' ? { path: art, crop: true } : { path: art.face, crop: false };
}

/**
 * 台詞枠の横の顔を決める。portrait を書いた行はそれを使い、無ければ話し手の顔を出す。
 * 話し手の顔は舞台でのポーズに合わせ、舞台にいなければ neutral。顔の絵の無い話し手と地の文は出さない
 */
export function linePortrait(line: PresentedLine): LinePortrait | null {
  if (line.portrait) return { character: line.portrait.character, pose: line.portrait.pose, explicit: true };
  const id = speakerCharacter(line.speaker);
  if (id === null) return null;
  const pose = line.cast?.find((actor) => actor.character === id)?.pose ?? 'neutral';
  return characterFace(id, pose) ? { character: id, pose, explicit: false } : null;
}

export function stillArt(id: string): string | null {
  return ART.stills[id] ?? null;
}
