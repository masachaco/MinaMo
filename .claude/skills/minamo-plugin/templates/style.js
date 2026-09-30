// Motion style template (runtime plugin). Copy to plugins/<name>.js, change the id / name, then edit.
// Lyric-style part: line() (+ lyricFx). Look-style part: backDecor / overlay / post / postFx / camera / transition.
// This one is both (use omitted). For only one side see lyric-style.js (use: 'lyric') and look.js (use: 'look').
// Everything is a pure function of time: use g.t, l.age, glyph times, g.rand()/lib.hash() — never Math.random().

export default function (api) {
  const { lib, helpers } = api;
  const FONT = '"Noto Sans JP", sans-serif';

  api.registerStyle({
    id: 'my-style',
    name: 'MY STYLE',
    description: '説明（ツールチップに出る）',
    color: '#7cf6ff',
    exitDuration: 0.4,
    fonts: ['900 "Noto Sans JP"'],
    transition: 'flashin', // FX id when a section of this look starts ('none' = no transition)
    post: { bloom: 0.35, chroma: 0.8, vignette: 0.4 },
    camera: { cut: true, shotBars: 2, pool: ['full', 'bust', 'face', 'left', 'right'], effects: ['shadow'] },

    // ---- lyric style: one call per visible line
    line(g, l) {
      const { ctx, t, u, pal } = g;
      // layout once per line (l.cache is reset when timings or the canvas size change)
      const L = (l.cache.my ??= (() => {
        const rows = helpers.makeRows(l, { maxRows: 2, maxLen: 10, perChunk: false, stagger: 0.04 });
        // one size for every row: the longest row decides it, so no row looks smaller than the others
        const size = Math.min(...rows.map((r) => lib.fitSize(ctx, helpers.rowText(r), 900, FONT, l.box.w * 0.9, 130 * u)));
        const gap = size * 1.2;
        const top = l.box.y + l.box.h / 2 - (rows.length * gap) / 2 + gap / 2;
        return rows.map((r, i) => ({ glyphs: r, run: lib.glyphRun(ctx, helpers.rowText(r), 900, FONT, size, 0), size, y: top + i * gap }));
      })());
      const ex = helpers.exitK(l); // 0 → 1 while the line exits
      const punch = 1 + 0.06 * helpers.hitPulse(l) * g.intensity; // bump on each tapped character
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const row of L) {
        ctx.font = lib.font(900, row.size, FONT);
        const x0 = l.box.x + (l.box.w - row.run.width) / 2;
        row.glyphs.forEach((gl, i) => {
          if (gl.g === ' ') return;
          const a = t - gl.tg; // seconds since this character appeared
          if (a < 0) return;
          const k = lib.ease.outBack(lib.clamp(a / 0.28));
          const p = row.run.glyphs[i];
          ctx.save();
          ctx.translate(x0 + p.cx, row.y - (1 - k) * row.size * 0.4 - ex * row.size * 0.5);
          ctx.scale(k * punch, k * punch);
          ctx.globalAlpha = lib.clamp(a / 0.06) * (1 - ex);
          ctx.fillStyle = a < 0.1 ? pal.accent : pal.text; // filled text (no outline-only glyphs)
          ctx.fillText(gl.g, 0, 0);
          ctx.restore();
        });
      }
      // a plate under the text goes on the plate layer (readability correction treats it as background)
      if (l.sub) {
        const sa = lib.clamp((l.age - 0.2) / 0.3) * (1 - ex);
        const last = L[L.length - 1];
        const y = last.y + last.size * 0.9;
        ctx.font = lib.font(700, 26 * u, FONT);
        const w = ctx.measureText(l.sub).width + 30 * u;
        ctx.globalAlpha = sa;
        lib.onPlate(g, (pl) => {
          pl.fillStyle = pal.accent;
          pl.fillRect(l.box.x + l.box.w / 2 - w / 2, y - 18 * u, w, 36 * u);
        });
        ctx.fillStyle = lib.onColor(pal.accent);
        ctx.fillText(l.sub, l.box.x + l.box.w / 2, y);
      }
      ctx.restore();
    },

    // ---- lyric style: post effects driven by the lyrics (flash on each new line)
    lyricFx(g, post) {
      for (const l of g.lines) post.flash = Math.max(post.flash, 0.25 * Math.max(0, 1 - l.age / 0.15) * g.intensity);
    },

    // ---- look style: behind the character (beat-reactive dots)
    backDecor(g) {
      const { ctx, W, H, u, pal, beat } = g;
      ctx.save();
      for (let i = 0; i < 40; i++) {
        const x = g.rand(i, 1) * W, y = g.rand(i, 2) * H;
        const on = g.rand(i, beat.index) < 0.2;
        ctx.globalAlpha = on ? 0.2 + 0.6 * beat.pulse : 0.12;
        ctx.fillStyle = on ? pal.accent : pal.text;
        const s = (on ? 5 + 6 * beat.pulse : 3) * u;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
      ctx.restore();
    },

    // ---- look style: per-frame post tweaks
    postFx(g, post) {
      post.chroma += g.beat.downPulse * 2 * g.intensity;
    },
  });
}
