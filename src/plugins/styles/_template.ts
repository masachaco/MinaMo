// Template for a new motion style (lyric style and / or look), written like any plugin.
//
// 1. Copy this file to e.g. src/plugins/styles/08-mystyle.ts (the name must start with a digit;
//    files are registered in name order, which decides the number key 1..9, 0).
//    As a runtime plugin: drop the type annotations and save it as a .js file.
// 2. Change id / name / color and implement line().
// 3. `npm run dev` picks it up automatically.
//
// Everything is a pure function of time: use g.t, l.age, l.out, chunk/glyph times and
// g.rand()/hash() instead of Math.random(), so seeking and export stay deterministic.
import type { PluginApi } from '../../plugin-loader';
import type { MotionStyle } from '../../engine/api';
import type { GlyphInfo } from '../../engine/helpers';
import type { glyphRun } from '../../engine/lib';

interface Row {
  glyphs: GlyphInfo[];
  run: ReturnType<typeof glyphRun>;
  size: number;
  y: number;
}

export default (api: PluginApi) => {
  const { clamp, ease, fitSize, font, glyphRun } = api.lib;
  const { exitK, hitPulse, makeRows, rowText } = api.helpers;

  const FONT = '"Noto Sans JP", sans-serif';

  const style: MotionStyle = {
    id: 'template',
    name: 'TEMPLATE',
    description: 'テンプレート',
    color: '#88ff88',
    exitDuration: 0.4,
    // transition: 'wipe',                       // FX id played when this section starts
    // post: { bloom: 0.3, chroma: 1 },          // post-process look
    // camera: { cut: true, shotBars: 2, pool: ['full', 'bust', 'face'], effects: ['shadow'] },

    // background(g) {},   // behind everything (g.hasBackground tells if an image/video is drawn)
    // backDecor(g) {},    // between background and character
    // frontDecor(g) {},   // between character and lyrics
    // overlay(g) {},      // above lyrics
    // postFx(g, post) {}, // tweak post params per frame (e.g. flash on beat)

    line(g, l) {
      const { ctx, t, u, pal } = g;
      // Cache the layout per line. l.box = free text area chosen by the camera director.
      const L: Row[] = (l.cache.tpl ??= (() => {
        const rows = makeRows(l, { maxRows: 2, maxLen: 10, perChunk: false, stagger: 0.04 });
        const size = Math.min(...rows.map((r) => fitSize(ctx, rowText(r), 900, FONT, l.box.w * 0.9, 120 * u)));
        const top = l.box.y + l.box.h / 2 - (rows.length * size * 1.2) / 2;
        return rows.map((r, i) => ({ glyphs: r, run: glyphRun(ctx, rowText(r), 900, FONT, size, 0), size, y: top + (i + 0.5) * size * 1.2 }));
      })());
      const ex = exitK(l); // 0 → 1 while the line exits
      const punch = 1 + 0.05 * hitPulse(l); // bump on every tapped character (音ハメ)
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const row of L) {
        ctx.font = font(900, row.size, FONT);
        const x0 = l.box.x + (l.box.w - row.run.width) / 2;
        row.glyphs.forEach((gl, i) => {
          const a = t - gl.tg; // seconds since this character appeared
          if (a < 0) return;
          const k = ease.outBack(clamp(a / 0.3));
          ctx.save();
          ctx.translate(x0 + row.run.glyphs[i].cx, row.y);
          ctx.scale(k * punch, k * punch);
          ctx.globalAlpha = 1 - ex;
          ctx.fillStyle = pal.text;
          ctx.fillText(gl.g, 0, 0);
          ctx.restore();
        });
      }
      ctx.restore();
    },
  };

  api.registerStyle(style);
};
