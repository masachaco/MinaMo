// Look-only style template (runtime plugin). Copy to plugins/<name>.js, change the id / name, then edit.
// use: 'look' → listed only as a look (LOOK track number keys, ルック menus), never as a lyric style; line() is not needed.
// Look parts: background / backDecor / frontDecor / overlay (layers), post / postFx, camera (auto direction), transition, title.
// Everything is a pure function of time: use g.t, g.beat, g.rand()/lib.hash() — never Math.random().

export default function (api) {
  const { lib } = api;

  api.registerStyle({
    id: 'my-look',
    name: 'MY LOOK',
    description: '斜めのストライプが拍で流れるルック（ルック専用のひな形）',
    color: '#5c7cff',
    use: 'look',
    transition: 'flashin', // FX id when a section of this look starts ('none' = no transition)
    post: { bloom: 0.3, vignette: 0.45, grain: 0.06 },
    camera: { cut: true, shotBars: 2, pool: ['full', 'bust', 'left', 'right'], effects: ['shadow'] },

    // behind everything (after the background image, if any): fill only when there is no image
    background(g) {
      if (g.hasBackground) return;
      const { ctx, W, H, pal } = g;
      const gr = ctx.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, lib.mix(pal.bg, pal.accent2, 0.18));
      gr.addColorStop(1, pal.bg);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    },

    // between the background and the character: diagonal stripes that step forward on every beat
    backDecor(g) {
      const { ctx, W, H, u, pal, beat } = g;
      const step = 140 * u;
      const shift = ((beat.index + lib.ease.outCubic(beat.phase)) * step * 0.5) % step;
      ctx.save();
      ctx.globalAlpha = 0.1 + 0.08 * beat.pulse;
      ctx.fillStyle = pal.accent;
      for (let x = -H - step + shift; x < W + step; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, H);
        ctx.lineTo(x + 40 * u, H);
        ctx.lineTo(x + 40 * u + H, 0);
        ctx.lineTo(x + H, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },

    // above the lyrics: a thin frame with a beat marker
    overlay(g) {
      const { ctx, W, H, u, pal, beat } = g;
      const m = 28 * u;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = pal.text;
      ctx.fillRect(m, m, W - m * 2, 2 * u);
      ctx.fillRect(m, H - m - 2 * u, W - m * 2, 2 * u);
      ctx.globalAlpha = 0.4 + 0.6 * beat.pulse;
      ctx.fillStyle = pal.accent;
      const s = 10 * u;
      ctx.fillRect(m + (beat.inBar / Math.max(1, beat.beatsPerBar - 1)) * (W - m * 2 - s), m - s / 2, s, s);
      ctx.restore();
    },

    // per-frame post tweaks (only while this is the look)
    postFx(g, post) {
      post.bloom += 0.15 * g.beat.downPulse * g.intensity;
    },
  });
}
