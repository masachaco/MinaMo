// Compile a project into a time-indexed render plan.
// Tracks: lyrics (timings + lyric styles + effects / motions), telop, chara, camera, fx, viz, look — merged with the
// auto director where it applies.

import { BeatGrid } from '../core/beat';
import type { ElemEvent, FxEvent, LyricLine, Project, StyleEvent, Telop } from '../core/types';
import { fillPlaceholders } from '../core/telops';
import { fallbackStyle, getFx, getStyle, styleFits, type StyleRole, findTelop, getTelop, listTelops, type TelopDef, type EffectId, type FrameId, type FxDef, type MotionId, type MotionStyle, type MoveId, type PosId } from './api';
import { mergeChannel, stateAt, type RecStep, type Step } from './channels';
import { isFrameId, isMoveId, POSITIONS, buildAutoShots, type AutoShot } from './director';
import { clamp, graphemes, hashStr, resolveTimes } from './lib';

export interface CSegment {
  index: number;
  styleId: string;
  style: MotionStyle;
  start: number;
  end: number;
  /** Transition override for the switch into this section ('none' / fx id); undefined = style default. */
  transition?: string;
}

export interface CLine {
  index: number;
  line: LyricLine;
  /** Lyric style section of the line. */
  seg: CSegment;
  style: MotionStyle;
  start: number;
  end: number;
  chunkTimes: number[];
  tapped: boolean[];
  glyphs: string[][];
  /** Flat per-character appear times / tapped flags. */
  gt: number[];
  gtap: boolean[];
  newerStarts: number[];
  /** The line used "/" (author-defined chunks). */
  manualChunks: boolean;
  seed: number;
  cache: Record<string, any>;
}

export interface CFx {
  id: string;
  def: FxDef;
  start: number;
  dur: number;
  seed: number;
}

export interface StagePlan {
  /** Character id, or null = no character. */
  char: Step<string | null>[];
  pos: Step<PosId>[];
  frame: Step<FrameId>[];
  move: Step<MoveId>[];
  motion: Step<MotionId | 'auto'>[];
  effect: Step<EffectId[] | 'auto'>[];
}

/** Effects / motion of the lyrics or the telops (none / 静止 until recorded). */
export interface ElemPlan {
  effect: Step<EffectId[]>[];
  motion: Step<MotionId>[];
}

export interface LookPlan {
  /** Background index, 'none' or 'auto' (cycle by look section). */
  bg: Step<string>[];
  /** Palette id or 'auto' (project palette). */
  palette: Step<string>[];
  /** Background darkness, or 'auto' (project setting). */
  dim: Step<string>[];
}

export interface VizPlan {
  /** Visualizer id or 'none'. */
  type: Step<string>[];
  pos: Step<string>[];
  color: Step<string>[];
  size: Step<string>[];
  layer: Step<string>[];
}

export const VIZ_DEFAULTS = { type: 'none', pos: 'bottom', color: 'accent', size: 'm', layer: 'back' } as const;

export interface CTelop {
  index: number;
  telop: Telop;
  def: TelopDef;
  start: number;
  /** Display length (explicit or template default). */
  dur: number;
  exitDur: number;
  text: string;
  sub: string;
  lines: string[];
  seed: number;
}

export interface Compiled {
  grid: BeatGrid;
  duration: number;
  lines: CLine[];
  /** Lyric style sections. */
  lyricSegs: CSegment[];
  /** Look (scene) style sections. */
  lookSegs: CSegment[];
  fx: CFx[];
  shots: AutoShot[];
  stage: StagePlan;
  /** Effects / motions of the lyrics and the telops (the characters' are in `stage`). */
  elem: { lyrics: ElemPlan; telop: ElemPlan };
  look: LookPlan;
  viz: VizPlan;
  /** Enabled character ids in order. */
  charIds: string[];
  /** Timed telops, sorted by start. */
  telops: CTelop[];
  firstLyric: number;
}

export function resolveStyle(id: string, role: StyleRole): MotionStyle {
  const s = getStyle(id);
  return s && styleFits(s, role) ? s : fallbackStyle(role);
}

