// Small helpers shared by the built-in visualizers. A runtime plugin cannot import this file: copy what it needs.

import type { DrawContext } from '../../engine/api';
import { clamp, lerp, rgba } from '../../engine/lib';

/** Band value at position k (0..1) over the useful part of the spectrum, linearly interpolated. */
export function band(g: DrawContext, k: number): number {
  const s = g.audio.spectrum;
  const n = Math.max(1, Math.floor(s.length * 0.86));
  const x = clamp(k) * (n - 1);
  const i = Math.floor(x);
  const f = x - i;
  return lerp(s[i] ?? 0, s[Math.min(n - 1, i + 1)] ?? 0, f);
}

/** Emphasize peaks a little so quiet passages don't look flat. */
export const shape = (v: number) => Math.pow(clamp(v), 1.35);

/** '#rrggbb' or 'hsl(...)' → with alpha. */
export function rgbaOf(c: string, a: number): string {
  if (c.startsWith('#')) return rgba(c, a);
  if (c.startsWith('hsl(')) return c.replace('hsl(', 'hsla(').replace(')', `,${a})`);
  return c;
}
