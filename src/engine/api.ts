// Plugin API: motion styles, one-shot FX, visualizers, telop templates, camera framings / moves, palettes,
// and the effects / motions of the elements (歌詞 / テロップ / 立ち絵).
//
// Built-in styles live in src/styles/*.ts and are auto-registered; the other built-ins register through the same
// functions (src/fx, src/viz, src/telop, src/element).
// Runtime plugins (.js) can be loaded from the UI; they receive `api` (see plugin-loader.ts). The built-ins in src/plugins/ are written the same way.

import type { Palette } from '../core/types';
import type * as Lib from './lib';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BeatState {
  bpm: number;
  /** Seconds per beat. */
  spb: number;
  beatsPerBar: number;
  /** Beats since the first downbeat (float). */
  beat: number;
  /** floor(beat) */
  index: number;
  /** 0..1 within the current beat. */
  phase: number;
  bar: number;
  /** 0..1 within the current bar. */
  barPhase: number;
  /** Beat number within the bar (0 = downbeat). */
  inBar: number;
  /** 1 at each beat, decays quickly. */
  pulse: number;
  /** Same as pulse but only on downbeats. */
  downPulse: number;
  /** Pulse on every 8th note. */
  halfPulse: number;
}

export interface AudioState {
  /** Overall loudness 0..1 */
  level: number;
  /** Low-frequency energy 0..1 */
  bass: number;
  /** High-frequency energy 0..1 */
  high: number;
  /** 64 log-spaced bands, 0..1 (smoothed: fast attack, slow release) */
  spectrum: Float32Array;
  /** 256 samples of the waveform around t (-1..1, ~64 ms) */
  wave: Float32Array;
}

export interface PostParams {
  bloom: number;
  bloomThreshold: number;
  /** Chromatic aberration in px (at 1080p). */
  chroma: number;
  grain: number;
  scanline: number;
  vignette: number;
  /** Block-displacement glitch amount 0..1 */
  glitch: number;
  contrast: number;
  saturation: number;
  brightness: number;
  invert: number;
  /** White flash 0..1 */
  flash: number;
  /** Zoom blur strength 0..1 */
  radialBlur: number;
  /** Horizontal mirror 0/1 */
  mirror: number;
  /** Pixelate 0..1 */
  pixelate: number;
  /** Hue rotation (radians). */
  hue: number;
}

export const DEFAULT_POST: PostParams = {
  bloom: 0.3,
  bloomThreshold: 0.72,
  chroma: 0.6,
  grain: 0.05,
  scanline: 0,
  vignette: 0.35,
  glitch: 0,
  contrast: 1,
  saturation: 1,
  brightness: 0,
  invert: 0,
  flash: 0,
  radialBlur: 0,
  mirror: 0,
  pixelate: 0,
  hue: 0,
};

/** Additive camera offsets (applied to the whole scene except HUD/overlays). */
export interface CameraFx {
  x: number;
  y: number;
  zoom: number;
  rot: number;
}

/** Auto-director shot kinds (used in CameraPolicy.pool). */
export type ShotKind = 'full' | 'bust' | 'face' | 'left' | 'right' | 'low' | 'tilt' | 'duo' | 'hide';
/** Element effect id (built-in: shadow / outline / glow / slice / silhouette, + plugin effects). */
export type EffectId = 'shadow' | 'outline' | 'glow' | 'slice' | 'silhouette' | (string & {});
/** Character effects (the same ids as every element). */
export type CharEffect = EffectId;
/** Camera framing. */
export type FrameId = 'wide' | 'full' | 'knee' | 'bust' | 'face' | 'low' | 'tilt' | (string & {}); // + plugin framings
/** Character position on screen. */
export type PosId = 'left' | 'center' | 'right' | 'duo';
/** Camera movement within a framing. */
export type MoveId = 'static' | 'push' | 'pull' | 'pan' | 'rise' | 'handheld' | 'roll' | 'beat' | (string & {}); // + plugin moves
/** Element motion id (built-in: idle / bounce / sway / float / hop / shake, + plugin motions). */
export type MotionId = 'idle' | 'bounce' | 'sway' | 'float' | 'hop' | 'shake' | (string & {});

