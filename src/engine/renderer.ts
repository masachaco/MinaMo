// Scene renderer: a pure function of song time → frame (deterministic, seekable, exportable).
//
// Layers: look style (background / decor / post) · characters (CHARA + CAMERA channels) ·
// lyrics (each line in its lyric style) · FX · telops · HUD · WebGL post.
// Lyrics, telops and characters also go through their track's motion (a transform around their pivot) and
// effects (drawn from the element's image: the sprite, or the text of the lyrics / telops).

import type { Analysis } from '../audio/analysis';
import { sampleAudio } from '../audio/analysis';
import type { Palette, Project } from '../core/types';
import { listPalettes,
  DEFAULT_POST, noOffsets, type AudioState, type BeatState, type CameraFx, type CameraPolicy, type DrawContext, type ElemTarget,
  type FxState, type LineCtx, type MotionId, type MotionOffsets, type MotionStyle, type PosId, type PostParams, type Rect, type VizCtx, getVisualizer,
} from './api';
import { markStale, type BgAsset, type CharAsset, type FxSource } from './assets';
import { stateAt } from './channels';
import { bgIndexFor, segmentAt, type CFx, type CLine, type Compiled, type CSegment, type ElemPlan } from './compile';
import { applyMove, boxFor, cameraOf, framePose, lerpPose, lerpRect, moveDur, posX, type Pose } from './director';
import { activeEffects, addOffsets, applyOffsets, drawEffected, isStill, motionOffsets, type ActiveEffect } from './elements';
import * as lib from './lib';
import { clamp, ease, hash, hashStr, lerp, makeCanvas, mix, rgba } from './lib';
import { PostFX } from './post';

export interface FrameInput {
  compiled: Compiled;
  project: Project;
  /** Project palette (used where the look track says 'auto'). */
  palette: Palette;
  analysis: Analysis | null;
  /** Enabled characters with loaded images. */
  chars: CharAsset[];
  bgs: BgAsset[];
  exporting: boolean;
}

interface CharItem {
  asset: CharAsset;
  pose: Pose;
  alpha: number;
  seed: number;
  /** When this character was switched in (MMD motions play from here). */
  since: number;
  /** MMD: switching between entries of the same model blends the bones from the outgoing entry. */
  blend?: { asset: CharAsset; since: number; k: number };
}

interface StageFrame {
  items: CharItem[];
  box: Rect;
  effects: ActiveEffect[];
  motion: MotionId;
  motionAmount: number;
  /** Seconds since the motion started. */
  motionAge: number;
  policy: CameraPolicy;
  /** Average x of visible characters (for background parallax). */
  cx: number;
}

/** Offscreen layers the lyrics / telops are drawn into when their effects (or a fading motion) need the whole image. */
interface ElemBuf {
  text: { c: HTMLCanvasElement; x: CanvasRenderingContext2D };
  plate: { c: HTMLCanvasElement; x: CanvasRenderingContext2D };
  /** Text of lyric styles that opt out of the readability correction (only with the correction on). */
  raw: { c: HTMLCanvasElement; x: CanvasRenderingContext2D } | null;
  /** text + raw, the image effects see when both are used. */
  union: { c: HTMLCanvasElement; x: CanvasRenderingContext2D } | null;
  src: FxSource;
}

/** Effects and motion of the lyrics or the telops at a frame. */
interface ElemFrame {
  effects: ActiveEffect[];
  off: MotionOffsets;
}

const TITLE_FONT = '"Dela Gothic One", "Anton", "Noto Sans JP", sans-serif';
const MONO_FONT = '"Share Tech Mono", "DotGothic16", monospace';
/** Readability correction presets: switch the fill below this contrast, to a dark / light version of its hue. */
const ADAPT: Record<string, { threshold: number; dark: number; light: number }> = {
  low: { threshold: 0.2, dark: 0.18, light: 0.86 },
  mid: { threshold: 0.3, dark: 0.1, light: 0.92 },
  high: { threshold: 0.42, dark: 0.05, light: 0.96 },
};
/** Character swap / show / hide transition. */
const SWAP = 0.38;
/** Character position slide. */
const SLIDE = 0.45;

const progress = (t: number, t0: number, t1: number, fallback: number) =>
  clamp((t - t0) / Math.max(0.05, (Number.isFinite(t1) ? t1 : t0 + fallback) - t0));

function mixPalette(a: Palette, b: Palette, k: number): Palette {
  return { ...b, bg: mix(a.bg, b.bg, k), text: mix(a.text, b.text, k), accent: mix(a.accent, b.accent, k), accent2: mix(a.accent2, b.accent2, k) };
}

export class Renderer {
  readonly scene: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly post: PostFX;
  private layer: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  W = 0;
  H = 0;
  u = 1;
  private audioState: AudioState = { level: 0, bass: 0, high: 0, spectrum: new Float32Array(64), wave: new Float32Array(256) };
  /** Last computed post params (for debugging / UI). */
  lastPost: PostParams = { ...DEFAULT_POST };

  constructor(W: number, H: number, output?: HTMLCanvasElement) {
    this.scene = makeCanvas(W, H);
    this.ctx = this.scene.getContext('2d', { alpha: false })!;
    this.layer = makeCanvas(W, H);
    this.lctx = this.layer.getContext('2d')!;
    this.post = new PostFX(output);
    this.resize(W, H);
  }

  get output(): HTMLCanvasElement {
    return this.post.canvas;
  }

  private layers: Record<'plateA' | 'textA' | 'over' | 'plateB' | 'textB', { c: HTMLCanvasElement; x: CanvasRenderingContext2D }> | null = null;
  /** Transparent full-size layers for the readability-corrected composite (allocated on first use). */
  private layerSet() {
    if (!this.layers || this.layers.textA.c.width !== this.W || this.layers.textA.c.height !== this.H) {
      const mk = () => {
        const c = makeCanvas(this.W, this.H);
        return { c, x: c.getContext('2d')! };
      };
      this.layers = { plateA: mk(), textA: mk(), over: mk(), plateB: mk(), textB: mk() };
    }
    return this.layers;
  }

