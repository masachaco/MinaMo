// FX 「シネスコ」 (key H): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { clamp, ease } = api.lib;

  api.registerFx({
    id: 'letterbox', name: 'シネスコ', key: 'h', color: '#bbbbbb', duration: 4, unit: 'beat', holdable: true,
    draw: (g, s) => {
      const k = Math.min(ease.outCubic(clamp(s.age / 0.35)), ease.inOutCubic(clamp((s.dur - s.age) / 0.35)));
      const bar = g.H * 0.12 * k;
      g.ctx.fillStyle = '#000';
      g.ctx.fillRect(0, 0, g.W, bar);
      g.ctx.fillRect(0, g.H - bar, g.W, bar);
    },
  });
};
