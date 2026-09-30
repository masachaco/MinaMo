// Loaded media for rendering: character sprites and backgrounds, plus derived caches.

import type { BackgroundRef, CharacterRef, MmdModelRef } from '../core/types';
import { makeCanvas } from './lib';
import type { AnimationClip } from 'three';
import type { MmdClip, MmdModel } from './mmd';

/** An image derived from a sprite (silhouette, outline, glow...). `stale` = the sprite changed: rebuild in place. */
export interface Derived {
  c: HTMLCanvasElement;
  pad: number;
  scale: number;
  stale?: boolean;
}

/** An image that effects work on (a character sprite, or a lyric / telop layer) with its derived images. */
export interface FxSource {
  img: HTMLCanvasElement;
  cache: Map<string, Derived>;
}

export interface CharAsset extends FxSource {
  ref: CharacterRef;
  /** The sprite (for MMD: the canvas the model is rendered into each frame). */
  img: HTMLCanvasElement;
  /** Image entries: the media key the sprite was loaded from (CharacterRef.media ?? id). */
  mediaKey?: string;
  /** MMD entry behind `img`: the (shared) model, this entry's pose / motion, and the last rendered state. */
  mmd?: { model: MmdModel; clip: MmdClip | null; key: string; camera: AnimationClip | null };
}

export interface BgAsset {
  ref: BackgroundRef;
  img?: HTMLCanvasElement;
  video?: HTMLVideoElement;
  blurred?: HTMLCanvasElement;
  url?: string;
}

const MAX_CHAR = 2048;
const MAX_BG = 2560;

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function toCanvas(img: CanvasImageSource & { width: number; height: number }, max: number, trim = false): HTMLCanvasElement {
  const iw = (img as HTMLImageElement).naturalWidth || img.width;
  const ih = (img as HTMLImageElement).naturalHeight || img.height;
  const k = Math.min(1, max / Math.max(iw, ih));
  let c = makeCanvas(iw * k, ih * k);
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
  if (trim) c = trimTransparent(c);
  return c;
}

/** Crop fully transparent margins so framing math works on the visible figure. */
function trimTransparent(c: HTMLCanvasElement): HTMLCanvasElement {
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const { width: w, height: h } = c;
  const d = x.getImageData(0, 0, w, h).data;
  let top = h, bottom = -1, left = w, right = -1;
  for (let y = 0; y < h; y += 2) {
    for (let xx = 0; xx < w; xx += 2) {
      if (d[(y * w + xx) * 4 + 3] > 8) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (xx < left) left = xx;
        if (xx > right) right = xx;
      }
    }
  }
  if (bottom < 0) return c;
  top = Math.max(0, top - 2);
  left = Math.max(0, left - 2);
  bottom = Math.min(h - 1, bottom + 2);
  right = Math.min(w - 1, right + 2);
  if (top === 0 && left === 0 && bottom === h - 1 && right === w - 1) return c;
  const out = makeCanvas(right - left + 1, bottom - top + 1);
  out.getContext('2d')!.drawImage(c, left, top, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Media key of an image character (a replaced image has its own key). */
export const charMediaKey = (ref: CharacterRef) => ref.media ?? ref.id;

export async function loadCharAsset(ref: CharacterRef, blob: Blob): Promise<CharAsset> {
  const img = await blobToImage(blob);
  return { ref, img: toCanvas(img, MAX_CHAR, true), cache: new Map(), mediaKey: charMediaKey(ref) };
}

/** MMD model from its stored folder files (normalized relative path → blob). */
export async function loadMmdModelAsset(ref: MmdModelRef, files: Map<string, Blob>): Promise<MmdModel> {
  const { loadMmdModel } = await import('./mmd'); // three.js is only loaded when an MMD model is used
  return loadMmdModel(files, ref.model);
}

/** MMD character entry: a model + its pose / motion, drawn into its own canvas. */
export async function makeMmdCharAsset(ref: CharacterRef, model: MmdModel, poseBlob: Blob | null, cameraBlob: Blob | null = null): Promise<CharAsset> {
  const { loadMmdCamera, loadMmdClip, mmdCanvas } = await import('./mmd');
  const clip = ref.mmdPose && poseBlob ? await loadMmdClip(ref.mmdPose, poseBlob) : null;
  const camera = ref.mmdCamera && cameraBlob ? await loadMmdCamera(cameraBlob) : null;
  const img = mmdCanvas();
  model.pose(clip, 0);
  model.render(img, 1024);
  return { ref, img, cache: new Map(), mmd: { model, clip, key: '', camera } };
}

export async function loadBgAsset(ref: BackgroundRef, blob: Blob): Promise<BgAsset> {
  if (ref.kind === 'video') {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('video load failed'));
    });
    return { ref, video: v, url };
  }
  const img = await blobToImage(blob);
  const c = toCanvas(img, MAX_BG);
  return { ref, img: c, blurred: blurCopy(c, 960, 10) };
}