  resize(W: number, H: number) {
    W = Math.max(16, Math.round(W));
    H = Math.max(16, Math.round(H));
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    this.u = Math.min(W, H) / 1080;
    this.scene.width = W;
    this.scene.height = H;
    this.layer.width = W;
    this.layer.height = H;
    this.post.resize(W, H);
  }

  // ---------------------------------------------------------------- look channels
  paletteAt(t: number, C: Compiled, F: FrameInput): Palette {
    const s = F.project.settings;
    const resolve = (id: string): Palette =>
      id === 'auto' ? F.palette : id === 'custom' ? s.customPalette : listPalettes().find((p) => p.id === id) ?? F.palette;
    const st = stateAt(C.look.palette, t);
    if (!st) return F.palette;
    const cur = resolve(st.v);
    if (st.prev === undefined) return cur;
    const k = ease.inOutCubic(clamp((t - st.t0) / 0.5));
    return k >= 1 ? cur : mixPalette(resolve(st.prev), cur, k);
  }

  /** Total background darkness: recorded brightness sets it directly, 'auto' = project setting + look style. */
  private dimAt(t: number, C: Compiled, F: FrameInput, styleDim: number): number {
    const auto = clamp(F.project.settings.bgDim + styleDim, 0, 0.95);
    const val = (v: string) => (v === 'auto' ? auto : clamp(parseFloat(v) || 0, 0, 0.98));
    const st = stateAt(C.look.dim, t);
    if (!st) return auto;
    if (st.prev === undefined) return val(st.v);
    return lerp(val(st.prev), val(st.v), ease.inOutCubic(clamp((t - st.t0) / 0.3)));
  }


  // ---------------------------------------------------------------- stage (characters + camera)
  /** Settled text area at time t (a line's layout is frozen to it; camera moves are followed by translation). */
  boxAt(t: number, C: Compiled, F: FrameInput): Rect {
    const cs = stateAt(C.stage.char, t);
    const ps = stateAt(C.stage.pos, t);
    const vis = !!cs?.v && F.chars.some((a) => a.ref.id === cs.v);
    return boxFor(vis ? ps?.v ?? 'center' : null, this.W, this.H);
  }

  /**
   * Text area a line is laid out for: the one in effect for most of the time the line is shown.
   * (The layout is sized once and only moved afterwards, so a character move recorded just after the
   * line starts must not leave the line sized for the old area.)
   */
  private lineBox(L: CLine, C: Compiled, F: FrameInput): Rect {
    const span = Math.min(6, (Number.isFinite(L.end) ? L.end : L.start + 4) - L.start);
    if (!(span > 0.05)) return this.boxAt(L.start + 0.001, C, F);
    const n = 24;
    const votes = new Map<string, { box: Rect; n: number }>();
    let best: { box: Rect; n: number } | null = null;
    for (let i = 0; i < n; i++) {
      const box = this.boxAt(L.start + ((i + 0.5) / n) * span, C, F);
      const key = `${box.x},${box.y},${box.w},${box.h}`;
      const v = votes.get(key) ?? { box, n: 0 };
      v.n++;
      votes.set(key, v);
      if (!best || v.n > best.n) best = v;
    }
    return best!.box;
  }

