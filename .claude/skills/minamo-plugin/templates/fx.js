// FX template (runtime plugin). Copy to plugins/<name>.js and change the id / name.
// apply(s): add to s.post / s.camera (never overwrite — other FX run in the same frame). draw(g, s): overlay.
// s.elements.lyrics / .telop / .chara: move one element only (add to dx / dy / rot, multiply sx / sy / alpha).

export default function (api) {
  const { lib } = api;

  api.registerFx({
    id: 'my-fx',
    name: 'マイFX',
    key: 'm', // preferred key; a free one is used if taken
    color: '#ff9ecb',
    duration: 1, // seconds, or beats with unit: 'beat'
    unit: 'beat',
    holdable: false, // true: holding the key extends it
    // lead: 0.2,    // start this many seconds early (for transitions centred on a cut)
    // hidden: true, // transition-only: not assigned to a key

    apply(s) {
      const k = Math.pow(1 - s.p, 2) * s.intensity; // strong at the start, fading out
      s.post.flash = Math.max(s.post.flash, 0.4 * k);
      s.post.chroma += 6 * k;
      s.camera.zoom += 0.06 * k;
    },

    draw(g, s) {
      const { ctx, W, H, u, pal } = g;
      const r = lib.ease.outCubic(s.p) * Math.hypot(W, H) * 0.6;
      ctx.save();
      ctx.globalAlpha = (1 - s.p) * 0.8;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = (18 * (1 - s.p) + 2) * u;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, 0, lib.TAU);
      ctx.stroke();
      ctx.restore();
    },
  });

  // one element only: the lyrics jump and shake, the rest of the screen stays still
  api.registerFx({
    id: 'my-lyric-punch',
    name: '歌詞パンチ',
    key: 'n',
    color: '#08d9d6',
    duration: 0.5,
    apply(s) {
      const k = Math.pow(1 - s.p, 2) * s.intensity;
      const L = s.elements.lyrics;
      L.sx *= 1 + 0.12 * k;
      L.sy *= 1 + 0.12 * k;
      L.dy -= 24 * k;
      L.dx += (s.rand(Math.floor(s.age * 60)) - 0.5) * 30 * k;
    },
  });
}
