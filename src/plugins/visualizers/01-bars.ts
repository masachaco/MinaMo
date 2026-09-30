// Visualizer 「バー」 (key 1): draws from g.audio (spectrum / waveform / level analysed in advance, looked up by time).
import type { PluginApi } from '../../plugin-loader';
import { band, shape } from './_shared';

export default (api: PluginApi) => {
  api.registerVisualizer({
    id: 'bars',
    name: 'バー',
    color: '#08d9d6',
    draw(g, v) {
      const { ctx, u } = g;
      const n = 48;
      const { x, y, w, h } = v.area;
      const step = w / n;
      const bw = step * 0.62;
      const base = v.flip ? y : y + h;
      ctx.save();
      ctx.globalAlpha = v.alpha;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const bh = Math.max(2 * u, shape(band(g, k)) * h * v.size);
        const bx = x + i * step + (step - bw) / 2;
        ctx.fillStyle = v.color(k);
        ctx.fillRect(bx, v.flip ? base : base - bh, bw, bh);
        // soft reflection
        ctx.globalAlpha = v.alpha * 0.18;
        ctx.fillRect(bx, v.flip ? base - bh * 0.35 : base + 2 * u, bw, bh * 0.35);
        ctx.globalAlpha = v.alpha;
      }
      ctx.restore();
    },
  });
};
