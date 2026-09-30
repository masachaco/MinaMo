// Visualizer 「ブロブ」 (key 8): draws from g.audio (spectrum / waveform / level analysed in advance, looked up by time).
import type { PluginApi } from '../../plugin-loader';
import { band, shape, rgbaOf } from './_shared';

export default (api: PluginApi) => {
  const { TAU } = api.lib;

  api.registerVisualizer({
    id: 'blob',
    name: 'ブロブ',
    color: '#ff6b35',
    draw(g, v) {
      const { ctx, u, t, audio } = g;
      const n = 48;
      const r0 = Math.min(v.area.w, v.area.h) * 0.28 * v.size;
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const k = i < n / 2 ? i / (n / 2) : (n - i) / (n / 2);
        const a = (i / n) * TAU + t * 0.3;
        const r = r0 * (1 + 0.45 * shape(band(g, k)) + 0.08 * audio.bass);
        pts.push([v.cx + Math.cos(a) * r, v.cy + Math.sin(a) * r]);
      }
      const path = () => {
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const p0 = pts[i], p1 = pts[(i + 1) % n];
          const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
          if (i === 0) ctx.moveTo(mx, my);
          else ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
        }
        const p0 = pts[0], p1 = pts[1];
        ctx.quadraticCurveTo(p0[0], p0[1], (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
        ctx.closePath();
      };
      ctx.save();
      const gr = ctx.createRadialGradient(v.cx, v.cy, 0, v.cx, v.cy, r0 * 1.5);
      gr.addColorStop(0, rgbaOf(v.color(0), 0.35));
      gr.addColorStop(1, rgbaOf(v.color(1), 0.05));
      ctx.globalAlpha = v.alpha;
      ctx.fillStyle = gr;
      path();
      ctx.fill();
      ctx.strokeStyle = v.color(0.5);
      ctx.lineWidth = 3 * u;
      path();
      ctx.stroke();
      ctx.restore();
    },
  });
};
