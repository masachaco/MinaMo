// Visualizer 「ドットEQ」 (key 5): draws from g.audio (spectrum / waveform / level analysed in advance, looked up by time).
import type { PluginApi } from '../../plugin-loader';
import { band, shape } from './_shared';

export default (api: PluginApi) => {
  const { TAU } = api.lib;

  api.registerVisualizer({
    id: 'dots',
    name: 'ドットEQ',
    color: '#9dff6b',
    draw(g, v) {
      const { ctx } = g;
      const cols = 32, rows = 12;
      const { x, y, w, h } = v.area;
      const cw = w / cols;
      const rh = (h * Math.min(1.3, v.size)) / rows;
      const r = Math.min(cw, rh) * 0.34;
      const base = v.flip ? y : y + h;
      ctx.save();
      for (let i = 0; i < cols; i++) {
        const k = i / (cols - 1);
        const lit = Math.round(shape(band(g, k)) * rows);
        for (let j = 0; j < rows; j++) {
          const on = j < lit;
          ctx.globalAlpha = v.alpha * (on ? 1 : 0.1);
          ctx.fillStyle = on ? v.color(j / (rows - 1)) : v.color(k);
          const cy = v.flip ? base + (j + 0.5) * rh : base - (j + 0.5) * rh;
          ctx.beginPath();
          ctx.arc(x + (i + 0.5) * cw, cy, r, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    },
  });
};