  private stageFrame(t: number, C: Compiled, F: FrameInput, beat: BeatState, lookSeg: CSegment): StageFrame {
    const { W, H } = this;
    const policy = cameraOf(lookSeg.style);
    const S = C.stage;
    const byId = new Map(F.chars.map((a) => [a.ref.id, a]));
    const portrait = W < H * 0.9;
    const cs = stateAt(S.char, t), ps = stateAt(S.pos, t), fs = stateAt(S.frame, t), ms = stateAt(S.move, t);
    const mo = stateAt(S.motion, t);
    // 'auto' = the look style's effects (at that step's time; the current one at t)
    const effects = activeEffects(S.effect, t, 'chara', (v, at) => (v === 'auto' ? cameraOf(segmentAt(C.lookSegs, at).style).effects : v));
    const autoMotion = !mo || mo.v === 'auto';
    const motion: MotionId = autoMotion ? (policy.bounce > 0 ? 'bounce' : 'idle') : (mo!.v as MotionId);
    const motionAmount = autoMotion ? policy.bounce : 1.5;
    const posV: PosId = ps?.v ?? 'center';
    const charV = cs?.v ?? null;
    const listFor = (id: string | null, pos: PosId): string[] => {
      if (!id || !byId.has(id)) return [];
      if (pos === 'duo' && C.charIds.length > 1) {
        const i = C.charIds.indexOf(id);
        const other = C.charIds[(i + 1) % C.charIds.length];
        return byId.has(other) && other !== id ? [id, other] : [id];
      }
      return [id];
    };
    const xFor = (pos: PosId, which: number) => (portrait && pos !== 'duo' ? 0.5 : posX(pos, which));

    // position slide
    let slideK = 1;
    let prevPos = posV;
    if (ps && ps.prev !== undefined && ps.prev !== ps.v && ps.smooth && t - ps.t0 < SLIDE) {
      slideK = ease.outCubic((t - ps.t0) / SLIDE);
      prevPos = ps.prev;
    }
    // hard-cut settle punch (auto cuts change char / pos / frame together)
    let cutAge = Infinity;
    for (const st of [cs, ps, fs]) if (st && st.prev !== undefined && st.prev !== st.v && !st.smooth) cutAge = Math.min(cutAge, t - st.t0);

    const md = moveDur(C.grid.spb);
    const barDur = C.grid.barDur;
    const framing = (a: CharAsset, x: number, seed: number): Pose => {
      const frame = fs?.v ?? 'full';
      let pose = framePose(frame, a.ref.faceY, fs ? progress(t, fs.t0, fs.t1, barDur * 8) : 0, seed, policy);
      pose.x = x;
      const move = ms?.v ?? 'static';
      pose = applyMove(pose, move, ms ? progress(t, ms.t0, ms.t1, barDur * 8) : 0, t, beat, policy.drift, seed);
      if (fs && fs.prev !== undefined && fs.prev !== fs.v && fs.smooth && t - fs.t0 < md) {
        const pp = framePose(fs.prev, a.ref.faceY, 1, seed, policy);
        pp.x = x;
        pose = lerpPose(pp, pose, ease.inOutCubic((t - fs.t0) / md));
      }
      if (cutAge < 0.4) pose.zoom *= 1 + 0.06 * (1 - ease.outCubic(cutAge / 0.4));
      // per-character screen offset (applies in every framing)
      pose.x += a.ref.offsetX || 0;
      pose.sy += a.ref.offsetY || 0;
      return pose;
    };

    const cur = listFor(charV, posV);
    let swapK = 1;
    let prevList: string[] = [];
    if (cs && cs.prev !== undefined && cs.prev !== cs.v && cs.smooth && t - cs.t0 < SWAP) {
      swapK = ease.outCubic((t - cs.t0) / SWAP);
      prevList = listFor(cs.prev, posV);
    }
    const dir = xFor(posV, 0) >= 0.5 ? 1 : -1;
    const modelOf = (id: string | undefined) => (id ? byId.get(id)?.ref.mmdModel : undefined);
    // entries of one MMD model share framing / drift so a pose switch does not jump
    const seedOf = (id: string) => hashStr(modelOf(id) ?? id) % 100000;
    const sinceOf = (id: string) => {
      let since = 0;
      for (const st of S.char) {
        if (st.t > t + 1e-6) break;
        if (st.v === id) since = st.t;
      }
      return since;
    };
    // same MMD model on both sides of a switch: blend the bones instead of dissolving two renders
    const morph = new Map<string, string>(); // entering id → leaving id
    prevList.forEach((id, which) => {
      const inId = cur[which];
      const sprite = (x: string) => !byId.get(x)?.mmd?.camera;
      if (inId && inId !== id && !prevList.includes(inId) && modelOf(id) && modelOf(id) === modelOf(inId) && sprite(id) && sprite(inId)) morph.set(inId, id);
    });
    const morphed = new Set(morph.values());
    const items: CharItem[] = [];
    // leaving characters first (drawn behind)
    prevList.forEach((id, which) => {
      if (cur.includes(id) || morphed.has(id)) return;
      const a = byId.get(id)!;
      items.push({ asset: a, pose: framing(a, xFor(posV, which) - dir * 0.06 * swapK, seedOf(id)), alpha: 1 - swapK, seed: seedOf(id), since: sinceOf(id) });
    });
    if (slideK < 1 && prevPos === 'duo' && posV !== 'duo' && charV) {
      const second = listFor(charV, 'duo')[1];
      if (second && !cur.includes(second)) {
        const a = byId.get(second)!;
        items.push({ asset: a, pose: framing(a, xFor('duo', 1), seedOf(second)), alpha: 1 - slideK, seed: seedOf(second), since: sinceOf(second) });
      }
    }
    cur.forEach((id, which) => {
      const a = byId.get(id)!;
      const from = morph.get(id);
      const entering = swapK < 1 && !prevList.includes(id) && !from;
      let alpha = entering ? swapK : 1;
      if (which === 1 && prevPos !== 'duo' && slideK < 1) alpha *= slideK;
      const x = lerp(xFor(prevPos, which), xFor(posV, which), slideK) + (entering ? dir * 0.06 * (1 - swapK) : 0);
      const blend = from ? { asset: byId.get(from)!, since: sinceOf(from), k: swapK } : undefined;
      items.push({ asset: a, pose: framing(a, x, seedOf(id)), alpha, seed: seedOf(id), since: sinceOf(id), blend });
    });

    // text area (animated with the same transitions)
    const vis = cur.length > 0;
    const settled = boxFor(vis ? posV : null, W, H);
    let box = settled;
    let fromT = -Infinity;
    if (ps && ps.prev !== undefined && ps.prev !== ps.v && ps.smooth && t - ps.t0 < SLIDE && ps.t0 > fromT) {
      fromT = ps.t0;
      box = lerpRect(boxFor(vis ? ps.prev : null, W, H), settled, ease.inOutCubic((t - ps.t0) / SLIDE));
    }
    if (cs && cs.prev !== undefined && cs.smooth && t - cs.t0 < SWAP && cs.t0 >= fromT) {
      const prevVis = listFor(cs.prev, posV).length > 0;
      if (prevVis !== vis) box = lerpRect(boxFor(prevVis ? posV : null, W, H), settled, ease.inOutCubic((t - cs.t0) / SWAP));
    }
    const shown = items.filter((i) => i.alpha > 0.5);
    const cx = shown.length ? shown.reduce((a, i) => a + i.pose.x, 0) / shown.length : 0.5;
    return { items, box, effects, motion, motionAmount, motionAge: mo ? t - mo.t0 : t, policy, cx };
  }

  /** Effects and motion of the lyrics or the telops at t (+ the FX offsets aimed at them). */
  private elemFrame(target: 'lyrics' | 'telop', plan: ElemPlan, g: DrawContext, fx: MotionOffsets, seed: number): ElemFrame {
    const t = g.t;
    const ms = stateAt(plan.motion, t);
    const off = motionOffsets(ms?.v, { target, t, age: ms ? t - ms.t0 : t, beat: g.beat, audio: g.audio, u: g.u, amount: 1.5, seed });
    return { effects: activeEffects(plan.effect, t, target, (v) => v), off: addOffsets(off, fx) };
  }

