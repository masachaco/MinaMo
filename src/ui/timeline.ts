// Multi-track timeline (MTR style): LYRICS / TELOP / CHARA / CAMERA / FX / VISUAL / LOOK / AUDIO.
// LYRICS has a lyric-style strip on top and, like TELOP, an effect / motion strip at the bottom.
// Click a track name to arm it. Drag items to edit, right-click to delete. Recording itself happens via REC.

import { TRACK_LIST, type App, type EventTrack, type Selection } from '../app';
import type { CamEvent, CharaEvent, LookEvent, TrackId } from '../core/types';
import { listPalettes, getFx, getStyle, getVisualizer, type ElemTarget } from '../engine/api';
import type { Step } from '../engine/channels';
import { parseEffects, type CSegment } from '../engine/compile';
import { allEffects, allFrames, allMotions, allMoves, nameOf, POSITIONS } from '../engine/director';
import { clamp, fmtTime } from '../engine/lib';
import { firstTargetAfter, lineChars, tapTargets } from '../core/lyrics';
import { popupMenu, type MenuItem } from './dom';
import { charLabel, modeInfo, perfKeys, VIZ_COLORS, VIZ_LAYERS, VIZ_POSITIONS, VIZ_SIZES, type PerfKey } from '../perform';

const LABEL_W = 84;
type RowId = 'ruler' | TrackId | 'wave';
const ROW_H: Record<Exclude<RowId, 'wave'>, number> = { ruler: 20, lyrics: 62, telop: 34, chara: 26, camera: 24, fx: 24, viz: 24, look: 30 };
const ORDER: RowId[] = ['ruler', 'lyrics', 'telop', 'chara', 'camera', 'fx', 'viz', 'look', 'wave'];
const STRIP = 12; // lyric-style strip / look-style band height
const ELEM_STRIP = 11; // effect / motion strip at the bottom of the lyrics and telop rows

interface Drag {
  kind: 'seek' | 'item' | 'pan';
  sel?: Selection;
  x0: number;
  start0: number;
  orig?: any;
  moved: boolean;
}

const KIND_COLOR: Record<string, string> = {
  char: '#ffd36e', pos: '#7cf6ff', effect: '#ff8fb8', motion: '#9dff6b',
  frame: '#7cf6ff', move: '#b7a0ff',
  type: '#9dff6b', size: '#dddddd', layer: '#b7a0ff', color: '#ffb3c7',
  bg: '#6bdcff', palette: '#ffb3c7', dim: '#dddddd', style: '#b58bff',
};

export class Timeline {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  start = 0;
  pps = 60;
  follow = true;
  snap = true;
  private drag: Drag | null = null;
  private staticDirty = true;
  private rows: { id: RowId; y: number; h: number }[] = [];

  constructor(private app: App, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', () => this.onUp());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => this.onContext(e));
    canvas.addEventListener('dblclick', (e) => this.onDblClick(e));
    canvas.addEventListener('mousemove', (e) => this.onHover(e));
    for (const ev of ['project', 'compiled', 'selection', 'analysis', 'registry', 'mode', 'rec']) app.on(ev, () => this.invalidate());
    this.resize();
  }

  invalidate() {
    this.staticDirty = true;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.W = Math.max(100, r.width);
    this.H = Math.max(60, r.height);
    for (const c of [this.canvas, this.layer]) {
      c.width = Math.round(this.W * this.dpr);
      c.height = Math.round(this.H * this.dpr);
    }
    let y = 0;
    this.rows = ORDER.map((id) => {
      const h = id === 'wave' ? Math.max(18, this.H - y) : ROW_H[id];
      const row = { id, y, h };
      y += h;
      return row;
    });
    this.invalidate();
  }

  // ---------------------------------------------------------------- coords
  x(t: number) {
    return LABEL_W + (t - this.start) * this.pps;
  }
  tAt(x: number) {
    return this.start + (x - LABEL_W) / this.pps;
  }
  get viewDur() {
    return (this.W - LABEL_W) / this.pps;
  }
  private row(id: RowId) {
    return this.rows.find((t) => t.id === id)!;
  }
  private rowAt(y: number): RowId {
    for (const t of this.rows) if (y >= t.y && y < t.y + t.h) return t.id;
    return 'wave';
  }

  zoom(f: number, aroundX = LABEL_W + (this.W - LABEL_W) / 2) {
    const t = this.tAt(aroundX);
    this.pps = clamp(this.pps * f, 4, 900);
    this.start = t - (aroundX - LABEL_W) / this.pps;
    this.clampView();
    this.invalidate();
  }

