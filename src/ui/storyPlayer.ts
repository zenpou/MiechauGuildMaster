// 紙芝居プレイヤー。前作(GuildQuest)から持ち込み、人物・絵の引き当てを cast.json・art.json に移した。
// 絵が未配置(null)か読み込みに失敗したときは仮の見た目(背景のグラデーション・シルエットカード・地の色)を出す
import {
  backgroundArt,
  castMember,
  characterArt,
  characterFace,
  figureDisplay,
  linePortrait,
  MOTIONS,
  POSITIONS,
  speakerCharacter,
  stillArt,
  type CharacterId,
  type CharacterPose,
  type PresentedLine,
  type StageActor,
} from '../core/presentation';
import { createStoryAudio, type StoryAudioController } from './storyAudio';
import './storyPlayer.css';

export interface CreateStoryPlayerOptions {
  id: string;
  title: string;
  lines: PresentedLine[];
  onClose: () => void;
}

export interface StoryPlayer {
  element: HTMLElement;
  dispose(): void;
}

const PLAYER_COUNTER = { value: 0 };
const STORY_MOTION_KEY = 'miechau_story_motion_enabled_v1';
const MOTION_CLASSES = MOTIONS.map((motion) => `is-motion-${motion}` as const);
const FALLBACK_COLOR = '#8e7650';

type Slot = {
  figure: HTMLElement;
  motion: HTMLElement;
  image: HTMLImageElement;
  card: HTMLElement;
  pose: HTMLElement;
  name: HTMLElement;
};

type StillView = {
  image: HTMLImageElement;
  fallback: HTMLElement;
};

type TextCueState = {
  supplied: boolean;
  valid: boolean;
  end: number;
  reached: boolean;
  consumed: boolean;
};

type ActorCueState = {
  actor: StageActor;
  key: string;
  cue: TextCueState;
};

type LineCueState = {
  index: number;
  line: PresentedLine;
  text: string;
  mode: 'initial' | 'forward' | 'back';
  stageReady: boolean;
  effect?: TextCueState;
  sfx?: TextCueState;
  actors: ActorCueState[];
};

const baseUrl = (): string => {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base : `${base}/`;
};

/** art.json の値は public/art/ からの相対パス */
export const artUrl = (path: string): string => `${baseUrl()}art/${path}`;

const makeTextCue = (
  anchor: string | undefined,
  text: string,
  supplied = anchor !== undefined,
): TextCueState => {
  if (!supplied) return { supplied: false, valid: true, end: 0, reached: false, consumed: false };
  const start = typeof anchor === 'string' && anchor.length > 0 ? text.indexOf(anchor) : -1;
  return {
    supplied: true,
    valid: start >= 0,
    end: start >= 0 ? start + (anchor as string).length : 0,
    reached: false,
    consumed: false,
  };
};

const readMotionSetting = (): boolean => {
  try {
    const value = globalThis.localStorage?.getItem(STORY_MOTION_KEY);
    return value === null || value === '1' || value === 'true';
  } catch {
    return true;
  }
};

const writeMotionSetting = (enabled: boolean): void => {
  try {
    globalThis.localStorage?.setItem(STORY_MOTION_KEY, enabled ? '1' : '0');
  } catch {
    // プライベートブラウズなどで保存できなくても、物語は先へ進める
  }
};

const make = <T extends keyof HTMLElementTagNameMap>(tag: T, className?: string): HTMLElementTagNameMap[T] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
};

const button = (label: string, className?: string): HTMLButtonElement => {
  const element = make('button', className);
  element.type = 'button';
  element.textContent = label;
  return element;
};

function normalizedActors(line: PresentedLine): StageActor[] {
  const used = new Set<string>();
  const out: StageActor[] = [];
  for (const actor of line.cast ?? []) {
    if (out.length >= POSITIONS.length || used.has(actor.character)) continue;
    const requested = POSITIONS.includes(actor.position) ? actor.position : undefined;
    const position = requested && !out.some((item) => item.position === requested)
      ? requested
      : POSITIONS.find((item) => !out.some((current) => current.position === item));
    if (!position) break;
    used.add(actor.character);
    const normalized: StageActor = {
      character: actor.character,
      pose: actor.pose,
      position,
      motion: actor.motion,
    };
    if (Object.prototype.hasOwnProperty.call(actor, 'motionAt')) normalized.motionAt = actor.motionAt;
    out.push(normalized);
  }
  return out;
}

/** cast.json に無い人物は id のまま出す。差し替えの途中で台本とキャストが食い違っても止めない */
const characterName = (id: CharacterId): string => castMember(id)?.name ?? id;
const characterColor = (id: CharacterId): string => castMember(id)?.color ?? FALLBACK_COLOR;

/** 枠の inline style に置くので、場面の写し(cloneNode)にも同じ収め方が写る */
const applyFigureDisplay = (figure: HTMLElement, id: CharacterId | null, pose: CharacterPose): void => {
  const display = id === null ? null : figureDisplay(id, pose);
  const set = (name: string, value: number | undefined) => {
    if (value === undefined) figure.style.removeProperty(name);
    else figure.style.setProperty(name, String(value));
  };
  set('--vn-figure-scale', display?.scale);
  set('--vn-figure-top', display?.top);
};

