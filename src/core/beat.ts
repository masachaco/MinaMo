import type { BeatState } from '../engine/api';

/** Constant-tempo beat grid. */
export class BeatGrid {
  constructor(
    public bpm: number,
    public beatsPerBar: number,
    public offset: number,
  ) {
    if (!(this.bpm > 0)) this.bpm = 120;
    if (!(this.beatsPerBar > 0)) this.beatsPerBar = 4;
  }

  get spb(): number {
    return 60 / this.bpm;
  }

  get barDur(): number {
    return this.spb * this.beatsPerBar;
  }

  beatAt(t: number): number {
    return (t - this.offset) / this.spb;
  }

  timeOfBeat(b: number): number {
    return this.offset + b * this.spb;
  }

  timeOfBar(bar: number): number {
    return this.offset + bar * this.barDur;
  }

  barAt(t: number): number {
    return Math.floor(this.beatAt(t) / this.beatsPerBar);
  }

  /** Snap t to the nearest 1/div beat. */
  quantize(t: number, div: number): number {
    if (!div) return t;
    const step = this.spb / div;
    return this.offset + Math.round((t - this.offset) / step) * step;
  }

  state(t: number): BeatState {
    const spb = this.spb;
    const beat = this.beatAt(t);
    const index = Math.floor(beat);
    const phase = beat - index;
    const bpb = this.beatsPerBar;
    const barF = beat / bpb;
    const bar = Math.floor(barF);
    const inBar = ((index % bpb) + bpb) % bpb;
    const since = phase * spb;
    const pulse = Math.exp(-since / 0.11);
    const half = (beat * 2) - Math.floor(beat * 2);
    return {
      bpm: this.bpm,
      spb,
      beatsPerBar: bpb,
      beat,
      index,
      phase,
      bar,
      barPhase: barF - bar,
      inBar,
      pulse,
      downPulse: inBar === 0 ? pulse : 0,
      halfPulse: Math.exp(-(half * spb * 0.5) / 0.07),
    };
  }
}