  private bufs: Partial<Record<'lyrics' | 'telop', ElemBuf>> = {};
  /** Cleared offscreen layers for the lyrics / telops (allocated on first use; `raw` also when asked). */
  private elemBuf(kind: 'lyrics' | 'telop', withRaw: boolean): ElemBuf {
    const mk = () => {
      const c = makeCanvas(this.W, this.H);
      return { c, x: c.getContext('2d')! };
    };
    let b = this.bufs[kind];
    if (!b || b.text.c.width !== this.W || b.text.c.height !== this.H) {
      const text = mk();
      b = { text, plate: mk(), raw: null, union: null, src: { img: text.c, cache: new Map() } };
      this.bufs[kind] = b;
    }
    if (withRaw && !b.raw) {
      b.raw = mk();
      b.union = mk();
    }
    for (const l of [b.text, b.plate, withRaw ? b.raw : null]) {
      if (!l) continue;
      l.x.setTransform(1, 0, 0, 1, 0, 0);
      l.x.globalAlpha = 1;
      l.x.globalCompositeOperation = 'source-over';
      l.x.filter = 'none';
      l.x.clearRect(0, 0, this.W, this.H);
    }
    return b;
  }

  /**
   * Put an element drawn into its offscreen layers onto the destinations, through its effects: plates as they are,
   * then the effects' under(), the text (or the effects' body), over(). `rawTo` = where uncorrected text goes.
   */
  private compositeElem(g: DrawContext, b: ElemBuf, st: ElemFrame, target: ElemTarget, seed: number, dest: { plate: CanvasRenderingContext2D; text: CanvasRenderingContext2D; rawTo: CanvasRenderingContext2D | null }) {
    const alpha = st.off.alpha;
    const blit = (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.drawImage(c, 0, 0);
      ctx.restore();
    };
    let img = b.text.c;
    if (dest.rawTo && b.raw && b.union) {
      // effects see all the text of the lyrics (corrected and not)
      const u = b.union.x;
      u.setTransform(1, 0, 0, 1, 0, 0);
      u.globalAlpha = 1;
      u.globalCompositeOperation = 'source-over';
      u.clearRect(0, 0, this.W, this.H);
      u.drawImage(b.text.c, 0, 0);
      u.drawImage(b.raw.c, 0, 0);
      img = b.union.c;
    }
    b.src.img = img;
    markStale(b.src);
    blit(dest.plate, b.plate.c);
    drawEffected(g, b.src, { x: 0, y: 0, w: this.W, h: this.H, scale: 1 }, st.effects, target, seed,
      { under: dest.plate, body: dest.text, over: dest.text, reset: true, alpha },
      () => {
        blit(dest.text, b.text.c);
        if (dest.rawTo && b.raw) blit(dest.rawTo, b.raw.c);
      });
  }

