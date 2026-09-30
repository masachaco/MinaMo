// Visualizer 「ミラーバー」 (key 2): draws from g.audio (spectrum / waveform / level analysed in advance, looked up by time).
import type { PluginApi } from '../../plugin-loader';
import { band, shape } from './_shared';

export default (api: PluginApi) => {
  api.registerVisualizer({
    id: 'mirror',
    name: 'ミラーバー',
    color: '#ff2e63',
    draw(g, v) {
      const { ctx, u } = g;
      const half = 28;
      const { w, h } = v.area;
      const step = w / (half * 2);
      const bw = step * 0.56;
      ctx.save();
      ctx.globalAlpha = v.alpha;
      for (let i = 0; i < half; i++) {
        const k = i / (half - 1);
        const bh = Math.max(2 * u, shape(band(g, k)) * h * 0.5 * v.size);
        ctx.fillStyle = v.color(k);
        for (const side of [-1, 1]) {
          const bx = v.cx + side * (i + 0.5) * step - bw / 2;
          ctx.fillRect(bx, v.cy - bh, bw, bh * 2);
        }
      }
      ctx.restore();
    },
  });
};
