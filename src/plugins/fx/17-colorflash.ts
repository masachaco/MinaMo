// FX 「カラーフラッシュ」 (key G): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'colorflash', name: 'カラーフラッシュ', key: 'g', color: '#ff2e63', duration: 0.4,
    draw: (g, s) => {
      g.ctx.save();
      g.ctx.globalCompositeOperation = 'screen';
      g.ctx.globalAlpha = Math.pow(1 - s.p, 2) * 0.75;
      g.ctx.fillStyle = s.seed % 2 ? g.pal.accent : g.pal.accent2;
      g.ctx.fillRect(0, 0, g.W, g.H);
      g.ctx.restore();
    },
  });
};
