// Camera director: auto shot planning + the vocabulary (framing / position / movement / motion / effects)
// shared by the auto director and the recorded CHARA / CAMERA tracks.

import type { BeatGrid } from '../core/beat';
import {
  assignKeys, DEFAULT_CAMERA, getCameraMove, getFraming, listCameraMoves, listEffects, listFramings, listMotions, type BeatState, type CameraPolicy,
  type CameraPose, type ElemTarget, type FrameId, type MotionStyle, type MoveId, type PosId, type Rect, type ShotKind,
} from './api';
import { clamp, hash, lerp } from './lib';

// ---------------------------------------------------------------- vocabulary (+ keys used in CHARA / CAMERA modes)
export interface Named<T extends string> {
  id: T;
  name: string;
  /** Key in its track ('' = none: plugins beyond the free keys, picked from the inspector / menu). */
  key: string;
}

// Framings and moves are all registered through the plugin API (built-ins: src/plugins/framings, camera-moves).
const FRAME_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'z', 'x', 'c', 'v', 'b'];
export const FRAME_AUTO_KEY = 'k';
const MOVE_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'p', '[', ']', 'n', 'm', 'l'];
export const MOVE_AUTO_KEY = 'o';

/** Definitions with their keys in a track (see assignKeys). */
function withKeys<T extends string>(defs: { id: string; name: string; key?: string }[], slots: string[]): Named<T>[] {
  const keys = assignKeys(defs, slots);
  return defs.map((d) => ({ id: d.id as T, name: d.name, key: keys.get(d.id) ?? '' }));
}
/** Registered framings with their CAMERA-track keys. */
export const allFrames = (): Named<FrameId>[] => withKeys(listFramings(), FRAME_KEYS);
/** Registered camera moves with their CAMERA-track keys. */
export const allMoves = (): Named<MoveId>[] => withKeys(listCameraMoves(), MOVE_KEYS);
/** A framing / move id that can be recorded (registered). */
export const isFrameId = (v: string) => !!getFraming(v);
export const isMoveId = (v: string) => !!getCameraMove(v);

export const POSITIONS: Named<PosId>[] = [
  { id: 'left', name: '左', key: 'a' },
  { id: 'center', name: '中央', key: 's' },
  { id: 'right', name: '右', key: 'd' },
  { id: 'duo', name: '2人', key: 'f' },
];
export const POS_AUTO_KEY = 'g';

// ---- element effects / motions (歌詞 / テロップ / 立ち絵 tracks): registered defs with their keys in each track.
// Effects: Q W E R T I O P [ ] in every element track (U too for lyrics / telops); none = Y, オート = U (characters).
const EFFECT_SLOTS: Record<ElemTarget, string[]> = {
  chara: ['q', 'w', 'e', 'r', 't', 'i', 'o', 'p', '[', ']'],
  lyrics: ['q', 'w', 'e', 'r', 't', 'i', 'o', 'p', '[', ']', 'u'],
  telop: ['q', 'w', 'e', 'r', 't', 'i', 'o', 'p', '[', ']', 'u'],
};
export const EFFECT_NONE_KEY = 'y';
export const EFFECT_AUTO_KEY = 'u';
// Motions: characters on the Z row (A = positions), lyrics / telops on the A row (their N / X are taps), then J K L.
const MOTION_SLOTS: Record<ElemTarget, string[]> = {
  chara: ['z', 'x', 'c', 'v', 'b', 'n', 'j', 'k', 'l', 'h'],
  lyrics: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  telop: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
};
export const MOTION_AUTO_KEY = 'm';

/** Effects usable on an element, with their keys in its track ('' = no key). */
export const allEffects = (target: ElemTarget): Named<string>[] => withKeys(listEffects(target), EFFECT_SLOTS[target]);
/** Motions usable on an element, with their keys in its track. */
export const allMotions = (target: ElemTarget): Named<string>[] => withKeys(listMotions(target), MOTION_SLOTS[target]);

export const nameOf = <T extends string>(list: Named<T>[], id: string) => list.find((x) => x.id === id)?.name ?? id;

// ---------------------------------------------------------------- auto shots
export interface SegmentLike {
  index: number;
  style: MotionStyle;
  start: number;
  end: number;
}

