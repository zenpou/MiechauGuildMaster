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
      switch (cue) {
        case 'paper':
          tone(ctx, 620, at, 0.06, 0.06, 'triangle');
          tone(ctx, 940, at + 0.045, 0.08, 0.045, 'triangle');
          break;
        case 'door':
          tone(ctx, 150, at, 0.14, 0.11, 'square');
          tone(ctx, 95, at + 0.12, 0.18, 0.08, 'triangle');
          break;
        case 'step':
          tone(ctx, 120, at, 0.09, 0.09, 'triangle');
          tone(ctx, 72, at + 0.045, 0.1, 0.06, 'sine');
          break;
        case 'bow':
          tone(ctx, 440, at, 0.16, 0.06, 'sine');
          tone(ctx, 660, at + 0.08, 0.22, 0.05, 'sine');
          break;
        case 'chime':
          tone(ctx, 880, at, 0.34, 0.07, 'sine');
          tone(ctx, 1320, at + 0.1, 0.42, 0.045, 'sine');
          break;
        case 'water':
          tone(ctx, 260, at, 0.28, 0.04, 'sine');
          tone(ctx, 390, at + 0.08, 0.35, 0.035, 'triangle');
          tone(ctx, 520, at + 0.19, 0.3, 0.025, 'sine');
          break;
        case 'cup':
          tone(ctx, 300, at, 0.1, 0.08, 'triangle');
          tone(ctx, 520, at + 0.06, 0.22, 0.045, 'sine');
          break;
        default:
          break;
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
