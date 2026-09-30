// Step channels: piecewise-constant values over time (character, position, framing, look...).
// Recorded track events override the auto director; a recorded 'auto' hands control back to it.

export interface Step<T> {
  t: number;
  v: T;
  /** Animate into this value (vs instant cut). */
  smooth: boolean;
  /** Came from a recorded event (vs auto director). */
  rec: boolean;
}

export interface RecStep<T> {
  t: number;
  v: T | 'auto';
  smooth: boolean;
}

/**
 * Merge auto steps with recorded steps. Before the first recorded step and after a recorded 'auto',
 * the auto steps apply; otherwise the recorded value holds until the next recorded step.
 */
export function mergeChannel<T>(auto: Step<T>[], rec: RecStep<T>[], autoDefault: T): Step<T>[] {
  const a = [...auto].sort((x, y) => x.t - y.t);
  const r = [...rec].sort((x, y) => x.t - y.t);
  const out: Step<T>[] = [];
  let ai = 0, ri = 0;
  let autoVal = autoDefault;
  let recMode = false;
  while (ai < a.length || ri < r.length) {
    const takeAuto = ri >= r.length || (ai < a.length && a[ai].t <= r[ri].t);
    if (takeAuto) {
      const s = a[ai++];
      autoVal = s.v;
      if (!recMode) out.push(s);
    } else {
      const s = r[ri++];
      if (s.v === 'auto') {
        recMode = false;
        out.push({ t: s.t, v: autoVal, smooth: s.smooth, rec: false });
      } else {
        recMode = true;
        out.push({ t: s.t, v: s.v as T, smooth: s.smooth, rec: true });
      }
    }
  }
  // drop consecutive duplicates (keeps transitions meaningful)
  const dedup: Step<T>[] = [];
  for (const s of out) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.t - s.t) < 1e-6) dedup[dedup.length - 1] = s;
    else if (last && sameValue(last.v, s.v) && last.rec === s.rec) continue;
    else dedup.push(s);
  }
  return dedup;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

export interface ChanState<T> {
  v: T;
  /** Previous value (undefined for the first step). */
  prev: T | undefined;
  /** Start of the current step. */
  t0: number;
  /** Start of the next step (Infinity if none). */
  t1: number;
  smooth: boolean;
  rec: boolean;
}

/** Value of a channel at time t (null if the channel is empty or t is before the first step). */
export function stateAt<T>(steps: Step<T>[], t: number): ChanState<T> | null {
  if (!steps.length) return null;
  let lo = 0, hi = steps.length - 1, i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].t <= t + 1e-6) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (i < 0) i = 0;
  const s = steps[i];
  return { v: s.v, prev: i > 0 ? steps[i - 1].v : undefined, t0: s.t, t1: steps[i + 1]?.t ?? Infinity, smooth: s.smooth, rec: s.rec };
}
