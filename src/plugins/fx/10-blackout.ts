// FX 「ブラックアウト」 (key P): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { clamp, rgba } = api.lib;

  api.registerFx({
    id: 'blackout', name: 'ブラックアウト', key: 'p', color: '#303030', duration: 1, unit: 'beat', holdable: true,
    draw: (g, s) => {
      const a = Math.min(clamp(s.age / 0.04), clamp((s.dur - s.age) / 0.15));
      g.ctx.fillStyle = `rgba(0,0,0,${a})`;
      g.ctx.fillRect(0, 0, g.W, g.H);
    },
  });
};
