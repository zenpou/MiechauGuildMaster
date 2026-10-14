// 紙芝居の効果音。音声ファイルを配らず Web Audio で鳴らす(オフラインでも同じ音が出る)
import type { SoundCue } from '../core/presentation';

/** ミュートと音量は別々に覚える。1つにまとめると、ミュートを解いたときに音量が戻らない */
export const STORY_AUDIO_VOLUME_KEY = 'miechau_story_audio_volume_v1';
export const STORY_AUDIO_MUTED_KEY = 'miechau_story_audio_muted_v1';

export interface StoryAudioSettings {
  volume: number;
  muted: boolean;
}

export interface StoryAudioController {
  readonly settings: StoryAudioSettings;
  /** 利用者の操作の中で呼ぶ。操作の前に AudioContext を作るとブラウザの自動再生制限に掛かる */
  activate(): void;
  setVolume(value: number): StoryAudioSettings;
  setMuted(value: boolean): StoryAudioSettings;
  play(cue: SoundCue): void;
  dispose(): void;
}

/** 1つの合成音。start と duration は秒、gain は主音量に掛ける前の大きさ */
export interface SoundPart {
  frequency: number;
  start: number;
  duration: number;
  gain: number;
  type: OscillatorType;
}

/** 効果音ごとの部品の表。鳴らし方の分岐に埋めると、語彙を足したのに音が無いことにテストで気づけない */
export const SOUND_PARTS: Record<SoundCue, readonly SoundPart[]> = {
  paper: [
    { frequency: 620, start: 0, duration: 0.06, gain: 0.06, type: 'triangle' },
    { frequency: 940, start: 0.045, duration: 0.08, gain: 0.045, type: 'triangle' },
  ],
  door: [
    { frequency: 150, start: 0, duration: 0.14, gain: 0.11, type: 'square' },
    { frequency: 95, start: 0.12, duration: 0.18, gain: 0.08, type: 'triangle' },
  ],
  step: [
    { frequency: 120, start: 0, duration: 0.09, gain: 0.09, type: 'triangle' },
    { frequency: 72, start: 0.045, duration: 0.1, gain: 0.06, type: 'sine' },
  ],
  bow: [
    { frequency: 440, start: 0, duration: 0.16, gain: 0.06, type: 'sine' },
    { frequency: 660, start: 0.08, duration: 0.22, gain: 0.05, type: 'sine' },
  ],
  chime: [
    { frequency: 880, start: 0, duration: 0.34, gain: 0.07, type: 'sine' },
    { frequency: 1320, start: 0.1, duration: 0.42, gain: 0.045, type: 'sine' },
  ],
  water: [
    { frequency: 260, start: 0, duration: 0.28, gain: 0.04, type: 'sine' },
    { frequency: 390, start: 0.08, duration: 0.35, gain: 0.035, type: 'triangle' },
    { frequency: 520, start: 0.19, duration: 0.3, gain: 0.025, type: 'sine' },
  ],
  cup: [
    { frequency: 300, start: 0, duration: 0.1, gain: 0.08, type: 'triangle' },
    { frequency: 520, start: 0.06, duration: 0.22, gain: 0.045, type: 'sine' },
  ],
  slash: [
    { frequency: 2400, start: 0, duration: 0.05, gain: 0.035, type: 'sawtooth' },
    { frequency: 1500, start: 0.025, duration: 0.07, gain: 0.045, type: 'sawtooth' },
    { frequency: 780, start: 0.06, duration: 0.12, gain: 0.04, type: 'triangle' },
  ],
  blow: [
    { frequency: 180, start: 0, duration: 0.05, gain: 0.07, type: 'square' },
    { frequency: 88, start: 0.01, duration: 0.14, gain: 0.12, type: 'square' },
    { frequency: 55, start: 0.03, duration: 0.24, gain: 0.1, type: 'sine' },
  ],
  roar: [
    { frequency: 62, start: 0, duration: 0.75, gain: 0.08, type: 'sawtooth' },
    { frequency: 93, start: 0.06, duration: 0.6, gain: 0.06, type: 'sawtooth' },
    { frequency: 41, start: 0.12, duration: 0.85, gain: 0.1, type: 'sine' },
  ],
  flame: [
    { frequency: 170, start: 0, duration: 0.45, gain: 0.045, type: 'sawtooth' },
    { frequency: 255, start: 0.07, duration: 0.4, gain: 0.035, type: 'square' },
    { frequency: 340, start: 0.15, duration: 0.36, gain: 0.03, type: 'sawtooth' },
    { frequency: 130, start: 0.22, duration: 0.4, gain: 0.04, type: 'triangle' },
  ],
};