  // ---------------------------------------------------------------- render
  render(t: number, F: FrameInput): void {
    const { W, H, u, ctx } = this;
    const C = F.compiled;
    const S = F.project.settings;
    const beat = C.grid.state(t);
    const audio = sampleAudio(F.analysis, t, this.audioState);
    const lookSeg = segmentAt(C.lookSegs, t);
    const look = lookSeg.style;
    const intensity = S.fxIntensity;
    const pal = this.paletteAt(t, C, F);

    // ---- post params from the look style (blend from previous section)
    const post: PostParams = { ...DEFAULT_POST, ...(look.post ?? {}) };
    if (lookSeg.index > 0 && t - lookSeg.start < 0.6) {
      const prevPost = { ...DEFAULT_POST, ...(C.lookSegs[lookSeg.index - 1].style.post ?? {}) };
      const k = ease.inOutCubic((t - lookSeg.start) / 0.6);
      for (const key of Object.keys(post) as (keyof PostParams)[]) post[key] = lerp(prevPost[key], post[key], k);
    }
    const camera: CameraFx = { x: 0, y: 0, zoom: 0, rot: 0 };
    // FX aimed at one element (added to its motion)
    const elemFx: Record<ElemTarget, MotionOffsets> = { lyrics: noOffsets(), telop: noOffsets(), chara: noOffsets() };

    // ---- fx
    const active: { f: CFx; s: FxState }[] = [];
    for (const f of C.fx) {
      if (f.start > t) break;
      if (t >= f.start + f.dur) continue;
      const age = t - f.start;
      const s: FxState = { age, p: clamp(age / f.dur), dur: f.dur, post, camera, elements: elemFx, beat, intensity, seed: f.seed, rand: (...n: number[]) => hash(f.seed, ...n) };
      active.push({ f, s });
      safe(() => f.def.apply?.(s));
    }

    const stage = this.stageFrame(t, C, F, beat, lookSeg);
    const bgState = stateAt(C.look.bg, t);
    const bgIdx = bgIndexFor(bgState?.v ?? 'auto', lookSeg.index, F.bgs.length);
    const g: DrawContext = {
      ctx, W, H, u, t, beat, audio, pal,
      box: stage.box,
      style: look,
      look,
      styleAge: t - lookSeg.start,
      segIndex: lookSeg.index,
      hasBackground: bgIdx >= 0,
      hasCharacter: stage.items.length > 0,
      rand: (...n: number[]) => hash(S.seed, ...n),
      lines: [],
      duration: C.duration,
      title: S.title,
      artist: S.artist,
      lib,
      plate: ctx,
      intensity,
      exporting: F.exporting,
    };

    // visible lines grouped by lyric style
    const groups = new Map<MotionStyle, LineCtx[]>();
    const all: LineCtx[] = [];
    for (const L of C.lines) {
      if (L.start > t) break;
      const exitDur = L.style.exitDuration ?? 0.4;
      if (t >= L.end + exitDur) continue;
      let arr = groups.get(L.style);
      if (!arr) groups.set(L.style, (arr = []));
      const lc = this.lineCtx(L, t, exitDur, C, F);
      arr.push(lc);
      all.push(lc);
    }
    const withLyricStyle = (st: MotionStyle, ls: LineCtx[], fn: () => void) => {
      g.style = st;
      g.lines = ls;
      safe(fn);
      g.style = look;
      g.lines = all;
    };
    g.lines = all;
    safe(() => look.postFx?.(g, post));
    for (const [st, ls] of groups) if (st.lyricFx) withLyricStyle(st, ls, () => st.lyricFx!(g, post));

    // readability correction: text goes on separate layers composited on the GPU
    const adapt = ADAPT[S.textAdapt];
    const lay = adapt ? this.layerSet() : null;
    if (lay) {
      for (const l of Object.values(lay)) {
        l.x.setTransform(1, 0, 0, 1, 0, 0);
        l.x.globalAlpha = 1;
        l.x.globalCompositeOperation = 'source-over';
        l.x.filter = 'none';
        l.x.clearRect(0, 0, W, H);
      }
    }
    const used = { a: false, over: false, b: false };

    // ---- base
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    const z = 1 + camera.zoom;
    ctx.translate(W / 2 + camera.x * u, H / 2 + camera.y * u);
    ctx.rotate(camera.rot);
    ctx.scale(z, z);
    ctx.translate(-W / 2, -H / 2);
    const camM = ctx.getTransform();

    this.drawBackground(g, F, C, lookSeg, stage, bgState, bgIdx);
    safe(() => look.background?.(g));
    safe(() => look.backDecor?.(g));
    this.drawViz(g, C, stage, 'back');
    this.poseMmd(stage, t, C.grid.spb, g.audio);
    this.drawCharacters(g, stage, elemFx.chara);
    safe(() => look.frontDecor?.(g));
    this.drawViz(g, C, stage, 'front');

    // ---- lyrics (each in its lyric style), gliding with the camera's free area. The lyrics track's motion moves
    // them around the text area center; with effects (or a fading motion) they are drawn offscreen first.
    const lyrSeed = (S.seed * 7919 + 11) % 100000;
    const lyr = this.elemFrame('lyrics', C.elem.lyrics, g, elemFx.lyrics, lyrSeed);
    const textA = lay ? lay.textA.x : ctx;
    const plateA = lay ? lay.plateA.x : ctx;
    const lb = groups.size && (lyr.effects.length || lyr.off.alpha < 0.999) ? this.elemBuf('lyrics', !!lay) : null;
    const lx = lb ? lb.text.x : textA;
    const lp = lb ? lb.plate.x : plateA;
    // styles that opt out of the correction draw onto an uncorrected layer (the plate layer, or their own offscreen one)
    const lraw = lb ? (lay ? lb.raw!.x : lx) : plateA;
    if (lay || lb) for (const x of new Set([lx, lp, lraw])) x.setTransform(camM);
    const pvx = stage.box.x + stage.box.w / 2, pvy = stage.box.y + stage.box.h / 2;
    const still = isStill(lyr.off);
    let rawUsed = false;
    g.plate = lp;
    for (const [st, ls] of groups) {
      used.a = true;
      const follow = st.followCamera !== false;
      const tx0 = st.adaptText === false ? lraw : lx;
      if (lb && lay && tx0 === lraw) rawUsed = true;
      g.ctx = tx0;
      withLyricStyle(st, ls, () => {
        for (const l of ls) {
          tx0.save();
          if (lp !== tx0) lp.save();
          for (const x of lp !== tx0 ? [tx0, lp] : [tx0]) {
            if (!still) applyOffsets(x, pvx, pvy, lyr.off);
            if (follow) x.translate(stage.box.x + stage.box.w / 2 - (l.box.x + l.box.w / 2), stage.box.y + stage.box.h / 2 - (l.box.y + l.box.h / 2));
          }
          safe(() => st.line?.(g, l));
          if (lp !== tx0) lp.restore();
          tx0.restore();
        }
      });
    }
    if (lb) this.compositeElem(g, lb, lyr, 'lyrics', lyrSeed, { plate: plateA, text: textA, rawTo: rawUsed ? plateA : null });

    // ---- look overlay (above lyrics, inside the camera)
    const ox = lay ? lay.over.x : ctx;
    if (lay) ox.setTransform(camM);
    g.ctx = ox;
    g.plate = ox;
    if (look.overlay) {
      used.over = true;
      safe(() => look.overlay!(g));
    }
    ctx.restore();
    if (lay) ox.setTransform(1, 0, 0, 1, 0, 0);

    // ---- fx overlays
    for (const { f, s } of active) {
      if (!f.def.draw) continue;
      used.over = true;
      safe(() => f.def.draw!(g, s));
    }

    // ---- telops (steady: outside the camera shake, above FX overlays) + HUD. The telop track's motion moves each
    // telop around its template's pivot; effects work like the lyrics'.
    const textB = lay ? lay.textB.x : ctx;
    const plateB = lay ? lay.plateB.x : ctx;
    const showing = C.telops.filter((tp) => tp.start <= t && t - (tp.start + tp.dur) < tp.exitDur);
    const telSeed = (S.seed * 7919 + 23) % 100000;
    const tel = this.elemFrame('telop', C.elem.telop, g, elemFx.telop, telSeed);
    const tb = showing.length && (tel.effects.length || tel.off.alpha < 0.999) ? this.elemBuf('telop', false) : null;
    const tx = tb ? tb.text.x : textB;
    const tpl = tb ? tb.plate.x : plateB;
    const stillT = isStill(tel.off);
    g.ctx = tx;
    g.plate = tpl;
    for (const tp of showing) {
      const out = t - (tp.start + tp.dur);
      used.b = true;
      const tc = { text: tp.text, sub: tp.sub, lines: tp.lines, age: t - tp.start, dur: tp.dur, out, outK: clamp(out / tp.exitDur), index: tp.index, seed: tp.seed };
      tx.save();
      if (tpl !== tx) tpl.save();
      if (!stillT) {
        const pv = tp.def.pivot;
        const px = (Number.isFinite(pv?.x) ? pv!.x : 0.5) * W, py = (Number.isFinite(pv?.y) ? pv!.y : 0.5) * H;
        applyOffsets(tx, px, py, tel.off);
        if (tpl !== tx) applyOffsets(tpl, px, py, tel.off);
      }
      safe(() => tp.def.draw(g, tc));
      if (tpl !== tx) tpl.restore();
      tx.restore();
    }
    if (tb) this.compositeElem(g, tb, tel, 'telop', telSeed, { plate: plateB, text: textB, rawTo: null });
    g.ctx = textB;
    g.plate = plateB;
    if (S.hud && !look.hideHud) {
      used.b = true;
      this.drawHud(g, S.title, S.artist);
    }
    g.ctx = ctx;
    g.plate = ctx;

    this.lastPost = post;
    this.post.render(this.scene, post, t, u, lay && adapt ? {
      plateA: used.a ? lay.plateA.c : null,
      textA: used.a ? lay.textA.c : null,
      over: used.over ? lay.over.c : null,
      plateB: used.b ? lay.plateB.c : null,
      textB: used.b ? lay.textB.c : null,
      ...adapt,
    } : undefined);
  }

