// Audio visualizer template (runtime plugin). Copy to plugins/<name>.js and change the id / name.
// Draw inside v.area with v.alpha; colors from v.color(k) (k = 0..1 along the visualizer).
// g.audio is precomputed from the song (a pure function of time): spectrum (64 bands 0..1), wave (256 samples).

export default function (api) {
  const { lib } = api;

  api.registerVisualizer({
    id: 'my-viz',
    name: 'MY VIZ',
    color: '#9dff6b',

    draw(g, v) {
      const { ctx, u } = g;
      const { area } = v;
      const sp = g.audio.spectrum;
      const n = 32;
      const gap = 4 * u * v.size;
      const w = (area.w - gap * (n - 1)) / n;
      ctx.save();
      ctx.globalAlpha = v.alpha;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        // average two bands of the useful range, slightly boosted by the beat
        const b = (sp[Math.floor(k * 54)] + sp[Math.min(63, Math.floor(k * 54) + 1)]) / 2;
        const h = Math.max(2 * u, Math.pow(lib.clamp(b), 1.4) * area.h * (0.85 + 0.15 * g.beat.pulse));
        const x = area.x + i * (w + gap);
        const y = v.flip ? area.y : area.y + area.h - h;
        ctx.fillStyle = v.color(k);
        lib.roundRect(ctx, x, y, w, h, w * 0.3);
        ctx.fill();
      }
      ctx.restore();
    },
  });
}