export interface CameraPolicy {
  /** Hard cuts between shots (true) or smooth moves (false). */
  cut: boolean;
  /** Bars per auto shot. */
  shotBars: number;
  pool: ShotKind[];
  /** Beat bounce amount (0 = none). */
  bounce: number;
  /** Slow drift/zoom amount within a shot. */
  drift: number;
  /** Max dutch tilt in degrees. */
  tilt: number;
  /** Character effects while the CHARA track's effect is オート (effect ids, plugin effects too). */
  effects: EffectId[];
  /** Blur background image. */
  bgBlur: boolean;
  /** Extra background darkening 0..1 */
  bgDim: number;
  /** Color-grade characters into the scene 0..1 */
  grade: number;
  /** Allow centered framing (text then goes to the lower area). */
  center: boolean;
}

export const DEFAULT_CAMERA: CameraPolicy = {
  cut: true,
  shotBars: 2,
  pool: ['full', 'bust', 'left', 'right', 'face'],
  bounce: 1,
  drift: 1,
  tilt: 0,
  effects: [],
  bgBlur: false,
  bgDim: 0.2,
  grade: 0.5,
  center: true,
};

export interface ChunkCtx {
  index: number;
  text: string;
  glyphs: string[];
  /** Appear time of the chunk's first character (song seconds). */
  t: number;
  /** First character tapped explicitly (vs auto-staggered). */
  tapped: boolean;
  /** Appear time per character (auto characters use a default stagger). */
  gt: number[];
  /** Per character: tapped explicitly. */
  gtap: boolean[];
}

export interface LineCtx {
  /** Line index in the lyrics. */
  index: number;
  /** Display text (chunks joined). */
  text: string;
  /** Sub text (after "|"), may be empty. */
  sub: string;
  chunks: ChunkCtx[];
  /** True when the author split the line with "/" (chunks are meant as row breaks), false for automatic chunks. */
  manualChunks: boolean;
  /** All glyphs of the line. */
  glyphs: string[];
  start: number;
  /** When the exit animation begins. */
  end: number;
  /** t - start */
  age: number;
  /** t - end (negative until the line starts exiting). */
  out: number;
  /** Exit duration of the style. */
  exitDur: number;
  /** Text area at the time the line started (from the camera director). */
  box: Rect;
  /** Stable per-line seed. */
  seed: number;
  /** Starts of the following lines in the same section (for history layouts). */
  newerStarts: number[];
  /** Seconds since the most recent tapped character (Infinity if none yet) — use for per-hit punches. */
  lastHit: number;
  /** Per-line scratch storage for cached layouts (reset when the project changes or canvas size changes). */
  cache: Record<string, any>;
  /** Number of lines in the lyrics. */
  total: number;
}

export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** Size unit: min(W,H)/1080 */
  u: number;
  t: number;
  beat: BeatState;
  audio: AudioState;
  pal: Palette;
  /** Current text area (from the camera director). */
  box: Rect;
  /** The style currently being drawn (look style in scene hooks, lyric style in line()). */
  style: MotionStyle;
  /** Current look (scene) style. */
  look: MotionStyle;
  /** Seconds since the current look section started. */
  styleAge: number;
  segIndex: number;
  hasBackground: boolean;
  hasCharacter: boolean;
  /** Deterministic random helper: same args → same value in [0,1). */
  rand: (...n: number[]) => number;
  /** Visible lines: in scene hooks all visible lines, in line()/lyricFx() the lines of that lyric style. */
  lines: LineCtx[];
  /** Song duration. */
  duration: number;
  title: string;
  artist: string;
  lib: typeof Lib;
  /**
   * Layer for plates behind text (sticker bodies, bars, boxes) and decorative lines that should not get a
   * readability outline. Text on ctx is measured against the plates. Same as ctx when the correction is
   * off. Use lib.onPlate().
   */
  plate: CanvasRenderingContext2D;
  intensity: number;
  /** Rendering for export (vs live preview). */
  exporting: boolean;
}

export interface TitleCtx {
  title: string;
  artist: string;
  /** 0..1 over the intro */
  p: number;
  age: number;
  dur: number;
}

