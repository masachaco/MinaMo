// Telop list parsing.
//   one line = one telop:  [template] main text | sub text
//   template may be an id (title, lower, corner, caption, chapter, credit) or a Japanese alias
//   {title} / {artist} are replaced with the song settings when drawn
//   lines starting with "#" are comments, empty lines are ignored

import type { Telop } from './types';
import { uid } from './id';

const ALIASES: Record<string, string> = {
  タイトル: 'title',
  名前: 'lower',
  ネーム: 'lower',
  ロワー: 'lower',
  ラベル: 'corner',
  コーナー: 'corner',
  字幕: 'caption',
  キャプション: 'caption',
  チャプター: 'chapter',
  見出し: 'chapter',
  クレジット: 'credit',
  スタッフ: 'credit',
};

export const DEFAULT_TELOP_TEXT = `# 1行 = 1テロップ。[型] 本文 | サブ（型: タイトル / 名前 / ラベル / 字幕 / チャプター / クレジット）
[タイトル] {title} | {artist}`;

export interface ParsedTelop {
  raw: string;
  template: string;
  text: string;
  sub: string;
}

export function parseTelopLine(raw: string): ParsedTelop {
  let s = raw.trim();
  let template = 'caption';
  const m = /^\[([^\]]+)\]\s*/.exec(s);
  if (m) {
    const tag = m[1].trim();
    template = ALIASES[tag] ?? tag; // an id or a registered name, resolved with findTelop()
    s = s.slice(m[0].length);
  }
  const bar = s.indexOf('|');
  const text = (bar >= 0 ? s.slice(0, bar) : s).trim();
  const sub = bar >= 0 ? s.slice(bar + 1).trim() : '';
  return { raw: raw.trim(), template, text, sub };
}

export function parseTelops(text: string): ParsedTelop[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(parseTelopLine);
}

/** Rebuild telops from edited text, keeping timings of unchanged lines (LCS on raw lines, like lyrics). */
export function reconcileTelops(old: Telop[], text: string): Telop[] {
  const parsed = parseTelops(text);
  const a = old.map((t) => t.raw);
  const b = parsed.map((p) => p.raw);
  const n = a.length, m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const map = new Array<number>(m).fill(-1);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { map[j] = i; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  // an edited line at the same slot keeps its timing
  for (let k = 0; k < m; k++) {
    if (map[k] >= 0) continue;
    const cand = (k > 0 ? map[k - 1] : -1) + 1;
    const nextMatched = map.slice(k + 1).find((x) => x >= 0) ?? n;
    if (cand < nextMatched && cand < n && !map.includes(cand)) map[k] = -2 - cand;
  }
  return parsed.map((p, k) => {
    const mi = map[k];
    const o = mi >= 0 ? old[mi] : mi <= -2 ? old[-2 - mi] : null;
    return { id: o?.id ?? uid(), raw: p.raw, template: p.template, text: p.text, sub: p.sub, start: o?.start ?? null, dur: o?.dur ?? null };
  });
}

/** Replace {title} / {artist}. */
export function fillPlaceholders(s: string, title: string, artist: string): string {
  return s.replace(/\{title\}/g, title).replace(/\{artist\}/g, artist);
}

/** Index of the first telop whose start is null or >= t (where recording resumes). */
export function firstTelopAfter(telops: Telop[], t: number): number {
  const i = telops.findIndex((x) => x.start === null || x.start >= t - 1e-4);
  return i < 0 ? telops.length : i;
}

/** Tap telop k at time t (punch-in: later telops that are now earlier than t are cleared). */
export function assignTelop(telops: Telop[], k: number, t: number): Telop[] {
  return telops.map((x, i) => {
    if (i === k) return { ...x, start: t, dur: null };
    if (i > k && x.start !== null && x.start <= t) return { ...x, start: null, dur: null };
    return x;
  });
}
