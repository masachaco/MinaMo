// App controller: project state, playback, MTR-style track recording (音ゲー / VJ input), render loop.
//
// Modes = tracks (lyrics / telop / chara / camera / fx / viz / look). REC records only the armed track:
//   重ね   (overdub, default): new events are added on top
//   上書き (replace): events of that track inside the recorded range are replaced (punch-in)
// While playing without REC, performance keys are auditioned live (not recorded).

import { analyzeAudio, type Analysis } from './audio/analysis';
import { AudioEngine } from './audio/engine';
import { uid } from './core/id';
import { assignTap, firstTargetAfter, lastTimeBefore, lineFirstTarget, reconcileLines, tapTargets, type TapTarget, type TapUnit } from './core/lyrics';
import { History, newProject, normalizeProject, paletteOf } from './core/project';
import { deleteMedia, downloadBlob, getMedia, loadProjectLocal, putMedia, saveProjectLocal } from './core/storage';
import type { BackgroundRef, CamEvent, CharaEvent, CharacterRef, ElemEvent, FxEvent, LookEvent, LyricLine, MmdModelRef, MmdPoseRef, Project, StyleEvent, Telop, VizEvent } from './core/types';
import { assignTelop, firstTelopAfter, reconcileTelops } from './core/telops';
import { getFx, listLookStyles, listLyricStyles, onRegistryChange, type EffectId, type ElemTarget, type MotionId } from './engine/api';
import { charMediaKey, disposeBg, loadBgAsset, loadCharAsset, loadMmdModelAsset, makeMmdCharAsset, type BgAsset, type CharAsset } from './engine/assets';
import { stateAt } from './engine/channels';
import { bgIndexAt, compileProject, segmentAt, type Compiled } from './engine/compile';
import { demoEnabled, loadDemoProject } from './demo';
import { cameraOf } from './engine/director';
import { ensureFonts } from './engine/fonts';
import { fmtTime } from './engine/lib';
import type { MmdModel } from './engine/mmd';
import { CLIP_EXT, MODEL_EXT, MODEL_FILE_EXT, normPath } from './engine/mmd-files';
import { Renderer, type FrameInput } from './engine/renderer';
import { charLabel as charName, modeInfo, MODES, perfKeys, type Mode, type PerfKey } from './perform';
import { $, chooseOne, codeKey, isTyping, toast, type PathFile } from './ui/dom';

/**
 * Event lists: lstyle = lyric styles, lfx / tfx = effects & motions of the lyrics / telops, then one list per track.
 * (Lyric and telop timings live on the lines / Project.telops.)
 */
export type EventTrack = 'lstyle' | 'lfx' | 'tfx' | 'chara' | 'cam' | 'fx' | 'viz' | 'look';

export type Selection =
  | { type: 'line'; index: number }
  | { type: 'glyph'; index: number; glyph: number }
  | { type: 'end'; index: number }
  | { type: 'telop'; index: number; part: 'body' | 'end' }
  | { type: 'ev'; track: EventTrack; id: string };

type AnyEvent = StyleEvent | ElemEvent | CharaEvent | CamEvent | FxEvent | VizEvent | LookEvent;

type ListKey = 'lyricStyleEvents' | 'lyricEvents' | 'telopEvents' | 'charaEvents' | 'camEvents' | 'fxEvents' | 'vizEvents' | 'lookEvents';
/** Project array for each event track. */
export const TRACK_LIST: Record<EventTrack, ListKey> = {
  lstyle: 'lyricStyleEvents',
  lfx: 'lyricEvents',
  tfx: 'telopEvents',
  chara: 'charaEvents',
  cam: 'camEvents',
  fx: 'fxEvents',
  viz: 'vizEvents',
  look: 'lookEvents',
};
/** Mode (armed track) each event list belongs to (the lyrics track records two lists). */
export const TRACK_MODE: Record<EventTrack, Mode> = { lstyle: 'lyrics', lfx: 'lyrics', tfx: 'telop', chara: 'chara', cam: 'camera', fx: 'fx', viz: 'viz', look: 'look' };

interface TakeSnap {
  lines: LyricLine[];
  telops: Telop[];
  lists: Record<string, AnyEvent[]>;
  cursor: number;
}

type Monitor = { [K in EventTrack]: AnyEvent[] };
const emptyMonitor = (): Monitor => ({ lstyle: [], lfx: [], tfx: [], chara: [], cam: [], fx: [], viz: [], look: [] });

type Listener = () => void;

export class App {
  project: Project = newProject();
  readonly history = new History();
  readonly engine = new AudioEngine();
  analysis: Analysis | null = null;
  compiled!: Compiled;
  readonly renderer: Renderer;
  readonly charAssets = new Map<string, CharAsset>();
  readonly bgAssets = new Map<string, BgAsset>();
  /** Loaded MMD models by Project.mmdModels id (shared by that model's character entries). */
  readonly mmdModels = new Map<string, MmdModel>();

  /** Armed track / key layout. */
  mode: Mode = 'lyrics';
  /** true = 重ね (overdub, default for every track), false = 上書き (replace the recorded range). */
  overdub = true;
  recording = false;
  /** Next lyric tap target (character index across all lines). */
  lyricCursor = 0;
  /** Cursor follows the playhead (first untapped character after it) until set by hand. */
  cursorFollow = true;
  private tgCache: { lines: LyricLine[]; targets: TapTarget[] } | null = null;
  /** Next telop to show (index into project.telops). */
  telopCursor = 0;
  telopFollow = true;
  private telopHeld: { key: string; index: number; start: number } | null = null;
  private recStart = 0;
  private takeIds = new Set<string>();
  private take: TakeSnap[] = [];
  private held = new Map<string, { evId: string; start: number; monitor: boolean }>();
  /** Live (auditioned, not recorded) events. */
  private monitor: Monitor = emptyMonitor();
  private monitorCount = 0;

  selection: Selection | null = null;
  exporting = false;
  /** Opened the demo because nothing was saved yet (the tutorial starts). */
  firstVisit = false;

  private dirty = true;
  private needsFrame = true;
  private lastT = -1;
  /** Where the current playback started (stop returns here in 'return' stop mode). */
  private playFrom = 0;
  /**
   * Editing without REC: 'place' = performance keys write straight into the project (mouse placement),
   * 'retarget' = they rewrite the selected event's value (keeping its time).
   */
  private edit: { kind: 'place' } | { kind: 'retarget'; track: EventTrack; id: string } | null = null;
  private lastPut: { track: EventTrack; id: string } | null = null;
  private saveTimer = 0;
  private listeners = new Map<string, Set<Listener>>();

