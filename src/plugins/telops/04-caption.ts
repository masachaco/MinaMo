// Telop template 「字幕」 (caption (subtitle)): picked with [型] in the telop list. Drawn from the seconds since it appeared (tl.age) and the exit progress (tl.outK).
import type { PluginApi } from '../../plugin-loader';
import { F_SANS, F_JP, inK } from './_shared';

export default (api: PluginApi) => {
  const { ease, fitSize, font, onPlate, rgba, roundRect } = api.lib;

  api.registerTelop({
    id: 'caption',
    name: '字幕',
    color: '#e8e8e8',
    bars: 2,
    exitDur: 0.3,
    pivot: { x: 0.5, y: 0.86 },
    draw(g, tl) {
      const { ctx, W, H, u, pal } = g;
      const size = fitSize(ctx, tl.text, 700, F_JP, W * 0.8, 40 * u);
      const subSize = 22 * u;
      const k = ease.outCubic(inK(tl, 0, 0.25)) * (1 - tl.outK);
      if (k <= 0.001) return;
      ctx.save();
      ctx.font = font(700, size, F_JP);
      const tw = ctx.measureText(tl.text).width;
      ctx.font = font(500, subSize, F_SANS);
      const sw = tl.sub ? ctx.measureText(tl.sub).width : 0;
      const bw = Math.max(tw, sw) + 44 * u;
      const bh = size * 1.5 + (tl.sub ? subSize * 1.5 : 0);
      const cy = H * 0.86 - bh / 2 + (1 - k) * 12 * u;
      ctx.globalAlpha = k;
      onPlate(g, (pl) => {
        pl.fillStyle = 'rgba(0,0,0,0.5)';
        roundRect(pl, W / 2 - bw / 2, cy - bh / 2, bw, bh, 8 * u);
        pl.fill();
      });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = font(700, size, F_JP);
      ctx.fillText(tl.text, W / 2, cy - (tl.sub ? subSize * 0.7 : 0));
      if (tl.sub) {
        ctx.fillStyle = pal.accent2;
        ctx.font = font(500, subSize, F_SANS);
        ctx.fillText(tl.sub, W / 2, cy + size * 0.55);
      }
      ctx.restore();
    },
  });
};