export type StyleUse = 'both' | 'lyric' | 'look';
export type StyleRole = 'lyric' | 'look';

export interface MotionStyle {
  /** Unique id (used in saved projects). */
  id: string;
  name: string;
  description?: string;
  /** Color shown in the timeline. */
  color: string;
  /**
   * Where the style can be picked: 'both' (default) = lyric style and look, 'lyric' = lyric style only
   * (only line / lyricFx matter), 'look' = look only (line may be omitted).
   */
  use?: StyleUse;
  /** Post-process parameters for this style. */
  post?: Partial<PostParams>;
  camera?: Partial<CameraPolicy>;
  /** Seconds a line keeps animating after it ends. */
  exitDuration?: number;
  /** How many following lines a line stays on screen for (history layouts). Default 0. */
  persist?: number;
  /** FX id played when a section of this style starts. */
  transition?: string;
  /** Font specs to preload, e.g. '900 "Noto Sans JP"'. */
  fonts?: string[];
  /** Hide the global HUD while this style is active (style draws its own). */
  hideHud?: boolean;
  /** Move line layouts along with the camera's text area (default true). */
  followCamera?: boolean;
  /**
   * Readability correction for this lyric style (default true). Set false for outline-only / glow text
   * (switching fills per pixel breaks thin strokes); its lines are then drawn as-is.
   */
  adaptText?: boolean;
  /** Background layer (called after the background image, if any). */
  background?(g: DrawContext): void;
  /** Between background and character. */
  backDecor?(g: DrawContext): void;
  /** Between character and lyrics. */
  frontDecor?(g: DrawContext): void;
  /** Draw one lyric line. Called for each visible line. Required unless use is 'look'. */
  line?(g: DrawContext, l: LineCtx): void;
  /** Above lyrics. */
  overlay?(g: DrawContext): void;
  /** Modify post params per frame. */
  postFx?(g: DrawContext, post: PostParams): void;
  /** Custom title card (used by the 'title' telop template when this is the look style). */
  title?(g: DrawContext, p: TitleCtx): void;
  /**
   * Lyric-driven post effects (flash on a new line, punches on tapped characters...).
   * Called when this style is used as a *lyric* style; g.lines = its visible lines.
   * (postFx is only called when the style is the *look* style.)
   */
  lyricFx?(g: DrawContext, post: PostParams): void;
}

export interface FxState {
  /** Seconds since the effect started (including lead). */
  age: number;
  /** 0..1 progress. */
  p: number;
  dur: number;
  post: PostParams;
  camera: CameraFx;
  /**
   * One element only (歌詞 / テロップ / 立ち絵), on top of its motion: add to dx / dy (px) and rot (radians),
   * multiply sx / sy / alpha. E.g. s.elements.lyrics.dx += 20 * shake shakes only the lyrics.
   */
  elements: Record<ElemTarget, MotionOffsets>;
  beat: BeatState;
  intensity: number;
  seed: number;
  rand: (...n: number[]) => number;
}

export interface FxDef {
  id: string;
  name: string;
  /** Preferred key (single character, e.g. 'q'). */
  key?: string;
  color: string;
  /** Duration; seconds unless unit = 'beat'. */
  duration: number;
  unit?: 'sec' | 'beat';
  /** Start this many seconds before the event (for wipes centered on a cut). */
  lead?: number;
  /** If true, holding the key extends the effect. */
  holdable?: boolean;
  /** Not assigned to a key (e.g. transition-only effects). */
  hidden?: boolean;
  /** Modify post/camera. */
  apply?(s: FxState): void;
  /** Draw overlay (above the scene, below HUD). */
  draw?(g: DrawContext, s: FxState): void;
}

export interface TelopCtx {
  /** Main text ({title}/{artist} already replaced). */
  text: string;
  sub: string;
  /** Main text split on " / " (credits etc.). */
  lines: string[];
  /** Seconds since the telop appeared. */
  age: number;
  /** Display length in seconds (explicit or the template default). */
  dur: number;
  /** Seconds since the exit began (negative while showing). */
  out: number;
  /** 0 → 1 over the exit animation. */
  outK: number;
  index: number;
  seed: number;
}

