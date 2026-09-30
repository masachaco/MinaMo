// FX 「ビートリング」 (key Z): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { TAU, ease } = api.lib;

  api.registerFx({
    id: 'rings', name: 'ビートリング', key: 'z', color: '#08d9d6', duration: 2, unit: 'beat', holdable: true,
    draw: (g, s) => {
      const { ctx, W, H, u, pal, beat } = g;
      const R = Math.hypot(W, H) * 0.55;
      ctx.save();
      ctx.strokeStyle = pal.accent2;
      for (let k = 0; k < 2; k++) {
        const ph = (beat.phase + k * 0.5) % 1;
        ctx.globalAlpha = (1 - ph) * 0.8;
        ctx.lineWidth = 10 * u * (1 - ph);
        ctx.beginPath();
        ctx.arc(W / 2, H / 2, ease.outCubic(ph) * R, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    },
  });
};