  private lineCtx(L: CLine, t: number, exitDur: number, C: Compiled, F: FrameInput): LineCtx {
    const key = `${L.style.id}:${this.W}x${this.H}`;
    const cache = (L.cache[key] ??= {});
    cache.__box ??= this.lineBox(L, C, F);
    let k = 0;
    let lastTap = -Infinity;
    for (let i = 0; i < L.gt.length; i++) if (L.gtap[i] && L.gt[i] <= t && L.gt[i] > lastTap) lastTap = L.gt[i];
    return {
      index: L.index,
      text: L.line.text,
      sub: L.line.sub,
      chunks: L.line.chunks.map((text, i) => {
        const n = L.glyphs[i].length;
        const c = { index: i, text, glyphs: L.glyphs[i], t: L.chunkTimes[i], tapped: L.tapped[i], gt: L.gt.slice(k, k + n), gtap: L.gtap.slice(k, k + n) };
        k += n;
        return c;
      }),
      manualChunks: L.manualChunks,
      lastHit: t - lastTap,
      glyphs: L.glyphs.flat(),
      start: L.start,
      end: L.end,
      age: t - L.start,
      out: t - L.end,
      exitDur,
      box: cache.__box,
      seed: L.seed,
      newerStarts: L.newerStarts,
      cache,
      total: F.project.lines.length,
    };
  }

