// Layout helpers for lyric styles, handed to plugins as api.helpers (makeRows, lineGlyphs, rowText, exitK, hitPulse, latestLine).

import type { DrawContext, LineCtx } from './api';
import { isCJK, isCJKChar, resolveTimes } from './lib';

export interface GlyphInfo {
  g: string;
  /** Chunk index. */
  chunk: number;
  /** Index within the chunk. */
  j: number;
  /** Index within the whole line. */
  k: number;
  /** Appear time. */
  tg: number;
}

/** Characters grouped by chunk, with appear times (tapped times kept, auto ones re-spaced by `stagger`). */
export function lineGlyphs(l: LineCtx, stagger: number): GlyphInfo[][] {
  const raw: (number | null)[] = [];
  for (const ch of l.chunks) ch.gt.forEach((t, j) => raw.push(ch.gtap[j] ? t : null));
  const { times } = resolveTimes(raw, l.start, stagger);
  let k = 0;
  return l.chunks.map((ch) => ch.glyphs.map((g, j) => ({ g, chunk: ch.index, j, k, tg: times[k++] })));
}

/** 1 right after a tapped character, decaying (for 音ハメ punches). */
export function hitPulse(l: LineCtx, decay = 0.09): number {
  return Number.isFinite(l.lastHit) && l.lastHit >= 0 ? Math.exp(-l.lastHit / decay) : 0;
}

function needsSpace(a: GlyphInfo[], b: GlyphInfo[]): boolean {
  const x = a[a.length - 1]?.g ?? '';
  const y = b[0]?.g ?? '';
  return x !== '' && y !== '' && x !== ' ' && y !== ' ' && !isCJKChar(x) && !isCJKChar(y);
}

function join(a: GlyphInfo[], b: GlyphInfo[]): GlyphInfo[] {
  if (!needsSpace(a, b)) return [...a, ...b];
  const sp: GlyphInfo = { g: ' ', chunk: b[0].chunk, j: -1, k: -1, tg: b[0].tg };
  return [...a, sp, ...b];
}

/**
 * Group a line's glyphs into rows.
 * perChunk: rows follow chunks, balanced to similar widths (≤ maxRows, splitting long CJK chunks when needed).
 * otherwise: fewest rows so that each row is about ≤ maxLen glyphs.
 */
export function makeRows(l: LineCtx, opts: { maxRows: number; maxLen: number; perChunk: boolean; stagger: number }): GlyphInfo[][] {
  const chunks = lineGlyphs(l, opts.stagger).filter((c) => c.length);
  if (!chunks.length) return [];
  let rows: GlyphInfo[][];
  if (opts.perChunk) {
    return balancedRows(chunks, opts.maxRows, opts.maxLen, l.manualChunks);
  } else {
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const target = Math.min(opts.maxRows, Math.max(1, Math.ceil(total / opts.maxLen)));
    const per = total / target;
    rows = [];
    let cur: GlyphInfo[] = [];
    let acc = 0;
    for (const c of chunks) {
      if (cur.length && rows.length < target - 1 && acc + c.length / 2 > per * (rows.length + 1)) {
        rows.push(cur);
        cur = [];
      }
      cur = cur.length ? join(cur, c) : [...c];
      acc += c.length;
    }
    if (cur.length) rows.push(cur);
  }
  // split rows that are still too long
  const cjk = isCJK(l.text);
  while (rows.length < opts.maxRows) {
    let li = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i].length > rows[li].length) li = i;
    const r = rows[li];
    if (r.length <= opts.maxLen) break;
    // prefer a chunk boundary near the middle
    let cut = -1, bestD = Infinity;
    for (let i = 1; i < r.length; i++) {
      if (r[i].chunk !== r[i - 1].chunk && r[i].g !== ' ') {
        const d = Math.abs(i - r.length / 2);
        if (d < bestD) { bestD = d; cut = i; }
      }
    }
    if (cut < 0 || bestD > r.length * 0.3) {
      if (!cjk) break;
      cut = Math.ceil(r.length / 2);
    }
    const a = r.slice(0, cut).filter((x, i, arr) => !(i === arr.length - 1 && x.g === ' '));
    const b = r.slice(cut).filter((x, i) => !(i === 0 && x.g === ' '));
    rows.splice(li, 1, a, b);
  }
  return rows;
}

// ---- balanced rows (justified layouts size each row to the same width, so row lengths must be even)