type AudioContextConstructor = new () => AudioContext;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // プライベートブラウズなどで保存できなくても、物語は先へ進める
  }
}

function readVolume(): number {
  const raw = readStorage(STORY_AUDIO_VOLUME_KEY);
  const value = raw === null ? 0.65 : Number(raw);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.65;
}

/** 保存値の無い初回はミュートで始める。音は利用者が自分で入れたときだけ鳴らす */
function readMuted(volume: number): boolean {
  const raw = readStorage(STORY_AUDIO_MUTED_KEY);
  if (volume === 0) return true;
  if (raw === null) return true;
  return raw === '1' || raw === 'true';
}

export function createStoryAudio(): StoryAudioController {
  let volume = readVolume();
  let muted = readMuted(volume);
  let activated = false;
  let disposed = false;
  let context: AudioContext | null = null;
  let masterGain: GainNode | null = null;

  const settings = (): StoryAudioSettings => ({ volume, muted });

  const getContext = (): AudioContext | null => {
    if (disposed) return null;
    if (context) return context;
    const globals = globalThis as typeof globalThis & {
      AudioContext?: AudioContextConstructor;
      webkitAudioContext?: AudioContextConstructor;
    };
    const Context = globals.AudioContext ?? globals.webkitAudioContext;
    if (!Context) return null;
    try {
      context = new Context();
      masterGain = context.createGain();
      masterGain.gain.setValueAtTime(muted ? 0 : volume, context.currentTime);
      masterGain.connect(context.destination);
      return context;
    } catch {
      context = null;
      masterGain = null;
      return null;
    }
  };

  const updateMasterGain = (): void => {
    if (!context || !masterGain || context.state === 'closed') return;
    try {
      const at = context.currentTime;
      masterGain.gain.cancelScheduledValues(at);
      masterGain.gain.setValueAtTime(muted ? 0 : volume, at);
    } catch {
      // 閉じた・使えない AudioContext で物語を止めない
    }
  };

  const activate = (): void => {
    if (disposed || muted || volume <= 0) return;
    activated = true;
    const ctx = getContext();
    if (!ctx || ctx.state !== 'suspended') return;
    void ctx.resume().catch(() => {
      // 再開を断られても、絵と文は音と無関係に進む
    });
  };

  const setVolume = (value: number): StoryAudioSettings => {
    volume = clamp(Number.isFinite(value) ? value : 0, 0, 1);
    if (volume === 0) muted = true;
    writeStorage(STORY_AUDIO_VOLUME_KEY, String(volume));
    writeStorage(STORY_AUDIO_MUTED_KEY, muted ? '1' : '0');
    updateMasterGain();
    return settings();
  };

  const setMuted = (value: boolean): StoryAudioSettings => {
    // 音量 0 はミュートとして扱う。古い保存値が「ミュートでない」でも、0 のままでは鳴らない
    muted = Boolean(value) || volume === 0;
    writeStorage(STORY_AUDIO_MUTED_KEY, muted ? '1' : '0');
    updateMasterGain();
    return settings();
  };

  const tone = (ctx: AudioContext, frequency: number, at: number, duration: number, gainValue: number, type: OscillatorType = 'sine') => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    if (!masterGain) return;
    gain.connect(masterGain);
    oscillator.onended = () => {
      try { oscillator.disconnect(); } catch { /* 切断済み */ }
      try { gain.disconnect(); } catch { /* 切断済み */ }
    };
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  };

  const play = (cue: SoundCue): void => {
    if (disposed || !activated || muted || volume <= 0) return;
    const ctx = getContext();
    if (!ctx || ctx.state === 'closed') return;
    try {
      const at = ctx.currentTime + 0.005;
      for (const part of SOUND_PARTS[cue] ?? []) {
        tone(ctx, part.frequency, at + part.start, part.duration, part.gain, part.type);
      }
    } catch {
      // Web Audio が失敗しても、場面はそのまま読める
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    activated = false;
    const ctx = context;
    context = null;
    const gain = masterGain;
    masterGain = null;
    if (gain) {
      try { gain.disconnect(); } catch { /* 切断済み */ }
    }
    if (ctx) void ctx.close().catch(() => undefined);
  };

  return {
    get settings() { return settings(); },
    activate,
    setVolume,
    setMuted,
    play,
    dispose,
  };
}