/**
 * 1つの章を演じる。外枠と舞台の枠は最初に一度だけ作り、行の移動では文字・属性・表示だけを変える。
 * 親の描き直しのたびに作り直すと、タイプライターと効果音が頭から始まってしまう
 */
export function createStoryPlayer(options: CreateStoryPlayerOptions): StoryPlayer {
  const { id, title, lines, onClose } = options;
  const root = make('section', 'vn-player');
  root.dataset.storyId = id;
  root.dataset.dialogueHidden = 'false';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', title);

  const cleanups: (() => void)[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  let closed = false;
  let currentIndex = lines.length ? 0 : -1;
  let visibleChars = 0;
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let transitionSnapshot: HTMLElement | undefined;
  let visualRevision = 0;
  const visualCleanupTimers = new Set<ReturnType<typeof setTimeout>>();
  let dialogueHidden = false;
  let historyOpen = false;
  let requestedMotionEnabled = readMotionSetting();
  const motionPreference = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : undefined;
  let prefersReducedMotion = Boolean(motionPreference?.matches);
  const playedCueIndices = new Set<number>();
  let lineCueState: LineCueState | undefined;
  let progressionGestureSeen = false;
  const audio: StoryAudioController = createStoryAudio();

  const listen = <T extends EventTarget>(target: T, event: string, handler: EventListener): void => {
    target.addEventListener(event, handler);
    cleanups.push(() => target.removeEventListener(event, handler));
  };

  const top = make('header', 'vn-player-top');
  const titleElement = make('h2', 'vn-player-title');
  titleElement.textContent = title;
  const progress = make('span', 'vn-player-progress');
  const closeButton = button('スキップ', 'vn-player-close');
  top.append(titleElement, progress, closeButton);

  const toolbar = make('div', 'vn-player-toolbar');
  const historyButton = button('会話履歴', 'vn-player-tool-button');
  historyButton.dataset.storyHistoryToggle = '';
  historyButton.setAttribute('aria-expanded', 'false');
  const stageButton = button('台詞を隠す', 'vn-player-tool-button');
  stageButton.dataset.storyStageToggle = '';
  stageButton.setAttribute('aria-pressed', 'false');
  const motionButton = button('演出ON', 'vn-player-tool-button vn-player-motion-toggle');
  motionButton.dataset.storyMotionToggle = '';
  motionButton.setAttribute('aria-pressed', 'true');
  motionButton.setAttribute('aria-label', '演出を有効にする');

  PLAYER_COUNTER.value += 1;
  const controlId = `vn-player-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${PLAYER_COUNTER.value}`;
  const audioControls = make('fieldset', 'vn-player-audio');
  const audioLegend = make('legend');
  audioLegend.textContent = '音声設定';
  const muteLabel = make('label', 'vn-player-audio-mute');
  const muteInput = make('input');
  muteInput.type = 'checkbox';
  muteInput.id = `${controlId}-mute`;
  const muteText = make('span');
  muteLabel.htmlFor = muteInput.id;
  muteLabel.append(muteInput, muteText);
  const volumeLabel = make('label', 'vn-player-audio-volume');
  volumeLabel.htmlFor = `${controlId}-volume`;
  volumeLabel.textContent = '音量';
  const volumeInput = make('input');
  volumeInput.type = 'range';
  volumeInput.id = `${controlId}-volume`;
  volumeInput.min = '0';
  volumeInput.max = '1';
  volumeInput.step = '0.05';
  const volumeValue = make('output');
  volumeValue.htmlFor = volumeInput.id;
  audioControls.append(audioLegend, muteLabel, volumeLabel, volumeInput, volumeValue);
  toolbar.append(historyButton, stageButton, motionButton, audioControls);

  const stage = make('div', 'vn-player-stage');
  stage.dataset.storyStage = '';
  stage.setAttribute('aria-label', '舞台');
  const scene = make('div', 'vn-player-scene');
  const sceneContent = make('div', 'vn-player-scene-content');
  const backgroundImage = make('img', 'vn-player-background');
  backgroundImage.alt = '';
  backgroundImage.decoding = 'async';
  const backgroundFallback = make('span', 'vn-player-background-fallback');
  const characters = make('div', 'vn-player-characters');
  const slots: Slot[] = POSITIONS.map((position) => {
    const figure = make('figure', `vn-player-character vn-player-character-${position}`);
    figure.dataset.position = position;
    const motion = make('div', 'vn-player-character-motion');
    const image = make('img', 'vn-player-character-image');
    image.decoding = 'async';
    image.alt = '';
    image.draggable = false;
    // 立ち絵が無いあいだのシルエットカード。輪郭と影を cast.json の色で塗る
    const card = make('span', 'vn-player-character-card');
    card.setAttribute('aria-hidden', 'true');
    card.hidden = true;
    const pose = make('span', 'vn-player-card-pose');
    card.append(make('span', 'vn-player-card-head'), make('span', 'vn-player-card-body'), pose);
    const name = make('figcaption', 'vn-player-character-name');
    motion.append(image, card, name);
    figure.append(motion);
    characters.append(figure);
    return { figure, motion, image, card, pose, name };
  });
  const stillView: StillView = {
    image: make('img', 'vn-player-still'),
    fallback: make('span', 'vn-player-still-fallback'),
  };
  stillView.image.decoding = 'async';
  stillView.image.hidden = true;
  stillView.fallback.hidden = true;
  const flash = make('span', 'vn-player-flash');
  flash.setAttribute('aria-hidden', 'true');
  const blackout = make('span', 'vn-player-blackout');
  blackout.setAttribute('aria-hidden', 'true');
  sceneContent.append(backgroundImage, backgroundFallback, characters, stillView.image, stillView.fallback);
  scene.append(sceneContent);
  stage.append(scene, flash, blackout);

  const dialogue = make('section', 'vn-player-dialogue');
  dialogue.setAttribute('aria-label', '台詞');
  const portrait = make('div', 'vn-player-portrait');
  portrait.dataset.storyPortrait = '';
  portrait.hidden = true;
  portrait.setAttribute('aria-hidden', 'true');
  const portraitImage = make('img', 'vn-player-portrait-image');
  portraitImage.decoding = 'async';
  portraitImage.alt = '';
  portraitImage.hidden = true;
  portraitImage.draggable = false;
  const portraitFallback = make('span', 'vn-player-portrait-fallback');
  portraitFallback.hidden = true;
  portrait.append(portraitImage, portraitFallback);
  const speaker = make('div', 'vn-player-speaker');
  speaker.hidden = true;
  const lineText = make('p', 'vn-player-line');
  // 打ち出し中の段落は読み上げない。1文字ずつ読まれないよう、全文が出たら下の要素で一度に知らせる
  lineText.setAttribute('aria-hidden', 'true');
  const lineAnnouncement = make('span', 'vn-player-line-announcement');
  lineAnnouncement.setAttribute('aria-live', 'polite');
  lineAnnouncement.setAttribute('aria-atomic', 'true');
  const typingHint = make('span', 'vn-player-typing-hint');
  dialogue.append(portrait, speaker, lineText, lineAnnouncement, typingHint);

  const history = make('section', 'vn-player-history');
  history.hidden = true;
  history.setAttribute('aria-label', '会話履歴');
  const historyTitle = make('h3');
  historyTitle.textContent = '会話履歴';
  const historyList = make('ol');
  const historyRows = lines.map((line, index) => {
    const row = make('li', 'vn-player-history-row');
    row.dataset.line = String(index);
    const rowSpeaker = make('b', 'vn-player-history-speaker');
    rowSpeaker.textContent = line.speaker || '物語';
    const rowText = make('span', 'vn-player-history-text');
    rowText.textContent = line.text;
    row.append(rowSpeaker, rowText);
    historyList.append(row);
    return row;
  });
  history.append(historyTitle, historyList);

  const navigation = make('nav', 'vn-player-navigation');
  const backButton = button('← 前へ', 'vn-player-back');
  backButton.dataset.storyBack = '';
  const nextButton = button('全文を表示', 'vn-player-next');
  nextButton.dataset.storyNext = '';
  navigation.append(backButton, nextButton);
  root.append(top, toolbar, stage, dialogue, history, navigation);

  // 一度失敗した絵は、同じパスの行が続いても読み直さずに仮の見た目のままにする
  const showFallback = (image: HTMLImageElement, fallback: HTMLElement) => {
    image.hidden = true;
    fallback.hidden = false;
  };
  const showArt = (image: HTMLImageElement, fallback: HTMLElement, path: string | null) => {
    if (path === null) {
      image.removeAttribute('src');
      delete image.dataset.src;
      showFallback(image, fallback);
      return;
    }
    const src = artUrl(path);
    image.dataset.src = src;
    if (image.dataset.failed === src) {
      showFallback(image, fallback);
      return;
    }
    image.hidden = false;
    fallback.hidden = true;
    if (image.getAttribute('src') !== src) image.src = src;
  };
  const watchArt = (image: HTMLImageElement, fallback: HTMLElement) => {
    listen(image, 'load', () => {
      if (image.getAttribute('src') !== image.dataset.src) return;
      image.hidden = false;
      fallback.hidden = true;
    });
    listen(image, 'error', () => {
      const src = image.getAttribute('src');
      if (!src || src !== image.dataset.src) return;
      image.dataset.failed = src;
      showFallback(image, fallback);
    });
  };
  watchArt(backgroundImage, backgroundFallback);
  watchArt(stillView.image, stillView.fallback);
  for (const slot of slots) watchArt(slot.image, slot.card);
  watchArt(portraitImage, portraitFallback);

  const updateAudioControls = () => {
    const settings = audio.settings;
    muteInput.checked = settings.muted;
    muteText.textContent = settings.muted ? 'ミュート中' : '音声ON';
    volumeInput.value = String(settings.volume);
    volumeValue.value = `${Math.round(settings.volume * 100)}%`;
    volumeValue.textContent = `${Math.round(settings.volume * 100)}%`;
    volumeInput.setAttribute('aria-label', `音量 ${Math.round(settings.volume * 100)}%`);
  };
  updateAudioControls();

  const motionIsEnabled = (): boolean => requestedMotionEnabled && !prefersReducedMotion;

  const updateMotionControl = () => {
    const enabled = motionIsEnabled();
    motionButton.textContent = enabled ? '演出ON' : '演出OFF';
    motionButton.setAttribute('aria-pressed', String(enabled));
    motionButton.setAttribute('aria-label', enabled ? '演出を無効にする' : '演出を有効にする');
    motionButton.title = prefersReducedMotion && requestedMotionEnabled
      ? 'システム設定により演出を抑えています'
      : enabled ? '演出を無効にする' : '演出を有効にする';
  };
  updateMotionControl();

  const stopTyping = () => {
    if (typingTimer !== undefined) {
      clearTimeout(typingTimer);
      timers.delete(typingTimer);
      typingTimer = undefined;
    }
  };

  const clearActorMotions = () => {
    for (const slot of slots) {
      slot.motion.classList.remove(...MOTION_CLASSES);
      delete slot.motion.dataset.motion;
    }
  };

  const removeTransitionSnapshot = () => {
    transitionSnapshot?.remove();
    transitionSnapshot = undefined;
  };

  const clearVisualCleanupTimers = () => {
    for (const timer of visualCleanupTimers) {
      clearTimeout(timer);
      timers.delete(timer);
    }
    visualCleanupTimers.clear();
  };

  const stopStageEffect = () => {
    clearVisualCleanupTimers();
    stage.classList.remove('is-fade', 'is-wipe', 'is-blackout', 'is-shake', 'is-flash', 'is-impact');
    scene.classList.remove('is-reveal-fade', 'is-reveal-wipe');
    sceneContent.classList.remove('is-effect-shake', 'is-effect-impact');
    flash.classList.remove('is-active', 'is-impact');
    blackout.classList.remove('is-active');
    delete stage.dataset.effectActive;
    clearActorMotions();
    removeTransitionSnapshot();
  };

  const snapshotClassNames: Record<string, string> = {
    'vn-player-scene-content': 'vn-player-transition-scene-content',
    'vn-player-characters': 'vn-player-transition-characters',
    'vn-player-character': 'vn-player-transition-character',
    'vn-player-character-motion': 'vn-player-transition-character-motion',
    'vn-player-character-image': 'vn-player-transition-character-image',
    'vn-player-character-card': 'vn-player-transition-character-card',
    'vn-player-character-name': 'vn-player-transition-character-name',
    'vn-player-background': 'vn-player-transition-background',
    'vn-player-background-fallback': 'vn-player-transition-background-fallback',
    'vn-player-still': 'vn-player-transition-still',
    'vn-player-still-fallback': 'vn-player-transition-still-fallback',
  };

  const sanitizeSnapshot = (node: HTMLElement, isRoot = false): void => {
    const originalClasses = [...node.classList];
    if (isRoot) {
      node.className = 'vn-player-scene-snapshot';
    } else {
      for (const className of originalClasses) {
        const replacement = snapshotClassNames[className];
        if (replacement) {
          node.classList.remove(className);
          node.classList.add(replacement);
        }
      }
    }
    for (const attribute of [...node.attributes]) {
      if (attribute.name.startsWith('data-') || attribute.name === 'id') node.removeAttribute(attribute.name);
    }
    node.removeAttribute('aria-label');
    node.setAttribute('aria-hidden', 'true');
    // 画像の src は残す。消すと去っていく場面の絵の大きさが崩れる
    if (node instanceof HTMLImageElement) node.alt = '';
    for (const child of [...node.children]) {
      if (child instanceof HTMLElement) sanitizeSnapshot(child);
    }
  };

  const captureSceneSnapshot = (): HTMLElement => {
    const snapshot = scene.cloneNode(true) as HTMLElement;
    sanitizeSnapshot(snapshot, true);
    snapshot.classList.add(`vn-player-transition-cast-${stage.dataset.castCount ?? '0'}`);
    snapshot.style.background = getComputedStyle(stage).background;
    return snapshot;
  };

  const cancelVisuals = () => {
    visualRevision += 1;
    stopStageEffect();
  };

  const scheduleVisualCleanup = (duration: number, cleanup: () => void) => {
    const revision = visualRevision;
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      timers.delete(timer);
      visualCleanupTimers.delete(timer);
      if (revision !== visualRevision || disposed || closed) return;
      cleanup();
    }, duration);
    visualCleanupTimers.add(timer);
    timers.add(timer);
  };

  const updateHistory = () => {
    for (const [index, row] of historyRows.entries()) {
      row.hidden = index > currentIndex;
      row.classList.toggle('is-current', index === currentIndex);
    }
    historyButton.textContent = currentIndex >= 0 ? `会話履歴 (${currentIndex + 1})` : '会話履歴';
  };

  const triggerActorMotion = (cue: ActorCueState): void => {
    if (cue.cue.consumed || cue.cue.reached === false || !motionIsEnabled()) return;
    const slot = slots.find((candidate) => candidate.figure.dataset.position === cue.actor.position);
    if (!slot || !cue.actor.motion) {
      cue.cue.consumed = true;
      return;
    }
    cue.cue.consumed = true;
    // 同じ動きが続く行でも動かし直せるよう、外したクラスを一度確定させてから付け直す
    void slot.motion.offsetWidth;
    slot.motion.dataset.motion = cue.actor.motion;
    slot.motion.classList.add(`is-motion-${cue.actor.motion}`);
    const motion = cue.actor.motion;
    scheduleVisualCleanup(620, () => {
      // 退場した人物は次の行で updateStage が出し直すまで伏せる。クラスを残すだけだと、
      // 演出OFFや次の行の場面の写し(クラス名が替わる)で元の位置に戻って見える
      if (motion === 'spin-out') slot.figure.hidden = true;
      slot.motion.classList.remove(`is-motion-${motion}`);
      if (slot.motion.dataset.motion === motion) delete slot.motion.dataset.motion;
    });
  };

  const applyActorMotion = (animate: boolean) => {
    clearActorMotions();
    const state = lineCueState;
    if (!animate || !motionIsEnabled() || !state) return;
    for (const cue of state.actors) {
      if (!cue.actor.motion || cue.cue.supplied) continue;
      cue.cue.reached = true;
      triggerActorMotion(cue);
    }
  };

  const applyStageTransition = (line: PresentedLine, animate: boolean, mode: 'initial' | 'forward' | 'back') => {
    const transition = line.transition ?? 'cut';
    stage.dataset.transition = transition;
    if (!animate || !motionIsEnabled()) return;

    // 新しい舞台の属性と絵を確定させてから遷移を始める
    void stage.offsetWidth;
    if (mode === 'initial') {
      if (transition === 'fade') {
        scene.classList.add('is-reveal-fade');
        scheduleVisualCleanup(540, () => scene.classList.remove('is-reveal-fade'));
      }
      if (transition === 'wipe') {
        scene.classList.add('is-reveal-wipe');
        scheduleVisualCleanup(640, () => scene.classList.remove('is-reveal-wipe'));
      }
    } else if (transition === 'fade' && transitionSnapshot) {
      const snapshot = transitionSnapshot;
      snapshot.classList.add('is-transition-fade');
      scheduleVisualCleanup(540, () => {
        snapshot.remove();
        if (transitionSnapshot === snapshot) transitionSnapshot = undefined;
      });
    } else if (transition === 'wipe' && transitionSnapshot) {
      const snapshot = transitionSnapshot;
      snapshot.classList.add('is-transition-wipe');
      scheduleVisualCleanup(640, () => {
        snapshot.remove();
        if (transitionSnapshot === snapshot) transitionSnapshot = undefined;
      });
    }
    if (transition === 'blackout') {
      stage.classList.add('is-blackout');
      blackout.classList.add('is-active');
      const snapshot = transitionSnapshot;
      // 暗転が濃いうちに前の場面を外す。暗転が明けてから外すと、最後に前の場面が透けて見える
      if (snapshot) {
        scheduleVisualCleanup(400, () => {
          snapshot.remove();
          if (transitionSnapshot === snapshot) transitionSnapshot = undefined;
        });
      }
      scheduleVisualCleanup(720, () => {
        stage.classList.remove('is-blackout');
        blackout.classList.remove('is-active');
      });
    }
  };

  const triggerStageEffect = (line: PresentedLine): void => {
    if (!line.effect || !motionIsEnabled()) return;
    stage.dataset.effectActive = line.effect;
    // 同じ効果の行が続いても、アニメーションを最初からやり直す
    void stage.offsetWidth;

    switch (line.effect) {
      case 'shake':
        stage.classList.add('is-shake');
        sceneContent.classList.add('is-effect-shake');
        break;
      case 'flash':
        stage.classList.add('is-flash');
        flash.classList.add('is-active');
        break;
      case 'impact':
        stage.classList.add('is-impact');
        sceneContent.classList.add('is-effect-impact');
        flash.classList.add('is-impact');
        break;
      default:
        break;
    }
    const effectDuration = line.effect === 'impact' ? 560 : line.effect === 'shake' ? 420 : line.effect === 'flash' ? 480 : 0;
    if (effectDuration > 0) {
      scheduleVisualCleanup(effectDuration + 80, () => {
        stage.classList.remove('is-shake', 'is-flash', 'is-impact');
        sceneContent.classList.remove('is-effect-shake', 'is-effect-impact');
        flash.classList.remove('is-active', 'is-impact');
        if (stage.dataset.effectActive === line.effect) delete stage.dataset.effectActive;
      });
    }
  };

  const applyStageEffect = (line: PresentedLine, animate: boolean, mode: 'initial' | 'forward' | 'back') => {
    stage.dataset.effect = line.effect ?? '';
    applyStageTransition(line, animate, mode);
    const state = lineCueState;
    if (!animate || !motionIsEnabled() || !state?.effect || state.effect.supplied) return;
    state.effect.reached = true;
    state.effect.consumed = true;
    triggerStageEffect(line);
  };

  const updateStage = (line: PresentedLine) => {
    const background = line.background ?? 'guild';
    stage.dataset.background = background;
    stage.dataset.mode = line.still ? 'still' : 'compose';
    backgroundFallback.textContent = `仮の背景 · ${background}`;
    showArt(backgroundImage, backgroundFallback, backgroundArt(background));
    characters.hidden = Boolean(line.still);
    if (line.still) {
      stillView.image.alt = `${title}の一枚絵`;
      stillView.fallback.textContent = `仮の一枚絵 · ${line.still}`;
      showArt(stillView.image, stillView.fallback, stillArt(line.still));
    } else {
      stillView.image.hidden = true;
      stillView.fallback.hidden = true;
      stillView.image.removeAttribute('src');
      delete stillView.image.dataset.src;
    }

    const speakerId = speakerCharacter(line.speaker);
    // 顔だけで出る人物は立ち絵に重ねない。残りの人物の位置は台本のまま
    const portraitCharacter = line.portrait?.character;
    const actors = normalizedActors(line).filter((actor) => actor.character !== portraitCharacter);
    stage.dataset.castCount = String(actors.length);
    const actorsByPosition = new Map(actors.map((actor) => [actor.position, actor]));
    slots.forEach((slot, slotIndex) => {
      const actor = actorsByPosition.get(POSITIONS[slotIndex]);
      if (!actor) {
        slot.figure.hidden = true;
        slot.figure.dataset.character = '';
        slot.figure.dataset.pose = '';
        slot.figure.dataset.motion = '';
        slot.motion.dataset.motion = '';
        applyFigureDisplay(slot.figure, null, '');
        slot.image.removeAttribute('src');
        delete slot.image.dataset.src;
        return;
      }
      const name = characterName(actor.character);
      slot.figure.hidden = false;
      slot.figure.dataset.character = actor.character;
      slot.figure.dataset.pose = actor.pose;
      slot.figure.dataset.motion = actor.motion ?? '';
      slot.figure.style.setProperty('--vn-cast-color', characterColor(actor.character));
      applyFigureDisplay(slot.figure, actor.character, actor.pose);
      // data-motion は動きが始まった印。motionAt のある動きは、その語句が出るまで空のままにする
      delete slot.motion.dataset.motion;
      slot.figure.classList.toggle('is-speaker', Boolean(speakerId && actor.character === speakerId));
      slot.figure.classList.toggle('is-listener', Boolean(speakerId && actor.character !== speakerId));
      slot.image.alt = `${name}(${actor.pose})`;
      slot.pose.textContent = actor.pose;
      slot.name.textContent = name;
      showArt(slot.image, slot.card, characterArt(actor.character, actor.pose));
    });
    stageButton.textContent = dialogueHidden ? '台詞を表示' : '台詞を隠す';
  };

  const updatePortrait = (line: PresentedLine) => {
    const data = linePortrait(line);
    dialogue.classList.toggle('has-portrait', Boolean(data));
    portrait.hidden = !data;
    if (!data) {
      portraitImage.hidden = true;
      portraitImage.removeAttribute('src');
      delete portraitImage.dataset.src;
      portraitImage.classList.remove('is-crop');
      portraitImage.alt = '';
      portraitFallback.hidden = true;
      portraitFallback.textContent = '';
      delete portrait.dataset.portraitCharacter;
      delete portrait.dataset.portraitPose;
      return;
    }
    const name = characterName(data.character);
    portrait.dataset.portraitCharacter = data.character;
    portrait.dataset.portraitPose = data.pose;
    portrait.style.setProperty('--vn-cast-color', characterColor(data.character));
    portraitImage.alt = `${name}の表情`;
    portraitFallback.textContent = name.slice(0, 1);
    const face = characterFace(data.character, data.pose);
    portraitImage.classList.toggle('is-crop', face?.crop === true);
    showArt(portraitImage, portraitFallback, face?.path ?? null);
  };

  const createLineCueState = (index: number, line: PresentedLine, text: string, mode: 'initial' | 'forward' | 'back'): LineCueState => {
    const portraitCharacter = line.portrait?.character;
    const actors = normalizedActors(line)
      .filter((actor) => actor.character !== portraitCharacter && Boolean(actor.motion))
      .map((actor) => ({
        actor,
        key: `${actor.position}:${actor.character}`,
        cue: makeTextCue(actor.motionAt, text, Object.prototype.hasOwnProperty.call(actor, 'motionAt')),
      }));
    return {
      index,
      line,
      text,
      mode,
      stageReady: false,
      effect: line.effect ? makeTextCue(line.effectAt, text, Object.prototype.hasOwnProperty.call(line, 'effectAt')) : undefined,
      sfx: line.sfx ? makeTextCue(line.sfxAt, text, Object.prototype.hasOwnProperty.call(line, 'sfxAt')) : undefined,
      actors,
    };
  };

  const consumePendingVisualCues = () => {
    const state = lineCueState;
    if (!state) return;
    if (state.effect && !state.effect.reached) state.effect.consumed = true;
    for (const actor of state.actors) {
      if (!actor.cue.reached) actor.cue.consumed = true;
    }
  };

  const playCueOnce = (index: number, line: PresentedLine | undefined): boolean => {
    if (!line?.sfx || playedCueIndices.has(index)) return false;
    // 鳴らす前に使用済みにする。ミュート中も使い切り、後で音を入れたときに古い場面の音を鳴らさない
    playedCueIndices.add(index);
    audio.play(line.sfx);
    return true;
  };

  const processTextCues = () => {
    const state = lineCueState;
    if (!state || !state.stageReady || state.mode === 'back') return;
    const reached = (cue: TextCueState): boolean => cue.valid && visibleChars >= cue.end;

    if (state.effect && !state.effect.reached && reached(state.effect)) {
      state.effect.reached = true;
      if (!state.effect.consumed && motionIsEnabled()) {
        state.effect.consumed = true;
        triggerStageEffect(state.line);
      } else {
        state.effect.consumed = true;
      }
    }
    for (const actor of state.actors) {
      if (!actor.cue.reached && reached(actor.cue)) {
        actor.cue.reached = true;
        if (!actor.cue.consumed && motionIsEnabled()) triggerActorMotion(actor);
        else actor.cue.consumed = true;
      }
    }
    if (state.sfx && reached(state.sfx)) {
      if (!state.sfx.reached) state.sfx.reached = true;
      // 最初の行は操作より前に打ち出しが始まる。タイマーから AudioContext を作ると自動再生制限に掛かるので、
      // 届いた印だけ残し、最初の操作で鳴らす
      if (!state.sfx.consumed && (state.mode !== 'initial' || progressionGestureSeen)) {
        state.sfx.consumed = true;
        playCueOnce(state.index, state.line);
      }
    }
  };

  const updateText = (text: string) => {
    const shown = text.slice(0, visibleChars);
    const last = currentIndex >= lines.length - 1;
    lineText.textContent = shown || ' ';
    lineAnnouncement.textContent = visibleChars >= text.length ? text : '';
    typingHint.textContent = visibleChars < text.length ? 'クリックで全文を表示' : (last ? 'クリックで閉じる' : 'クリックで次へ');
    nextButton.textContent = visibleChars < text.length ? '全文を表示' : (last ? '閉じる' : '次へ →');
    processTextCues();
  };

  const typeNext = (text: string) => {
    stopTyping();
    if (visibleChars >= text.length) return;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      timers.delete(timer);
      if (typingTimer === timer) typingTimer = undefined;
      if (disposed || closed) return;
      visibleChars = Math.min(text.length, visibleChars + 1);
      updateText(text);
      if (visibleChars < text.length) {
        timer = setTimeout(advance, 24);
        typingTimer = timer;
        timers.add(timer);
      }
    };
    timer = setTimeout(advance, 24);
    typingTimer = timer;
    timers.add(timer);
  };

  const renderLine = (index: number, mode: 'initial' | 'forward' | 'back') => {
    if (disposed || closed) return;
    currentIndex = lines.length ? Math.max(0, Math.min(index, lines.length - 1)) : -1;
    const line = currentIndex >= 0 ? lines[currentIndex] : undefined;
    stopTyping();
    cancelVisuals();
    root.classList.toggle('is-motion-static', mode === 'back' || !motionIsEnabled());
    if (!line) {
      lineCueState = undefined;
      progress.textContent = '0 / 0';
      speaker.hidden = true;
      lineText.textContent = '台詞がありません。';
      lineAnnouncement.textContent = '台詞がありません。';
      typingHint.textContent = '「閉じる」で戻ります';
      nextButton.textContent = '閉じる';
      backButton.disabled = true;
      updateHistory();
      return;
    }
    progress.textContent = `${currentIndex + 1} / ${lines.length}`;
    const speakerText = line.speaker ?? '';
    speaker.textContent = speakerText;
    speaker.hidden = !speakerText;
    const text = line.text;
    lineCueState = createLineCueState(currentIndex, line, text, mode);
    const animate = mode !== 'back' && motionIsEnabled();
    if (animate && mode === 'forward' && (line.transition === 'fade' || line.transition === 'wipe' || line.transition === 'blackout')) {
      transitionSnapshot = captureSceneSnapshot();
      stage.insertBefore(transitionSnapshot, scene);
    }
    updateStage(line);
    updatePortrait(line);
    lineCueState.stageReady = true;
    if (mode === 'back' || !motionIsEnabled()) consumePendingVisualCues();
    applyStageEffect(line, animate, mode);
    applyActorMotion(animate);
    visibleChars = mode === 'back' ? text.length : Math.min(1, text.length);
    updateText(text);
    if (mode !== 'back') typeNext(text);
    updateHistory();
    backButton.disabled = dialogueHidden || currentIndex <= 0;
    if (mode === 'forward' && !Object.prototype.hasOwnProperty.call(line, 'sfxAt')) {
      const state = lineCueState;
      if (state?.sfx) {
        state.sfx.reached = true;
        state.sfx.consumed = true;
      }
      playCueOnce(currentIndex, line);
    }
  };

  const close = () => {
    if (closed) return;
    closed = true;
    dispose();
    onClose();
  };

  const advance = () => {
    if (closed || disposed) return;
    progressionGestureSeen = true;
    audio.activate();
    const line = currentIndex >= 0 ? lines[currentIndex] : undefined;
    const text = line ? line.text : '';
    processTextCues();
    // 最初の行は操作の前に描くので、その効果音は最初の操作で一度だけ鳴らす。2行目からは行に入ったときに鳴る
    if (currentIndex === 0 && line && !Object.prototype.hasOwnProperty.call(line, 'sfxAt')) {
      const state = lineCueState;
      if (state?.sfx) {
        state.sfx.reached = true;
        state.sfx.consumed = true;
      }
      playCueOnce(currentIndex, line);
    }
    if (visibleChars < text.length) {
      stopTyping();
      visibleChars = text.length;
      updateText(text);
      return;
    }
    if (currentIndex < 0 || currentIndex >= lines.length - 1) close();
    else renderLine(currentIndex + 1, 'forward');
  };

  const goBack = () => {
    if (closed || disposed || currentIndex <= 0) return;
    stopTyping();
    renderLine(currentIndex - 1, 'back');
  };

  listen(closeButton, 'click', (event) => { event.stopPropagation(); close(); });
  listen(nextButton, 'click', (event) => { event.stopPropagation(); advance(); });
  listen(backButton, 'click', (event) => { event.stopPropagation(); goBack(); });
  listen(motionButton, 'click', (event) => {
    event.stopPropagation();
    requestedMotionEnabled = !requestedMotionEnabled;
    writeMotionSetting(requestedMotionEnabled);
    updateMotionControl();
    root.classList.toggle('is-motion-static', !motionIsEnabled());
    if (!motionIsEnabled()) {
      consumePendingVisualCues();
      cancelVisuals();
    }
  });
  listen(stage, 'click', (event) => {
    if (dialogueHidden) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, input, label')) return;
    advance();
  });
  listen(dialogue, 'click', (event) => {
    if (event.target instanceof HTMLElement && event.target.closest('button, input, label')) return;
    advance();
  });
  listen(historyButton, 'click', (event) => {
    event.stopPropagation();
    historyOpen = !historyOpen;
    history.hidden = !historyOpen;
    historyButton.setAttribute('aria-expanded', String(historyOpen));
  });
  listen(stageButton, 'click', (event) => {
    event.stopPropagation();
    dialogueHidden = !dialogueHidden;
    root.classList.toggle('is-dialogue-hidden', dialogueHidden);
    root.dataset.dialogueHidden = String(dialogueHidden);
    dialogue.hidden = dialogueHidden;
    navigation.hidden = dialogueHidden;
    nextButton.disabled = dialogueHidden;
    backButton.disabled = dialogueHidden || currentIndex <= 0;
    stageButton.setAttribute('aria-pressed', String(dialogueHidden));
    stageButton.textContent = dialogueHidden ? '台詞を表示' : '台詞を隠す';
    if (dialogueHidden) {
      historyOpen = false;
      history.hidden = true;
      historyButton.setAttribute('aria-expanded', 'false');
    }
  });
  listen(muteInput, 'change', () => {
    audio.setMuted(muteInput.checked);
    if (!muteInput.checked) audio.activate();
    updateAudioControls();
  });
  listen(volumeInput, 'input', () => {
    audio.setVolume(Number(volumeInput.value));
    if (audio.settings.volume > 0 && !audio.settings.muted) audio.activate();
    updateAudioControls();
  });

  const handleMotionPreference = (event: Event) => {
    prefersReducedMotion = (event as MediaQueryListEvent).matches;
    updateMotionControl();
    root.classList.toggle('is-motion-static', !motionIsEnabled());
    if (!motionIsEnabled()) {
      consumePendingVisualCues();
      cancelVisuals();
    }
  };
  if (motionPreference && typeof motionPreference.addEventListener === 'function') {
    listen(motionPreference, 'change', handleMotionPreference);
  } else if (motionPreference) {
    const legacyPreference = motionPreference as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    legacyPreference.addListener?.(handleMotionPreference);
    cleanups.push(() => legacyPreference.removeListener?.(handleMotionPreference));
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    stopTyping();
    cancelVisuals();
    root.classList.add('is-motion-static');
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const cleanup of cleanups.splice(0)) cleanup();
    audio.dispose();
  };

  // 最初の行は、操作を受けるまで音を出さない
  renderLine(0, 'initial');

  return { element: root, dispose };
}