  constructor(outCanvas: HTMLCanvasElement) {
    this.renderer = new Renderer(640, 360, outCanvas);
    this.engine.onEnd = () => {
      if (this.recording) this.stopRec();
      else this.returnToStart();
      this.clearMonitor();
      this.emit('transport');
    };
    onRegistryChange(() => {
      this.dirty = true;
      this.emit('registry');
    });
    // flush the debounced autosave when the tab is hidden / closed / reloaded
    const flush = () => {
      if (!this.saveTimer) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = 0;
      saveProjectLocal(this.project);
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  }

  // ------------------------------------------------------------------ events
  on(ev: string, fn: Listener) {
    let s = this.listeners.get(ev);
    if (!s) this.listeners.set(ev, (s = new Set()));
    s.add(fn);
  }
  emit(ev: string) {
    this.listeners.get(ev)?.forEach((f) => f());
  }

  // ------------------------------------------------------------------ project
  get settings() {
    return this.project.settings;
  }

  get duration(): number {
    return this.engine.duration;
  }

  get time(): number {
    return this.engine.time;
  }

  /** Apply a change to the project. history=true records an undo step. */
  mutate(fn: (p: Project) => void, opts: { history?: boolean; silent?: boolean } = {}) {
    if (opts.history !== false) this.history.push(this.project);
    fn(this.project);
    this.invalidate();
    if (!opts.silent) this.emit('project');
  }

  invalidate() {
    this.dirty = true;
    this.needsFrame = true;
    this.scheduleSave();
  }

  requestFrame() {
    this.needsFrame = true;
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = 0;
      saveProjectLocal(this.project);
    }, 600);
  }

  /** All text drawn on screen (for font preloading). */
  fontText(): string {
    const p = this.project;
    return p.lines.map((l) => l.text + l.sub).join('') + p.telops.map((t) => t.text + t.sub).join('') + p.settings.title + p.settings.artist;
  }

  setTelops(text: string) {
    this.mutate((p) => {
      p.telopText = text;
      p.telops = reconcileTelops(p.telops, text);
    });
    if (this.telopCursor > this.project.telops.length) this.telopCursor = this.project.telops.length;
    this.emit('cursor');
    ensureFonts(this.fontText()).then((changed) => changed && this.invalidate());
  }

  setLyrics(text: string) {
    this.mutate((p) => {
      p.lyricsText = text;
      p.lines = reconcileLines(p.lines, text);
    });
    this.clampCursor();
    ensureFonts(this.fontText()).then((changed) => changed && this.invalidate());
  }

  undo() {
    const p = this.history.undo(this.project);
    if (!p) return toast('これ以上戻せません');
    this.replaceProject(p, false);
    void this.syncCharImages(); // a replaced 立ち絵 image goes back too
  }

  redo() {
    const p = this.history.redo(this.project);
    if (!p) return;
    this.replaceProject(p, false);
    void this.syncCharImages();
  }

  replaceProject(p: Project, resetHistory: boolean) {
    this.project = normalizeProject(p);
    if (resetHistory) this.history.clear();
    this.selection = null;
    this.engine.grid = null;
    this.invalidate();
    this.clampCursor();
    this.emit('project');
    this.emit('assets');
  }

  private clampCursor() {
    const n = this.targets().length;
    if (this.lyricCursor > n) this.lyricCursor = n;
    if (this.cursorFollow) this.followCursor(true);
    this.emit('cursor');
  }

  /** Characters with loaded images, in project order (enabled only). */
  enabledChars(): CharAsset[] {
    const out: CharAsset[] = [];
    for (const r of this.project.characters) {
      const a = this.charAssets.get(r.id);
      if (!a) continue;
      a.ref = r;
      if (r.enabled) out.push(a);
    }
    return out;
  }

  loadedBgs(): BgAsset[] {
    const out: BgAsset[] = [];
    for (const r of this.project.backgrounds) {
      const a = this.bgAssets.get(r.id);
      if (a) {
        a.ref = r;
        out.push(a);
      }
    }
    return out;
  }

  /** Project with live (auditioned) events merged in. */
  private effectiveProject(): Project {
    if (!this.monitorCount) return this.project;
    const p = { ...this.project };
    for (const tr of Object.keys(TRACK_LIST) as EventTrack[]) {
      const m = this.monitor[tr];
      if (m.length) (p as any)[TRACK_LIST[tr]] = [...(p as any)[TRACK_LIST[tr]], ...m];
    }
    return p;
  }

  recompile() {
    const s = this.settings;
    const W = Math.round(s.width * s.previewScale), H = Math.round(s.height * s.previewScale);
    this.renderer.resize(W, H);
    this.compiled = compileProject(this.effectiveProject(), this.duration, W, H, this.enabledChars().map((a) => a.ref.id));
    this.engine.grid = this.compiled.grid;
    this.engine.metronome = s.metronome;
    this.dirty = false;
    this.emit('compiled');
  }

  frameInput(exporting = false): FrameInput {
    return {
      compiled: this.compiled,
      project: this.project,
      palette: paletteOf(this.settings),
      analysis: this.analysis,
      chars: this.enabledChars(),
      bgs: this.loadedBgs(),
      exporting,
    };
  }

  // ------------------------------------------------------------------ state queries (for key lights / toggles)
  /** Effect ids on for an element at t (characters on オート: the look style's). */
  effectsAt(target: ElemTarget, t: number): EffectId[] {
    const C = this.compiled;
    if (target !== 'chara') return [...(stateAt(C.elem[target].effect, t)?.v ?? [])];
    const st = stateAt(C.stage.effect, t);
    if (!st || st.v === 'auto') return [...cameraOf(segmentAt(C.lookSegs, t).style).effects];
    return [...st.v];
  }

  /** Motion of an element at t ('auto' = characters on オート). */
  motionAt(target: ElemTarget, t: number): MotionId | 'auto' {
    const C = this.compiled;
    if (target !== 'chara') return stateAt(C.elem[target].motion, t)?.v ?? 'idle';
    return stateAt(C.stage.motion, t)?.v ?? 'auto';
  }

  bgIndexAt(t: number): number {
    return bgIndexAt(this.compiled, t, this.loadedBgs().length);
  }

  // ------------------------------------------------------------------ transport
  async play() {
    if (this.engine.playing) return;
    if (this.time >= this.duration - 0.05) this.engine.seek(0);
    this.playFrom = this.time;
    await this.engine.play();
    this.emit('transport');
  }

  /** Pause playback. Pausing during REC ends the take (REC off). In 'return' stop mode the playhead goes back to where playback started. */
  pause() {
    if (this.recording) {
      this.stopRec(); // sets recording = false, then calls pause() again
      return;
    }
    const wasPlaying = this.engine.playing;
    this.engine.pause();
    if (wasPlaying) this.returnToStart();
    this.clearMonitor();
    this.syncVideos(false, this.time);
    this.emit('transport');
  }

  /** 'return' stop mode: back to where playback started. */
  private returnToStart() {
    if (this.settings.stopMode === 'stay') return;
    this.engine.seek(Math.max(0, Math.min(this.duration, this.playFrom)));
    this.needsFrame = true;
    this.emit('seek');
  }

  togglePlay() {
    if (this.engine.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    this.engine.seek(Math.max(0, Math.min(this.duration, t)));
    // jumping during playback is like starting from there (the stop return point follows)
    if (this.engine.playing) this.playFrom = this.time;
    this.clearMonitor();
    this.needsFrame = true;
    this.emit('seek');
  }

  // ------------------------------------------------------------------ modes
  setMode(m: Mode) {
    if (this.recording) {
      toast('録音中はモードを切り替えられません（Esc で停止）');
      return;
    }
    this.mode = m;
    this.emit('mode');
  }

  cycleMode(dir: 1 | -1) {
    const i = MODES.findIndex((x) => x.id === this.mode);
    this.setMode(MODES[(i + dir + MODES.length) % MODES.length].id);
  }

  setOverdub(v: boolean) {
    this.overdub = v;
    this.emit('mode');
  }

  // ------------------------------------------------------------------ recording
  async startRec() {
    if (this.recording) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.clearMonitor();
    this.history.push(this.project);
    this.take = [];
    this.takeIds = new Set();
    this.recStart = this.time;
    if (this.mode === 'telop' && this.telopFollow) this.telopCursor = firstTelopAfter(this.project.telops, this.time);
    if (this.mode === 'lyrics') {
      if (this.cursorFollow) this.lyricCursor = firstTargetAfter(this.project.lines, this.targets(), this.time);
      const prev = lastTimeBefore(this.project.lines, this.targets(), this.lyricCursor);
      if (prev != null && prev > this.time + 0.05) toast(`⚠ 再生位置が直前の歌詞（${fmtTime(prev)}）より前です`, 3000);
    }
    this.recording = true;
    document.body.classList.add('rec-mode');
    if (!this.engine.playing) await this.play();
    this.emit('rec');
  }

  stopRec() {
    if (!this.recording) return;
    this.pruneTake();
    this.recording = false;
    this.held.clear();
    this.telopHeld = null;
    document.body.classList.remove('rec-mode');
    this.pause();
    this.emit('rec');
    this.emit('project');
  }

  /** Start time of the current take. */
  get recordStart(): number {
    return this.recStart;
  }

  toggleRec() {
    if (this.recording) this.stopRec();
    else this.startRec();
  }

  /** Song time of a key event, compensated for event-queue delay and the user's latency setting. */
  eventTime(e?: Event): number {
    let t = this.time;
    // real-time delays become song time at the playback speed
    const rate = this.engine.rate;
    if (e && this.engine.playing) {
      const delay = (performance.now() - e.timeStamp) / 1000;
      if (delay > 0 && delay < 0.25) t -= delay * rate;
    }
    return t - (this.settings.latencyMs / 1000) * rate;
  }

  /** Playback speed (practice). Other than 1× plays a pitch-preserving stretched copy, prepared on first use. */
  async setRate(r: number) {
    if (r === this.engine.rate) return;
    const slow = r !== 1 && !!this.engine.buffer;
    if (slow) toast(`再生速度 ${r}× を準備中…`, 8000);
    try {
      await this.engine.setRate(r);
      if (slow) toast(`再生速度 ${r}×（音程はそのまま）`);
    } catch (e) {
      toast(`再生速度を変えられません: ${(e as Error).message}`, 4000);
    }
    this.emit('transport');
  }

  private snapEvent(t: number): number {
    const d = this.settings.eventSnap;
    return Math.max(0, d ? this.compiled.grid.quantize(t, d) : t);
  }

  private pushTake() {
    const p = this.project;
    const lists: Record<string, AnyEvent[]> = {};
    for (const k of Object.values(TRACK_LIST)) lists[k] = (p as any)[k].map((e: AnyEvent) => ({ ...e }));
    this.take.push({ lines: p.lines.map((l) => ({ ...l, times: [...l.times] })), telops: p.telops.map((x) => ({ ...x })), lists, cursor: this.mode === 'telop' ? this.telopCursor : this.lyricCursor });
    if (this.take.length > 500) this.take.shift();
  }

  /** 上書き mode: remove pre-existing events of the armed track (all its lists) inside the recorded range. */
  private pruneTake() {
    if (!this.recording || this.overdub) return;
    const t0 = this.recStart - 1e-3, t1 = this.time;
    for (const track of Object.keys(TRACK_LIST) as EventTrack[]) {
      if (TRACK_MODE[track] !== this.mode) continue;
      const key = TRACK_LIST[track];
      const list = (this.project as any)[key] as AnyEvent[];
      const kept = list.filter((e) => this.takeIds.has(e.id) || e.time < t0 || e.time > t1);
      if (kept.length !== list.length) {
        (this.project as any)[key] = kept;
        this.invalidate();
      }
    }
  }

  // ------------------------------------------------------------------ lyric cursor
  /** Tap targets of the current lyrics (cached by lines identity; structure only changes with new arrays). */
  targets(): TapTarget[] {
    const lines = this.project.lines;
    if (!this.tgCache || this.tgCache.lines !== lines) this.tgCache = { lines, targets: tapTargets(lines) };
    return this.tgCache.targets;
  }

  /** Set the lyric input position (manual → stops following the playhead). */
  setCursor(k: number, manual = true) {
    if (this.recording) return;
    const n = this.targets().length;
    const v = Math.max(0, Math.min(n, Math.round(k)));
    const changed = v !== this.lyricCursor || (manual && this.cursorFollow);
    this.lyricCursor = v;
    if (manual) this.cursorFollow = false;
    if (changed) this.emit('cursor');
  }

  setCursorFollow(v: boolean) {
    this.cursorFollow = v;
    if (v) this.followCursor(true);
    this.emit('cursor');
  }

  /** Move the cursor by characters or lines. */
  moveCursor(unit: 'glyph' | 'line', dir: number) {
    const tg = this.targets();
    if (unit === 'glyph') return this.setCursor(this.lyricCursor + dir);
    const cur = tg[Math.min(this.lyricCursor, tg.length - 1)];
    if (!cur) return;
    const lineIdx = this.lyricCursor >= tg.length ? this.project.lines.length : cur.line;
    const onStart = this.lyricCursor < tg.length && cur.lineFirst;
    const target = dir < 0 ? (onStart || this.lyricCursor >= tg.length ? lineIdx - 1 : lineIdx) : lineIdx + 1;
    this.setCursor(lineFirstTarget(tg, Math.max(0, target)));
  }

  /** Seek to one bar before the cursor position (its time, or the last tapped character before it). */
  cueToCursor() {
    const tg = this.targets();
    const own = tg[this.lyricCursor] ? this.project.lines[tg[this.lyricCursor].line].times[tg[this.lyricCursor].glyph] : null;
    const ref = own ?? lastTimeBefore(this.project.lines, tg, this.lyricCursor) ?? 0;
    this.seek(Math.max(0, ref - (this.compiled?.grid.barDur ?? 2)));
  }

  private lastFollowT = -1;
  private followCursor(force = false) {
    if (this.recording || !this.cursorFollow) return;
    const t = this.time;
    if (!force && t === this.lastFollowT) return;
    this.lastFollowT = t;
    const k = firstTargetAfter(this.project.lines, this.targets(), t);
    if (k !== this.lyricCursor) {
      this.lyricCursor = k;
      this.emit('cursor');
    }
  }

  // ------------------------------------------------------------------ telops
  setTelopCursor(k: number, manual = true) {
    if (this.recording) return;
    this.telopCursor = Math.max(0, Math.min(this.project.telops.length, Math.round(k)));
    if (manual) this.telopFollow = false;
    this.emit('cursor');
  }

  setTelopFollow(v: boolean) {
    this.telopFollow = v;
    if (v) this.followTelop(true);
    this.emit('cursor');
  }

  private lastTelopFollowT = -1;
  private followTelop(force = false) {
    if (this.recording || !this.telopFollow) return;
    const t = this.time;
    if (!force && t === this.lastTelopFollowT) return;
    this.lastTelopFollowT = t;
    const k = firstTelopAfter(this.project.telops, t);
    if (k !== this.telopCursor) {
      this.telopCursor = k;
      this.emit('cursor');
    }
  }

  /** Space in the TELOP track: show the next telop (hold the key to set its length). */
  recTelop(t: number, key: string) {
    if (!this.recording || this.mode !== 'telop') return;
    const k = this.telopCursor;
    if (k >= this.project.telops.length) {
      toast('テロップ一覧の最後です');
      return;
    }
    this.pushTake();
    const q = this.settings.eventSnap;
    if (q) t = this.compiled.grid.quantize(t, q);
    t = Math.max(0, t);
    this.mutate((p) => (p.telops = assignTelop(p.telops, k, t)), { history: false, silent: true });
    this.telopHeld = { key, index: k, start: t };
    this.telopCursor = k + 1;
    this.emit('cursor');
  }

  /** X in the TELOP track: end the telop showing now. */
  recTelopClear(t: number) {
    if (!this.recording || this.mode !== 'telop') return;
    const cur = [...this.compiled.telops].reverse().find((x) => x.start <= t && t < x.start + x.dur);
    if (!cur) return;
    this.pushTake();
    this.mutate((p) => (p.telops[cur.index] = { ...p.telops[cur.index], dur: Math.max(0.1, t - cur.start) }), { history: false, silent: true });
  }

  moveTelopCursor(dir: number) {
    this.setTelopCursor(this.telopCursor + dir);
  }

  /** Space = one character, N = one chunk, Enter = one line. */
  recTap(t: number, unit: TapUnit) {
    if (!this.recording || this.mode !== 'lyrics') return;
    const targets = tapTargets(this.project.lines);
    if (this.lyricCursor >= targets.length) {
      toast('歌詞の最後に到達しました');
      return;
    }
    this.pushTake();
    const q = this.settings.quantize;
    if (q) t = this.compiled.grid.quantize(t, q);
    const r = assignTap(this.project.lines, targets, this.lyricCursor, Math.max(0, t), unit);
    this.mutate((p) => (p.lines = r.lines), { history: false, silent: true });
    this.lyricCursor = r.next;
    this.emit('tap');
    this.emit('cursor');
  }

  recClear(t: number) {
    if (!this.recording || this.mode !== 'lyrics') return;
    const targets = tapTargets(this.project.lines);
    const last = targets[this.lyricCursor - 1];
    if (!last) return;
    const line = this.project.lines[last.line];
    const start = line.times[0];
    if (start == null || t <= start) return;
    this.pushTake();
    this.mutate((p) => (p.lines[last.line] = { ...p.lines[last.line], end: t }), { history: false, silent: true });
    this.emit('tap');
  }

  recUndo() {
    const s = this.take.pop();
    if (!s) {
      toast('このテイクで取り消せる入力はありません');
      return;
    }
    this.mutate((p) => {
      p.lines = s.lines;
      p.telops = s.telops;
      for (const [k, v] of Object.entries(s.lists)) (p as any)[k] = v;
    }, { history: false, silent: true });
    if (this.mode === 'telop') this.telopCursor = s.cursor;
    else this.lyricCursor = s.cursor;
    this.emit('tap');
    this.emit('cursor');
  }

  private clearMonitor() {
    if (!this.monitorCount) return;
    this.monitor = emptyMonitor();
    this.monitorCount = 0;
    this.invalidate();
  }

  /**
   * Put a state event into an event list at time t (snapped).
   * REC on its track → recorded into the project; playing without REC → auditioned live.
   */
  putEvent(track: EventTrack, data: Record<string, any>, t: number): string | null {
    const mode = TRACK_MODE[track];
    const ed = this.edit;
    if (ed?.kind === 'retarget') {
      // rewrite the selected event's value in place (time and id kept; an FX keeps its hold)
      if (ed.track !== track) return null;
      const ev = (this.eventList(track) as any[]).find((e) => e.id === ed.id);
      if (!ev) return null;
      const hold = ev.hold;
      for (const k of Object.keys(ev)) if (k !== 'id' && k !== 'time') delete ev[k];
      Object.assign(ev, data);
      if (track === 'fx' && hold > 0 && getFx(ev.fx)?.holdable) ev.hold = hold;
      this.lastPut = { track, id: ev.id };
      return ev.id;
    }
    const place = ed?.kind === 'place';
    const toProject = place || (this.recording && this.mode === mode);
    if (!toProject && !this.engine.playing) return null;
    t = this.snapEvent(t);
    const id = uid();
    const ev = { id, time: t, ...data } as AnyEvent;
    const same = (e: AnyEvent) =>
      Math.abs(e.time - t) < 1e-3 && (track === 'lstyle' || track === 'fx' || (e as any).kind === (ev as any).kind);
    if (toProject) {
      if (!place) {
        this.pushTake();
        this.takeIds.add(id);
      }
      const key = TRACK_LIST[track];
      this.mutate((p) => {
        const list = ((p as any)[key] as AnyEvent[]).filter((e) => track === 'fx' || !same(e));
        list.push(ev);
        list.sort((a, b) => a.time - b.time);
        (p as any)[key] = list;
      }, { history: false, silent: true });
      this.lastPut = { track, id };
    } else {
      const list = this.monitor[track].filter((e) => track === 'fx' || !same(e));
      list.push(ev);
      this.monitor[track] = list;
      this.monitorCount++;
      this.invalidate();
    }
    return id;
  }

  /** FX key down (hold extends holdable FX on key up). */
  putFx(fx: string, t: number, key: string) {
    const id = this.putEvent('fx', { fx, hold: 0 }, t);
    if (id && !this.edit) this.held.set(key, { evId: id, start: this.snapEvent(t), monitor: !(this.recording && this.mode === 'fx') });
  }

  // ------------------------------------------------------------------ keyboard
  /** Performance keys of the current mode (cheap to rebuild; labels follow characters / backgrounds). */
  perfKeyList(): PerfKey[] {
    return perfKeys(this, this.mode);
  }

  /** Visual key feedback for the performance panel. */
  hit(key: string) {
    const el = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
    el?.classList.add('hit');
    setTimeout(() => el?.classList.remove('hit'), 110);
  }

  /** Trigger a performance key (keyboard or panel click). */
  perform(k: PerfKey, t: number, shift: boolean, keyName = k.key) {
    if (!this.recording && !this.engine.playing) {
      toast('再生中に押すと試せます。記録は REC（Shift+R）、タイムラインのダブルクリックでも置けます');
      return;
    }
    if (k.recOnly && !this.recording) {
      toast('歌詞タップは REC 中のみ（Shift+R）');
      return;
    }
    k.run(t, { shift, key: keyName });
    this.hit(k.key);
  }

  private keyDownAt = new Map<string, number>();

  handleKeyDown(e: KeyboardEvent) {
    if (!e.repeat) this.keyDownAt.set(codeKey(e), e.timeStamp);
    // typing in a field never triggers performance keys (BPM etc.)
    if (isTyping(e)) {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT')) (e.target as HTMLElement).blur();
      return;
    }
    const k = codeKey(e);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') {
      e.preventDefault();
      if (!this.recording) e.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      if (!this.recording) this.redo();
      return;
    }
    if (mod && k === 's') {
      e.preventDefault();
      this.saveProjectFile();
      return;
    }
    if (mod || e.altKey) return;
    if (e.shiftKey && k === 'r') {
      e.preventDefault();
      if (!e.repeat) this.toggleRec();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.cycleMode(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Escape') {
      if (this.recording) this.stopRec();
      else this.pause();
      return;
    }
    if (this.recording && k === 'Backspace') {
      e.preventDefault();
      if (!e.repeat) this.recUndo();
      return;
    }
    const pk = this.perfKeyList().find((x) => x.key === k);
    // Space: tap while recording lyrics / telops, otherwise play / pause (pausing a take ends REC)
    if (k === ' ' && !(this.recording && (this.mode === 'lyrics' || this.mode === 'telop'))) {
      e.preventDefault();
      if (!e.repeat) this.togglePlay();
      return;
    }
    if (pk && !this.recording && !this.engine.playing && this.canRetarget(pk)) {
      e.preventDefault();
      if (!e.repeat) this.retargetSelection(pk, e.shiftKey, k);
      return;
    }
    if (pk) {
      e.preventDefault();
      if (e.repeat) return;
      this.perform(pk, this.eventTime(e), e.shiftKey, k);
      return;
    }
    if (this.recording) return;
    const grid = this.compiled?.grid;
    if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'range' && e.key.startsWith('Arrow')) return;
    if (this.mode === 'lyrics' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      this.moveCursor(e.shiftKey ? 'glyph' : 'line', e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (this.mode === 'telop' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      this.moveTelopCursor(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = grid ? (e.shiftKey ? grid.barDur : grid.spb) : 1;
      this.seek(this.time + (e.key === 'ArrowLeft' ? -step : step));
    } else if (e.key === 'Home') this.seek(0);
    else if (e.key === 'End') this.seek(this.duration);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection) {
      e.preventDefault();
      this.deleteSelection();
    }
  }

  handleKeyUp(e: KeyboardEvent) {
    const k = codeKey(e);
    // physical press length from the key events' own timestamps (independent of audio clock jitter)
    const down = this.keyDownAt.get(k);
    this.keyDownAt.delete(k);
    // held length in song time (at slower playback a hold covers less of the song)
    const pressed = down != null ? Math.max(0, (e.timeStamp - down) / 1000) * this.engine.rate : 0;
    const th = this.telopHeld;
    if (th && th.key === k) {
      this.telopHeld = null;
      const hold = pressed;
      const tp = this.project.telops[th.index];
      if (hold > 0.3 && tp && tp.start === th.start) {
        tp.dur = hold;
        this.invalidate();
      }
    }
    const h = this.held.get(k);
    if (!h) return;
    this.held.delete(k);
    const hold = pressed;
    if (hold <= 0.2) return;
    const list = (h.monitor ? this.monitor.fx : this.project.fxEvents) as FxEvent[];
    const ev = list.find((x) => x.id === h.evId);
    if (ev && getFx(ev.fx)?.holdable) {
      ev.hold = hold;
      this.invalidate();
    }
  }

  // ------------------------------------------------------------------ selection
  eventList(track: EventTrack): AnyEvent[] {
    return (this.project as any)[TRACK_LIST[track]];
  }

  deleteSelection() {
    const s = this.selection;
    if (!s) return;
    this.mutate((p) => {
      if (s.type === 'line') {
        const l = p.lines[s.index];
        if (l) p.lines[s.index] = { ...l, times: l.times.map(() => null), end: null };
      } else if (s.type === 'glyph') {
        const l = p.lines[s.index];
        if (l && s.glyph > 0) p.lines[s.index] = { ...l, times: l.times.map((x, i) => (i === s.glyph ? null : x)) };
      } else if (s.type === 'end') {
        const l = p.lines[s.index];
        if (l) p.lines[s.index] = { ...l, end: null };
      } else if (s.type === 'telop') {
        const tp = p.telops[s.index];
        if (tp) p.telops[s.index] = { ...tp, start: null, dur: null };
      } else {
        const key = TRACK_LIST[s.track];
        (p as any)[key] = ((p as any)[key] as AnyEvent[]).filter((e) => e.id !== s.id);
      }
    });
    this.select(null);
  }

  select(s: Selection | null) {
    this.selection = s;
    // selecting an element arms its track, so the key panel shows the values it can take
    const m: Mode | null = !s ? null : s.type === 'ev' ? TRACK_MODE[s.track] : s.type === 'telop' ? 'telop' : 'lyrics';
    if (m && m !== this.mode && !this.recording) {
      this.mode = m;
      this.emit('mode');
    }
    this.emit('selection');
  }

  // ------------------------------------------------------------------ editing without REC
  /** Place what a performance key would record, straight into the project at time t (mouse placement). Selects it. */
  placeKey(k: PerfKey, t: number, shift = false) {
    if (this.recording) return;
    this.history.push(this.project);
    this.lastPut = null;
    this.edit = { kind: 'place' };
    try {
      k.run(Math.max(0, t), { shift, key: k.key });
    } finally {
      this.edit = null;
    }
    const put = this.lastPut as { track: EventTrack; id: string } | null;
    this.emit('project');
    if (put) this.select({ type: 'ev', track: put.track, id: put.id });
  }

  /** Whether a performance key can rewrite the current selection (an event of the same list, in the armed track). */
  canRetarget(k: PerfKey): boolean {
    const s = this.selection;
    return !!s && s.type === 'ev' && TRACK_MODE[s.track] === this.mode && !k.recOnly && k.track === s.track;
  }

  /** Rewrite the selected event with a performance key's value (time kept). */
  retargetSelection(k: PerfKey, shift = false, keyName = k.key) {
    const s = this.selection;
    if (!s || s.type !== 'ev') return;
    const ev = this.eventList(s.track).find((e) => e.id === s.id);
    if (!ev) return;
    this.history.push(this.project);
    this.edit = { kind: 'retarget', track: s.track, id: s.id };
    try {
      k.run(ev.time, { shift, key: keyName });
    } finally {
      this.edit = null;
    }
    this.invalidate();
    this.emit('project');
    this.emit('selection');
    this.hit(k.key);
  }

  /** Mouse placement on the lyrics row: the next untimed glyph / chunk / line at time t. */
  placeTap(unit: TapUnit, t: number) {
    const targets = tapTargets(this.project.lines);
    if (this.cursorFollow) this.lyricCursor = firstTargetAfter(this.project.lines, targets, t);
    if (this.lyricCursor >= targets.length) return toast('歌詞の最後に到達しました');
    const r = assignTap(this.project.lines, targets, this.lyricCursor, Math.max(0, t), unit);
    this.mutate((p) => (p.lines = r.lines));
    const line = targets[this.lyricCursor]?.line;
    this.lyricCursor = r.next;
    if (line != null) this.select({ type: 'line', index: line });
    this.emit('cursor');
  }

  /** Mouse placement: telop k starts at time t (default length). */
  placeTelop(k: number, t: number) {
    if (!this.project.telops[k]) return;
    this.mutate((p) => (p.telops = assignTelop(p.telops, k, Math.max(0, t))));
    this.telopCursor = k + 1;
    this.select({ type: 'telop', index: k, part: 'body' });
    this.emit('cursor');
  }

  /**
   * Lyric style of one line only: a style event at the line start, and one restoring the previous style at the next
   * line (when nothing starts there yet). null removes the event at the line start.
   */
  setLineStyle(index: number, style: string | null) {
    const C = this.compiled;
    const L = C.lines.find((x) => x.index === index);
    if (!L) return;
    const start = L.start;
    const next = C.lines.filter((x) => x.start > start + 1e-3).sort((a, b) => a.start - b.start)[0];
    const at = (t: number) => (e: StyleEvent) => Math.abs(e.time - t) < 1e-3;
    this.mutate((p) => {
      const before = segmentAt(C.lyricSegs, start - 1e-3).styleId;
      let list = p.lyricStyleEvents.filter((e) => !at(start)(e));
      if (style) {
        list.push({ id: uid(), time: start, style });
        if (next && !list.some(at(next.start))) list.push({ id: uid(), time: next.start, style: before });
      }
      p.lyricStyleEvents = list.sort((a, b) => a.time - b.time);
    });
  }

  modeName() {
    return modeInfo(this.mode).name;
  }

  // ------------------------------------------------------------------ media
  setStatus(msg: string) {
    const el = $('#status');
    if (el) el.textContent = msg;
  }

  /** store = false: restoring the song of the project (its audio id is `forId`; skipped if the project's song changed). */
  async setAudioFile(file: Blob, name: string, store = true, forId?: string) {
    const stale = () => !store && this.project.audio?.id !== forId;
    // given up (another song or 新規 came in): a song still loading keeps its own status line
    const abort = () => void (this.project.audio || this.setStatus(''));
    if (stale()) return;
    this.pause();
    this.setStatus('音声を読み込み中…');
    const data = await file.arrayBuffer();
    if (stale()) return abort();
    const buf = await this.engine.load(data);
    if (!buf) return abort();
    if (store) {
      const old = this.project.audio;
      if (old) deleteMedia(old.id);
      const ref = { id: uid(), name, mime: file.type };
      await putMedia(ref.id, file);
      this.mutate((p) => {
        p.audio = ref;
        if (p.settings.title === 'UNTITLED') p.settings.title = name.replace(/\.[^.]+$/, '');
      });
    }
    this.invalidate();
    this.emit('assets');
    this.setStatus('音声を解析中…');
    const analysis = await analyzeAudio(buf, (p) => this.engine.buffer === buf && this.setStatus(`音声を解析中… ${Math.round(p * 100)}%`));
    if (this.engine.buffer !== buf) return abort();
    this.analysis = analysis;
    this.setStatus(`${name} (${fmtTime(buf.duration)})`);
    this.invalidate();
    this.emit('analysis');
  }

  async addBackgroundFile(file: File) {
    const kind: BackgroundRef['kind'] = file.type.startsWith('video') ? 'video' : 'image';
    const ref: BackgroundRef = { id: uid(), name: file.name, mime: file.type, kind };
    try {
      const a = await loadBgAsset(ref, file);
      await putMedia(ref.id, file);
      this.bgAssets.set(ref.id, a);
      this.mutate((p) => p.backgrounds.push(ref));
      this.emit('assets');
    } catch (e) {
      toast(`背景を読み込めません: ${(e as Error).message}`);
    }
  }

  async addCharacterFile(file: File) {
    const ref: CharacterRef = { id: uid(), name: file.name, mime: file.type, faceY: 0.15, scale: 1, offsetX: 0, offsetY: 0, flip: false, enabled: true };
    try {
      const a = await loadCharAsset(ref, file);
      const ar = a.img.height / a.img.width;
      ref.faceY = ar > 1.9 ? 0.11 : ar > 1.3 ? 0.18 : 0.3;
      await putMedia(ref.id, file);
      this.charAssets.set(ref.id, a);
      this.mutate((p) => p.characters.push(ref));
      this.emit('assets');
    } catch (e) {
      toast(`立ち絵を読み込めません: ${(e as Error).message}`);
    }
  }

  /**
   * Replace the image of an image character. The entry keeps its id (every recorded switch still points at it) and its
   * settings (face, size, offsets, flip); the new image is stored under a new key so undo / redo can go back.
   */
  async replaceCharacterImage(id: string, file: File) {
    const ref = this.project.characters.find((c) => c.id === id);
    if (!ref || ref.kind === 'mmd') return;
    const key = uid();
    try {
      const a = await loadCharAsset({ ...ref, media: key }, file);
      await putMedia(key, file);
      this.mutate((p) => {
        const c = p.characters.find((x) => x.id === id);
        if (!c) return;
        c.media = key;
        c.name = file.name;
        c.mime = file.type;
      });
      a.ref = this.project.characters.find((c) => c.id === id) ?? a.ref;
      this.charAssets.set(id, a);
      this.emit('assets');
      toast(`立ち絵を差し替えました: ${file.name}（記録・顔の位置・大きさ・位置はそのまま）`, 3000);
    } catch (e) {
      toast(`立ち絵を読み込めません: ${(e as Error).message}`);
    }
  }

  /** Image characters whose image key changed (undo / redo of a replacement, a loaded project): reload their sprite. */
  private async syncCharImages() {
    let changed = false;
    for (const r of this.project.characters) {
      const a = this.charAssets.get(r.id);
      const key = charMediaKey(r);
      if (r.kind === 'mmd' || a?.mediaKey === key) continue;
      const b = await getMedia(key);
      // the project may have moved on while loading (undo, redo in a row): keep only what it still asks for
      const now = this.project.characters.find((c) => c.id === r.id);
      if (!now || charMediaKey(now) !== key) continue;
      let next: CharAsset | null = null;
      if (b) {
        try {
          next = await loadCharAsset(now, b);
        } catch {
          /* unreadable: shown as not loaded */
        }
      }
      if (next) this.charAssets.set(r.id, next);
      else if (a) this.charAssets.delete(r.id);
      else continue;
      changed = true;
    }
    if (changed) {
      this.invalidate();
      this.emit('assets');
    }
  }

  removeBackground(id: string) {
    const a = this.bgAssets.get(id);
    if (a) disposeBg(a);
    this.bgAssets.delete(id);
    deleteMedia(id);
    this.mutate((p) => (p.backgrounds = p.backgrounds.filter((b) => b.id !== id)));
    this.emit('assets');
  }

  removeCharacter(id: string) {
    const ref = this.project.characters.find((c) => c.id === id);
    this.charAssets.delete(id);
    // an MMD entry owns only its pose file (the model stays until the model is removed)
    if (ref?.kind === 'mmd') {
      if (ref.mmdPose) deleteMedia(ref.mmdPose.id);
      if (ref.mmdCamera) deleteMedia(ref.mmdCamera.id);
    } else deleteMedia(ref ? charMediaKey(ref) : id);
    this.mutate((p) => (p.characters = p.characters.filter((c) => c.id !== id)));
    this.emit('assets');
  }

  // ------------------------------------------------------------------ MMD
  /** Add an MMD model from a folder (asks which model when the folder holds several). Creates its rest-pose entry. */
  async addMmdFolder(files: PathFile[]): Promise<string | null> {
    const models = files.filter((f) => MODEL_EXT.test(f.path));
    if (!models.length) {
      toast('フォルダに .pmx / .pmd が見つかりません');
      return null;
    }
    let pick = models[0].path;
    if (models.length > 1) {
      const v = await chooseOne('読み込むモデルを選択', models.map((m) => ({ value: m.path, label: m.path })));
      if (!v) return null;
      pick = v;
    }
    // keep the chosen model and the textures around it (other model variants / psd / txt are dropped)
    const dir = pick.includes('/') ? pick.slice(0, pick.lastIndexOf('/') + 1) : '';
    const keep = files.filter((f) => f.path.startsWith(dir) && (f.path === pick || (MODEL_FILE_EXT.test(f.path) && !MODEL_EXT.test(f.path))));
    const blobs = new Map<string, Blob>();
    for (const f of keep) blobs.set(normPath(f.path.slice(dir.length)), f.file);
    const file = pick.slice(pick.lastIndexOf('/') + 1);
    const mref: MmdModelRef = { id: uid(), name: file.replace(/\.(pmx|pmd)$/i, ''), model: normPath(file), files: [...blobs.keys()] };
    toast(`MMD モデルを読み込み中… ${mref.name}`, 4000);
    try {
      const model = await loadMmdModelAsset(mref, blobs);
      model.physicsOn = mref.physics !== false;
      for (const [k, b] of blobs) await putMedia(`${mref.id}/${k}`, b);
      this.mmdModels.set(mref.id, model);
      const entry: CharacterRef = {
        id: uid(), name: `${mref.name} / 基本姿勢`, mime: 'model/mmd', kind: 'mmd', mmdModel: mref.id,
        faceY: model.faceY, scale: 1, offsetX: 0, offsetY: 0, flip: false, enabled: true,
      };
      this.charAssets.set(entry.id, await makeMmdCharAsset(entry, model, null));
      this.mutate((p) => {
        p.mmdModels.push(mref);
        p.characters.push(entry);
      });
      this.emit('assets');
      toast(`MMD モデルを追加しました: ${mref.name}（ポーズ / モーションを追加すると立ち絵として増えます）`, 3000);
      return mref.id;
    } catch (e) {
      toast(`MMD モデルを読み込めません: ${(e as Error).message}`, 4000);
      return null;
    }
  }

  /**
   * Add VPD poses / VMD motions to a model: each file becomes a character entry of that model.
   * Camera VMDs (camera frames only) are attached to an entry instead: the motion added with them, or one you pick.
   */
  async addMmdPoses(modelId: string, files: File[]) {
    const mref = this.project.mmdModels.find((m) => m.id === modelId);
    const model = this.mmdModels.get(modelId);
    if (!mref || !model) return toast('モデルが読み込まれていません');
    const { inspectVmd } = await import('./engine/mmd');
    // new entries start from the model's first entry's placement
    const base = this.project.characters.find((c) => c.mmdModel === modelId);
    const cameras: File[] = [];
    const addedMotions: string[] = [];
    for (const f of files) {
      if (!CLIP_EXT.test(f.name)) continue;
      const isVmd = /\.vmd$/i.test(f.name);
      if (isVmd) {
        const info = await inspectVmd(f).catch(() => null);
        if (info && !info.bones && !info.morphs && info.camera) {
          cameras.push(f);
          continue;
        }
      }
      const pose: MmdPoseRef = { id: uid(), name: f.name.replace(/\.(vpd|vmd)$/i, ''), kind: isVmd ? 'vmd' : 'vpd' };
      const entry: CharacterRef = {
        id: uid(), name: `${mref.name} / ${pose.name}`, mime: 'model/mmd', kind: 'mmd', mmdModel: modelId, mmdPose: pose,
        faceY: base?.faceY ?? model.faceY, scale: base?.scale ?? 1, offsetX: base?.offsetX ?? 0, offsetY: base?.offsetY ?? 0,
        flip: base?.flip ?? false, enabled: true,
      };
      try {
        this.charAssets.set(entry.id, await makeMmdCharAsset(entry, model, f));
        await putMedia(pose.id, f);
        this.mutate((p) => p.characters.push(entry));
        if (isVmd) addedMotions.push(entry.id);
      } catch (e) {
        toast(`${f.name} を読み込めません: ${(e as Error).message}`, 4000);
      }
    }
    for (const f of cameras) {
      const entries = this.project.characters.filter((c) => c.mmdModel === modelId);
      const motions = entries.filter((c) => c.mmdPose?.kind === 'vmd');
      let target = addedMotions.length === 1 ? addedMotions[0] : motions.length === 1 ? motions[0].id : null;
      if (!target && entries.length) {
        target = await chooseOne(`カメラ VMD「${f.name}」を付ける立ち絵`, entries.map((c) => ({ value: c.id, label: charName(c) })));
      }
      if (target) await this.setMmdCamera(target, f);
    }
    this.emit('assets');
  }

  /** Attach (file) or remove (null) the camera VMD of an MMD entry. */
  async setMmdCamera(entryId: string, file: File | null) {
    const ref = this.project.characters.find((c) => c.id === entryId);
    const a = this.charAssets.get(entryId);
    if (!ref || !a?.mmd) return;
    if (!file) {
      if (ref.mmdCamera) deleteMedia(ref.mmdCamera.id);
      a.mmd.camera = null;
      a.mmd.key = '';
      this.mutate(() => delete ref.mmdCamera);
      this.emit('assets');
      return;
    }
    try {
      const { loadMmdCamera } = await import('./engine/mmd');
      const clip = await loadMmdCamera(file);
      const cam = { id: uid(), name: file.name.replace(/\.vmd$/i, '') };
      await putMedia(cam.id, file);
      if (ref.mmdCamera) deleteMedia(ref.mmdCamera.id);
      a.mmd.camera = clip;
      a.mmd.key = '';
      this.mutate(() => (ref.mmdCamera = cam));
      toast(`カメラを付けました: ${cam.name}（この立ち絵の間は MMD のカメラで全画面表示）`, 3000);
    } catch (e) {
      toast(`${file.name} を読み込めません: ${(e as Error).message}`, 4000);
    }
    this.emit('assets');
  }

  /** Hair / skirt physics on or off for a model (all its entries). */
  setMmdPhysics(modelId: string, on: boolean) {
    const model = this.mmdModels.get(modelId);
    if (model) model.physicsOn = on;
    for (const a of this.charAssets.values()) if (a.ref.mmdModel === modelId && a.mmd) a.mmd.key = '';
    this.mutate((p) => {
      const m = p.mmdModels.find((x) => x.id === modelId);
      if (m) m.physics = on;
    });
  }

  /** Remove a model with all its entries. */
  removeMmdModel(modelId: string) {
    const mref = this.project.mmdModels.find((m) => m.id === modelId);
    for (const c of this.project.characters.filter((x) => x.mmdModel === modelId)) {
      this.charAssets.delete(c.id);
      if (c.mmdPose) deleteMedia(c.mmdPose.id);
      if (c.mmdCamera) deleteMedia(c.mmdCamera.id);
    }
    this.mmdModels.get(modelId)?.dispose();
    this.mmdModels.delete(modelId);
    for (const f of mref?.files ?? []) deleteMedia(`${modelId}/${f}`);
    this.mutate((p) => {
      p.characters = p.characters.filter((c) => c.mmdModel !== modelId);
      p.mmdModels = p.mmdModels.filter((m) => m.id !== modelId);
    });
    this.emit('assets');
  }

  /** Model for dropped VPD / VMD files: the only one, or ask. */
  private async pickMmdModel(): Promise<string | null> {
    const ms = this.project.mmdModels.filter((m) => this.mmdModels.has(m.id));
    if (!ms.length) {
      toast('先に MMD モデルのフォルダを追加してください');
      return null;
    }
    if (ms.length === 1) return ms[0].id;
    return chooseOne('ポーズ / モーションを追加するモデル', ms.map((m) => ({ value: m.id, label: m.name })));
  }

  /** Drop with folder paths: MMD model folders and VPD / VMD files are picked out, the rest as before. */
  async handleDropPaths(files: PathFile[]) {
    let added: string | null = null;
    if (files.some((f) => MODEL_EXT.test(f.path))) {
      // one model per top-level folder
      const roots = [...new Set(files.filter((f) => MODEL_EXT.test(f.path)).map((f) => f.path.split('/')[0]))];
      for (const r of roots) added = (await this.addMmdFolder(files.filter((f) => f.path.split('/')[0] === r))) ?? added;
      files = files.filter((f) => !roots.includes(f.path.split('/')[0]) || CLIP_EXT.test(f.path));
    }
    const poses = files.filter((f) => CLIP_EXT.test(f.path)).map((f) => f.file);
    if (poses.length) {
      const id = added ?? (await this.pickMmdModel());
      if (id) await this.addMmdPoses(id, poses);
    }
    const rest = files.filter((f) => !CLIP_EXT.test(f.path)).map((f) => f.file);
    if (rest.length) await this.handleDrop(rest);
  }

  async handleDrop(files: File[]) {
    for (const f of files) {
      if (f.type.startsWith('audio') || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name)) await this.setAudioFile(f, f.name);
      else if (f.type.startsWith('video')) await this.addBackgroundFile(f);
      else if (f.type.startsWith('image')) {
        // PNG with transparency → character, otherwise background
        if (await hasAlpha(f)) await this.addCharacterFile(f);
        else await this.addBackgroundFile(f);
      } else if (f.name.endsWith('.json')) await this.loadProjectFile(f);
    }
  }

  /** Restore media blobs of the current project from IndexedDB. */
  async restoreMedia() {
    const p = this.project;
    const missing: string[] = [];
    if (p.audio) {
      const { id, name } = p.audio;
      const b = await getMedia(id);
      if (b) await this.setAudioFile(b, name, false, id).catch(() => missing.push(name));
      else missing.push(p.audio.name);
    }
    for (const r of p.backgrounds) {
      if (this.bgAssets.has(r.id)) continue;
      const b = await getMedia(r.id);
      if (b) {
        try {
          this.bgAssets.set(r.id, await loadBgAsset(r, b));
        } catch {
          missing.push(r.name);
        }
      } else missing.push(r.name);
    }
    for (const m of p.mmdModels) {
      if (this.mmdModels.has(m.id)) continue;
      const blobs = new Map<string, Blob>();
      for (const f of m.files) {
        const b = await getMedia(`${m.id}/${f}`);
        if (b) blobs.set(f, b);
      }
      try {
        if (!blobs.has(m.model)) throw new Error('model file missing');
        const model = await loadMmdModelAsset(m, blobs);
        model.physicsOn = m.physics !== false;
        this.mmdModels.set(m.id, model);
      } catch {
        missing.push(m.name);
      }
    }
    for (const r of p.characters) {
      if (this.charAssets.has(r.id)) continue;
      if (r.kind === 'mmd') {
        const model = r.mmdModel ? this.mmdModels.get(r.mmdModel) : undefined;
        if (!model) continue; // reported with its model
        try {
          const b = r.mmdPose ? await getMedia(r.mmdPose.id) : null;
          if (r.mmdPose && !b) throw new Error('pose file missing');
          const cam = r.mmdCamera ? await getMedia(r.mmdCamera.id) : null;
          this.charAssets.set(r.id, await makeMmdCharAsset(r, model, b, cam));
        } catch {
          missing.push(r.name);
        }
        continue;
      }
      const b = await getMedia(charMediaKey(r));
      if (b) {
        try {
          this.charAssets.set(r.id, await loadCharAsset(r, b));
        } catch {
          missing.push(r.name);
        }
      } else missing.push(r.name);
    }
    if (missing.length) toast(`見つからない素材: ${missing.join(', ')}`, 4000);
    this.invalidate();
    this.emit('assets');
  }

  // ------------------------------------------------------------------ project files
  saveProjectFile() {
    const blob = new Blob([JSON.stringify(this.project, null, 1)], { type: 'application/json' });
    downloadBlob(blob, `${this.settings.title || 'project'}.minamo.json`);
    toast('プロジェクトを保存しました（素材ファイルはブラウザ内に保存）');
  }

  async loadProjectFile(file: File) {
    try {
      const p = JSON.parse(await file.text());
      this.history.push(this.project);
      this.replaceProject(p, false);
      await this.restoreMedia();
      await this.syncCharImages(); // same entry as a loaded one but another image
      toast('プロジェクトを読み込みました');
    } catch (e) {
      toast(`読み込み失敗: ${(e as Error).message}`);
    }
  }

  /**
   * Start over with an empty project (sample lyrics, no media). Not undoable: undo does not bring media back, so the
   * history is cleared. The old media stay in IndexedDB (a re-loaded .json finds them).
   */
  newBlankProject() {
    this.pause();
    this.engine.unload();
    this.analysis = null;
    this.setStatus('');
    this.replaceProject(newProject(), true);
    this.seek(0);
    this.emit('analysis');
    toast('新規プロジェクトにしました');
  }

  /** Replace the current project with the demo (undo goes back). */
  async openDemo() {
    try {
      toast('デモを読み込み中…', 1500);
      const demo = await loadDemoProject();
      if (!demo) return toast('デモのプロジェクトがありません');
      this.history.push(this.project);
      this.replaceProject(demo.project, false);
      await this.restoreMedia();
      await this.syncCharImages();
      this.seek(demo.start);
      toast('デモを開きました（Ctrl+Z で元のプロジェクトに戻せます）', 3000);
    } catch (e) {
      toast(`デモを読み込めません: ${(e as Error).message}`);
    }
  }

  newProjectKeepMedia(clearTimings: boolean) {
    this.mutate((p) => {
      if (clearTimings) {
        p.lines = p.lines.map((l) => ({ ...l, times: l.times.map(() => null), end: null }));
        p.telops = p.telops.map((x) => ({ ...x, start: null, dur: null }));
        p.lyricStyleEvents = [];
        p.lyricEvents = [];
        p.telopEvents = [];
        p.charaEvents = [];
        p.camEvents = [];
        p.fxEvents = [];
        p.vizEvents = [];
        p.lookEvents = [];
      }
    });
  }

  async init() {
    let demoStart = 0;
    const saved = loadProjectLocal();
    if (saved) this.project = normalizeProject(saved);
    else if (demoEnabled()) {
      // first visit: open the demo project (public/demo) and keep it as the saved project
      const demo = await loadDemoProject().catch((e) => {
        console.warn('demo project', e);
        return null;
      });
      if (demo) {
        this.project = normalizeProject(demo.project);
        saveProjectLocal(this.project);
        this.firstVisit = true;
        demoStart = demo.start;
      }
    }
    const lyricIds = listLyricStyles().map((s) => s.id);
    const lookIds = listLookStyles().map((s) => s.id);
    if (!lyricIds.includes(this.settings.lyricStyle)) this.settings.lyricStyle = lyricIds[0];
    if (!lookIds.includes(this.settings.lookStyle)) this.settings.lookStyle = lookIds[0];
    this.recompile();
    ensureFonts(this.fontText()).then(() => this.invalidate());
    await this.restoreMedia();
    // the demo opens where the singing begins (demo.json "start")
    if (demoStart) this.seek(demoStart);
  }

  // ------------------------------------------------------------------ loop
  private syncVideos(playing: boolean, t: number) {
    const bgs = this.loadedBgs();
    if (!bgs.length || !this.compiled) return;
    const active = bgs[this.bgIndexAt(t)];
    for (const b of bgs) {
      const v = b.video;
      if (!v) continue;
      if (b !== active) {
        if (!v.paused) v.pause();
        continue;
      }
      const target = v.duration ? t % v.duration : 0;
      if (playing) {
        if (v.playbackRate !== this.engine.rate) v.playbackRate = this.engine.rate;
        if (v.paused) v.play().catch(() => {});
        if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
      }
    }
  }

  tick() {
    if (this.exporting) return;
    if (this.recording) this.pruneTake();
    else {
      this.followCursor();
      this.followTelop();
    }
    if (this.dirty) this.recompile();
    const t = this.time;
    const playing = this.engine.playing;
    const hasVideo = this.loadedBgs().some((b) => b.video);
    if (playing || this.needsFrame || t !== this.lastT || hasVideo) {
      this.syncVideos(playing, t);
      this.renderer.render(t, this.frameInput());
      this.needsFrame = false;
      this.lastT = t;
    }
    this.emit('frame');
  }
}

async function hasAlpha(file: File): Promise<boolean> {
  if (!/png|webp|gif|avif/i.test(file.type)) return false;
  try {
    const bmp = await createImageBitmap(file);
    const w = Math.min(64, bmp.width), h = Math.min(64, bmp.height);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(bmp, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    let transparent = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 200) transparent++;
    return transparent / (w * h) > 0.05;
  } catch {
    return false;
  }
}
