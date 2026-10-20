import { DUNGEON } from '../core/data';
import { exploredRate, parseFloor, visibleFrom, xy } from '../core/dungeon';
import { buildJourneyDayPlayback, journeyPlaybackDays, playbackSnapshotAt, type JourneyDayPlayback, type PlaybackSnapshot, isPlayableJourney } from '../core/journeyPlayback';
import type { Expedition, JourneyFrame, JourneyMember, JourneyRecord } from '../core/types';
import { div, h, span } from './dom';
import { dungeonTheme, terrainCell } from './dungeonArt';
import { mapFace } from './mapFace';
import './journey.css';

export interface JourneySpec {
  id: string;
  expedition: Expedition;
  record: JourneyRecord;
  /** 自動日送りでは昨日まで。履歴の手動再生では帰還日まで。 */
  maxDay: number;
  initialDay: number;
  /** 手動で帰還履歴を見直す場合だけ、結果を冒頭にも出す。 */
  revealOutcome?: boolean;
}

interface PlayerOptions {
  specs: JourneySpec[];
  onClose: () => void;
}

const SPEEDS = [1, 4, 12] as const;
type Speed = typeof SPEEDS[number];

const kindText: Record<string, string> = {
  start: '探索を開始', move: '移動', event: '出来事', hidden: '隠し通路', gather: '採集', treasure: '宝箱', trap: '罠',
  stairs: '階段', encounter: '遭遇', rest: '休息', retreat: '撤退', camp: 'キャンプ', end: '探索終了',
};

const combatText: Record<string, string> = {
  attack: '攻撃', heal: '回復', item: '道具', down: '戦闘不能', flee: '逃走',
};

const memberName = (record: JourneyRecord, id: string | undefined, fallback = '隊員') =>
  record.members.find((m) => m.id === id)?.name ?? fallback;

function describeFrame(record: JourneyRecord, frame: JourneyFrame): string {
  if (frame.combatKind) {
    const actor = frame.actorName ?? memberName(record, frame.actorId);
    const target = frame.targetName ?? memberName(record, frame.targetId, '相手');
    const action = combatText[frame.combatKind] ?? frame.combatKind;
    if (frame.combatKind === 'down') return record.members.some(m => m.id === frame.targetId) ? `${target}が戦闘不能になった` : `${target}を倒した`;
    if (frame.combatKind === 'flee') return `${actor}たちは戦闘から逃れた`;
    // 観察値は残りHPで打ち切った実変化量。詳細ログの攻撃力・回復力とは区別する。
    if (frame.combatKind === 'attack') return frame.amount === 0 ? `${actor}の攻撃を${target}がかわした` : `${actor} → ${target}のHP −${frame.amount ?? 0}`;
    if (frame.combatKind === 'heal' || frame.combatKind === 'item') return `${actor}が${frame.combatKind === 'item' ? '回復薬で' : ''}${target}のHPを${frame.amount ?? 0}回復`;
    return `${actor}が${target}へ${action}`;
  }
  if (frame.text) return frame.text;
  if (frame.kind === 'move') return frame.movement === 'return' ? '入口へ戻る' : '奥へ進む';
  return kindText[frame.kind] ?? '探索を続ける';
}

function resultText(e: Expedition): string {
  if (e.result.wiped) return '全滅';
  if (e.result.retreated) return '撤退';
  return '成功';
}

function allFocusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled])')];
}

export class JourneyPlayer {
  readonly element: HTMLElement;
  private readonly options: PlayerOptions;
  private readonly selectedDays = new Map<string, number>();
  private readonly positions = new Map<string, number>();
  private readonly overlay: HTMLElement;
  private readonly mapLayer: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly eventList: HTMLElement;
  private readonly status: HTMLElement;
  private readonly daySelect: HTMLSelectElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly playButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly restartButton: HTMLButtonElement;
  private readonly finishButton: HTMLButtonElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private currentSpecIndex = 0;
  private playback: JourneyDayPlayback | undefined;
  private mapGrid: ReturnType<typeof parseFloor> | undefined;
  private leader: JourneyMember | undefined;
  private speed: Speed = 4;
  private playing = false;
  private timer: number | undefined;
  private closed = false;