const NO_BREAK_BEFORE = /[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶーゝゞヽヾ々、。，．,.!?！？…‥)）」』】〕〉》・:：;；〜～]/;
const NO_BREAK_AFTER = /[(（「『【〔〈《]/;
const PARTICLE = /[でがはをにもへとてのばねよさ]/;
const HIRA = /[ぁ-ゟ]/;
const KATA = /[゠-ヿｦ-ﾟ]/;
const KANJI = /[㐀-鿿豈-﫿々〆]/;
const scriptOf = (c: string) => (HIRA.test(c) ? 'h' : KATA.test(c) ? 'k' : KANJI.test(c) ? 'c' : 'o');

/** Cost of a row break between a and b inside one chunk (Infinity = never). */
function midBreakCost(a: string, b: string): number {
  if (a === ' ' || b === ' ') return 0.6;
  if (NO_BREAK_BEFORE.test(b) || NO_BREAK_AFTER.test(a)) return Infinity;
  if (!isCJKChar(a) && !isCJKChar(b)) return Infinity; // never inside a latin word
  const sa = scriptOf(a), sb = scriptOf(b);
  if (sa === 'h' && sb !== 'h') return 0.8; // particle → next word
  if ((a === 'て' || a === 'で') && /[るた]/.test(b)) return 2.5; // してる / 飛んでた
  if (sa === 'h' && PARTICLE.test(a)) return 1; // likely a particle in a kana run
  if (sa === 'c' && sb === 'h') return 2; // okurigana
  if (sa !== sb) return 1.2;
  return sa === 'h' ? 1.6 : 1.8;
}

const glyphW = (c: string) => (c === ' ' ? 0.35 : isCJKChar(c) ? 1 : 0.6);

function trimSpaces(r: GlyphInfo[]): GlyphInfo[] {
  let a = 0, b = r.length;
  while (a < b && r[a].g === ' ') a++;
  while (b > a && r[b - 1].g === ' ') b--;
  return r.slice(a, b);
}

/** Rebuild a row from a slice of the flat glyph list (inserting spaces between latin chunks). */
function sliceRow(flat: GlyphInfo[], a: number, b: number): GlyphInfo[] {
  let row: GlyphInfo[] = [];
  let piece: GlyphInfo[] = [];
  for (let i = a; i < b; i++) {
    if (piece.length && flat[i].chunk !== piece[0].chunk) {
      row = row.length ? join(row, piece) : piece;
      piece = [];
    }
    piece.push(flat[i]);
  }
  if (piece.length) row = row.length ? join(row, piece) : piece;
  return trimSpaces(row);
}

/**
 * Split the line into ≤ maxRows rows of similar width.
 * Breaks prefer chunk boundaries; CJK chunks may be split inside (kinsoku and okurigana avoided)
 * when that evens the rows out. Automatic chunks may also end up on fewer rows when that is more even;
 * author-made "/" chunks keep one row each (up to maxRows) and are split inside only as a last resort.
 */
function balancedRows(chunks: GlyphInfo[][], maxRows: number, maxLen: number, manual: boolean): GlyphInfo[][] {
  const flat = chunks.flat();
  const n = flat.length;
  const letters = (r: GlyphInfo[]) => r.filter((x) => x.g !== ' ').length;
  const count = letters(flat);
  // one row per chunk, long chunks counted as several rows
  const natural = Math.max(1, Math.min(maxRows, count, chunks.reduce((a, c) => a + Math.max(1, Math.ceil(letters(c) / maxLen)), 0)));
  // break candidates: position i = between flat[i-1] and flat[i]
  const cand: { i: number; cost: number }[] = [];
  for (let i = 1; i < n; i++) {
    const cost = flat[i].chunk !== flat[i - 1].chunk ? 0 : midBreakCost(flat[i - 1].g, flat[i].g) + (manual ? 4 : 0);
    if (Number.isFinite(cost)) cand.push({ i, cost });
  }
  let best: GlyphInfo[][] = [sliceRow(flat, 0, n)];
  let bestCost = Infinity;
  const cuts: number[] = [];
  const evalCuts = (k: number, brk: number) => {
    const rows: GlyphInfo[][] = [];
    let a = 0;
    for (const c of [...cuts, n]) { rows.push(sliceRow(flat, a, c)); a = c; }
    if (rows.some((r) => !r.length)) return;
    const ws = rows.map((r) => r.reduce((s, x) => s + glyphW(x.g), 0));
    const over = rows.reduce((s, r) => s + Math.max(0, letters(r) - maxLen), 0);
    const cost = 2 * Math.log(Math.max(...ws) / Math.min(...ws)) + 0.35 * over + brk + (manual ? 10 : 0.6) * (natural - k);
    if (cost < bestCost - 1e-9) { bestCost = cost; best = rows; }
  };
  const search = (k: number, from: number, brk: number) => {
    if (cuts.length === k - 1) return evalCuts(k, brk);
    for (let c = from; c < cand.length; c++) {
      if (brk + cand[c].cost >= bestCost) continue;
      cuts.push(cand[c].i);
      search(k, c + 1, brk + cand[c].cost);
      cuts.pop();
    }
  };
  for (let k = natural; k >= 1; k--) search(k, 0, 0);
  return best;
}

export const rowText = (r: GlyphInfo[]) => r.map((x) => x.g).join('');

/** Line-level fade for lines exiting (0..1 visible). */
export function exitK(l: LineCtx): number {
  return l.out <= 0 ? 0 : Math.min(1, l.out / l.exitDur);
}

/** Latest visible line (the one that started last). */
export function latestLine(g: DrawContext): LineCtx | null {
  let best: LineCtx | null = null;
  for (const l of g.lines) if (!best || l.start > best.start) best = l;
  return best;
}
