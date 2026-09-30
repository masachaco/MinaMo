import type { LyricLine } from './types';
import { graphemes, isCJK, isCJKChar } from '../engine/lib';
import { uid } from './id';

// Lyrics syntax
//   one line = one phrase (one tap in line mode)
//   "/"  splits a line into chunks (tap units in chunk mode, row breaks in some styles)
//   "|"  text after it is a sub line (translation etc.)
//   lines starting with "#" are comments, empty lines are ignored

let segW: Intl.Segmenter | null = null;

const HIRA_ONLY = /^[ぁ-ゟ]+$/;
const PUNCT_ONLY = /^[\s、。，．,.!?！？…‥ー〜～・「」『』（）()]+$/;
/** Pre-noun words (この道, あの日) belong to the word after them. */
const PRENOUN = /^(この|その|あの|どの|こんな|そんな|あんな|どんな)$/;

/** Split a Japanese phrase into natural chunks (words with particles attached). */
function autoChunksCJK(s: string): string[] {
  if (!('Segmenter' in Intl)) return [s];
  segW ??= new Intl.Segmenter('ja', { granularity: 'word' });
  const out: string[] = [];
  for (const seg of segW.segment(s)) {
    const w = seg.segment;
    if (!w.trim()) {
      if (out.length) out[out.length - 1] += w;
      continue;
    }
    const attach = out.length > 0 && (PUNCT_ONLY.test(w) || (HIRA_ONLY.test(w) && w.length <= 2 && !PRENOUN.test(w)) || PRENOUN.test(out[out.length - 1]));
    if (attach) out[out.length - 1] += w;
    else out.push(w);
  }
  // merge tiny chunks so rows are not too fragmented
  const merged: string[] = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (Array.from(last).length <= 1 || Array.from(c).length <= 1) && Array.from(last + c).length <= 5) {
      merged[merged.length - 1] = last + c;
    } else merged.push(c);
  }
  return merged.map((c) => c.trim()).filter(Boolean);
}

function joinChunks(chunks: string[]): string {
  let s = '';
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (i > 0) {
      const prev = s[s.length - 1] ?? '';
      const next = c[0] ?? '';
      const latin = (ch: string) => ch !== '' && !isCJKChar(ch);
      if (latin(prev) && latin(next)) s += ' ';
    }
    s += c;
  }
  return s;
}

export interface ParsedLine {
  raw: string;
  text: string;
  sub: string;
  chunks: string[];
}

export function parseLine(raw: string): ParsedLine {
  let main = raw;
  let sub = '';
  const bar = raw.indexOf('|');
  if (bar >= 0) {
    main = raw.slice(0, bar);
    sub = raw.slice(bar + 1).trim();
  }
  main = main.trim();
  let chunks: string[];
  if (main.includes('/')) {
    chunks = main.split('/').map((c) => c.trim()).filter(Boolean);
  } else if (isCJK(main)) {
    chunks = autoChunksCJK(main);
  } else {
    chunks = main.split(/\s+/).filter(Boolean);
  }
  if (!chunks.length) chunks = [main || ' '];
  return { raw: raw.trim(), text: joinChunks(chunks), sub, chunks };
}

export function parseLyrics(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(parseLine);
}

/**
 * Rebuild lines from edited lyrics text while keeping timings of unchanged lines.
 * Uses an LCS diff on raw line text; replaced lines at the same position keep their start time.
 */
