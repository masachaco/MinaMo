// Lyric-only style template (runtime plugin). Copy to plugins/<name>.js, change the id / name, then edit.
// use: 'lyric' → listed only as a lyric style (LYRICS track number keys, 歌詞スタイル menus), never as a look.
// Only line() / lyricFx() and the lyric options (exitDuration, persist, adaptText, followCamera, fonts) are used.
// Everything is a pure function of time: use g.t, l.age, glyph times, g.rand()/lib.hash() — never Math.random().

export default function (api) {
  const { lib, helpers } = api;
  const FONT = '"Dela Gothic One", "Noto Sans JP", sans-serif';

  api.registerStyle({
    id: 'my-lyric',
    name: 'MY LYRIC',
    description: '1文字ずつ大きく落ちてきて弾む歌詞（歌詞スタイル専用のひな形）',
    color: '#ffb35c',
    use: 'lyric',
    exitDuration: 0.35,
    fonts: ['400 "Dela Gothic One"'],

    line(g, l) {
      const { ctx, t, u, pal } = g;
      // layout once per line: rows of about the same width, one font size for the whole line
      const L = (l.cache.myLyric ??= (() => {
        const rows = helpers.makeRows(l, { maxRows: 3, maxLen: 8, perChunk: true, stagger: 0.05 });
        const fit = Math.min(...rows.map((r) => lib.fitSize(ctx, helpers.rowText(r), 400, FONT, l.box.w * 0.88, 150 * u)));
        const size = Math.min(fit, l.box.h / (rows.length * 1.15));
        const gap = size * 1.15;
        const top = l.box.y + l.box.h / 2 - ((rows.length - 1) * gap) / 2;
        return rows.map((r, i) => ({ glyphs: r, run: lib.glyphRun(ctx, helpers.rowText(r), 400, FONT, size, 0), size, y: top + i * gap }));
      })());
      const ex = helpers.exitK(l); // 0 → 1 while the line exits
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      L.forEach((row, ri) => {
        ctx.font = lib.font(400, row.size, FONT);
        const x0 = l.box.x + (l.box.w - row.run.width) / 2;
        row.glyphs.forEach((gl, i) => {
          if (gl.g === ' ') return;
          const a = t - gl.tg; // seconds since this character appeared (tapped time, or filled in)
          if (a < 0) return;
          const p = row.run.glyphs[i];
          const k = lib.ease.outBack(lib.clamp(a / 0.22), 2.2); // stamp down from big, with overshoot
          const tilt = (lib.hash(l.seed, ri, i) - 0.5) * 0.3 * (1 - lib.clamp(a / 0.3));
          const s = lib.lerp(1.8, 1, k);
          ctx.save();
          ctx.translate(x0 + p.cx, row.y + ex * row.size * (ri % 2 ? 0.6 : -0.6)); // rows leave in opposite directions
          ctx.rotate(tilt);
          ctx.scale(s, s);
          ctx.globalAlpha = lib.clamp(a / 0.05) * (1 - ex);
          ctx.fillStyle = a < 0.12 ? pal.accent : pal.text; // filled text (no outline-only glyphs)
          ctx.fillText(gl.g, 0, 0);
          ctx.restore();
        });
      });
      ctx.restore();
    },

    // lyric-driven post effect: a short color split on each tapped character
    lyricFx(g, post) {
      for (const l of g.lines) post.chroma += 4 * helpers.hitPulse(l, 0.12) * g.intensity;
    },
  });
}