  // ---------------------------------------------------------------- layers
  private drawBackground(
    g: DrawContext, F: FrameInput, C: Compiled, lookSeg: CSegment, stage: StageFrame,
    bgState: ReturnType<typeof stateAt<string>>, bgIdx: number,
  ) {
    const { ctx, W, H, pal, t } = g;
    const pol = cameraOf(lookSeg.style);
    // crossfade from the previous background
    let prevIdx = bgIdx;
    let k = 1;
    if (bgState && bgState.prev !== undefined && t - bgState.t0 < 0.4) {
      prevIdx = bgIndexFor(bgState.prev, segmentAt(C.lookSegs, bgState.t0 - 1e-3).index, F.bgs.length);
      k = ease.inOutCubic((t - bgState.t0) / 0.4);
    }
    if (bgIdx < 0 || prevIdx < 0) {
      const gr = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.6);
      gr.addColorStop(0, mix(pal.bg, pal.accent, 0.14));
      gr.addColorStop(1, pal.bg);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    }
    if (bgIdx < 0 && prevIdx < 0) return;
    const segP = clamp((t - lookSeg.start) / Math.max(1, Math.min(lookSeg.end, g.duration) - lookSeg.start));
    const zoom = 1.08 + 0.06 * ease.inOutSine(segP) + g.beat.pulse * 0.006 * pol.bounce;
    const par = -(stage.cx - 0.5) * W * 0.05;
    const drawBg = (idx: number, alpha: number) => {
      const bg = F.bgs[idx];
      if (!bg || alpha <= 0.001) return;
      let src: CanvasImageSource | undefined;
      let sw = 0, sh = 0;
      if (bg.video) {
        src = bg.video;
        sw = bg.video.videoWidth;
        sh = bg.video.videoHeight;
      } else if (bg.img) {
        const c = pol.bgBlur && bg.blurred ? bg.blurred : bg.img;
        src = c;
        sw = c.width;
        sh = c.height;
      }
      if (!src || !sw || !sh) return;
      const s = Math.max(W / sw, H / sh) * zoom;
      ctx.globalAlpha = alpha;
      ctx.drawImage(src, (W - sw * s) / 2 + par, (H - sh * s) / 2, sw * s, sh * s);
      ctx.globalAlpha = 1;
    };
    if (k < 1 && prevIdx >= 0 && prevIdx !== bgIdx) drawBg(prevIdx, 1);
    drawBg(bgIdx, k < 1 && prevIdx !== bgIdx ? k : 1);
    if (bgIdx < 0 && prevIdx >= 0) drawBg(prevIdx, 1 - k);
    const dim = this.dimAt(t, C, F, pol.bgDim);
    if (dim > 0) {
      ctx.fillStyle = rgba(pal.bg, dim);
      ctx.fillRect(0, 0, W, H);
    }
    // subtle color wash to unify with the palette
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    const gr = ctx.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, rgba(pal.accent, 0.35));
    gr.addColorStop(1, rgba(pal.accent2, 0.35));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ---------------------------------------------------------------- visualizer
  private vizGeometry(pos: string, stage: StageFrame): { area: Rect; cx: number; cy: number } {
    const { W, H } = this;
    const R = (x: number, y: number, w: number, h: number): Rect => ({ x: x * W, y: y * H, w: w * W, h: h * H });
    let area: Rect;
    switch (pos) {
      case 'top':
        area = R(0.04, 0.04, 0.92, 0.26);
        break;
      case 'center':
        area = R(0.1, 0.25, 0.8, 0.5);
        break;
      case 'full':
        area = R(0, 0, 1, 1);
        break;
      case 'around': {
        const s = H * 0.64;
        const cx = stage.cx * W, cy = H * 0.44;
        return { area: { x: cx - s / 2, y: cy - s / 2, w: s, h: s }, cx, cy };
      }
      case 'bottom':
      default:
        area = R(0.04, 0.7, 0.92, 0.26);
    }
    return { area, cx: area.x + area.w / 2, cy: area.y + area.h / 2 };
  }

  private drawViz(g: DrawContext, C: Compiled, stage: StageFrame, layer: 'back' | 'front') {
    const V = C.viz;
    const t = g.t;
    if ((stateAt(V.layer, t)?.v ?? 'back') !== layer) return;
    const ty = stateAt(V.type, t);
    if (!ty) return;
    const fade = ty.prev !== undefined && ty.prev !== ty.v ? ease.inOutCubic(clamp((t - ty.t0) / 0.3)) : 1;
    const draws: { id: string; alpha: number }[] = [];
    if (ty.v !== 'none') draws.push({ id: ty.v, alpha: fade });
    if (fade < 1 && ty.prev && ty.prev !== 'none') draws.push({ id: ty.prev, alpha: 1 - fade });
    if (!draws.length) return;
    // position / size glide
    const ps = stateAt(V.pos, t);
    const posV = ps?.v ?? 'bottom';
    let geo = this.vizGeometry(posV, stage);
    if (ps && ps.prev !== undefined && ps.prev !== ps.v && t - ps.t0 < 0.35) {
      const k = ease.inOutCubic((t - ps.t0) / 0.35);
      const a = this.vizGeometry(ps.prev, stage);
      geo = { area: lerpRect(a.area, geo.area, k), cx: lerp(a.cx, geo.cx, k), cy: lerp(a.cy, geo.cy, k) };
    }
    const sizeOf = (v: string) => (v === 's' ? 0.65 : v === 'l' ? 1.45 : 1);
    const ss = stateAt(V.size, t);
    let size = sizeOf(ss?.v ?? 'm');
    if (ss && ss.prev !== undefined && t - ss.t0 < 0.3) size = lerp(sizeOf(ss.prev), size, ease.inOutCubic((t - ss.t0) / 0.3));
    const mode = stateAt(V.color, t)?.v ?? 'accent';
    const pal = g.pal;
    const color = (k: number): string =>
      mode === 'accent2' ? pal.accent2 : mode === 'text' ? pal.text : mode === 'grad' ? mix(pal.accent2, pal.accent, clamp(k)) :
        mode === 'rainbow' ? `hsl(${Math.round((k * 300 + t * 40) % 360)},90%,62%)` : pal.accent;
    for (const d of draws) {
      const def = getVisualizer(d.id);
      if (!def || d.alpha <= 0.001) continue;
      g.ctx.save();
      safe(() => def.draw(g, { ...geo, pos: posV as VizCtx['pos'], size, alpha: d.alpha, color, flip: posV === 'top', age: t - ty.t0, seed: hashStr(d.id) }));
      g.ctx.restore();
    }
  }

  /** Pose and render the MMD characters on stage for time t (skipped while nothing changes). */
  private poseMmd(stage: StageFrame, t: number, spb: number, audio: AudioState) {
    let mouth = -1;
    for (const it of stage.items) {
      const m = it.asset.mmd;
      if (!m || it.alpha <= 0.001) continue;
      const h = Math.min(2048, Math.round(this.H * 1.6 * (it.asset.ref.scale || 1)));
      const b = it.blend && it.blend.k < 1 && it.blend.asset.mmd ? it.blend : undefined;
      if (it.asset.ref.mmdLip && mouth < 0) mouth = mouthOpen(audio);
      const open = it.asset.ref.mmdLip ? mouth : 0;
      const moving = !!m.clip?.vmd || !!b || m.model.physicsOn || !!m.camera;
      const rate = motionRate(it.asset, spb);
      // rotation: the entry's own, eased from the outgoing entry during a same-model switch
      const r1 = it.asset.ref.mmdRot ?? NO_ROT;
      const r0 = b?.asset.ref.mmdRot ?? r1;
      const k = b ? b.k : 1;
      const rot = { x: lerp(r0.x, r1.x, k), y: lerp(r0.y, r1.y, k), z: lerp(r0.z, r1.z, k) };
      const key = `${it.since}|${moving ? t.toFixed(4) : ''}|${b ? b.asset.ref.id : ''}|${h}|${open.toFixed(2)}|${rate}|${rot.x},${rot.y},${rot.z}|${m.camera ? `${this.W}x${this.H}` : ''}`;
      if (key === m.key) continue;
      m.key = key;
      m.model.setRotation(rot.x, rot.y, rot.z);
      if (m.camera) {
        // camera VMD: full-frame through the VMD camera, same timing as the motion
        m.model.pose(m.clip, (t - it.since) * rate, undefined, open, t, rate);
        m.model.poseCamera(m.camera, (t - it.since) * rate);
        m.model.renderCamera(it.asset.img, this.W, this.H);
        markStale(it.asset);
        continue;
      }
      const local = (a: CharAsset, since: number) => (t - since) * motionRate(a, spb);
      m.model.pose(m.clip, local(it.asset, it.since), b ? { clip: b.asset.mmd!.clip, localT: local(b.asset, b.since), k: b.k } : undefined, open, t, rate);
      m.model.render(it.asset.img, h);
      markStale(it.asset); // silhouettes / glows are derived from the frame
    }
  }

  private drawCharacters(g: DrawContext, stage: StageFrame, fxOff: MotionOffsets) {
    if (!stage.items.length) return;
    const { W, H, u, beat, pal, t } = g;
    const L = this.lctx;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalAlpha = 1;
    L.globalCompositeOperation = 'source-over';
    L.clearRect(0, 0, W, H);
    const effects = stage.effects;
    const dests = { under: L, body: L, over: L, reset: false, alpha: 1 };
    for (const it of stage.items) {
      if (it.alpha <= 0.001) continue;
      const a = it.asset;
      const img = a.img;
      if (a.mmd?.camera) {
        // camera VMD entry: already framed by its own camera, drawn full-screen (camera track framing / motion not applied)
        L.save();
        L.globalAlpha = it.alpha;
        drawEffected(g, a, { x: 0, y: 0, w: W, h: H, scale: W / img.width }, effects, 'chara', it.seed, dests);
        L.restore();
        continue;
      }
      const mo = addOffsets(motionOffsets(stage.motion, { target: 'chara', t, age: stage.motionAge, beat, audio: g.audio, u, amount: stage.motionAmount, seed: it.seed }), fxOff);
      if (mo.alpha <= 0.001) continue;
      const baseH = H * 0.95 * (a.ref.scale || 1);
      const s = (baseH / img.height) * it.pose.zoom;
      const dw = img.width * s, dh = img.height * s;
      L.save();
      L.globalAlpha = it.alpha * mo.alpha;
      L.translate(it.pose.x * W + mo.dx, it.pose.sy * H + mo.dy);
      L.rotate(it.pose.rot + mo.rot);
      L.scale(mo.sx * (a.ref.flip ? -1 : 1), mo.sy);
      drawEffected(g, a, { x: -dw / 2, y: -it.pose.fy * dh, w: dw, h: dh, scale: s }, effects, 'chara', it.seed, dests);
      L.restore();
    }
    // grade the character layer into the scene (not under solid looks such as シルエット)
    const grade = effects.some((e) => e.def.flat) ? 0 : stage.policy.grade;
    if (grade > 0) {
      L.save();
      L.globalCompositeOperation = 'source-atop';
      const gr = L.createLinearGradient(0, H * 0.35, 0, H);
      gr.addColorStop(0, rgba(pal.bg, 0));
      gr.addColorStop(1, rgba(pal.bg, 0.55 * grade));
      L.fillStyle = gr;
      L.fillRect(0, 0, W, H);
      const rim = L.createLinearGradient(0, 0, W, H * 0.6);
      rim.addColorStop(0, rgba(pal.accent, 0.22 * grade));
      rim.addColorStop(0.5, rgba(pal.accent, 0));
      L.fillStyle = rim;
      L.fillRect(0, 0, W, H);
      L.restore();
    }
    g.ctx.drawImage(this.layer, 0, 0);
  }

  private drawHud(g: DrawContext, title: string, artist: string) {
    const { ctx, W, H, u, t, beat, pal } = g;
    ctx.save();
    const m = 36 * u;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = pal.text;
    ctx.font = lib.font(400, 18 * u, MONO_FONT);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(`${title}  /  ${artist}`.toUpperCase(), m, H - m);
    ctx.textAlign = 'right';
    const bar = Math.max(0, beat.bar + 1);
    ctx.fillText(`BAR ${String(bar).padStart(3, '0')}`, W - m - (beat.beatsPerBar * 16 + 10) * u, m + 12 * u);
    for (let i = 0; i < beat.beatsPerBar; i++) {
      const on = i === beat.inBar && t >= 0 && beat.beat >= 0;
      ctx.globalAlpha = on ? 0.95 : 0.3;
      ctx.fillStyle = on ? pal.accent : pal.text;
      ctx.fillRect(W - m - (beat.beatsPerBar - i) * 16 * u, m + 2 * u, 10 * u, 10 * u);
    }
    const p = clamp(t / Math.max(1, g.duration));
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = pal.text;
    ctx.fillRect(m, H - m + 12 * u, W - m * 2, 2 * u);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = pal.accent;
    ctx.fillRect(m, H - m + 12 * u, (W - m * 2) * p, 2 * u);
    ctx.restore();
  }
}

