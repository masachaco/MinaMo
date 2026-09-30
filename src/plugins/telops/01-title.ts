// Telop template 「タイトル」 (title card): picked with [型] in the telop list. Drawn from the seconds since it appeared (tl.age) and the exit progress (tl.outK).
import type { PluginApi } from '../../plugin-loader';
import { F_TITLE, F_SANS, inK } from './_shared';

export default (api: PluginApi) => {
  const { clamp, ease, fitSize, font, glyphRun, lerp, onPlate } = api.lib;

  api.registerTelop({
    id: 'title',
    name: 'タイトル',
    color: '#ffe600',
    bars: 4,
    exitDur: 0.6,
    pivot: { x: 0.5, y: 0.5 },
    draw(g, tl) {
      if (g.look.title) {
        g.look.title(g, { title: tl.text, artist: tl.sub, p: clamp(tl.age / tl.dur), age: tl.age, dur: tl.dur });
        return;
      }
      const { ctx, W, H, u, pal } = g;
      const age = tl.age;
      const outK = ease.inCubic(tl.outK);
      const cx = W / 2, cy = H / 2;
      const text = tl.text || 'UNTITLED';
      const size = fitSize(ctx, text, 400, F_TITLE, W * 0.72, 190 * u);
      const run = glyphRun(ctx, text, 400, F_TITLE, size, size * 0.04);
      ctx.save();
      ctx.font = font(400, size, F_TITLE);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      const x0 = cx - run.width / 2;
      const lift = -outK * 40 * u;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, cy - size * 0.62 + lift, W, size * 1.24);
      ctx.clip();
      run.glyphs.forEach((gl, i) => {
        const k = ease.outExpo(clamp((age - 0.15 - i * 0.05) / 0.9));
        ctx.globalAlpha = 1 - outK;
        ctx.fillStyle = pal.text;
        ctx.fillText(gl.g, x0 + gl.cx, cy + (1 - k) * size * 1.1 + lift);
      });
      ctx.restore();
      const lk = ease.outExpo(inK(tl, 0, 1.2));
      ctx.globalAlpha = 1 - outK;
      const lw = run.width * 1.1 * lk;
      onPlate(g, (pl) => {
        pl.fillStyle = pal.accent;
        pl.fillRect(cx - lw / 2, cy - size * 0.72 + lift, lw, 3 * u);
        pl.fillRect(cx - lw / 2, cy + size * 0.72 + lift, lw, 3 * u);
      });
      if (tl.sub) {
        const ak = ease.outCubic(inK(tl, 0.6, 1.2));
        const art = tl.sub.toUpperCase();
        const as = 30 * u;
        const ar = glyphRun(ctx, art, 500, F_SANS, as, as * lerp(0.8, 0.35, ak));
        ctx.font = font(500, as, F_SANS);
        ctx.globalAlpha = ak * (1 - outK);
        ctx.fillStyle = pal.text;
        ar.glyphs.forEach((gl) => ctx.fillText(gl.g, cx - ar.width / 2 + gl.cx, cy + size * 0.72 + 50 * u + lift));
      }
      ctx.restore();
    },
  });
};
