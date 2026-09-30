// Pitch-preserving time stretch (WSOLA) for slowed / sped-up practice playback.
// in:  { channels: Float32Array[], rate }   rate = playback speed (0.5 = half speed, output twice as long)
// out: { channels: Float32Array[] }
//
// Frames of N samples are overlap-added with a Hann window at a fixed synthesis hop; each frame is taken from
// around rate × (its output position), shifted within ±TOL so it lines up with the natural continuation of the
// previous frame (best cross-correlation on the mono mix). All channels use the same shifts.

const N = 2048;
const HS = N / 2;
const TOL = 256;
const STEP = 4; // correlation decimation (samples and lags)

self.onmessage = (ev: MessageEvent<{ channels: Float32Array[]; rate: number }>) => {
  const { channels, rate } = ev.data;
  const len = channels[0].length;
  const mono = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) mono[i] += ch[i] / channels.length;
  const outLen = Math.ceil(len / rate) + N;
  const out = channels.map(() => new Float32Array(outLen));
  const norm = new Float32Array(outLen);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  let prev = 0; // input position of the previous frame
  for (let o = 0; o + N <= outLen; o += HS) {
    const ideal = Math.round((o * rate));
    let pos = ideal;
    if (o > 0) {
      // the previous frame naturally continues at prev + HS: pick the shift that matches it best
      const nat = prev + HS;
      let best = -Infinity;
      for (let d = -TOL; d <= TOL; d += STEP) {
        const q = ideal + d;
        if (q < 0 || q + N > len || nat + N > len) continue;
        let c = 0;
        for (let i = 0; i < N; i += STEP * 2) c += mono[nat + i] * mono[q + i];
        if (c > best) {
          best = c;
          pos = q;
        }
      }
    }
    if (pos + N > len) pos = Math.max(0, len - N);
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c], dst = out[c];
      for (let i = 0; i < N; i++) dst[o + i] += src[pos + i] * win[i];
    }
    for (let i = 0; i < N; i++) norm[o + i] += win[i];
    prev = pos;
  }
  for (let i = 0; i < outLen; i++) {
    const n = norm[i];
    if (n > 1e-3) for (const dst of out) dst[i] /= n;
  }
  const trimmed = out.map((d) => d.slice(0, Math.ceil(len / rate)));
  (self as unknown as Worker).postMessage({ channels: trimmed }, trimmed.map((d) => d.buffer));
};