export interface TelopDef {
  id: string;
  name: string;
  color: string;
  /** Default length in bars (when the key is only tapped). */
  bars: number;
  /** Exit animation length in seconds (drawn after dur). */
  exitDur?: number;
  /** Where the telop sits (fractions of W / H): the center of telop motions. Default the screen center. */
  pivot?: { x: number; y: number };
  draw(g: DrawContext, t: TelopCtx): void;
}

export type VizPos = 'bottom' | 'center' | 'top' | 'around' | 'full';

export interface VizCtx {
  /** Area to draw in (px). */
  area: Rect;
  /** Anchor (px): area center, or the character for 'around'. */
  cx: number;
  cy: number;
  pos: VizPos;
  /** Size multiplier (small 0.65 / medium 1 / large 1.45). */
  size: number;
  /** Opacity (crossfades when the type changes). */
  alpha: number;
  /** Color at position k (0..1) along the visualizer. */
  color: (k: number) => string;
  /** Grow downward (top position). */
  flip: boolean;
  /** Seconds since this visualizer type started. */
  age: number;
  seed: number;
}

export interface VisualizerDef {
  id: string;
  name: string;
  /** Color shown in the timeline. */
  color: string;
  /** Draw using g.audio (spectrum / wave / bass / level) and g.beat. */
  draw(g: DrawContext, v: VizCtx): void;
}

/**
 * Where the character image sits on screen. The image point at height `fy` (0 = top of the image, 1 = bottom;
 * the face is at the character's faceY) is placed at screen height `sy` (fraction of H) and horizontal position `x`
 * (fraction of W, the character's position — framings don't set it, moves may nudge it). `zoom` 1 = the image is
 * about the screen height (full body); 2.7 is a face close-up. `rot` in radians.
 */
export interface CameraPose {
  /** Screen x of the character (fraction of the width). */
  x: number;
  /** Screen y (fraction of the height, 0 = top) where the point `fy` of the character is placed. */
  sy: number;
  /** Point of the character image held at `sy` (fraction of its height: 0 = top, 1 = feet, faceY = face). */
  fy: number;
  zoom: number;
  /** Roll in radians. */
  rot: number;
}

export interface FramingCtx {
  /** Face position of the character (fraction of the image height). */
  faceY: number;
  /** 0..1 progress through the framing (for framings that move, like a pan-up). */
  p: number;
  seed: number;
  /** Camera policy of the current look style. */
  policy: CameraPolicy;
}

/** Camera framing (CAMERA track, like ワイド / バスト / アップ). */
export interface FramingDef {
  id: string;
  name: string;
  /** Preferred key in the CAMERA track (free ones: z x c v b). */
  key?: string;
  /** The pose for this framing (x is ignored: it comes from the character position). */
  pose(c: FramingCtx): Omit<CameraPose, 'x'> & { x?: number };
  /** false: the look's random tilt (CameraPolicy.tilt) is not added — for framings that set their own roll. */
  lookTilt?: boolean;
}

export interface CameraMoveCtx {
  /** 0..1 progress through the move (from its event to the next move event, capped at 8 bars). */
  p: number;
  t: number;
  beat: BeatState;
  /** Drift amount of the current look style (1 = normal). */
  drift: number;
  seed: number;
}

/** Camera movement on top of a framing (CAMERA track, like ズームイン / 手ブレ). */
export interface CameraMoveDef {
  id: string;
  name: string;
  /** Preferred key in the CAMERA track (free ones: p [ ] n m l). */
  key?: string;
  /** Change the pose (mutate it or return a new one). Keep it a pure function of the context. */
  apply(pose: CameraPose, c: CameraMoveCtx): CameraPose | void;
}

// ---------------- element effects / motions (歌詞 / テロップ / 立ち絵)

/** The elements that take effects and motions: 歌詞 (lyrics), テロップ (telop), 立ち絵 (chara). */
export type ElemTarget = 'lyrics' | 'telop' | 'chara';
export const ELEM_TARGETS: readonly ElemTarget[] = ['lyrics', 'telop', 'chara'];

