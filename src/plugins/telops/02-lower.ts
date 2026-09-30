// Telop template 「名前」 (lower third (name strap)): picked with [型] in the telop list. Drawn from the seconds since it appeared (tl.age) and the exit progress (tl.outK).
import type { PluginApi } from '../../plugin-loader';
import { F_SANS, inK } from './_shared';

export default (api: PluginApi) => {
  const { ease, fitSize, font, onPlate, rgba } = api.lib;

  api.registerTelop({
    id: 'lower',
    name: '名前',
    color: '#08d9d6',
    bars: 4,
    exitDur: 0.45,
    pivot: { x: 0.2, y: 0.8 },
    draw(g, tl) {
      const { ctx, W, H, u, pal } = g;
      const x0 = W * 0.06;
      const mainSize = fitSize(ctx, tl.text, 800, F_SANS, W * 0.45, 46 * u);
      const subSize = 22 * u;
      ctx.save();
      ctx.font = font(800, mainSize, F_SANS);
      const mw = ctx.measureText(tl.text).width;
      ctx.font = font(600, subSize, F_SANS);
      const sw = tl.sub ? ctx.measureText(tl.sub).width : 0;
      const padX = 22 * u, padY = 14 * u;
      const bw = Math.max(mw, sw) + padX * 2;
      const bh = mainSize * 1.1 + (tl.sub ? subSize * 1.5 : 0) + padY * 2;
      const y0 = H * 0.86 - bh;
      const inBar = ease.outCubic(inK(tl, 0, 0.25));
      const inPanel = ease.outExpo(inK(tl, 0.1, 0.5));
      const out = ease.inCubic(tl.outK);
      const wPanel = bw * inPanel * (1 - out);
      onPlate(g, (pl) => {
        // accent bar + panel
        pl.fillStyle = pal.accent;
        pl.fillRect(x0 - 8 * u, y0 + bh * (1 - inBar) * 0.5, 6 * u, bh * inBar * (1 - out));
        pl.fillStyle = rgba(pal.bg, 0.72);
        pl.fillRect(x0, y0, wPanel, bh);
      });
      // text revealed with the panel
      ctx.beginPath();
      ctx.rect(x0, y0, wPanel, bh);
      ctx.clip();
      const slide = (1 - inPanel) * -30 * u;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillStyle = pal.text;
      ctx.font = font(800, mainSize, F_SANS);
      ctx.fillText(tl.text, x0 + padX + slide, y0 + padY + mainSize * 0.92);
      if (tl.sub) {
        ctx.fillStyle = pal.accent2;
        ctx.font = font(600, subSize, F_SANS);
        ctx.fillText(tl.sub, x0 + padX + slide * 1.4, y0 + padY + mainSize * 1.1 + subSize * 1.1);
      }
      ctx.restore();
    },
  });
};