  fit() {
    this.pps = clamp((this.W - LABEL_W - 10) / Math.max(1, this.app.duration), 2, 900);
    this.start = 0;
    this.invalidate();
  }

  private clampView() {
    this.start = clamp(this.start, -2, Math.max(0, this.app.duration - this.viewDur * 0.5));
  }

  private snapT(t: number, e: MouseEvent): number {
    if (!this.snap || e.altKey || !this.app.compiled) return t;
    return this.app.compiled.grid.quantize(t, this.app.settings.quantize || 4);
  }

  // ---------------------------------------------------------------- labels
  /** Label of an effect / motion value of an element. */
  private elemLabel(target: ElemTarget, kind: string, value: string): string {
    if (kind === 'motion') return nameOf(allMotions(target), value);
    return parseEffects(value).map((x) => nameOf(allEffects(target), x)).join('+') || '効果なし';
  }

  private eventLabel(track: EventTrack, e: any): string {
    switch (track) {
      case 'lstyle':
        return getStyle(e.style)?.name ?? e.style;
      case 'lfx':
        return this.elemLabel('lyrics', e.kind, e.value);
      case 'tfx':
        return this.elemLabel('telop', e.kind, e.value);
      case 'fx':
        return getFx(e.fx)?.name ?? e.fx;
      case 'chara': {
        const ev = e as CharaEvent;
        if (ev.value === 'auto') return { char: 'キャラA', pos: '位置A', effect: '効果A', motion: '動きA' }[ev.kind];
        if (ev.kind === 'char') {
          const ch = this.app.project.characters.find((c) => c.id === ev.value);
          return ev.value === 'none' ? '隠す' : ch ? charLabel(ch) : '?';
        }
        if (ev.kind === 'pos') return nameOf(POSITIONS, ev.value);
        return this.elemLabel('chara', ev.kind, ev.value);
      }
      case 'cam': {
        const ev = e as CamEvent;
        if (ev.value === 'auto') return ev.kind === 'frame' ? 'フレームA' : 'ムーブA';
        return (ev.kind === 'frame' ? nameOf(allFrames(), ev.value) : nameOf(allMoves(), ev.value)) + (ev.smooth ? '〜' : '');
      }
      case 'viz': {
        const nm = (list: { id: string; name: string }[]) => list.find((x) => x.id === e.value)?.name ?? e.value;
        if (e.kind === 'type') return e.value === 'none' ? '消す' : getVisualizer(e.value)?.name ?? e.value;
        if (e.kind === 'pos') return nm(VIZ_POSITIONS);
        if (e.kind === 'color') return nm(VIZ_COLORS);
        if (e.kind === 'size') return `サイズ${nm(VIZ_SIZES)}`;
        return nm(VIZ_LAYERS);
      }
      case 'look': {
        const ev = e as LookEvent;
        if (ev.kind === 'style') {
          const nm = getStyle(ev.value)?.name ?? ev.value;
          if (ev.transition === 'none') return `${nm}（切替なし）`;
          return ev.transition ? `${nm} → ${getFx(ev.transition)?.name ?? ev.transition}` : nm;
        }
        if (ev.value === 'auto') return { bg: '背景A', palette: 'パレットA', dim: '明るさA' }[ev.kind] ?? 'A';
        if (ev.kind === 'bg') return ev.value === 'none' ? '背景なし' : `BG${parseInt(ev.value, 10) + 1}`;
        if (ev.kind === 'palette') return listPalettes().find((p) => p.id === ev.value)?.name ?? ev.value;
        return `暗さ${Math.round(parseFloat(ev.value) * 100)}%`;
      }
    }
  }

  private eventColor(track: EventTrack, e: any): string {
    if (track === 'lstyle') return getStyle(e.style)?.color ?? '#888';
    if (track === 'fx') return getFx(e.fx)?.color ?? '#888';
    if (track === 'look' && e.kind === 'palette') return listPalettes().find((p) => p.id === e.value)?.accent ?? KIND_COLOR.palette;
    if (track === 'viz' && e.kind === 'type') return getVisualizer(e.value)?.color ?? '#888';
    return KIND_COLOR[e.kind] ?? '#aaa';
  }