export function reconcileLines(old: LyricLine[], text: string): LyricLine[] {
  const parsed = parseLyrics(text);
  const a = old.map((l) => l.raw);
  const b = parsed.map((p) => p.raw);
  const n = a.length, m = b.length;
  // LCS table (lyrics are small, O(n*m) is fine)
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const map = new Array<number>(m).fill(-1);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { map[j] = i; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  // unmatched new lines sitting between matched neighbors inherit the old line at the same relative slot
  for (let k = 0; k < m; k++) {
    if (map[k] >= 0) continue;
    const prevOld = k > 0 ? map[k - 1] : -1;
    const cand = prevOld + 1;
    const nextMatched = map.slice(k + 1).find((x) => x >= 0) ?? n;
    if (cand < nextMatched && cand < n && !map.includes(cand)) map[k] = -2 - cand; // soft match
  }
  return parsed.map((p, k) => {
    const mi = map[k];
    if (mi >= 0) {
      const o = old[mi];
      return { ...o, text: p.text, sub: p.sub, chunks: p.chunks };
    }
    const times: (number | null)[] = new Array(glyphCount(p)).fill(null);
    let end: number | null = null;
    let id = uid();
    if (mi <= -2) {
      const o = old[-2 - mi];
      times[0] = o.times[0] ?? null;
      end = o.end;
      id = o.id;
    }
    return { id, raw: p.raw, text: p.text, sub: p.sub, chunks: p.chunks, times, end };
  });
}

/** Number of timed characters (graphemes) of a line. */
export function glyphCount(l: { chunks: string[] }): number {
  return l.chunks.reduce((a, c) => a + graphemes(c).length, 0);
}

export interface TapTarget {
  line: number;
  /** Character index within the line. */
  glyph: number;
  chunk: number;
  /** First character of its chunk. */
  chunkFirst: boolean;
  /** First character of its line. */
  lineFirst: boolean;
}

/** Every character of every line is a tap target. */
export function tapTargets(lines: LyricLine[]): TapTarget[] {
  const out: TapTarget[] = [];
  lines.forEach((l, li) => {
    let k = 0;
    l.chunks.forEach((c, ci) => {
      const n = graphemes(c).length;
      for (let j = 0; j < n; j++) out.push({ line: li, glyph: k++, chunk: ci, chunkFirst: j === 0, lineFirst: k === 1 });
    });
  });
  return out;
}

export function targetTime(lines: LyricLine[], tg: TapTarget): number | null {
  return lines[tg.line]?.times[tg.glyph] ?? null;
}

/**
 * Where recording resumes at time t: the first target whose (effective) time is >= t.
 * Auto (null) characters inherit the time of the previous character of their line,
 * so the untapped rest of a line that already started is skipped.
 */
export function firstTargetAfter(lines: LyricLine[], targets: TapTarget[], t: number): number {
  let last = -Infinity;
  for (let i = 0; i < targets.length; i++) {
    const tg = targets[i];
    const tt = targetTime(lines, tg);
    if (tg.lineFirst) last = tt ?? Infinity;
    const eff = tt ?? last;
    if (tt !== null) last = tt;
    if (eff >= t - 1e-4) return i;
  }
  return targets.length;
}

/** glyph = one character, chunk = one "/" chunk, line = the whole line. */
export type TapUnit = 'glyph' | 'chunk' | 'line';

/**
 * Tap at time t with the cursor at target k.
 * chunk/line units first skip to the next chunk/line boundary, then assign t to its first character
 * and make the rest of the unit auto-timed. Later targets earlier than t are cleared (punch-in).
 * Returns the new lines and the next cursor.
 */
export function assignTap(lines: LyricLine[], targets: TapTarget[], k: number, t: number, unit: TapUnit): { lines: LyricLine[]; next: number } {
  const n = targets.length;
  if (unit === 'line') while (k < n && !targets[k].lineFirst) k++;
  if (unit === 'chunk') while (k < n && !targets[k].chunkFirst) k++;
  if (k >= n) return { lines, next: n };
  const next = lines.map((l) => ({ ...l, times: [...l.times] }));
  const tg = targets[k];
  const L = next[tg.line];
  L.times[tg.glyph] = t;
  if (tg.lineFirst && L.end !== null && L.end <= t) L.end = null;
  let q = k + 1;
  if (unit !== 'glyph') {
    while (q < n && targets[q].line === tg.line && (unit === 'line' || targets[q].chunk === tg.chunk)) {
      next[targets[q].line].times[targets[q].glyph] = null;
      q++;
    }
  }
  for (let r = q; r < n; r++) {
    const o = targets[r];
    const ol = next[o.line];
    const ot = ol.times[o.glyph];
    if (ot !== null && ot <= t) {
      ol.times[o.glyph] = null;
      if (o.lineFirst) ol.end = null;
    }
  }
  return { lines: next, next: q };
}

/** First target index at or after k that starts a unit (what N / Enter would tap). */
export function unitStart(targets: TapTarget[], k: number, unit: TapUnit): number {
  let j = k;
  if (unit === 'line') while (j < targets.length && !targets[j].lineFirst) j++;
  if (unit === 'chunk') while (j < targets.length && !targets[j].chunkFirst) j++;
  return j;
}

/** Index of the first target of line `line` (targets.length if none). */
export function lineFirstTarget(targets: TapTarget[], line: number): number {
  const i = targets.findIndex((t) => t.line >= line);
  return i < 0 ? targets.length : i;
}

/** Characters of a line in tap order (chunks concatenated). */
export function lineChars(l: LyricLine): string[] {
  return l.chunks.flatMap((c) => graphemes(c));
}

export interface TapPreview {
  /** Target index that will be tapped. */
  at: number;
  line: number;
  /** Text that will appear with this tap. */
  text: string;
  /** Characters skipped (left auto-timed) to reach the unit boundary. */
  skipped: number;
}

/** What the next Space (glyph) / N (chunk) / Enter (line) will reveal from cursor k. */
export function previewTap(lines: LyricLine[], targets: TapTarget[], k: number, unit: TapUnit): TapPreview | null {
  const j = unitStart(targets, k, unit);
  const tg = targets[j];
  if (!tg) return null;
  const l = lines[tg.line];
  let text: string;
  if (unit === 'glyph') text = lineChars(l)[tg.glyph] ?? '';
  else if (unit === 'chunk') text = l.chunks[tg.chunk] ?? '';
  else text = l.text;
  return { at: j, line: tg.line, text, skipped: j - k };
}

/** Time of the last tapped target before k (for cueing), or null. */
export function lastTimeBefore(lines: LyricLine[], targets: TapTarget[], k: number): number | null {
  for (let i = Math.min(k, targets.length) - 1; i >= 0; i--) {
    const t = targetTime(lines, targets[i]);
    if (t != null) return t;
  }
  return null;
}