export function segmentAt(segs: CSegment[], t: number): CSegment {
  let lo = 0, hi = segs.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= t + 1e-6) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return segs[ans];
}

/** Background asset index for a bg channel value (-1 = none). 'auto' cycles by look section. */
export function bgIndexFor(v: string, segIndex: number, n: number): number {
  if (!n || v === 'none') return -1;
  if (v === 'auto') return segIndex % n;
  const i = parseInt(v, 10);
  return Number.isFinite(i) ? ((i % n) + n) % n : segIndex % n;
}

/** Background asset index at time t. */
export function bgIndexAt(C: Compiled, t: number, n: number): number {
  return bgIndexFor(stateAt(C.look.bg, t)?.v ?? 'auto', segmentAt(C.lookSegs, t).index, n);
}

export function lineStart(l: LyricLine): number | null {
  if (l.times[0] != null) return l.times[0];
  for (const t of l.times) if (t != null) return t;
  return null;
}

function buildSegments(events: (StyleEvent & { transition?: string })[], initial: string, duration: number, role: StyleRole): CSegment[] {
  const evs = [...events].sort((a, b) => a.time - b.time);
  const segs: CSegment[] = [];
  let cur: { start: number; styleId: string; transition?: string } = { start: 0, styleId: initial };
  const push = (end: number) =>
    segs.push({ index: segs.length, styleId: cur.styleId, style: resolveStyle(cur.styleId, role), start: cur.start, end, transition: cur.transition });
  for (const e of evs) {
    if (segs.length === 0 && e.time <= 0.05 && cur.start === 0) {
      cur.styleId = e.style;
      continue;
    }
    if (e.style === cur.styleId && e.time - cur.start < 0.05) continue;
    push(e.time);
    cur = { start: e.time, styleId: e.style, transition: e.transition };
  }
  push(Math.max(duration, cur.start + 1));
  return segs;
}

const isFrame = (v: string): v is FrameId => isFrameId(v);
const isMove = (v: string): v is MoveId => isMoveId(v);
const isPos = (v: string): v is PosId => POSITIONS.some((f) => f.id === v);
// motion / effect ids stay even when not registered (a plugin not loaded): drawn as nothing, kept when editing
const isMotion = (v: string): v is MotionId => v.length > 0;

/** Effect ids of an event value ('a,b'), in the order they were turned on. */
export function parseEffects(v: string): EffectId[] {
  return [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))];
}

/** Effects / motion channels of the lyrics or the telops. */
function elemPlan(events: ElemEvent[]): ElemPlan {
  const of = (k: ElemEvent['kind']) => events.filter((e) => e.kind === k);
  return {
    effect: mergeChannel<EffectId[]>([], [{ t: 0, v: [], smooth: false }, ...of('effect').map((e) => ({ t: e.time, v: parseEffects(e.value), smooth: true }))], []),
    motion: mergeChannel<MotionId>([], [{ t: 0, v: 'idle', smooth: false }, ...of('motion').filter((e) => isMotion(e.value)).map((e) => ({ t: e.time, v: e.value, smooth: true }))], 'idle'),
  };
}

/**
 * @param charIds enabled character ids with loaded images (defaults to all enabled characters in the project)
 */
