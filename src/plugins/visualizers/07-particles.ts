// Visualizer 「パーティクル」 (key 7): draws from g.audio (spectrum / waveform / level analysed in advance, looked up by time).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { TAU, hash } = api.lib;

  api.registerVisualizer({
    id: 'particles',
    name: 'パーティクル',
    color: '#ff8fb8',
    draw(g, v) {
      const { ctx, u, t, audio } = g;
      const n = 140;
      const P = 1.6;
      const R = Math.max(v.area.w, v.area.h) * 0.55 * v.size;
      const fromBottom = v.pos === 'bottom' || v.pos === 'top';
      ctx.save();
      for (let i = 0; i < n; i++) {
        const r = (k: number) => hash(v.seed, i, k);
        const age = ((t + r(1) * P) % P) / P;
        const burst = 0.45 + 0.9 * audio.bass;
        let px: number, py: number;
        if (fromBottom) {
          px = v.area.x + r(2) * v.area.w + Math.sin(t * 2 + i) * 10 * u;
          const rise = age * v.area.h * 1.4 * burst;
          py = v.flip ? v.area.y + rise : v.area.y + v.area.h - rise;
        } else {
          const a = r(2) * TAU;
          const d = age * R * burst;
          px = v.cx + Math.cos(a) * d;
          py = v.cy + Math.sin(a) * d;
        }
        const s = (1.5 + r(3) * 3.5) * u * (1 + audio.level);
        ctx.globalAlpha = v.alpha * (1 - age) * (0.5 + 0.5 * r(4));
        ctx.fillStyle = v.color(r(5));
        ctx.beginPath();
        ctx.arc(px, py, s, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    },
  });
};