export function disposeBg(b: BgAsset) {
  if (b.video) {
    b.video.pause();
    b.video.removeAttribute('src');
    b.video.load();
  }
  if (b.url) URL.revokeObjectURL(b.url);
}

function blurCopy(src: HTMLCanvasElement, maxW: number, blurPx: number): HTMLCanvasElement {
  const k = Math.min(1, maxW / src.width);
  const c = makeCanvas(src.width * k, src.height * k);
  const x = c.getContext('2d')!;
  const pad = blurPx * 2;
  // draw slightly enlarged to avoid transparent edges from the blur
  x.filter = `blur(${blurPx}px)`;
  x.drawImage(src, -pad, -pad, c.width + pad * 2, c.height + pad * 2);
  x.filter = 'none';
  return c;
}

/** Mark the derived images of a source out of date (its image was redrawn); they are rebuilt in place on next use. */
export function markStale(src: FxSource) {
  for (const e of src.cache.values()) e.stale = true;
}

/** Derived images kept per sprite, least recently used dropped first (an effect painting a new color every frame must not grow it forever). */
const MAX_DERIVED = 16;

/** Cached derived image: built on first use, rebuilt into the same canvas (when the size allows) once stale. */
function derived(src: FxSource, key: string, w: number, h: number, build: (x: CanvasRenderingContext2D, c: HTMLCanvasElement) => { pad: number; scale: number }): Derived {
  let e = src.cache.get(key);
  if (e) src.cache.delete(key); // re-inserted below: the Map's order is the use order
  if (e && !e.stale) {
    src.cache.set(key, e);
    return e;
  }
  const W = Math.max(1, Math.ceil(w)), H = Math.max(1, Math.ceil(h));
  const c = e && e.c.width === W && e.c.height === H ? e.c : makeCanvas(W, H);
  const x = c.getContext('2d')!;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.filter = 'none';
  x.clearRect(0, 0, c.width, c.height);
  const r = build(x, c);
  x.globalCompositeOperation = 'source-over';
  x.filter = 'none';
  e = { c, pad: r.pad, scale: r.scale };
  src.cache.set(key, e);
  while (src.cache.size > MAX_DERIVED) src.cache.delete(src.cache.keys().next().value!);
  return e;
}

/** Solid-color silhouette of a sprite (same size as img). */
export function silhouette(a: FxSource, color: string): Derived {
  return derived(a, 'sil:' + color, a.img.width, a.img.height, (x, c) => {
    x.drawImage(a.img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    return { pad: 0, scale: 1 };
  });
}

/** Dilated silhouette (outline) `r` image px thick (default: relative to the image height) — padded by `pad` = r. */
export function outlineSil(a: FxSource, color: string, r = Math.max(3, Math.round(a.img.height * 0.006))): Derived {
  const sil = silhouette(a, color).c;
  return derived(a, `out:${color}:${r}`, a.img.width + r * 2, a.img.height + r * 2, (x) => {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      x.drawImage(sil, r + Math.cos(ang) * r, r + Math.sin(ang) * r);
    }
    x.drawImage(sil, r, r);
    return { pad: r, scale: 1 };
  });
}

/** Blurred low-res silhouette for glows. `scale` = cache px per image px. */
export function glowSil(a: FxSource, color: string): Derived {
  const scale = 0.25;
  const blur = Math.max(4, a.img.height * 0.02 * scale);
  const pad = blur * 3;
  const sil = silhouette(a, color).c;
  return derived(a, 'glow:' + color, a.img.width * scale + pad * 2, a.img.height * scale + pad * 2, (x) => {
    x.filter = `blur(${blur}px)`;
    x.drawImage(sil, pad, pad, a.img.width * scale, a.img.height * scale);
    return { pad: pad / scale, scale };
  });
}

/** Paint cut out to the sprite's shape (img-sized, the canvas is reused per key and repainted on every call). */
export function maskOf(a: FxSource, key: string, fn: (x: CanvasRenderingContext2D, w: number, h: number) => void): HTMLCanvasElement {
  const e = a.cache.get('mask:' + key);
  if (e) e.stale = true; // repainted each call (the paint may change every frame)
  return derived(a, 'mask:' + key, a.img.width, a.img.height, (x, c) => {
    x.save();
    fn(x, c.width, c.height);
    x.restore();
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(a.img, 0, 0);
    return { pad: 0, scale: 1 };
  }).c;
}