/**
 * How an element is moved for one frame, around its pivot (lyrics: the text area center, telop: TelopDef.pivot,
 * character: its framing anchor). Motions and FX add up.
 */
export interface MotionOffsets {
  /** Offset in px (multiply by u). */
  dx: number;
  dy: number;
  /** Rotation in radians. */
  rot: number;
  /** Scale. */
  sx: number;
  sy: number;
  /** Opacity multiplier 0..1. */
  alpha: number;
}
export const noOffsets = (): MotionOffsets => ({ dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, alpha: 1 });

export interface MotionCtx {
  /** The element being moved. */
  target: ElemTarget;
  t: number;
  /** Seconds since this motion started. */
  age: number;
  beat: BeatState;
  audio: AudioState;
  /** Size unit min(W,H)/1080 (offsets are px). */
  u: number;
  /** Strength: 1.5 when recorded; the look style's bounce for characters on オート. */
  amount: number;
  /** Stable per element (per character / per telop). */
  seed: number;
}

/** Motion of an element (バウンス, ゆらゆら…). One at a time per element; recorded in its track. */
export interface MotionDef {
  id: string;
  name: string;
  /** Preferred key in the element tracks (free in all of them: j k l). */
  key?: string;
  /** Elements it can be used on (default all). */
  targets?: ElemTarget[];
  /** The offsets at this moment (a pure function of c). Missing fields = unchanged. */
  offsets(c: MotionCtx): Partial<MotionOffsets> | void;
}

export type EffectImage = CanvasImageSource & { width: number; height: number };

export interface EffectCtx {
  /** The element this effect is drawn for. */
  target: ElemTarget;
  /**
   * The element's image: the character sprite (MMD: this frame's render), or the lyrics / telops drawn this frame
   * (a full-frame layer of the text; plates such as stickers and boxes are not in it and stay underneath).
   * After an image() effect, the replaced image.
   */
  img: EffectImage;
  /** Where img is drawn in g.ctx's coordinates (characters: their own space, flipped / rotated with them; lyrics / telops: the frame). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawn px per image px. */
  scale: number;
  /** Seconds since this effect was turned on. */
  age: number;
  /** Stable per element (per character). */
  seed: number;
  /** Solid-color copy of the element's shape (img-sized, cached). */
  silhouette(color: string): HTMLCanvasElement;
  /** The shape grown by `width` drawn px (default: a few px relative to the image), solid color: draw it with e.draw(o.c, o.pad). */
  outline(color: string, width?: number): { c: HTMLCanvasElement; pad: number };
  /** Blurred solid-color shape for glows (low-res): draw it with e.draw(o.c, o.pad). */
  glow(color: string): { c: HTMLCanvasElement; pad: number };
  /** Paint cut out to the shape: fn(ctx, w, h) fills an img-sized canvas, kept only where the element is. Reused per key. */
  mask(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, key?: string): HTMLCanvasElement;
  /** Draw an img-sized image (with `pad` image px of margin on each side) where the element is, on g.ctx. */
  draw(image: CanvasImageSource, pad?: number): void;
}

/**
 * Effect of an element (影, 縁取り, グロー…). Toggled in its track; several combine in the order they were turned on.
 * g.ctx is where each hook draws (already placed: draw with e.draw / e.x e.y e.w e.h).
 */
export interface EffectDef {
  id: string;
  name: string;
  /** Preferred key in the element tracks (free in all of them: i o p [ ]). */
  key?: string;
  /** Elements it can be used on (default all). */
  targets?: ElemTarget[];
  /** Characters: skip the scene color grade while on (solid looks such as シルエット). */
  flat?: boolean;
  /** Replace the element's image (return an img-sized image, e.g. e.silhouette(color)). */
  image?(g: DrawContext, e: EffectCtx): EffectImage | void;
  /** Behind the element (shadow, outline, glow). */
  under?(g: DrawContext, e: EffectCtx): void;
  /** Draw the element yourself (e.g. sliced); the last effect with body() draws it. */
  body?(g: DrawContext, e: EffectCtx): void;
  /** On top of the element. */
  over?(g: DrawContext, e: EffectCtx): void;
}

