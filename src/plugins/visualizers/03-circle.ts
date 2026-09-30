// Visualizer 「サークル」 (key 3): draws from g.audio (spectrum / waveform / level analysed in advance, looked up by time).
import type { PluginApi } from '../../plugin-loader';
import { band, shape } from './_shared';

export default (api: PluginApi) => {
  const { TAU } = api.lib;

  api.registerVisualizer({
    id: 'circle',
    name: 'サークル',
    color: '#b58bff',
    draw(g, v) {
      const { ctx, u, t, audio } = g;
      const n = 90;
      const r0 = Math.min(v.area.w, v.area.h) * 0.24 * v.size * (1 + 0.06 * audio.bass);
      const len = r0 * 0.95;
      const rot = t * 0.15;
      ctx.save();
      ctx.globalAlpha = v.alpha;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2 * u, ((TAU * r0) / n) * 0.45);
      for (let i = 0; i < n; i++) {
        // mirrored around the circle: low frequencies at the top
        const k = i < n / 2 ? i / (n / 2) : (n - i) / (n / 2);
        const val = shape(band(g, k));
        const a = rot + (i / n) * TAU - Math.PI / 2;
        const c = Math.cos(a), s = Math.sin(a);
        ctx.strokeStyle = v.color(k);
        ctx.beginPath();
        ctx.moveTo(v.cx + c * r0, v.cy + s * r0);
        ctx.lineTo(v.cx + c * (r0 + 3 * u + val * len), v.cy + s * (r0 + 3 * u + val * len));
        ctx.stroke();
      }
      ctx.strokeStyle = v.color(0);
      ctx.globalAlpha = v.alpha * (0.35 + 0.5 * audio.bass);
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.arc(v.cx, v.cy, r0 * 0.9, 0, TAU);
      ctx.stroke();
      ctx.restore();
    },
  });
};
