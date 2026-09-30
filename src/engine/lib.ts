// Helper library shared by the renderer and motion-style plugins.
// Runtime plugins receive this object as `api.lib`.

// ---------- math ----------
export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => clamp((v - a) / (b - a || 1e-9));
export const smoothstep = (a: number, b: number, v: number) => {
  const x = invLerp(a, b, v);
  return x * x * (3 - 2 * x);
};
/** Normalized progress of `age` over `dur` (clamped 0..1). */
export const prog = (age: number, dur: number) => clamp(age / (dur || 1e-9));
export const TAU = Math.PI * 2;
export const deg = (d: number) => (d * Math.PI) / 180;

export const ease = {
  linear: (x: number) => x,
  inQuad: (x: number) => x * x,
  outQuad: (x: number) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2),
  inCubic: (x: number) => x * x * x,
  outCubic: (x: number) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  inQuart: (x: number) => x * x * x * x,
  outQuart: (x: number) => 1 - Math.pow(1 - x, 4),
  inOutQuart: (x: number) => (x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2),
  outQuint: (x: number) => 1 - Math.pow(1 - x, 5),
  inExpo: (x: number) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  outExpo: (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutExpo: (x: number) =>
    x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
  inSine: (x: number) => 1 - Math.cos((x * Math.PI) / 2),
  outSine: (x: number) => Math.sin((x * Math.PI) / 2),
  inOutSine: (x: number) => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: (x: number, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  inBack: (x: number, s = 1.70158) => (s + 1) * x * x * x - s * x * x,
  outElastic: (x: number) =>
    x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  outBounce: (x: number) => {
    const n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  },
};

// ---------- deterministic random ----------
/** Hash any numbers to a float in [0,1). Deterministic: same input → same output. */
export function hash(...n: number[]): number {
  let h = 0x9e3779b9 | 0;
  for (let i = 0; i < n.length; i++) {
    let k = Math.floor(n[i] * 1000) | 0;
    k = Math.imul(k ^ (k >>> 16), 0x85ebca6b);
    k = Math.imul(k ^ (k >>> 13), 0xc2b2ae35);
    h = Math.imul(h ^ k ^ (k >>> 16), 0x27d4eb2d) + i;
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(arr: readonly T[], r: number): T => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];
export const range = (r: number, a: number, b: number) => a + (b - a) * r;
/** Smooth value noise in [-1,1]. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(i, seed) * 2 - 1;
  const b = hash(i + 1, seed) * 2 - 1;
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

// ---------- timing ----------
/**
 * Resolve per-character appear times. raw[k] = tapped time or null (auto).
 * Character 0 appears at `start`. Auto characters between two tapped ones are spread evenly
 * (at most `stagger` apart); after the last tapped one they follow every `stagger` seconds.
 */
export function resolveTimes(raw: (number | null)[], start: number, stagger: number): { times: number[]; tapped: boolean[] } {
  const n = raw.length;
  const times = new Array<number>(n);
  const tapped = new Array<boolean>(n).fill(false);
  if (!n) return { times, tapped };
  times[0] = start;
  tapped[0] = raw[0] != null;
  let a = 0;
  let ta = start;
  const fill = (from: number, to: number, t0: number, t1: number) => {
    const m = to - from;
    if (m <= 0) return;
    const step = Math.min(stagger, (t1 - t0) / (m + 1));
    for (let j = 0; j < m; j++) times[from + j] = t0 + step * (j + 1);
  };
  for (let k = 1; k < n; k++) {
    const v = raw[k];
    if (v != null && v >= ta - 1e-6) {
      fill(a + 1, k, ta, v);
      times[k] = v;
      tapped[k] = true;
      a = k;
      ta = v;
    }
  }
  for (let k = a + 1; k < n; k++) times[k] = ta + stagger * (k - a);
  return { times, tapped };
}

// ---------- color ----------
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(a)})`;
}
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
/** Pick black or white (or given colors) for best contrast on `bg`. */
export function onColor(bg: string, dark = '#0a0a0f', light = '#ffffff'): string {
  return luminance(bg) > 0.55 ? dark : light;
}

// ---------- text ----------
let segG: Intl.Segmenter | null = null;
export function graphemes(s: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    segG ??= new Intl.Segmenter('ja', { granularity: 'grapheme' });
    return Array.from(segG.segment(s), (x) => x.segment);
  }
  return Array.from(s);
}

const CJK_RE = /[　-ヿ㐀-鿿豈-﫿＀-￯]/;
export const isCJKChar = (c: string) => CJK_RE.test(c);
/** True when the text is mostly Japanese/Chinese characters. */
export function isCJK(s: string): boolean {
  let cjk = 0, other = 0;
  for (const c of s) {
    if (c === ' ') continue;
    if (CJK_RE.test(c)) cjk++;
    else other++;
  }
  return cjk > 0 && cjk >= other * 0.5;
}

export const font = (weight: string | number, size: number, family: string) =>
  `${weight} ${Math.max(1, size).toFixed(1)}px ${family}`;

const measureCache = new Map<string, number>();
/** Width of text at 100px for the given weight/family (cached). */
export function width100(ctx: CanvasRenderingContext2D, text: string, weight: string | number, family: string): number {
  const key = weight + '|' + family + '|' + text;
  let w = measureCache.get(key);
  if (w === undefined) {
    ctx.save();
    ctx.font = font(weight, 100, family);
    w = ctx.measureText(text).width;
    ctx.restore();
    if (measureCache.size > 5000) measureCache.clear();
    measureCache.set(key, w);
  }
  return w;
}
export function clearMeasureCache() {
  measureCache.clear();
}

/** Largest font size (≤ maxSize) so that text fits in maxW. */
export function fitSize(
  ctx: CanvasRenderingContext2D, text: string, weight: string | number, family: string,
  maxW: number, maxSize: number, minSize = 6, spacingEm = 0,
): number {
  const n = graphemes(text).length;
  const w = width100(ctx, text, weight, family) + spacingEm * 100 * Math.max(0, n - 1);
  if (w <= 0) return maxSize;
  return clamp((maxW / w) * 100, minSize, maxSize);
}

export interface GlyphPos {
  g: string;
  /** Left x relative to run start. */
  x: number;
  w: number;
  /** Center x relative to run start. */
  cx: number;
}

/** Lay out graphemes horizontally. spacing is in px. */
export function glyphRun(
  ctx: CanvasRenderingContext2D, text: string, weight: string | number, family: string, size: number, spacing = 0,
): { glyphs: GlyphPos[]; width: number } {
  const gs = graphemes(text);
  const out: GlyphPos[] = [];
  let x = 0;
  const k = size / 100;
  for (const g of gs) {
    const w = width100(ctx, g, weight, family) * k;
    out.push({ g, x, w, cx: x + w / 2 });
    x += w + spacing;
  }
  return { glyphs: out, width: Math.max(0, x - (gs.length ? spacing : 0)) };
}

// Vertical (tategaki) helpers
const ROTATE_V = /[ー―‐\-～〜~…‥：:；;（）()「」『』【】〈〉《》［］\[\]｛｝{}＝=→←↑↓]/;
const SMALL_KANA = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/;
const PUNCT_V = /[、。，．,.]/;
export interface VGlyph {
  g: string;
  /** Center y relative to column top. */
  cy: number;
  rotate: boolean;
  dx: number;
  dy: number;
}
/** Lay out graphemes in a vertical column. Returns glyph centers and total height. */
export function verticalRun(text: string, size: number, lineGap = 1.02): { glyphs: VGlyph[]; height: number } {
  const gs = graphemes(text).filter((g) => g !== ' ' && g !== '　');
  const step = size * lineGap;
  const glyphs: VGlyph[] = gs.map((g, i) => {
    const rotate = ROTATE_V.test(g);
    let dx = 0, dy = 0;
    if (SMALL_KANA.test(g)) { dx = size * 0.1; dy = -size * 0.1; }
    if (PUNCT_V.test(g)) { dx = size * 0.6; dy = -size * 0.6; }
    return { g, cy: i * step + size / 2, rotate, dx, dy };
  });
  return { glyphs, height: gs.length * step };
}

// ---------- drawing ----------
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function polygon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU - Math.PI / 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r1: number, r2: number, n: number, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r1 : r2;
    const a = rot + (i / (n * 2)) * TAU - Math.PI / 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Draw an opaque plate behind text (sticker body, highlight bar, caption box) on g.plate with the current
 * transform / alpha of g.ctx. Text drawn on g.ctx is then checked for readability against the plate.
 */
export function onPlate(g: { ctx: CanvasRenderingContext2D; plate: CanvasRenderingContext2D }, fn: (p: CanvasRenderingContext2D) => void) {
  const p = g.plate;
  if (p === g.ctx) {
    // same canvas (correction off): still isolate the state the plate drawing changes
    p.save();
    try {
      fn(p);
    } finally {
      p.restore();
    }
    return;
  }
  p.save();
  p.setTransform(g.ctx.getTransform());
  p.globalAlpha = g.ctx.globalAlpha;
  // text state too: strokeText / fillText on the plate must match the text layer
  p.font = g.ctx.font;
  p.textAlign = g.ctx.textAlign;
  p.textBaseline = g.ctx.textBaseline;
  p.direction = g.ctx.direction;
  try {
    fn(p);
  } finally {
    p.restore();
  }
}

/** Run `fn` with a temporary save/restore. */
export function scoped(ctx: CanvasRenderingContext2D, fn: () => void) {
  ctx.save();
  try {
    fn();
  } finally {
    ctx.restore();
  }
}

/** Draw a glyph centered at (x,y) with transform. */
export function drawGlyph(
  ctx: CanvasRenderingContext2D, g: string, x: number, y: number,
  opts: { scale?: number; sx?: number; sy?: number; rot?: number; alpha?: number; fill?: string | null; stroke?: string | null; lineWidth?: number },
) {
  const a = opts.alpha ?? 1;
  if (a <= 0.001) return;
  ctx.save();
  ctx.translate(x, y);
  if (opts.rot) ctx.rotate(opts.rot);
  const s = opts.scale ?? 1;
  ctx.scale(s * (opts.sx ?? 1), s * (opts.sy ?? 1));
  ctx.globalAlpha *= a;
  if (opts.stroke) {
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = opts.lineWidth ?? 2;
    ctx.lineJoin = 'round';
    ctx.strokeText(g, 0, 0);
  }
  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    ctx.fillText(g, 0, 0);
  }
  ctx.restore();
}

// ---------- sprites ----------
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

const spriteCache = new Map<string, HTMLCanvasElement>();
/** Cached soft radial "bokeh" sprite (white; tint via globalCompositeOperation or alpha). */
export function softDot(size = 128, hardness = 0.2): HTMLCanvasElement {
  const key = `dot:${size}:${hardness}`;
  let c = spriteCache.get(key);
  if (!c) {
    c = makeCanvas(size, size);
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(hardness, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    spriteCache.set(key, c);
  }
  return c;
}

/** Tinted copy of a sprite (cached). */
export function tinted(src: HTMLCanvasElement | HTMLImageElement, color: string, key: string): HTMLCanvasElement {
  const k = `tint:${key}:${color}`;
  let c = spriteCache.get(k);
  if (!c) {
    c = makeCanvas(src.width, src.height);
    const x = c.getContext('2d')!;
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    spriteCache.set(k, c);
  }
  return c;
}

/** Format seconds as m:ss.cc */
export function fmtTime(t: number): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, '0')}`;
}
