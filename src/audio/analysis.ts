// Offline audio analysis: waveform peaks, loudness envelopes and a 32-band spectrum,
// precomputed so that rendering stays a pure function of time (seekable & exportable).

import type { AudioState } from '../engine/api';

export const BANDS = 64;
/** Samples per second of the downsampled mono track used for oscilloscope waveforms. */
export const WAVE_RATE = 4000;
/** Points in AudioState.wave. */
export const WAVE_POINTS = 256;

export interface Analysis {
  duration: number;
  /** Envelope frames per second. */
  rate: number;
  level: Float32Array;
  bass: Float32Array;
  high: Float32Array;
  /** frames * BANDS */
  spec: Float32Array;
  peakRate: number;
  peakMin: Float32Array;
  peakMax: Float32Array;
  /** Mono signal at WAVE_RATE (for oscilloscope visuals). */
  wave: Float32Array;
}

const FFT_N = 2048;

class FFT {
  private rev: Uint32Array;
  private cos: Float32Array;
  private sin: Float32Array;
  constructor(private n: number) {
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
  }
  run(re: Float32Array, im: Float32Array) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * this.cos[k] - im[b] * this.sin[k];
          const ti = re[b] * this.sin[k] + im[b] * this.cos[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  }
}

function percentile(a: Float32Array, p: number): number {
  const s = Float32Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 1;
}

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

export async function analyzeAudio(buf: AudioBuffer, onProgress?: (p: number) => void): Promise<Analysis> {
  const sr = buf.sampleRate;
  const N = buf.length;
  const mono = new Float32Array(N);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < N; i++) mono[i] += d[i] / buf.numberOfChannels;
  }

  // waveform peaks
  const peakRate = 200;
  const pw = Math.max(1, Math.floor(sr / peakRate));
  const pn = Math.ceil(N / pw);
  const peakMin = new Float32Array(pn), peakMax = new Float32Array(pn);
  for (let p = 0; p < pn; p++) {
    let mn = 0, mx = 0;
    const e = Math.min(N, (p + 1) * pw);
    for (let i = p * pw; i < e; i++) {
      const v = mono[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    peakMin[p] = mn;
    peakMax[p] = mx;
  }

  // downsampled mono (box filter) for waveform visuals
  const wstep = sr / WAVE_RATE;
  const wn = Math.ceil(N / wstep);
  const wave = new Float32Array(wn);
  let wpeak = 1e-6;
  for (let i = 0; i < wn; i++) {
    const a = Math.floor(i * wstep), b = Math.min(N, Math.floor((i + 1) * wstep));
    let sum = 0;
    for (let k = a; k < b; k++) sum += mono[k];
    wave[i] = sum / Math.max(1, b - a);
    if (Math.abs(wave[i]) > wpeak) wpeak = Math.abs(wave[i]);
  }
  for (let i = 0; i < wn; i++) wave[i] /= wpeak;

  // spectrum frames
  const rate = 60;
  const frames = Math.ceil(buf.duration * rate);
  const level = new Float32Array(frames);
  const bass = new Float32Array(frames);
  const high = new Float32Array(frames);
  const spec = new Float32Array(frames * BANDS);
  const fft = new FFT(FFT_N);
  const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N);
  const win = new Float32Array(FFT_N);
  for (let i = 0; i < FFT_N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_N - 1));
  const binHz = sr / FFT_N;
  // log-spaced band edges 40Hz..16kHz
  const edges: number[] = [];
  for (let b = 0; b <= BANDS; b++) edges.push(Math.max(1, Math.round((40 * Math.pow(16000 / 40, b / BANDS)) / binHz)));
  const bassMax = Math.round(150 / binHz), highMin = Math.round(4000 / binHz);

  for (let f = 0; f < frames; f++) {
    const center = Math.floor((f / rate) * sr);
    const s0 = center - FFT_N / 2;
    let sum = 0;
    for (let i = 0; i < FFT_N; i++) {
      const idx = s0 + i;
      const v = idx >= 0 && idx < N ? mono[idx] : 0;
      sum += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    level[f] = Math.sqrt(sum / FFT_N);
    fft.run(re, im);
    let bs = 0, hs = 0;
    for (let k = 1; k < FFT_N / 2; k++) {
      const m = re[k] * re[k] + im[k] * im[k];
      if (k <= bassMax) bs += m;
      else if (k >= highMin) hs += m;
    }
    bass[f] = Math.sqrt(bs);
    high[f] = Math.sqrt(hs);
    for (let b = 0; b < BANDS; b++) {
      let m = 0;
      const a = edges[b], e = Math.max(a + 1, edges[b + 1]);
      for (let k = a; k < e && k < FFT_N / 2; k++) m = Math.max(m, Math.hypot(re[k], im[k]));
      const db = 20 * Math.log10(m / FFT_N + 1e-9);
      spec[f * BANDS + b] = Math.max(0, Math.min(1, (db + 72) / 60));
    }
    if (f % 400 === 0) {
      onProgress?.(f / frames);
      await yieldUI();
    }
  }

  // spectrum: per-band fast attack / slow release so bars fall smoothly
  for (let b = 0; b < BANDS; b++) {
    let y = 0;
    for (let f = 0; f < frames; f++) {
      const i = f * BANDS + b;
      const x = spec[i];
      y = x > y ? x * 0.7 + y * 0.3 : y * 0.84 + x * 0.16;
      spec[i] = y;
    }
  }
  // normalize & smooth (fast attack, slow release)
  for (const arr of [level, bass, high]) {
    const ref = percentile(arr, 0.97);
    let y = 0;
    for (let i = 0; i < arr.length; i++) {
      const x = Math.min(1, arr[i] / ref);
      y = x > y ? x : y * 0.86 + x * 0.14;
      arr[i] = y;
    }
  }
  onProgress?.(1);
  return { duration: buf.duration, rate, level, bass, high, spec, peakRate, peakMin, peakMax, wave };
}

const EMPTY_SPEC = new Float32Array(BANDS);
const EMPTY_WAVE = new Float32Array(WAVE_POINTS);

/** Sample the analysis at time t. */
export function sampleAudio(a: Analysis | null, t: number, out?: AudioState): AudioState {
  const o: AudioState = out ?? { level: 0, bass: 0, high: 0, spectrum: new Float32Array(BANDS), wave: new Float32Array(WAVE_POINTS) };
  if (!a) {
    o.level = o.bass = o.high = 0;
    o.spectrum = EMPTY_SPEC;
    o.wave = EMPTY_WAVE;
    return o;
  }
  const f = Math.max(0, Math.min(a.level.length - 1, Math.floor(t * a.rate)));
  o.level = a.level[f];
  o.bass = a.bass[f];
  o.high = a.high[f];
  o.spectrum = a.spec.subarray(f * BANDS, f * BANDS + BANDS);
  const w0 = Math.max(0, Math.min(a.wave.length - WAVE_POINTS, Math.floor(t * WAVE_RATE) - WAVE_POINTS / 2));
  o.wave = a.wave.subarray(w0, w0 + WAVE_POINTS);
  return o;
}