// ---------------- registry ----------------
const styles = new Map<string, MotionStyle>();
const fxs = new Map<string, FxDef>();
const vizs = new Map<string, VisualizerDef>();
const telops = new Map<string, TelopDef>();
const framings = new Map<string, FramingDef>();
const moves = new Map<string, CameraMoveDef>();
const palettes = new Map<string, Palette>();
const effects = new Map<string, EffectDef>();
const motions = new Map<string, MotionDef>();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function registerStyle(s: MotionStyle) {
  if (!s || !s.id) throw new Error('invalid style: needs id');
  if (s.use != null && !['both', 'lyric', 'look'].includes(s.use)) throw new Error("invalid style: use must be 'both' | 'lyric' | 'look'");
  if (s.use !== 'look' && typeof s.line !== 'function') throw new Error("invalid style: needs line() (or use: 'look')");
  styles.set(s.id, s);
  notify();
}

export function registerFx(f: FxDef) {
  if (!f || !f.id) throw new Error('invalid fx: needs id');
  fxs.set(f.id, f);
  notify();
}

export function registerVisualizer(v: VisualizerDef) {
  if (!v || !v.id || typeof v.draw !== 'function') throw new Error('invalid visualizer: needs id and draw()');
  vizs.set(v.id, v);
  notify();
}

export const listVisualizers = () => [...vizs.values()];

export function registerTelop(t: TelopDef) {
  if (!t || !t.id || typeof t.draw !== 'function') throw new Error('invalid telop: needs id and draw()');
  telops.set(t.id, t);
  notify();
}
export const listTelops = () => [...telops.values()];

// ids that mean something else in recorded events ('auto' = the director decides, 'custom' = the project's own palette)
const reserved = { framing: new Set(['auto']), move: new Set(['auto']), palette: new Set(['auto', 'custom']) };
const taken = (kind: keyof typeof reserved, id: string, what: string) => {
  if (reserved[kind].has(id)) throw new Error(`invalid ${what}: "${id}" is reserved`);
};

export function registerFraming(f: FramingDef) {
  if (!f || !f.id || typeof f.pose !== 'function') throw new Error('invalid framing: needs id and pose()');
  taken('framing', f.id, 'framing');
  framings.set(f.id, f);
  notify();
}
export function registerCameraMove(m: CameraMoveDef) {
  if (!m || !m.id || typeof m.apply !== 'function') throw new Error('invalid camera move: needs id and apply()');
  taken('move', m.id, 'camera move');
  moves.set(m.id, m);
  notify();
}
const HEX = /^#[0-9a-f]{6}$/i;
export function registerPalette(p: Palette) {
  if (!p || !p.id) throw new Error('invalid palette: needs an id');
  taken('palette', p.id, 'palette');
  for (const k of ['bg', 'text', 'accent', 'accent2'] as const) if (!HEX.test(p[k] ?? '')) throw new Error(`invalid palette: ${k} must be #rrggbb`);
  palettes.set(p.id, { ...p, name: p.name || p.id });
  notify();
}
// element effects / motions: ids end up in comma lists and next to 'auto' / '' in recorded events
const ELEM_ID = /^[^,\s]+$/;
function elemCheck(d: { id?: unknown; targets?: unknown } | null | undefined, what: string, reservedIds: string[]) {
  if (!d || typeof d.id !== 'string' || !ELEM_ID.test(d.id)) throw new Error(`invalid ${what}: needs an id (no spaces or commas)`);
  if (reservedIds.includes(d.id)) throw new Error(`invalid ${what}: "${d.id}" is reserved`);
  const t = d.targets;
  if (t !== undefined && (!Array.isArray(t) || !t.length || t.some((x) => !ELEM_TARGETS.includes(x)))) {
    throw new Error(`invalid ${what}: targets must list 'lyrics' / 'telop' / 'chara'`);
  }
}
export function registerEffect(e: EffectDef) {
  elemCheck(e, 'effect', ['auto', 'none']);
  if (!(['image', 'under', 'body', 'over'] as const).some((k) => typeof e[k] === 'function')) throw new Error('invalid effect: needs image(), under(), body() or over()');
  effects.set(e.id, e);
  notify();
}
export function registerMotion(m: MotionDef) {
  elemCheck(m, 'motion', ['auto']);
  if (typeof m.offsets !== 'function') throw new Error('invalid motion: needs offsets()');
  motions.set(m.id, m);
  notify();
}
/** Whether an effect / motion can be used on an element. */
export const fitsTarget = (d: { targets?: ElemTarget[] }, target: ElemTarget) => !d.targets || d.targets.includes(target);
/** Registered effects (built-in first), optionally only those usable on `target`. */
export const listEffects = (target?: ElemTarget) => [...effects.values()].filter((e) => !target || fitsTarget(e, target));
export const listMotions = (target?: ElemTarget) => [...motions.values()].filter((m) => !target || fitsTarget(m, target));
export const getEffect = (id: string): EffectDef | undefined => effects.get(id);
export const getMotion = (id: string): MotionDef | undefined => motions.get(id);

