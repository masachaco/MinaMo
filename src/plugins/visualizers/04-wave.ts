// Visualizer 「波形」 (key 4): draws from g.audio (spectrum / waveform / level analysed in advance, looked up by time).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { TAU } = api.lib;

  api.registerVisualizer({
    id: 'wave',
    name: '波形',
    color: '#7cf6ff',
    draw(g, v) {
      const { ctx, u, audio } = g;
      const s = audio.wave;
      const n = s.length;
      ctx.save();
      ctx.globalAlpha = v.alpha;
      ctx.lineJoin = 'round';
      const path = () => {
        ctx.beginPath();
        if (v.pos === 'around') {
          const r0 = Math.min(v.area.w, v.area.h) * 0.3 * v.size;
          for (let i = 0; i <= n; i++) {
            const a = (i / n) * TAU - Math.PI / 2;
            const r = r0 * (1 + 0.35 * (s[i % n] ?? 0));
            const px = v.cx + Math.cos(a) * r, py = v.cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        } else {
          const amp = v.area.h * 0.42 * v.size;
          for (let i = 0; i < n; i++) {
            const px = v.area.x + (i / (n - 1)) * v.area.w;
            // taper the ends
            const env = Math.sin((i / (n - 1)) * Math.PI);
            const py = v.cy + (s[i] ?? 0) * amp * env;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        }
      };
      const grad = ctx.createLinearGradient(v.area.x, 0, v.area.x + v.area.w, 0);
      grad.addColorStop(0, v.color(0));
      grad.addColorStop(0.5, v.color(0.5));
      grad.addColorStop(1, v.color(1));
      ctx.strokeStyle = grad;
      ctx.globalAlpha = v.alpha * 0.3;
      ctx.lineWidth = 9 * u;
      path();
      ctx.stroke();
      ctx.globalAlpha = v.alpha;
      ctx.lineWidth = 2.5 * u;
      path();
      ctx.stroke();
      ctx.restore();
    },
  });
};
