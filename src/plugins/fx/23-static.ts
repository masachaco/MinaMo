// FX 「砂嵐」 (key X): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { hash } = api.lib;

  api.registerFx({
    id: 'static', name: '砂嵐', key: 'x', color: '#dddddd', duration: 0.5, holdable: true,
    draw: (g, s) => {
      const { ctx, W, H, u } = g;
      const f = Math.floor(s.age * 30);
      const a = s.dur > 0.6 ? 0.55 : 0.55 * (1 - s.p);
      ctx.save();
      const step = Math.max(3, Math.round(6 * u));
      for (let y = 0; y < H; y += step)
        for (let x = 0; x < W; x += step * 4) {
          const v = hash(x, y, f);
          if (v < 0.5) continue;
          ctx.globalAlpha = a * v;
          ctx.fillStyle = v > 0.8 ? '#ffffff' : '#888888';
          ctx.fillRect(x, y, step * 4, step);
        }
      ctx.restore();
    },
  });
};
