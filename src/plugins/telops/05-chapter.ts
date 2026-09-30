// Telop template 「チャプター」 (chapter card): picked with [型] in the telop list. Drawn from the seconds since it appeared (tl.age) and the exit progress (tl.outK).
import type { PluginApi } from '../../plugin-loader';
import { F_MONO, F_DISPLAY, inK } from './_shared';

export default (api: PluginApi) => {
  const { ease, fitSize, font, glyphRun, lerp, onPlate, rgba } = api.lib;

  api.registerTelop({
    id: 'chapter',
    name: 'チャプター',
    color: '#ff2e63',
    bars: 2,
    exitDur: 0.4,
    pivot: { x: 0.5, y: 0.5 },
    draw(g, tl) {
      const { ctx, W, H, u, pal } = g;
      const out = ease.inCubic(tl.outK);
      const text = tl.text.toUpperCase();
      const size = fitSize(ctx, text, 400, F_DISPLAY, W * 0.62, 150 * u, 10, 0.1);
      const track = lerp(0.5, 0.08, ease.outExpo(inK(tl, 0, 0.8)));
      const run = glyphRun(ctx, text, 400, F_DISPLAY, size, size * track);
      ctx.save();
      // dim the scene behind the card
      onPlate(g, (pl) => {
        pl.fillStyle = rgba(pal.bg, 0.4 * ease.outCubic(inK(tl, 0, 0.3)) * (1 - out));
        pl.fillRect(0, 0, W, H);
      });
      const cx = W / 2, cy = H / 2;
      const sc = 1 + out * 0.12;
      ctx.translate(cx, cy);
      ctx.scale(sc, sc);
      ctx.globalAlpha = (1 - out) * ease.outCubic(inK(tl, 0, 0.2));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = font(400, size, F_DISPLAY);
      ctx.fillStyle = pal.text;
      for (const gl of run.glyphs) ctx.fillText(gl.g, -run.width / 2 + gl.cx, 0);
      const lk = ease.outExpo(inK(tl, 0.1, 0.8));
      const lw = run.width * 0.6 * lk;
      onPlate(g, (pl) => {
        pl.fillStyle = pal.accent;
        pl.fillRect(-lw, -size * 0.62, lw * 2, 3 * u);
        pl.fillRect(-lw, size * 0.62, lw * 2, 3 * u);
      });
      if (tl.sub) {
        ctx.globalAlpha = (1 - out) * inK(tl, 0.35, 0.4);
        ctx.fillStyle = pal.accent2;
        ctx.font = font(400, 22 * u, F_MONO);
        ctx.fillText(tl.sub.toUpperCase().split('').join(' '), 0, -size * 0.62 - 26 * u);
      }
      ctx.restore();
    },
  });
};