const NO_ROT = { x: 0, y: 0, z: 0 };

/**
 * Playback rate of an MMD motion entry. 'beat' sync stretches one loop to the nearest whole number of beats,
 * so a looping dance stays on the grid at any BPM; the speed multiplier applies on top.
 */
function motionRate(a: CharAsset, spb: number): number {
  const m = a.mmd;
  const speed = a.ref.mmdSpeed || 1;
  const d = m ? m.model.duration(m.clip) : 0;
  if (!d || (a.ref.mmdSync ?? 'beat') === 'orig' || !(spb > 0)) return speed;
  const beats = Math.max(1, Math.round(d / spb));
  return (d / (beats * spb)) * speed;
}

/** Mouth opening (0..1) from vocal-range loudness (bands ≈ 300 Hz – 3 kHz), stepped like anime lip flaps. */
function mouthOpen(audio: AudioState): number {
  const sp = audio.spectrum;
  let v = 0;
  for (let b = 21; b <= 46; b++) v += sp[b] ?? 0;
  v /= 26;
  const k = clamp((v - 0.42) / 0.28);
  return Math.round(k * 4) / 4;
}

function safe(fn: () => void) {
  try {
    fn();
  } catch (e) {
    if (!(safe as any).warned) {
      console.warn('style error', e);
      (safe as any).warned = true;
      setTimeout(() => ((safe as any).warned = false), 2000);
    }
  }
}
