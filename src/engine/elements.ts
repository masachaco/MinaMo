// Element effects / motions at render time (歌詞 / テロップ / 立ち絵): which ones are on at t, the motion offsets,
// and drawing an element's image through its effects. Pure functions of time like the rest of the renderer.

import {
  fitsTarget, getEffect, getMotion, listEffects, noOffsets, type DrawContext, type EffectCtx, type EffectDef, type EffectImage, type ElemTarget,
  type MotionCtx, type MotionOffsets,
} from './api';
import { glowSil, maskOf, outlineSil, silhouette, type FxSource } from './assets';
import type { Step } from './channels';
import { clamp } from './lib';

/** An effect that is on, and since when (song seconds). */
export interface ActiveEffect {
  def: EffectDef;
  since: number;
}

const warned = new Set<string>();
function warnOnce(what: string, e: unknown) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(what, e);
  setTimeout(() => warned.delete(what), 2000);
}

function guard(what: string, fn: () => void) {
  try {
    fn();
  } catch (e) {
    warnOnce(what, e);
  }
}

// ---------------------------------------------------------------- state at t
/** Index of the step in effect at t (-1 before the first). */
function stepIndex<T>(steps: Step<T>[], t: number): number {
  let lo = 0, hi = steps.length - 1, i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].t <= t + 1e-6) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return i;
}

/**
 * Effects on at t for an element, in drawing order (registration order, built-ins first: the same set always stacks
 * the same way). Unknown ids (a plugin not loaded) and effects not meant for this element are skipped.
 * `resolve` turns a step value into ids (characters: 'auto' = the look style's).
 */
export function activeEffects<T>(steps: Step<T>[], t: number, target: ElemTarget, resolve: (v: T, stepT: number) => string[]): ActiveEffect[] {
  const i = stepIndex(steps, t);
  if (i < 0) return [];
  const ids = (j: number) => resolve(steps[j].v, j === i ? t : steps[j].t);
  const out: ActiveEffect[] = [];
  for (const id of ids(i)) {
    const def = getEffect(id);
    if (!def || !fitsTarget(def, target) || out.some((a) => a.def === def)) continue;
    let since = steps[i].t;
    for (let j = i - 1; j >= 0 && ids(j).includes(id); j--) since = steps[j].t;
    out.push({ def, since });
  }
  if (out.length > 1) {
    const rank = new Map(listEffects().map((d, k) => [d, k]));
    out.sort((a, b) => (rank.get(a.def) ?? 0) - (rank.get(b.def) ?? 0));
  }
  return out;
}

const KEYS = ['dx', 'dy', 'rot', 'sx', 'sy', 'alpha'] as const;

/** Offsets of a motion (identity for none / unknown / not meant for this element; bad values are ignored). */
export function motionOffsets(id: string | null | undefined, c: MotionCtx): MotionOffsets {
  const o = noOffsets();
  const def = id ? getMotion(id) : undefined;
  if (!def || !fitsTarget(def, c.target)) return o;
  let r: Partial<MotionOffsets> | void = undefined;
  try {
    r = def.offsets(c);
  } catch (e) {
    warnOnce(`motion ${id}:`, e);
  }
  if (r && typeof r === 'object') for (const k of KEYS) if (typeof r[k] === 'number' && Number.isFinite(r[k])) o[k] = r[k]!;
  o.alpha = clamp(o.alpha);
  return o;
}

/** Motion + FX offsets: positions and rotation add, scale and opacity multiply. */
export function addOffsets(a: MotionOffsets, b: MotionOffsets): MotionOffsets {
  const f = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  return {
    dx: a.dx + f(b.dx, 0), dy: a.dy + f(b.dy, 0), rot: a.rot + f(b.rot, 0),
    sx: a.sx * f(b.sx, 1), sy: a.sy * f(b.sy, 1), alpha: clamp(a.alpha * f(b.alpha, 1)),
  };
}

export const isStill = (o: MotionOffsets) => !o.dx && !o.dy && !o.rot && o.sx === 1 && o.sy === 1;

/** Apply offsets to a context around the pivot (px, py) in its current coordinates. */
export function applyOffsets(ctx: CanvasRenderingContext2D, px: number, py: number, o: MotionOffsets) {
  ctx.translate(px + o.dx, py + o.dy);
  if (o.rot) ctx.rotate(o.rot);
  if (o.sx !== 1 || o.sy !== 1) ctx.scale(o.sx, o.sy);
  ctx.translate(-px, -py);
}

// ---------------------------------------------------------------- drawing through effects
export interface EffectRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawn px per image px. */
  scale: number;
}

/** Where the effect hooks draw: behind the element, the element itself, on top. `reset` = draw in frame coordinates. */
export interface EffectDests {
  under: CanvasRenderingContext2D;
  body: CanvasRenderingContext2D;
  over: CanvasRenderingContext2D;
  reset: boolean;
  /** Opacity for everything drawn (the element's alpha × its motion's). */
  alpha: number;
}

/**
 * Draw an element's image with its effects (in `list` order): image() replacements, under(), the body (the last
 * body() effect, or `plainBody` / the image), over(). Each hook runs with g.ctx set to its destination inside
 * save / restore, so one effect's state never leaks into the next.
 */
export function drawEffected(
  g: DrawContext, src: FxSource, r: EffectRect, list: ActiveEffect[], target: ElemTarget, seed: number, dests: EffectDests,
  plainBody?: () => void,
) {
  const prev = g.ctx;
  const make = (a: ActiveEffect | null, img: EffectImage): EffectCtx => ({
    target, img, x: r.x, y: r.y, w: r.w, h: r.h, scale: r.scale, seed,
    age: a ? Math.max(0, g.t - a.since) : 0,
    silhouette: (color) => silhouette(src, color).c,
    outline: (color, width) => {
      const d = outlineSil(src, color, width != null && width > 0 ? Math.max(1, Math.round(width / r.scale)) : undefined);
      return { c: d.c, pad: d.pad };
    },
    glow: (color) => {
      const d = glowSil(src, color);
      return { c: d.c, pad: d.pad };
    },
    mask: (fn, key = 'mask') => maskOf(src, key, fn),
    draw: (image, pad = 0) => {
      const p = pad * r.scale;
      g.ctx.drawImage(image, r.x - p, r.y - p, r.w + p * 2, r.h + p * 2);
    },
  });
  const run = (ctx: CanvasRenderingContext2D, what: string, fn: () => void) => {
    ctx.save();
    if (dests.reset) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = dests.alpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
    } else ctx.globalAlpha *= dests.alpha;
    g.ctx = ctx;
    try {
      guard(what, fn);
    } finally {
      g.ctx = prev;
      ctx.restore();
    }
  };
  let img: EffectImage = src.img;
  for (const a of list) {
    if (!a.def.image) continue;
    guard(`effect ${a.def.id}:`, () => {
      const out = a.def.image!(g, make(a, img));
      if (out && out.width > 0 && out.height > 0) img = out;
    });
  }
  for (const a of list) if (a.def.under) run(dests.under, `effect ${a.def.id}:`, () => a.def.under!(g, make(a, img)));
  let bodyFx: ActiveEffect | undefined;
  for (const a of list) if (a.def.body) bodyFx = a;
  if (bodyFx) run(dests.body, `effect ${bodyFx.def.id}:`, () => bodyFx!.def.body!(g, make(bodyFx!, img)));
  else if (img === src.img && plainBody) plainBody();
  else run(dests.body, 'effect body:', () => make(null, img).draw(img));
  for (const a of list) if (a.def.over) run(dests.over, `effect ${a.def.id}:`, () => a.def.over!(g, make(a, img)));
}
