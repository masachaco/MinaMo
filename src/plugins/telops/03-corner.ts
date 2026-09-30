// Telop template 「ラベル」 (corner label): picked with [型] in the telop list. Drawn from the seconds since it appeared (tl.age) and the exit progress (tl.outK).
import type { PluginApi } from '../../plugin-loader';
import { F_MONO, inK } from './_shared';

export default (api: PluginApi) => {
  const { ease, font, onPlate, rgba } = api.lib;

  api.registerTelop({
    id: 'corner',
    name: 'ラベル',
    color: '#b7a0ff',
    bars: 8,
    exitDur: 0.35,
    pivot: { x: 0.12, y: 0.11 },
    draw(g, tl) {
      const { ctx, W, H, u, pal, beat } = g;
      const x0 = W * 0.04, y0 = H * 0.08;
      const size = 20 * u;
      const txt = tl.text.toUpperCase();
      const n = Math.ceil(txt.length * inK(tl, 0.15, 0.45));
      ctx.save();
      ctx.font = font(400, size, F_MONO);
      const tw = ctx.measureText(txt).width;
      const bw = tw + 46 * u, bh = size * 1.9;
      const open = ease.outExpo(inK(tl, 0, 0.35)) * (1 - ease.inCubic(tl.outK));
      onPlate(g, (pl) => {
        pl.fillStyle = rgba(pal.bg, 0.55);
        pl.fillRect(x0, y0, bw * open, bh);
        pl.strokeStyle = pal.accent;
        pl.lineWidth = 1.5 * u;
        pl.strokeRect(x0, y0, bw * open, bh);
      });
      ctx.beginPath();
      ctx.rect(x0, y0, bw * open, bh + size * 1.6);
      ctx.clip();
      if (beat.phase < 0.6) {
        ctx.fillStyle = pal.accent;
        ctx.beginPath();
        ctx.arc(x0 + 16 * u, y0 + bh / 2, 5 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = pal.text;
      ctx.textBaseline = 'middle';
      ctx.fillText(txt.slice(0, n), x0 + 32 * u, y0 + bh / 2 + 1 * u);
      if (tl.sub) {
        ctx.globalAlpha = inK(tl, 0.5, 0.3);
        ctx.fillStyle = pal.text;
        ctx.font = font(400, size * 0.75, F_MONO);
        ctx.fillText(tl.sub, x0 + 4 * u, y0 + bh + size * 0.8);
      }
      ctx.restore();
    },
  });
};
