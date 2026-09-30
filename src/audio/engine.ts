import type { BeatGrid } from '../core/beat';

/** Sample-accurate playback clock built on Web Audio. */
export class AudioEngine {
  readonly ctx: AudioContext;
  buffer: AudioBuffer | null = null;
  playing = false;
  metronome = false;
  grid: BeatGrid | null = null;
  /** Duration used when no audio is loaded. */
  fallbackDuration = 180;
  onEnd: (() => void) | null = null;
  /** Playback speed (song seconds per real second). Other speeds play a pitch-preserving stretched copy. */
  rate = 1;

  private src: AudioBufferSourceNode | null = null;
  private master: GainNode;
  private startCtx = 0;
  private startPos = 0;
  private pos = 0;
  private clickTimer = 0;
  private nextClickBeat = 0;
  private endTimer = 0;
  private stretched = new Map<number, AudioBuffer>();
  private stretching = new Map<number, Promise<AudioBuffer>>();
  private loadSeq = 0;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  /** Decode and use a song. null = superseded by a later load() / unload() while decoding. */
  async load(data: ArrayBuffer): Promise<AudioBuffer | null> {
    const seq = ++this.loadSeq;
    this.pause();
    const buf = await this.ctx.decodeAudioData(data);
    if (seq !== this.loadSeq) return null;
    this.buffer = buf;
    this.stretched.clear();
    this.stretching.clear();
    this.pos = 0;
    return buf;
  }

  unload() {
    this.loadSeq++;
    this.pause();
    this.buffer = null;
    this.stretched.clear();
    this.stretching.clear();
    this.pos = 0;
  }

  /**
   * Change the playback speed. The stretched copy is prepared in a worker (a few seconds the first time for each
   * speed); playback continues from the same song position.
   */
  async setRate(r: number): Promise<void> {
    r = Math.max(0.25, Math.min(2, r));
    if (r !== 1 && this.buffer && !this.stretched.has(r)) await this.prepare(r);
    const wasPlaying = this.playing;
    const at = this.time;
    this.pause();
    this.rate = r;
    this.pos = at;
    if (wasPlaying) await this.play(at);
  }

  private prepare(r: number): Promise<AudioBuffer> {
    const buf = this.buffer!;
    let job = this.stretching.get(r);
    if (!job) {
      job = new Promise<AudioBuffer>((resolve, reject) => {
        const w = new Worker(new URL('./stretch.worker.ts', import.meta.url), { type: 'module' });
        const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice());
        w.onmessage = (ev: MessageEvent<{ channels: Float32Array[] }>) => {
          const out = this.ctx.createBuffer(ev.data.channels.length, ev.data.channels[0].length, buf.sampleRate);
          ev.data.channels.forEach((d, c) => out.copyToChannel(d as Float32Array<ArrayBuffer>, c));
          if (this.buffer === buf) this.stretched.set(r, out);
          w.terminate();
          resolve(out);
        };
        w.onerror = (e) => {
          w.terminate();
          this.stretching.delete(r);
          reject(new Error(e.message));
        };
        w.postMessage({ channels, rate: r }, channels.map((d) => d.buffer));
      });
      this.stretching.set(r, job);
    }
    return job;
  }

  get duration(): number {
    return this.buffer ? this.buffer.duration : this.fallbackDuration;
  }

  /** Output latency: how far the audible signal lags ctx.currentTime (capped; some devices report nonsense). */
  get latency(): number {
    const c = this.ctx as AudioContext & { outputLatency?: number };
    const l = c.outputLatency || c.baseLatency || 0;
    return Number.isFinite(l) ? Math.min(0.3, Math.max(0, l)) : 0;
  }

  /** Song time that is currently audible. */
  get time(): number {
    if (!this.playing) return this.pos;
    const t = this.startPos + (this.ctx.currentTime - this.startCtx - this.latency) * this.rate;
    return Math.min(this.duration, Math.max(this.startPos, t));
  }

  set volume(v: number) {
    this.master.gain.value = v;
  }

  async play(from = this.pos) {
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.stopSource();
    from = Math.max(0, Math.min(from, this.duration - 0.01));
    this.startCtx = this.ctx.currentTime + 0.02;
    this.startPos = from;
    this.playing = true;
    if (this.buffer) {
      const s = this.ctx.createBufferSource();
      const st = this.rate !== 1 ? this.stretched.get(this.rate) : undefined;
      if (st) {
        // stretched copy: buffer time = song time / rate
        s.buffer = st;
        s.start(this.startCtx, from / this.rate);
      } else {
        s.buffer = this.buffer;
        s.playbackRate.value = this.rate; // not prepared yet: plain resampling (pitch shifts)
        s.start(this.startCtx, from);
      }
      s.connect(this.master);
      this.src = s;
    }
    clearTimeout(this.endTimer);
    const remain = ((this.duration - from) / this.rate) * 1000 + 50;
    this.endTimer = window.setTimeout(() => {
      if (!this.playing) return;
      this.pos = this.duration;
      this.playing = false;
      this.stopSource();
      this.onEnd?.();
    }, remain);
    this.nextClickBeat = this.grid ? Math.ceil(this.grid.beatAt(from) - 1e-6) : 0;
    this.scheduleClicks();
  }

  pause() {
    if (this.playing) this.pos = this.time;
    this.playing = false;
    clearTimeout(this.endTimer);
    this.stopSource();
  }

  seek(t: number) {
    t = Math.max(0, Math.min(t, this.duration));
    if (this.playing) this.play(t);
    else this.pos = t;
  }

  private stopSource() {
    window.clearTimeout(this.clickTimer);
    if (this.src) {
      try {
        this.src.stop();
      } catch {
        /* already stopped */
      }
      this.src.disconnect();
      this.src = null;
    }
  }

  private scheduleClicks = () => {
    if (!this.playing) return;
    if (this.metronome && this.grid) {
      const horizon = this.ctx.currentTime + 0.15;
      for (;;) {
        const songT = this.grid.timeOfBeat(this.nextClickBeat);
        const ctxT = this.startCtx + (songT - this.startPos) / this.rate;
        if (ctxT > horizon) break;
        if (ctxT >= this.ctx.currentTime - 0.005) this.click(ctxT, this.nextClickBeat % this.grid.beatsPerBar === 0);
        this.nextClickBeat++;
      }
    }
    this.clickTimer = window.setTimeout(this.scheduleClicks, 30);
  };

  private click(at: number, down: boolean) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = down ? 1760 : 1175;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(down ? 0.5 : 0.3, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + 0.06);
  }
}