export const listFramings = () => [...framings.values()];
export const listCameraMoves = () => [...moves.values()];
/** Registered palettes (built-in first). */
export const listPalettes = () => [...palettes.values()];
export const getFraming = (id: string): FramingDef | undefined => framings.get(id);
export const getCameraMove = (id: string): CameraMoveDef | undefined => moves.get(id);
export const getTelop = (id: string): TelopDef | undefined => telops.get(id);
/** Telop template named in a telop line ([型]): its id (any case) or its registered name. */
export const findTelop = (tag: string): TelopDef | undefined =>
  telops.get(tag) ?? telops.get(tag.toLowerCase()) ?? [...telops.values()].find((t) => t.id.toLowerCase() === tag.toLowerCase() || t.name === tag);
export const getVisualizer = (id: string): VisualizerDef | undefined => vizs.get(id);
export const listStyles = () => [...styles.values()];
/** Whether a style can be used as a lyric style / as a look. */
export const styleFits = (s: MotionStyle, role: StyleRole) => (s.use ?? 'both') === 'both' || s.use === role;
export const listLyricStyles = () => listStyles().filter((s) => styleFits(s, 'lyric'));
export const listLookStyles = () => listStyles().filter((s) => styleFits(s, 'look'));
export const listStylesFor = (role: StyleRole) => (role === 'lyric' ? listLyricStyles() : listLookStyles());
export const listFx = () => [...fxs.values()];
export const getStyle = (id: string): MotionStyle | undefined => styles.get(id);
export const getFx = (id: string): FxDef | undefined => fxs.get(id);
export function fallbackStyle(role?: StyleRole): MotionStyle {
  const s = (role ? listStylesFor(role)[0] : undefined) ?? styles.values().next().value;
  if (!s) throw new Error('no styles registered');
  return s;
}
export function onRegistryChange(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export const STYLE_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
export const FX_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'z', 'x', 'c', 'v', 'b', 'n', 'm'];

/**
 * Keys of a track for its definitions, the same rule everywhere: in registration order (built-ins first), a definition
 * gets its preferred `key` when that is one of the track's `slots` and still free, else the next free slot, else ''
 * (no key: picked from the key panel, the double-click menu or the inspector).
 */
export function assignKeys<T extends { id: string; key?: string }>(defs: T[], slots: readonly string[]): Map<string, string> {
  const free = [...slots];
  const out = new Map<string, string>();
  for (const d of defs) {
    const k = d.key && free.includes(d.key) ? d.key : free[0] ?? '';
    if (k) free.splice(free.indexOf(k), 1);
    out.set(d.id, k);
  }
  return out;
}

/** Keyboard key → style id, among the styles usable in that role. */
export function styleKeyMap(role: StyleRole): Map<string, string> {
  return invert(assignKeys(listStylesFor(role), STYLE_KEYS));
}

/** Keyboard key → fx id (transitions are hidden: no key). */
export function fxKeyMap(): Map<string, string> {
  return invert(assignKeys(listFx().filter((f) => !f.hidden), FX_KEYS));
}

function invert(m: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, k] of m) if (k) out.set(k, id);
  return out;
}