  constructor(options: PlayerOptions) {
    this.options = options;
    const first = options.specs[0];
    this.selectedDays.set(first.id, Math.min(first.initialDay, first.maxDay));

    this.overlay = div('journey-overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '冒険の道中' });
    const header = div('journey-header',
      h('h2', { class: 'journey-title' }, '冒険の道中'),
      span('journey-subtitle', '隊の動きを見ています'),
      h('button', { class: 'journey-close', onclick: () => this.close() }, '閉じる'),
    );
    const tabBar = div('journey-team-tabs', { role: 'tablist', 'aria-label': '観察する隊' }, ...options.specs.map((spec, i) => {
      const button = h('button', { role: 'tab', 'aria-selected': i === 0 ? 'true' : 'false', class: i === 0 ? 'on' : '', onclick: () => this.selectSpec(i) }, this.teamLabel(spec)) as HTMLButtonElement;
      this.tabs.push(button);
      return button;
    }));
    const map = div('journey-map-wrap', { role: 'img', 'aria-label': '探索中の地図' });
    this.mapLayer = div('journey-map-tiles');
    this.marker = div('journey-leader-marker');
    map.append(this.mapLayer, this.marker);
    const mapPanel = div('journey-map-panel', map, this.status = div('journey-status', '準備中'),
      div('small dim', '入＝入口　採＝採集　宝＝宝箱　巣＝敵の巣　主＝強敵　罠＝罠'));

    this.eventList = div('journey-events', { 'aria-live': 'polite', 'aria-label': '道中の出来事' });
    const eventPanel = div('journey-event-panel', h('h3', null, '道中の記録'), this.eventList);
    this.daySelect = h('select', { class: 'journey-day-select', 'aria-label': '表示日', onchange: (ev: Event) => this.selectDay(Number((ev.target as HTMLSelectElement).value)) }) as HTMLSelectElement;
    this.playButton = h('button', { class: 'primary', onclick: () => this.togglePlay() }, '一時停止') as HTMLButtonElement;
    this.nextButton = h('button', { onclick: () => this.nextEvent() }, '次の出来事') as HTMLButtonElement;
    this.restartButton = h('button', { onclick: () => this.restart() }, '最初から') as HTMLButtonElement;
    this.finishButton = h('button', { class: 'journey-finish', onclick: () => this.finishDayAndClose() }, '観察を終える') as HTMLButtonElement;
    const controls = div('journey-controls',
      h('label', { class: 'journey-control-label' }, '表示日', this.daySelect),
      span('journey-control-label', '速度'),
      ...SPEEDS.map((speed) => {
        const button = h('button', { class: speed === this.speed ? 'on' : '', 'aria-pressed': String(speed === this.speed), onclick: () => this.setSpeed(speed) }, `${speed}x`) as HTMLButtonElement;
        this.speedButtons.push(button);
        return button;
      }),
      this.playButton, this.nextButton, this.restartButton, this.finishButton,
    );
    const summary = div('journey-summary');
    this.element = div('journey-player', header, tabBar, summary, mapPanel, eventPanel, controls);
    this.overlay.append(this.element);
    this.element.addEventListener('keydown', (ev) => this.onKeyDown(ev));
    this.summary = summary;
    this.status.setAttribute('role', 'status');
    this.renderSpec();
  }

  private readonly summary: HTMLElement;

  private teamLabel(spec: JourneySpec): string {
    const leader = spec.record.members.find((m) => m.id === spec.record.leaderId)?.name ?? '隊長';
    return `${leader}隊 (${spec.record.members.length}人)`;
  }

  private currentSpec(): JourneySpec { return this.options.specs[this.currentSpecIndex]; }

  private renderSpec() {
    this.stopTimer();
    const spec = this.currentSpec();
    const def = DUNGEON[spec.record.dungeon];
    const floor = def?.floors.find((f) => f.id === spec.record.floor) ?? def?.floors[0];
    this.mapGrid = floor ? parseFloor(floor) : undefined;
    this.leader = spec.record.members.find((m) => m.id === spec.record.leaderId) ?? spec.record.members[0];
    this.marker.replaceChildren(this.leader ? mapFace(this.leader, 'journey-leader-face') : span('journey-leader-face', '隊長'));
    this.mapLayer.parentElement?.style.setProperty('--journey-map-width', String(this.mapGrid?.width ?? 12));
    const days = journeyPlaybackDays(spec.record, spec.maxDay);
    let day = this.selectedDays.get(spec.id);
    if (!day || !days.includes(day)) day = days.includes(spec.initialDay) ? spec.initialDay : (days.at(-1) ?? Math.min(spec.initialDay, spec.maxDay));
    this.selectedDays.set(spec.id, day);
    this.daySelect.replaceChildren(...days.map((value) => h('option', { value, selected: value === day ? true : undefined }, `${value}日目`)));
    this.playback = buildJourneyDayPlayback(spec.record, day);
    this.positions.set(spec.id, Math.min(this.positions.get(spec.id) ?? 0, this.playback?.frames.length ?? 0));
    for (const [i, tab] of this.tabs.entries()) {
      tab.classList.toggle('on', i === this.currentSpecIndex);
      tab.setAttribute('aria-selected', i === this.currentSpecIndex ? 'true' : 'false');
    }
    this.renderSummary(spec, days);
    this.renderCurrent();
    if (this.playback?.frames.length) this.playing = true;
    this.updateControls();
    this.schedule();
  }

  private renderSummary(spec: JourneySpec, days: number[]) {
    const memberNames = spec.record.members.map((m) => m.name).join('・');
    const dungeon = DUNGEON[spec.record.dungeon];
    const floor = dungeon?.floors.find((f) => f.id === spec.record.floor);
    const place = `${dungeon?.name ?? '未知のダンジョン'} / ${floor?.name ?? '不明な階層'}`;
    const trip = spec.revealOutcome && spec.expedition.claimed
      ? `${spec.record.startDay}日目出発 → ${spec.expedition.returnDay}日目帰還 / ${resultText(spec.expedition)}`
      : `${spec.record.startDay}日目出発 / 現地探索`;
    this.summary.replaceChildren(
      span('journey-summary-main', `${memberNames} / ${place}`),
      span('journey-summary-sub', trip),
      span('journey-summary-sub', days.length ? `観察できる日: ${days[0]}〜${days.at(-1)}日目` : '探索の記録はありません'),
      span('journey-rate', '探索率 0%'),
    );
  }

  private currentIndex(): number { return this.positions.get(this.currentSpec().id) ?? 0; }

  private currentSnapshot(): PlaybackSnapshot {
    const p = this.playback;
    const i = this.currentIndex();
    return p ? playbackSnapshotAt(p, i) : { visited: [], hiddenFound: [], hp: {}, cell: null };
  }

  private renderCurrent() {
    const p = this.playback;
    const spec = this.currentSpec();
    const i = this.currentIndex();
    const currentFrame = p?.frames[Math.max(0, i - 1)];
    const snapshot = this.currentSnapshot();
    this.renderMap(snapshot, currentFrame?.cell ?? snapshot.cell);
    this.renderEvents(p, i);
    const rate = this.mapGrid ? Math.round(exploredRate(this.mapGrid, snapshot.visited) * 100) : 0;
    const rateNode = this.summary.querySelector('.journey-rate');
    if (rateNode) rateNode.textContent = `探索率 ${rate}%`;
    const total = p?.frames.length ?? 0;
    const text = currentFrame ? describeFrame(spec.record, currentFrame) : total ? '探索開始前' : 'この日は現地探索の記録がありません';
    this.status.textContent = text;
    this.renderHp(spec.record, snapshot);
    this.updateControls();
  }

  private renderMap(snapshot: PlaybackSnapshot, cell: number | null) {
    const grid = this.mapGrid;
    const spec = this.currentSpec();
    const theme = dungeonTheme(spec.record.dungeon);
    if (!grid) {
      this.mapLayer.replaceChildren();
      this.marker.style.display = 'none';
      return;
    }
    this.mapLayer.className = 'journey-map-tiles terrain-map';
    this.mapLayer.style.gridTemplateColumns = `repeat(${grid.width}, 1fr)`;
    const visited = new Set(snapshot.visited);
    const hiddenFound = new Set(snapshot.hiddenFound);
    const known = new Set<number>();
    for (const index of visited) {
      known.add(index);
      for (const neighbor of visibleFrom(grid, index)) {
        known.add(neighbor);
      }
    }
    this.mapLayer.replaceChildren(...grid.cells.map((def, index) => terrainCell(theme, def, index, {
      known: known.has(index), visited: visited.has(index), hidden: hiddenFound.has(index), recent: index === cell,
      keys: spec.record.initialKeys ?? [],
    })));
    if (cell === null || !grid.cells[cell]) {
      this.marker.style.display = 'none';
    } else {
      const pos = xy(grid, cell);
      this.mapLayer.parentElement?.setAttribute('aria-label', `${DUNGEON[spec.record.dungeon]?.name ?? '探索中の地図'}。${this.leader?.name ?? '隊長'}は横${pos.x + 1}、縦${pos.y + 1}マス目`);
      this.marker.style.display = 'block';
      this.marker.style.left = `${(pos.x * 100) / grid.width}%`;
      this.marker.style.top = `${(pos.y * 100) / grid.height}%`;
    }
  }

  private renderEvents(p: JourneyDayPlayback | undefined, count: number) {
    if (!p || !p.frames.length) {
      this.eventList.replaceChildren(div('dim', 'この日に記録された出来事はありません'));
      return;
    }
    // 攻撃ごとの観察フレームはHPと現在の行動へ反映する。
    // 履歴にはスキル・各ターンの既存ログを使い、同じ攻撃や撃破を二度並べない。
    const events = p.frames.slice(0, count).filter(f => f.kind !== 'move' && f.kind !== 'combat_action').slice(-60);
    this.eventList.replaceChildren(...events.map((frame, i) =>
      div(`journey-event journey-event-${frame.kind}${i === events.length - 1 ? ' current' : ''}`,
        span('journey-event-text', describeFrame(p.record, frame)),
      )));
    this.eventList.scrollTop = this.eventList.scrollHeight;
  }

  private renderHp(record: JourneyRecord, snapshot: PlaybackSnapshot) {
    const rows = record.members.map((member) => {
      const hp = Math.max(0, snapshot.hp[member.id] ?? member.maxHp);
      const pct = member.maxHp > 0 ? Math.round((hp / member.maxHp) * 100) : 0;
      return div('journey-hp-row', div('journey-hp-name', mapFace(member, 'journey-member-face'), member.name), div('journey-hp-bar', div('journey-hp-fill', { style: `width:${pct}%` })), span('journey-hp-value', `${hp}/${member.maxHp}`));
    });
    const old = this.element.querySelector('.journey-hp');
    const panel = div('journey-hp', h('h3', null, '隊の状態'), ...rows);
    if (old) old.replaceWith(panel); else this.element.insertBefore(panel, this.element.querySelector('.journey-map-panel'));
  }

  private selectSpec(index: number) {
    if (index === this.currentSpecIndex || !this.options.specs[index]) return;
    this.currentSpecIndex = index;
    this.renderSpec();
  }

  private selectDay(day: number) {
    const spec = this.currentSpec();
    const days = journeyPlaybackDays(spec.record, spec.maxDay);
    if (!days.includes(day)) return;
    this.selectedDays.set(spec.id, day);
    this.positions.set(spec.id, 0);
    this.renderSpec();
  }

  private setSpeed(speed: Speed) {
    this.speed = speed;
    this.speedButtons.forEach((button, index) => {
      button.classList.toggle('on', SPEEDS[index] === speed);
      button.setAttribute('aria-pressed', String(SPEEDS[index] === speed));
    });
    this.schedule();
  }

  private togglePlay() {
    if (!this.playback?.frames.length) return;
    if (this.currentIndex() >= this.playback.frames.length) {
      this.positions.set(this.currentSpec().id, 0);
      this.playing = true;
      this.renderCurrent();
      this.schedule();
      return;
    }
    this.playing = !this.playing;
    this.updateControls();
    this.schedule();
  }

  private nextEvent() {
    this.stopTimer();
    const total = this.playback?.frames.length ?? 0;
    const frames = this.playback?.frames ?? [];
    let next = total;
    for (let i = this.currentIndex(); i < total; i++) {
      const frame = frames[i];
      if (frame.kind !== 'move' || frame.text || frame.combatKind) { next = i + 1; break; }
    }
    this.positions.set(this.currentSpec().id, next);
    this.playing = false;
    this.renderCurrent();
  }

  private restart() {
    this.positions.set(this.currentSpec().id, 0);
    this.playing = true;
    this.renderCurrent();
    this.schedule();
  }

  private finishDayAndClose() {
    this.stopTimer();
    this.positions.set(this.currentSpec().id, this.playback?.frames.length ?? 0);
    this.close();
  }

  private updateControls() {
    const total = this.playback?.frames.length ?? 0;
    const done = this.currentIndex() >= total;
    this.playButton.textContent = done ? 'もう一度再生' : this.playing ? '一時停止' : '再生';
    this.nextButton.disabled = done;
    this.restartButton.disabled = total === 0;
  }

  private schedule() {
    this.stopTimer();
    if (!this.playing || !this.playback?.frames.length) {
      this.updateControls();
      return;
    }
    if (this.currentIndex() >= this.playback.frames.length) {
      this.playing = false;
      this.updateControls();
      return;
    }
    const delay = Math.max(80, 900 / this.speed);
    this.timer = window.setTimeout(() => {
      if (this.closed) return;
      const next = Math.min(this.playback?.frames.length ?? 0, this.currentIndex() + 1);
      this.positions.set(this.currentSpec().id, next);
      this.renderCurrent();
      this.schedule();
    }, delay);
  }

  private stopTimer() {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private onKeyDown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') { ev.preventDefault(); this.close(); return; }
    if (ev.key !== 'Tab') return;
    const focusables = allFocusables(this.element);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables.at(-1)!;
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopTimer();
    this.options.onClose();
  }

  /** セーブ差し替え時に、描画コールバックを再入させずタイマーだけ破棄する。 */
  dispose() {
    this.closed = true;
    this.stopTimer();
  }
}

export function createJourneyPlayer(options: PlayerOptions): JourneyPlayer | null {
  const specs = options.specs.filter((spec) => isPlayableJourney(spec.record));
  if (!specs.length) return null;
  return new JourneyPlayer({ ...options, specs });
}
