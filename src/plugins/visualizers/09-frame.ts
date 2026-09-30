// Visualizer 「フレーム」 (key 9): draws from g.audio (spectrum / waveform / level analysed in advance, looked up by time).
import type { PluginApi } from '../../plugin-loader';
import { band, shape } from './_shared';

export default (api: PluginApi) => {
  api.registerVisualizer({
    id: 'frame',
    name: 'フレーム',
    color: '#e8e8e8',
    draw(g, v) {
      const { ctx, W, H, u } = g;
      const depth = Math.min(W, H) * 0.12 * v.size;
      ctx.save();
      ctx.globalAlpha = v.alpha;
      const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number, count: number) => {
        const dx = (x1 - x0) / count, dy = (y1 - y0) / count;
        const thick = Math.max(2 * u, Math.hypot(dx, dy) * 0.55);
        for (let i = 0; i < count; i++) {
          const k = i / (count - 1);
          const e = shape(band(g, k < 0.5 ? k * 2 : (1 - k) * 2));
          const px = x0 + dx * (i + 0.5), py = y0 + dy * (i + 0.5);
          const len = Math.max(2 * u, e * depth);
          ctx.fillStyle = v.color(k);
          if (nx !== 0) ctx.fillRect(nx > 0 ? px : px - len, py - thick / 2, len, thick);
          else ctx.fillRect(px - thick / 2, ny > 0 ? py : py - len, thick, len);
        }
      };
      edge(0, H, W, H, 0, -1, 64);
      edge(0, 0, W, 0, 0, 1, 64);
      edge(0, 0, 0, H, 1, 0, 36);
      edge(W, 0, W, H, -1, 0, 36);
      ctx.restore();
    },
  });
};
