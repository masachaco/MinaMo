// Telop template (runtime plugin). Copy to plugins/<name>.js and change the id / name.
// Use it in the telop list as:  [my-telop] 本文 | サブ   (the template's name works too)
// Plates (bars / boxes) go on the plate layer via lib.onPlate(); text stays on g.ctx.

export default function (api) {
  const { lib } = api;
  const FONT = '"Noto Sans JP", sans-serif';

  api.registerTelop({
    id: 'my-telop',
    name: 'マイテロップ',
    color: '#ffe600',
    bars: 4, // default length in bars (when the key is only tapped)
    exitDur: 0.4,

    draw(g, t) {
      const { ctx, W, H, u, pal } = g;
      const inK = lib.ease.outExpo(lib.clamp(t.age / 0.5));
      const outK = lib.ease.inCubic(t.outK); // 0 → 1 during the exit
      const x = 80 * u - (1 - inK) * 120 * u - outK * 200 * u;
      const y = H * 0.78;
      ctx.save();
      ctx.globalAlpha = inK * (1 - outK);
      ctx.font = lib.font(900, 54 * u, FONT);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const w = ctx.measureText(t.text).width + 48 * u;
      lib.onPlate(g, (pl) => {
        pl.fillStyle = pal.accent;
        pl.fillRect(x, y - 40 * u, w * inK, 80 * u);
      });
      ctx.fillStyle = lib.onColor(pal.accent);
      ctx.fillText(t.text, x + 24 * u, y);
      if (t.sub) {
        ctx.font = lib.font(700, 26 * u, FONT);
        ctx.fillStyle = pal.text;
        ctx.fillText(t.sub, x + 24 * u, y + 62 * u);
      }
      ctx.restore();
    },
  });
}