  // ---------------------------------------------------------------- drawing
  draw(t: number) {
    const { app } = this;
    if (!app.compiled) return;
    if (this.follow && app.engine.playing && !this.drag) {
      const vd = this.viewDur;
      if (t > this.start + vd * 0.85 || t < this.start) {
        this.start = t - vd * 0.15;
        this.invalidate();
      }
    }
    if (this.staticDirty) this.drawStatic();
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.layer, 0, 0);
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const px = this.x(t);
    if (px >= LABEL_W && px <= this.W) {
      c.fillStyle = app.recording ? '#ff2a3d' : '#ffffff';
      c.fillRect(px - 0.75, 0, 1.5, this.H);
      c.beginPath();
      c.moveTo(px - 6, 0);
      c.lineTo(px + 6, 0);
      c.lineTo(px, 8);
      c.fill();
    }
    if (app.recording) this.invalidate(); // recorded range grows
  }

  private drawSegments(c: CanvasRenderingContext2D, segs: CSegment[], y: number, h: number) {
    const W = this.W;
    for (const seg of segs) {
      const xa = Math.max(LABEL_W, this.x(seg.start)), xb = Math.min(W, this.x(Math.min(seg.end, this.app.duration)));
      if (xb <= LABEL_W || xa >= W) continue;
      c.fillStyle = hexA(seg.style.color, 0.3);
      c.fillRect(xa, y, xb - xa, h);
      c.fillStyle = seg.style.color;
      c.fillRect(xa, y, 2, h);
      if (xb - xa > 30) {
        c.save();
        c.beginPath();
        c.rect(xa, y, xb - xa - 2, h);
        c.clip();
        c.fillStyle = '#f0f0f6';
        c.font = '700 9px "Montserrat", sans-serif';
        c.fillText(seg.style.name, xa + 5, y + h / 2 + 1);
        c.restore();
      }
    }
  }

  /** Effect / motion strip of the lyrics or telops: bands where effects (upper half) / a motion (lower half) are on, then the events. */
  private drawElemStrip(c: CanvasRenderingContext2D, track: EventTrack, plan: { effect: Step<string[]>[]; motion: Step<string>[] }, y: number, h: number) {
    const W = this.W;
    c.fillStyle = 'rgba(255,255,255,0.03)';
    c.fillRect(LABEL_W, y, W - LABEL_W, h);
    const bands = <T>(steps: Step<T>[], on: (v: T) => boolean, color: string, by: number, bh: number) => {
      c.fillStyle = color;
      steps.forEach((s, i) => {
        if (!on(s.v)) return;
        const xa = Math.max(LABEL_W, this.x(s.t)), xb = Math.min(W, this.x(steps[i + 1]?.t ?? this.app.duration));
        if (xb > xa) c.fillRect(xa, by, xb - xa, bh);
      });
    };
    bands(plan.effect, (v) => v.length > 0, hexA(KIND_COLOR.effect, 0.28), y + 1, h / 2 - 1);
    bands(plan.motion, (v) => v !== 'idle', hexA(KIND_COLOR.motion, 0.28), y + h / 2, h / 2 - 1);
    this.drawEvents(c, track, y, h);
  }

  private drawEvents(c: CanvasRenderingContext2D, track: EventTrack, y: number, h: number, opts: { hold?: boolean } = {}) {
    const sel = this.app.selection;
    const W = this.W;
    const list = this.app.eventList(track) as any[];
    let lastLabelX = -Infinity;
    for (const e of list) {
      const x = this.x(e.time);
      if (opts.hold && e.hold > 0) {
        const xb = this.x(e.time + e.hold);
        if (xb > LABEL_W && x < W) {
          c.fillStyle = hexA(this.eventColor(track, e), 0.3);
          c.fillRect(Math.max(LABEL_W, x), y + h * 0.3, xb - Math.max(LABEL_W, x), h * 0.4);
        }
      }
      if (x < LABEL_W - 6 || x > W + 6) continue;
      const on = sel?.type === 'ev' && sel.track === track && sel.id === e.id;
      c.fillStyle = on ? '#ffffff' : this.eventColor(track, e);
      diamond(c, x, y + h / 2, on ? 6 : 4.5);
      if (this.pps > 40 && x - lastLabelX > 46) {
        c.fillStyle = on ? '#ffffff' : '#a8a8c0';
        c.font = '10px "Noto Sans JP", sans-serif';
        c.fillText(this.eventLabel(track, e), x + 7, y + h / 2 + 1);
        lastLabelX = x;
      }
    }
  }

  private drawStatic() {
    this.staticDirty = false;
    const { app } = this;
    const C = app.compiled;
    const c = this.lctx;
    const W = this.W, H = this.H;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#0d0d13';
    c.fillRect(0, 0, W, H);
    c.textBaseline = 'middle';
    const t0 = this.tAt(LABEL_W), t1 = this.tAt(W);
    const grid = C.grid;
    const armed = app.mode;

    for (const r of this.rows) {
      const isArmed = r.id === armed;
      c.fillStyle = isArmed ? (app.recording ? '#1c1014' : '#12121c') : r.id === 'ruler' ? '#111119' : '#0d0d13';
      c.fillRect(LABEL_W, r.y, W - LABEL_W, r.h);
      c.fillStyle = '#1b1b26';
      c.fillRect(0, r.y + r.h - 1, W, 1);
    }

    // recorded range of the current take
    if (app.recording) {
      const rs = app.recordStart;
      const xa = Math.max(LABEL_W, this.x(rs)), xb = this.x(app.time);
      const r = this.row(armed);
      c.fillStyle = 'rgba(255,42,61,0.12)';
      c.fillRect(xa, r.y, Math.max(0, xb - xa), r.h);
    }

    // waveform
    const wv = this.row('wave');
    const a = app.analysis;
    if (a) {
      const mid = wv.y + wv.h / 2;
      const amp = wv.h * 0.46;
      c.fillStyle = '#2b5f6b';
      for (let x = LABEL_W; x < W; x++) {
        const ta = this.tAt(x), tb = this.tAt(x + 1);
        if (tb < 0 || ta > a.duration) continue;
        let i0 = Math.max(0, Math.floor(ta * a.peakRate));
        const i1 = Math.min(a.peakMax.length - 1, Math.max(i0, Math.ceil(tb * a.peakRate)));
        let mn = 0, mx = 0;
        for (; i0 <= i1; i0++) {
          if (a.peakMin[i0] < mn) mn = a.peakMin[i0];
          if (a.peakMax[i0] > mx) mx = a.peakMax[i0];
        }
        c.fillRect(x, mid - mx * amp, 1, Math.max(1, (mx - mn) * amp));
      }
    } else {
      c.fillStyle = '#44445a';
      c.font = '11px "Noto Sans JP", sans-serif';
      c.fillText('音楽ファイルを読み込むと波形が表示されます', LABEL_W + 12, wv.y + wv.h / 2);
    }

    // beat grid
    const beatPx = grid.spb * this.pps;
    const barPx = grid.barDur * this.pps;
    let labelEvery = 1;
    while (barPx * labelEvery < 34) labelEvery *= 2;
    const b0 = Math.floor(grid.beatAt(Math.max(0, t0))) - 1;
    const b1 = Math.ceil(grid.beatAt(t1)) + 1;
    const ruler = this.row('ruler');
    c.font = '10px "Share Tech Mono", monospace';
    for (let b = b0; b <= b1; b++) {
      const tt = grid.timeOfBeat(b);
      if (tt < 0) continue;
      const x = Math.round(this.x(tt)) + 0.5;
      if (x < LABEL_W) continue;
      const isBar = ((b % grid.beatsPerBar) + grid.beatsPerBar) % grid.beatsPerBar === 0;
      if (!isBar && beatPx < 6) continue;
      const bar = Math.floor(b / grid.beatsPerBar);
      c.fillStyle = isBar ? (bar % labelEvery === 0 ? '#2e2e40' : '#1f1f2c') : '#17171f';
      c.fillRect(x, ruler.y + (isBar ? 0 : 12), 1, H);
      if (isBar && bar % labelEvery === 0) {
        c.fillStyle = '#9090a8';
        c.fillText(String(bar + 1), x + 3, ruler.y + 9);
      }
    }

    // LYRICS: style strip + blocks + effect / motion strip
    const ly = this.row('lyrics');
    const sel = app.selection;
    this.drawSegments(c, C.lyricSegs, ly.y + 1, STRIP - 2);
    this.drawEvents(c, 'lstyle', ly.y, STRIP);
    this.drawElemStrip(c, 'lfx', C.elem.lyrics, ly.y + ly.h - ELEM_STRIP - 1, ELEM_STRIP);
    const by = ly.y + STRIP, bh = ly.h - STRIP - ELEM_STRIP - 1;
    for (const L of C.lines) {
      const xa = this.x(L.start), xb = this.x(L.end);
      if (xb < LABEL_W || xa > W) continue;
      const on = !!sel && sel.type !== 'ev' && sel.index === L.index;
      const col = L.style.color;
      const xa2 = Math.max(LABEL_W, xa);
      c.fillStyle = hexA(col, on ? 0.38 : 0.18);
      c.fillRect(xa2, by + 3, Math.max(2, xb - xa2), bh - 6);
      c.fillStyle = on ? '#ffffff' : col;
      if (xa >= LABEL_W) c.fillRect(xa - 1, by + 1, 3, bh - 2);
      L.gt.forEach((gt, i) => {
        if (i === 0) return;
        const x = this.x(gt);
        if (x < LABEL_W || x > W) return;
        const gOn = sel?.type === 'glyph' && sel.index === L.index && sel.glyph === i;
        const tap = L.gtap[i];
        if (!tap && this.pps < 40) return;
        c.fillStyle = gOn ? '#ffffff' : tap ? hexA(col, 0.95) : hexA(col, 0.4);
        c.fillRect(x - 0.5, by + bh - (tap ? 15 : 8), tap ? 2 : 1, tap ? 12 : 5);
      });
      if (L.line.end != null) {
        const x = this.x(L.line.end);
        if (x >= LABEL_W && x <= W) {
          c.fillStyle = sel?.type === 'end' && sel.index === L.index ? '#ffffff' : '#ff8a9a';
          c.fillRect(x - 1, by + 4, 2, bh - 8);
          c.fillRect(x - 6, by + 4, 6, 2);
          c.fillRect(x - 6, by + bh - 6, 6, 2);
        }
      }
      if (xb - xa2 > 24) {
        c.save();
        c.beginPath();
        c.rect(xa2 + 4, by, xb - xa2 - 8, bh);
        c.clip();
        c.fillStyle = '#f0f0f6';
        c.font = '600 11px "Noto Sans JP", sans-serif';
        c.fillText(L.line.text, xa2 + 6, by + 12);
        c.restore();
      }
    }

    // TELOP: blocks from start to start + length (drag the right edge to change the length) + effect / motion strip
    const trow = this.row('telop');
    this.drawElemStrip(c, 'tfx', C.elem.telop, trow.y + trow.h - ELEM_STRIP - 1, ELEM_STRIP);
    const tr = { y: trow.y, h: trow.h - ELEM_STRIP - 1 };
    for (const tp of C.telops) {
      const xa = this.x(tp.start), xb = this.x(tp.start + tp.dur);
      if (xb < LABEL_W || xa > W) continue;
      const on = sel?.type === 'telop' && sel.index === tp.index;
      const xa2 = Math.max(LABEL_W, xa);
      c.fillStyle = hexA(tp.def.color, on ? 0.45 : 0.22);
      c.fillRect(xa2, tr.y + 3, Math.max(2, xb - xa2), tr.h - 6);
      c.fillStyle = on ? '#ffffff' : tp.def.color;
      if (xa >= LABEL_W) c.fillRect(xa - 1, tr.y + 2, 3, tr.h - 4);
      if (xb <= W) c.fillRect(xb - 2, tr.y + 5, 2, tr.h - 10);
      if (tp.telop.dur == null && xb - xa2 > 14) {
        // default length marker (…)
        c.fillStyle = hexA(tp.def.color, 0.7);
        c.fillRect(xb - 9, tr.y + tr.h / 2 - 1, 2, 2);
        c.fillRect(xb - 6, tr.y + tr.h / 2 - 1, 2, 2);
      }
      if (xb - xa2 > 30) {
        c.save();
        c.beginPath();
        c.rect(xa2 + 4, tr.y, xb - xa2 - 12, tr.h);
        c.clip();
        c.fillStyle = '#f0f0f6';
        c.font = '10px "Noto Sans JP", sans-serif';
        c.fillText(`[${tp.def.name}] ${tp.text}`, xa2 + 6, tr.y + tr.h / 2 + 1);
        c.restore();
      }
    }

    // CHARA / CAMERA: director changes (only where a track is switched to オート) + recorded events
    const ch = this.row('chara');
    const cam = this.row('camera');
    c.fillStyle = 'rgba(124,246,255,0.35)';
    const autoTicks = (steps: { t: number; rec: boolean }[], y: number) => {
      for (const s of steps) {
        if (s.rec) continue;
        const x = this.x(s.t);
        if (x >= LABEL_W && x <= W) c.fillRect(x, y, 5, 2);
      }
    };
    autoTicks([...C.stage.char, ...C.stage.pos], ch.y + ch.h - 5);
    autoTicks([...C.stage.frame, ...C.stage.move], cam.y + cam.h - 5);
    this.drawEvents(c, 'chara', ch.y, ch.h);
    this.drawEvents(c, 'cam', cam.y, cam.h);
    // FX
    const fx = this.row('fx');
    this.drawEvents(c, 'fx', fx.y, fx.h, { hold: true });
    // VISUAL: active visualizer band + events
    const vr = this.row('viz');
    for (let i = 0; i < C.viz.type.length; i++) {
      const s = C.viz.type[i];
      if (s.v === 'none') continue;
      const xa = Math.max(LABEL_W, this.x(s.t)), xb = Math.min(W, this.x(C.viz.type[i + 1]?.t ?? app.duration));
      if (xb <= LABEL_W || xa >= W) continue;
      c.fillStyle = hexA(getVisualizer(s.v)?.color ?? '#888888', 0.16);
      c.fillRect(xa, vr.y + 3, xb - xa, vr.h - 6);
    }
    this.drawEvents(c, 'viz', vr.y, vr.h);
    // LOOK: style band + events
    const lk = this.row('look');
    this.drawSegments(c, C.lookSegs, lk.y + 1, STRIP - 2);
    this.drawEvents(c, 'look', lk.y + STRIP - 2, lk.h - STRIP + 2);

    // labels (click to arm)
    c.fillStyle = '#0f0f16';
    c.fillRect(0, 0, LABEL_W, H);
    c.fillStyle = '#1b1b26';
    c.fillRect(LABEL_W - 1, 0, 1, H);
    for (const r of this.rows) {
      if (r.id === 'ruler' || r.id === 'wave') continue;
      const info = modeInfo(r.id);
      const isArmed = r.id === armed;
      const cy = r.y + Math.min(r.h / 2, 14);
      c.fillStyle = isArmed ? (app.recording ? '#ff2a3d' : info.color) : '#3a3a4e';
      c.beginPath();
      c.arc(12, cy, 4, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = isArmed ? '#f0f0f6' : '#76768e';
      c.font = '700 10px "Montserrat", sans-serif';
      c.fillText(info.en, 22, cy + 1);
    }
    const wr = this.row('wave');
    c.fillStyle = '#56566c';
    c.font = '700 10px "Montserrat", sans-serif';
    c.fillText('AUDIO', 22, wr.y + Math.min(wr.h / 2, 14));
    c.fillStyle = app.recording ? '#ff2a3d' : '#56566c';
    c.font = '10px "Share Tech Mono", monospace';
    c.fillText(app.recording ? `● REC ${modeInfo(armed).en}` : `${Math.round(grid.bpm)} BPM`, 8, ruler.y + 10);
  }

  // ---------------------------------------------------------------- hit test
  /** y is on the effect / motion strip of the lyrics or telop row. */
  private inElemStrip(r: 'lyrics' | 'telop', y: number): boolean {
    const row = this.row(r);
    return y >= row.y + row.h - ELEM_STRIP - 1;
  }

  private nearestEvent(track: EventTrack, x: number): Selection | null {
    let best: Selection | null = null, bd = 8;
    for (const e of this.app.eventList(track)) {
      const d = Math.abs(this.x(e.time) - x);
      if (d < bd) {
        bd = d;
        best = { type: 'ev', track, id: e.id };
      }
    }
    return best;
  }

  private hit(x: number, y: number): Selection | null {
    const C = this.app.compiled;
    const r = this.rowAt(y);
    const near = (t: number, rad = 6) => Math.abs(this.x(t) - x) <= rad;
    if ((r === 'lyrics' || r === 'telop') && this.inElemStrip(r, y)) return this.nearestEvent(r === 'lyrics' ? 'lfx' : 'tfx', x);
    if (r === 'telop') {
      for (const tp of [...C.telops].reverse()) if (near(tp.start + tp.dur, 5)) return { type: 'telop', index: tp.index, part: 'end' };
      const t = this.tAt(x);
      for (const tp of [...C.telops].reverse()) if (t >= tp.start - 4 / this.pps && t <= tp.start + tp.dur) return { type: 'telop', index: tp.index, part: 'body' };
      return null;
    }
    if (r === 'chara') return this.nearestEvent('chara', x);
    if (r === 'camera') return this.nearestEvent('cam', x);
    if (r === 'fx') return this.nearestEvent('fx', x);
    if (r === 'viz') return this.nearestEvent('viz', x);
    if (r === 'look') return this.nearestEvent('look', x);
    if (r === 'lyrics') {
      const ly = this.row('lyrics');
      if (y < ly.y + STRIP) return this.nearestEvent('lstyle', x);
      for (const L of C.lines) if (L.line.end != null && near(L.line.end, 5)) return { type: 'end', index: L.index };
      for (const L of C.lines)
        for (let i = 1; i < L.gt.length; i++) if (L.gtap[i] && near(L.gt[i], 4)) return { type: 'glyph', index: L.index, glyph: i };
      for (const L of C.lines) if (near(L.start, 6)) return { type: 'line', index: L.index };
      const t = this.tAt(x);
      for (const L of C.lines) if (t >= L.start && t <= L.end) return { type: 'line', index: L.index };
    }
    return null;
  }

  private origOf(sel: Selection): any {
    const p = this.app.project;
    switch (sel.type) {
      case 'line': {
        const l = p.lines[sel.index];
        return { times: [...l.times], end: l.end };
      }
      case 'glyph':
        return p.lines[sel.index].times[sel.glyph];
      case 'end':
        return p.lines[sel.index].end;
      case 'telop': {
        const tp = this.app.compiled.telops.find((x) => x.index === sel.index);
        return { start: tp?.start ?? 0, dur: tp?.dur ?? 1 };
      }
      case 'ev':
        return this.app.eventList(sel.track).find((e) => e.id === sel.id)?.time;
    }
  }

  private applyDrag(sel: Selection, orig: any, dt: number, e: MouseEvent) {
    const p = this.app.project;
    if (sel.type === 'line') {
      const l = p.lines[sel.index];
      const base = orig.times[0] ?? 0;
      const d = this.snapT(base + dt, e) - base;
      p.lines[sel.index] = { ...l, times: orig.times.map((x: number | null) => (x == null ? null : Math.max(0, x + d))), end: orig.end == null ? null : orig.end + d };
    } else if (sel.type === 'glyph') {
      const l = p.lines[sel.index];
      const prev = l.times.slice(0, sel.glyph).reduce<number>((m, x) => (x != null ? Math.max(m, x) : m), 0);
      const next = l.times.slice(sel.glyph + 1).find((x) => x != null) ?? Infinity;
      const times = [...l.times];
      times[sel.glyph] = clamp(this.snapT(orig + dt, e), prev + 0.01, next - 0.01);
      p.lines[sel.index] = { ...l, times };
    } else if (sel.type === 'end') {
      const l = p.lines[sel.index];
      p.lines[sel.index] = { ...l, end: Math.max((l.times[0] ?? 0) + 0.05, this.snapT(orig + dt, e)) };
    } else if (sel.type === 'telop') {
      const tp = p.telops[sel.index];
      if (sel.part === 'end') p.telops[sel.index] = { ...tp, dur: Math.max(0.1, this.snapT(orig.start + orig.dur + dt, e) - orig.start) };
      else p.telops[sel.index] = { ...tp, start: Math.max(0, this.snapT(orig.start + dt, e)) };
    } else {
      const ev = this.app.eventList(sel.track).find((x) => x.id === sel.id);
      if (ev) ev.time = Math.max(0, this.snapT(orig + dt, e));
      const key = TRACK_LIST[sel.track];
      ((p as any)[key] as { time: number }[]).sort((a, b) => a.time - b.time);
    }
    this.app.invalidate();
  }

  // ---------------------------------------------------------------- input
  private local(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: MouseEvent) {
    if (e.button === 2) return;
    const { x, y } = this.local(e);
    const r = this.rowAt(y);
    if (x < LABEL_W) {
      if (r !== 'ruler' && r !== 'wave') this.app.setMode(r);
      return;
    }
    if (e.button === 1) {
      this.drag = { kind: 'pan', x0: x, start0: this.start, moved: false };
      return;
    }
    const sel = r === 'ruler' || r === 'wave' || this.app.recording ? null : this.hit(x, y);
    if (sel) {
      this.app.select(sel);
      this.drag = { kind: 'item', sel, x0: x, start0: this.start, orig: this.origOf(sel), moved: false };
    } else {
      if (r !== 'ruler' && r !== 'wave') this.app.select(null);
      if (this.app.recording) return;
      this.drag = { kind: 'seek', x0: x, start0: this.start, moved: false };
      this.app.seek(this.tAt(x));
    }
    e.preventDefault();
  }

  private onMove(e: MouseEvent) {
    const d = this.drag;
    if (!d) return;
    const { x } = this.local(e);
    if (d.kind === 'pan') {
      this.start = d.start0 - (x - d.x0) / this.pps;
      this.clampView();
      this.invalidate();
      return;
    }
    if (d.kind === 'seek') {
      this.app.seek(this.tAt(x));
      return;
    }
    if (!d.moved && Math.abs(x - d.x0) < 3) return;
    if (!d.moved) {
      this.app.history.push(this.app.project);
      d.moved = true;
    }
    if (d.sel) this.applyDrag(d.sel, d.orig, (x - d.x0) / this.pps, e);
  }

  private onUp() {
    const d = this.drag;
    this.drag = null;
    if (d?.kind === 'item' && d.moved) this.app.emit('project');
  }

  private onHover(e: MouseEvent) {
    if (this.drag) return;
    const { x, y } = this.local(e);
    if (x < LABEL_W) {
      const r = this.rowAt(y);
      this.canvas.style.cursor = r !== 'ruler' && r !== 'wave' ? 'pointer' : 'default';
      this.canvas.title = r !== 'ruler' && r !== 'wave' ? `${modeInfo(r).name}トラックを録音対象にする` : '';
      return;
    }
    this.canvas.title = '';
    this.canvas.style.cursor = this.hit(x, y) ? 'ew-resize' : 'default';
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const { x } = this.local(e);
    if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-e.deltaY * 0.0022), x);
    else {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.start += d / this.pps;
      this.clampView();
      this.invalidate();
    }
  }

  /** Double-click on a lane: menu of what can be placed there at that time (no REC needed). */
  private onDblClick(e: MouseEvent) {
    const app = this.app;
    if (app.recording) return;
    const { x, y } = this.local(e);
    if (x < LABEL_W) return;
    const r = this.rowAt(y);
    if (r === 'ruler' || r === 'wave') return;
    if (this.hit(x, y)) return; // on an element: it is selected (inspector / keys edit it)
    const t = this.snapT(this.tAt(x), e);
    const title = `${modeInfo(r).name} · ${fmtTime(t)} に置く（Shift+クリックでスムーズ／トランジションなし）`;
    const byGroup = (keys: PerfKey[]) => {
      const groups = new Map<string, MenuItem[]>();
      for (const k of keys) {
        if (k.recOnly) continue;
        const list = groups.get(k.group) ?? [];
        list.push({ label: k.label, key: k.key, color: k.color, pick: (ev) => app.placeKey(k, t, ev.shiftKey) });
        groups.set(k.group, list);
      }
      return [...groups].map(([g, items]) => ({ title: g, items }));
    };
    const ofTrack = (keys: PerfKey[], track: EventTrack) => keys.filter((k) => k.track === track);
    if ((r === 'lyrics' || r === 'telop') && this.inElemStrip(r, y)) {
      const name = r === 'lyrics' ? '歌詞' : 'テロップ';
      popupMenu(e.clientX, e.clientY, `${name}のエフェクト・モーション · ${fmtTime(t)} から`, byGroup(ofTrack(perfKeys(app, r), r === 'lyrics' ? 'lfx' : 'tfx')));
      return;
    }
    if (r === 'lyrics') {
      const ly = this.row('lyrics');
      if (y < ly.y + STRIP) {
        popupMenu(e.clientX, e.clientY, `歌詞スタイル · ${fmtTime(t)} から`, byGroup(ofTrack(perfKeys(app, 'lyrics'), 'lstyle')));
        return;
      }
      const lines = app.project.lines;
      const targets = tapTargets(lines);
      const k = firstTargetAfter(lines, targets, t);
      const tg = targets[k];
      if (!tg) return;
      const chars = lineChars(lines[tg.line]);
      const chunk = lines[tg.line].chunks[tg.chunk] ?? '';
      const items: MenuItem[] = [
        { label: `次の1文字「${chars[tg.glyph] ?? ''}」`, key: ' ', color: '#08d9d6', pick: () => app.placeTap('glyph', t) },
        { label: `次のチャンク「${chunk}」`, key: 'n', color: '#08d9d6', pick: () => app.placeTap('chunk', t) },
        { label: `次の1行「${lines[tg.line].text}」`, key: 'Enter', color: '#08d9d6', pick: () => app.placeTap('line', t) },
      ];
      popupMenu(e.clientX, e.clientY, `歌詞 · ${fmtTime(t)} に置く`, [{ title: 'TAP', items }]);
      return;
    }
    if (r === 'telop') {
      const tps = app.project.telops;
      const items: MenuItem[] = tps.map((tp, i) => ({
        label: `${i + 1}. [${tp.template}] ${tp.text}${tp.start != null ? '（配置済み）' : ''}`, color: i === app.telopCursor ? '#ffe600' : undefined,
        pick: () => app.placeTelop(i, t),
      }));
      popupMenu(e.clientX, e.clientY, `テロップ · ${fmtTime(t)} に置く`, [{ title: 'TELOP', items }]);
      return;
    }
    popupMenu(e.clientX, e.clientY, title, byGroup(perfKeys(app, r)));
  }

  private onContext(e: MouseEvent) {
    e.preventDefault();
    if (this.app.recording) return;
    const { x, y } = this.local(e);
    const sel = x > LABEL_W ? this.hit(x, y) : null;
    if (sel) {
      this.app.select(sel);
      this.app.deleteSelection();
    }
  }
}

function hexA(hex: string, a: number) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function diamond(c: CanvasRenderingContext2D, x: number, y: number, s: number) {
  c.beginPath();
  c.moveTo(x, y - s);
  c.lineTo(x + s, y);
  c.lineTo(x, y + s);
  c.lineTo(x - s, y);
  c.closePath();
  c.fill();
}
