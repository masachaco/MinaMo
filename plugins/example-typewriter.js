// Example runtime plugin for MinaMo.
// Load it from the left panel: Project → プラグイン → 「.js を読み込む」.
// The file is stored in the browser and re-loaded automatically next time.
//
// A plugin default-exports a function that receives `api`:
//   api.registerStyle(style)  — add a motion style (gets the next number key)
//   api.registerFx(fx)        — add a one-shot FX (gets a free Q..] key)
//   api.lib                   — easing, deterministic random, color, text measuring helpers
//   api.helpers               — makeRows / lineGlyphs / exitK / hitPulse / latestLine / rowText

export default function (api) {
  const { lib, helpers } = api;
  const FONT = '"Share Tech Mono", "DotGothic16", monospace';

  api.registerStyle({
    id: 'typewriter',
    name: 'TYPEWRITER',
    description: 'タイプライター風。1文字ごとに打鍵して紙が弾む（サンプルプラグイン）。',
    color: '#9dff6b',
    exitDuration: 0.3,
    fonts: ['400 "Share Tech Mono"', '400 "DotGothic16"'],
    post: { bloom: 0.25, grain: 0.1, scanline: 0.12, chroma: 1.5 },
    camera: { cut: true, shotBars: 2, effects: ['shadow'] },

    line(g, l) {
      const { ctx, t, u, pal } = g;
      // layout is cached per line (reset automatically when timings or canvas size change)
      const L = (l.cache.tw ??= (() => {
        const rows = helpers.makeRows(l, { maxRows: 2, maxLen: 16, perChunk: false, stagger: 0.05 });
        const size = Math.min(...rows.map((r) => lib.fitSize(ctx, helpers.rowText(r), 400, FONT, l.box.w * 0.85, 96 * u)));
        const top = l.box.y + l.box.h / 2 - (rows.length * size * 1.3) / 2;
        return rows.map((r, i) => ({ glyphs: r, run: lib.glyphRun(ctx, helpers.rowText(r), 400, FONT, size, 0), size, y: top + i * size * 1.3 + size * 0.65 }));
      })());
      const ex = helpers.exitK(l);
      const kick = helpers.hitPulse(l, 0.06); // 1 right after each tapped character
      ctx.save();
      ctx.translate(0, -kick * 6 * u);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (const row of L) {
        ctx.font = lib.font(400, row.size, FONT);
        const x0 = l.box.x + (l.box.w - row.run.width) / 2;
        let lastX = x0;
        row.glyphs.forEach((gl, i) => {
          const a = t - gl.tg;
          if (a < 0) return;
          const p = row.run.glyphs[i];
          lastX = x0 + p.x + p.w;
          ctx.globalAlpha = (1 - ex) * lib.clamp(a / 0.03);
          ctx.fillStyle = a < 0.08 ? pal.accent : pal.text;
          ctx.fillText(gl.g, x0 + p.cx, row.y + (a < 0.08 ? -3 * u : 0));
        });
        if (g.beat.phase < 0.5 && ex === 0) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = pal.accent;
          ctx.fillRect(lastX + 4 * u, row.y + row.size * 0.4, row.size * 0.5, 4 * u);
        }
      }
      ctx.restore();
    },
  });

  api.registerFx({
    id: 'rainbow',
    name: 'レインボー',
    color: '#ff9df0',
    duration: 2,
    unit: 'beat',
    holdable: true,
    apply(s) {
      s.post.hue += s.age * 6;
      s.post.saturation += 0.4;
    },
  });
}