export function compileProject(p: Project, duration: number, W: number, H: number, charIds?: string[]): Compiled {
  const s = p.settings;
  const grid = new BeatGrid(s.bpm, s.beatsPerBar, s.offset);
  const ids = charIds ?? p.characters.filter((c) => c.enabled).map((c) => c.id);

  // --- sections
  const lyricSegs = buildSegments(p.lyricStyleEvents, s.lyricStyle, duration, 'lyric');
  const lookSegs = buildSegments(
    p.lookEvents.filter((e) => e.kind === 'style').map((e) => ({ id: e.id, time: e.time, style: e.value, transition: e.transition })),
    s.lookStyle,
    duration,
    'look',
  );

  // --- lines
  const stagger = clamp(grid.spb * 0.125, 0.03, 0.08);
  const capDur = Math.max(1, s.lineCapBars) * grid.barDur;
  const timed = p.lines
    .map((line, index) => ({ line, index, start: lineStart(line) }))
    .filter((x): x is { line: LyricLine; index: number; start: number } => x.start !== null)
    .sort((a, b) => a.start - b.start);

  const lines: CLine[] = timed.map(({ line, index, start }) => {
    const seg = segmentAt(lyricSegs, start);
    const glyphs = line.chunks.map((c) => graphemes(c));
    const { times: gt, tapped: gtap } = resolveTimes(line.times, start, stagger);
    const chunkTimes: number[] = [];
    const tapped: boolean[] = [];
    let k = 0;
    for (const g of glyphs) {
      chunkTimes.push(gt[k] ?? start);
      tapped.push(!!gtap[k] || k === 0);
      k += g.length;
    }
    return {
      index, line, seg, style: seg.style, start, end: Infinity, chunkTimes, tapped, glyphs, gt, gtap,
      newerStarts: [],
      manualChunks: line.raw.split('|')[0].includes('/'),
      seed: (hashStr(line.id) ^ (s.seed * 2654435761)) >>> 0,
      cache: {},
    };
  });

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const persist = Math.max(0, Math.floor(L.style.persist ?? 0));
    let end = Infinity;
    let lastStart = L.start;
    for (let k = 0; k <= persist; k++) {
      const M = lines[i + k];
      if (!M) break;
      if (k > 0) {
        if (M.seg !== L.seg) {
          end = Math.min(end, M.start);
          break;
        }
        lastStart = M.start;
      }
      if (M.line.end != null && M.line.end >= L.start) end = Math.min(end, M.line.end);
    }
    const after = lines[i + persist + 1];
    if (after) end = Math.min(end, after.start);
    end = Math.min(end, lastStart + capDur, duration);
    L.end = Math.max(end, L.start + 0.05);
    for (let k = 1; k <= 4; k++) {
      const M = lines[i + k];
      if (!M || M.seg !== L.seg) break;
      L.newerStarts.push(M.start);
    }
  }

  // --- auto director (driven by look sections)
  const shots = buildAutoShots({
    grid,
    duration,
    segments: lookSegs,
    nChars: ids.length,
    shotScale: s.shotScale,
    seed: s.seed,
    portrait: W < H * 0.9,
    lineStarts: lines.map((l) => l.start),
  });

  // --- stage channels = auto shots merged with recorded CHARA / CAMERA tracks
  const auto = <T>(f: (sh: AutoShot) => T): Step<T>[] => shots.map((sh) => ({ t: sh.start, v: f(sh), smooth: sh.smooth, rec: false }));
  const rec = <T>(list: { time: number; value: string; smooth?: boolean }[], parse: (v: string) => T | 'auto' | undefined, smooth = true): RecStep<T>[] =>
    list.flatMap((e) => {
      const v = parse(e.value);
      return v === undefined ? [] : [{ t: e.time, v, smooth: e.smooth ?? smooth }];
    });
  const ce = (k: string) => p.charaEvents.filter((e) => e.kind === k);
  const me = (k: string) => p.camEvents.filter((e) => e.kind === k);
  const idSet = new Set(ids);
  // No automatic direction by default: until something is recorded the stage is fixed
  // (first character, centered, full body, still, no effects). A recorded 'auto' opts into the director.
  const fixed = <T>(v: T, list: RecStep<T>[]): RecStep<T>[] => [{ t: 0, v, smooth: false }, ...list];
  const stage: StagePlan = {
    char: mergeChannel(
      auto((sh) => (sh.char < 0 || !ids.length ? null : ids[sh.char % ids.length])),
      fixed<string | null>(ids[0] ?? null, rec<string | null>(ce('char'), (v) => (v === 'auto' ? 'auto' : v === 'none' || !idSet.has(v) ? null : v))),
      null,
    ),
    pos: mergeChannel(auto((sh) => sh.pos), fixed<PosId>('center', rec<PosId>(ce('pos'), (v) => (v === 'auto' || isPos(v) ? v : undefined))), 'center'),
    frame: mergeChannel(auto((sh) => sh.frame), fixed<FrameId>('full', rec<FrameId>(me('frame'), (v) => (v === 'auto' || isFrame(v) ? v : undefined), false)), 'full'),
    move: mergeChannel(auto((sh) => sh.move), fixed<MoveId>('static', rec<MoveId>(me('move'), (v) => (v === 'auto' || isMove(v) ? v : undefined))), 'push'),
    motion: mergeChannel<MotionId | 'auto'>([], fixed<MotionId | 'auto'>('idle', rec<MotionId | 'auto'>(ce('motion'), (v) => (v === 'auto' || isMotion(v) ? v : undefined))), 'auto'),
    effect: mergeChannel<EffectId[] | 'auto'>([], fixed<EffectId[] | 'auto'>([], rec<EffectId[] | 'auto'>(ce('effect'), (v) => (v === 'auto' ? 'auto' : parseEffects(v)))), 'auto'),
  };
  const elem = { lyrics: elemPlan(p.lyricEvents ?? []), telop: elemPlan(p.telopEvents ?? []) };

  // --- look channels (background: first image until a background is recorded; 'auto' cycles by look section)
  const lk = (k: string) => p.lookEvents.filter((e) => e.kind === k).map((e) => ({ t: e.time, v: e.value, smooth: true }));
  const look: LookPlan = {
    bg: mergeChannel<string>([], [{ t: 0, v: '0', smooth: false }, ...lk('bg')], 'auto'),
    palette: mergeChannel<string>([], lk('palette'), 'auto'),
    dim: mergeChannel<string>([], lk('dim'), 'auto'),
  };

  // --- visualizer channels (off until recorded)
  const vz = (k: keyof typeof VIZ_DEFAULTS): Step<string>[] =>
    mergeChannel<string>([], [{ t: 0, v: VIZ_DEFAULTS[k], smooth: false }, ...p.vizEvents.filter((e) => e.kind === k).map((e) => ({ t: e.time, v: e.value, smooth: true }))], VIZ_DEFAULTS[k]);
  const viz: VizPlan = { type: vz('type'), pos: vz('pos'), color: vz('color'), size: vz('size'), layer: vz('layer') };

  // --- fx (+ look section transitions)
  const fx: CFx[] = [];
  const addFx = (e: Pick<FxEvent, 'fx' | 'time' | 'hold'>, seed: number) => {
    const def = getFx(e.fx);
    if (!def) return;
    let dur = def.unit === 'beat' ? def.duration * grid.spb : def.duration;
    if (def.holdable && e.hold > dur) dur = e.hold;
    const lead = def.lead ?? 0;
    fx.push({ id: e.fx, def, start: e.time - lead, dur: dur + lead, seed });
  };
  p.fxEvents.forEach((e, i) => addFx(e, (hashStr(e.id) + i) >>> 0));
  for (const seg of lookSegs) {
    if (seg.index === 0 && seg.start <= 0.05) continue;
    const tr = seg.transition ?? seg.style.transition;
    if (tr && tr !== 'none') addFx({ fx: tr, time: seg.start, hold: 0 }, seg.index * 7919);
  }
  fx.sort((a, b) => a.start - b.start);

  // --- telops
  const fallbackTelop = getTelop('caption') ?? listTelops()[0];
  const telops: CTelop[] = [];
  p.telops.forEach((tp, index) => {
    const def = findTelop(tp.template) ?? fallbackTelop;
    if (tp.start == null || !def) return;
    const text = fillPlaceholders(tp.text, s.title, s.artist);
    telops.push({
      index,
      telop: tp,
      def,
      start: tp.start,
      dur: Math.max(0.1, tp.dur ?? def.bars * grid.barDur),
      exitDur: def.exitDur ?? 0.5,
      text,
      sub: fillPlaceholders(tp.sub, s.title, s.artist),
      lines: text.split(/\s+\/\s+/).filter(Boolean),
      seed: hashStr(tp.id),
    });
  });
  telops.sort((a, b) => a.start - b.start);

  const firstLyric = lines.length ? lines[0].start : duration;

  return { grid, duration, lines, lyricSegs, lookSegs, fx, shots, stage, elem, look, viz, charIds: ids, telops, firstLyric };
}