export interface AutoShot {
  index: number;
  start: number;
  end: number;
  frame: FrameId;
  pos: PosId;
  /** Index into the enabled characters, -1 = no character. */
  char: number;
  move: MoveId;
  /** Smooth move (vs hard cut) into this shot. */
  smooth: boolean;
  seed: number;
  segIndex: number;
}

export const cameraOf = (s: MotionStyle): CameraPolicy => ({ ...DEFAULT_CAMERA, ...(s.camera ?? {}) });

const KIND_FRAME: Record<ShotKind, { frame: FrameId; pos?: PosId; hide?: boolean }> = {
  full: { frame: 'full' },
  bust: { frame: 'bust' },
  face: { frame: 'face' },
  left: { frame: 'knee', pos: 'left' },
  right: { frame: 'knee', pos: 'right' },
  low: { frame: 'low' },
  tilt: { frame: 'tilt' },
  duo: { frame: 'full', pos: 'duo' },
  hide: { frame: 'full', hide: true },
};
const AUTO_MOVES: MoveId[] = ['push', 'pull', 'pan', 'rise'];

/** Plan automatic shots: a new shot every `shotBars` bars (snapped to phrase starts) and at every look section. */
export function buildAutoShots(opts: {
  grid: BeatGrid;
  duration: number;
  segments: SegmentLike[];
  nChars: number;
  shotScale: number;
  seed: number;
  portrait: boolean;
  lineStarts?: number[];
}): AutoShot[] {
  const { grid, duration, segments, nChars, shotScale, seed, portrait } = opts;
  const barDur = grid.barDur;
  const segAt = (t: number) => {
    let s = segments[0];
    for (const g of segments) if (g.start <= t + 1e-6) s = g;
    return s;
  };
  const lenOf = (seg: SegmentLike) => Math.max(0.5, cameraOf(seg.style).shotBars * shotScale) * barDur;

  const bs: { t: number; segStart?: boolean }[] = [];
  for (const seg of segments) {
    bs.push({ t: seg.start, segStart: true });
    const len = lenOf(seg);
    const segEnd = Math.min(seg.end, duration);
    let k = Math.floor((seg.start - grid.offset) / len) + 1;
    for (let tt = grid.offset + k * len; tt < segEnd - 0.05; tt = grid.offset + ++k * len) {
      let bt = tt;
      // cut on the phrase: snap to the nearest line start within 3/4 bar
      if (opts.lineStarts?.length) {
        let best = Infinity;
        for (const ls of opts.lineStarts) {
          const d = Math.abs(ls - tt);
          if (d < best && d < barDur * 0.75 && ls > seg.start + barDur * 0.5 && ls < segEnd) {
            best = d;
            bt = ls;
          }
        }
      }
      if (bt - seg.start > barDur * 0.5) bs.push({ t: bt });
    }
  }
  bs.sort((a, b) => a.t - b.t);
  const kept: (typeof bs[number] & { seg: SegmentLike })[] = [];
  for (const b of bs) {
    if (b.t >= duration) continue;
    const prev = kept[kept.length - 1];
    if (prev && b.t - prev.t < grid.spb * 0.25) {
      if (b.segStart) kept.pop();
      else continue;
    }
    kept.push({ ...b, seg: segAt(b.t) });
  }
  if (!kept.length) kept.push({ t: 0, segStart: true, seg: segments[0] });
  kept[0].t = Math.min(kept[0].t, 0);

  const shots: AutoShot[] = [];
  let prevKind: ShotKind | null = null;
  let prevChar = 0;
  kept.forEach((b, i) => {
    const policy = cameraOf(b.seg.style);
    const r = (k: number) => hash(seed, i, k, b.seg.index);
    let pool = policy.pool.filter((k) => k !== 'duo' || nChars >= 2);
    if (!pool.length) pool = ['full'];
    const cand = pool.length > 1 ? pool.filter((k) => k !== prevKind) : pool;
    const kind = nChars === 0 ? 'hide' : cand[Math.floor(r(1) * cand.length) % cand.length];
    let char = prevChar;
    if (nChars > 1 && r(2) < 0.45) char = (prevChar + 1 + Math.floor(r(3) * (nChars - 1))) % nChars;
    const def = KIND_FRAME[kind];
    let pos: PosId = def.pos ?? 'center';
    if (!def.pos) {
      const sides: PosId[] = policy.center ? ['left', 'right', 'left', 'right', 'center'] : ['left', 'right'];
      pos = sides[Math.floor(r(4) * sides.length)];
    }
    if (portrait && pos !== 'duo') pos = 'center';
    shots.push({
      index: i,
      start: b.t,
      end: kept[i + 1]?.t ?? duration,
      frame: def.frame,
      pos,
      char: def.hide || nChars === 0 ? -1 : char,
      move: AUTO_MOVES[Math.floor(r(5) * 4)],
      smooth: !policy.cut,
      seed: Math.floor(r(6) * 1e6),
      segIndex: b.seg.index,
    });
    prevKind = kind;
    prevChar = char;
  });
  return shots;
}

