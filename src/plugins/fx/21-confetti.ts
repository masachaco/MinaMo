// FX 「紙吹雪」 (key L): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { clamp, hash } = api.lib;

  api.registerFx({
    id: 'confetti', name: '紙吹雪', key: 'l', color: '#ffd36e', duration: 1.6,
    draw: (g, s) => {
      const { ctx, W, H, u, pal } = g;
      const cols = [pal.accent, pal.accent2, pal.text, '#ffd36e'];
      ctx.save();
      for (let i = 0; i < 90; i++) {
        const r = (k: number) => hash(s.seed, i, k);
        const vx = (r(1) - 0.5) * W * 0.9, vy = -(0.6 + r(2) * 0.9) * H;
        const tt = s.age;
        const x = W / 2 + vx * tt, y = H * 1.05 + vy * tt + 0.5 * H * 1.6 * tt * tt;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(tt * (4 + r(3) * 8));
        ctx.scale(Math.cos(tt * 9 + i), 1);
        ctx.globalAlpha = 1 - clamp((s.p - 0.7) / 0.3);
        ctx.fillStyle = cols[i % cols.length];
        ctx.fillRect(-6 * u, -9 * u, 12 * u, 18 * u);
        ctx.restore();
      }
      ctx.restore();
    },
  });
};
