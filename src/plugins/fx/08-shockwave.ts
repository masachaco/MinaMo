// FX 「衝撃波」 (key I): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { TAU, clamp, ease } = api.lib;

  api.registerFx({
    id: 'shockwave', name: '衝撃波', key: 'i', color: '#ff2e63', duration: 0.75,
    apply: (s) => {
      s.post.radialBlur += 0.35 * (1 - s.p) * s.intensity;
      s.camera.zoom += 0.04 * (1 - ease.outCubic(s.p));
    },
    draw: (g, s) => {
      const { ctx, W, H, u, pal } = g;
      const R = Math.hypot(W, H) * 0.62;
      ctx.save();
      for (let k = 0; k < 2; k++) {
        const p = clamp((s.age - k * 0.08) / (s.dur * 0.9));
        if (p <= 0 || p >= 1) continue;
        ctx.strokeStyle = k ? pal.accent2 : pal.accent;
        ctx.globalAlpha = 1 - p;
        ctx.lineWidth = 36 * u * (1 - p);
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, ease.outExpo(p) * R, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    },
  });
};