// ---------------------------------------------------------------- poses
/** Character placement (see CameraPose in api.ts). */
export type Pose = CameraPose;

const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Framing pose. p = progress through the framing (for the pan-up shot). */
export function framePose(frame: FrameId, faceY: number, p: number, seed: number, policy: CameraPolicy): Pose {
  // an unknown id (a plugin that is not loaded) shows the whole character
  const def = getFraming(frame) ?? getFraming('full');
  let r: Partial<Pose> = {};
  try {
    r = def?.pose({ faceY, p: clamp(p), seed, policy }) ?? {};
  } catch (e) {
    console.warn(`framing ${frame}:`, e);
  }
  const pose = { x: finite(r.x, 0.5), sy: finite(r.sy, 1.02), fy: finite(r.fy, 1), zoom: Math.max(0.05, finite(r.zoom, 1)), rot: finite(r.rot, 0) };
  // the look's slight random tilt (off for framings that set their own roll)
  if (policy.tilt && def?.lookTilt !== false) pose.rot += ((((seed % 7) / 3) - 1) * policy.tilt * Math.PI) / 180;
  return pose;
}

export function posX(pos: PosId, which: number): number {
  switch (pos) {
    case 'left':
      return 0.27;
    case 'right':
      return 0.73;
    case 'duo':
      return which === 0 ? 0.3 : 0.7;
    default:
      return 0.5;
  }
}

/** Camera movement applied on top of a framing. p = progress through the movement segment. */
export function applyMove(pose: Pose, move: MoveId, p: number, t: number, beat: BeatState, drift: number, seed: number): Pose {
  const def = getCameraMove(move);
  if (!def) return { ...pose };
  const out = { ...pose };
  try {
    const q = def.apply(out, { p: clamp(p), t, beat, drift, seed }) ?? out;
    return { x: finite(q.x, pose.x), sy: finite(q.sy, pose.sy), fy: finite(q.fy, pose.fy), zoom: Math.max(0.05, finite(q.zoom, pose.zoom)), rot: finite(q.rot, pose.rot) };
  } catch (e) {
    console.warn(`camera move ${move}:`, e);
    return { ...pose };
  }
}

export function lerpPose(a: Pose, b: Pose, k: number): Pose {
  return { x: lerp(a.x, b.x, k), sy: lerp(a.sy, b.sy, k), fy: lerp(a.fy, b.fy, k), zoom: lerp(a.zoom, b.zoom, k), rot: lerp(a.rot, b.rot, k) };
}

/** Text area for a character position (null = no character on screen). */
export function boxFor(pos: PosId | null, W: number, H: number): Rect {
  const portrait = W < H * 0.9;
  const R = (x: number, y: number, w: number, h: number): Rect => ({ x: x * W, y: y * H, w: w * W, h: h * H });
  if (pos === null) return R(0.08, 0.12, 0.84, 0.76);
  if (portrait) return R(0.06, 0.08, 0.88, 0.4);
  if (pos === 'duo') return R(0.22, 0.58, 0.56, 0.34);
  if (pos === 'left') return R(0.47, 0.14, 0.49, 0.72);
  if (pos === 'right') return R(0.04, 0.14, 0.49, 0.72);
  return R(0.08, 0.56, 0.84, 0.36);
}

export function lerpRect(a: Rect, b: Rect, k: number): Rect {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) };
}

/** Duration of a smooth camera move between framings. */
export const moveDur = (spb: number) => Math.min(1.1, Math.max(0.45, spb * 2));
