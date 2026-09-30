// Visualizer 「リング」 (key 6): draws from g.audio (spectrum / waveform / level analysed in advance, looked up by time).
import type { PluginApi } from '../../plugin-loader';
import { band, shape } from './_shared';

export default (api: PluginApi) => {
  const { TAU } = api.lib;

  api.registerVisualizer({
    id: 'rings',
    name: 'リング',
    color: '#ffd36e',
    draw(g, v) {
      const { ctx, u } = g;
      const n = 7;
      const R = Math.min(v.area.w, v.area.h) * 0.46 * v.size;
      ctx.save();
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const e = shape(band(g, k));
        const r = R * ((i + 1) / n) * (0.85 + 0.25 * e);
        ctx.globalAlpha = v.alpha * (0.2 + 0.8 * e);
        ctx.strokeStyle = v.color(k);
        ctx.lineWidth = (2 + 10 * e) * u;
        ctx.beginPath();
        ctx.arc(v.cx, v.cy, r, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    },
  });
};
