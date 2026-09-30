// Effect template (runtime plugin): effects for the lyrics, the telops and the characters (the Q row of the
// 歌詞 / テロップ / 立ち絵 tracks). Copy to plugins/<name>.js, change the ids / names, then edit.
//
// An effect draws from the element's image e.img — a character sprite, or the text of the lyrics / telops
// (plates such as stickers and boxes are not in it; they stay underneath). Hooks, all optional (at least one):
//   image(g, e) → an img-sized image to use instead (e.g. e.silhouette(color))
//   under(g, e)   behind the element        body(g, e) draw the element yourself (the last body() wins)
//   over(g, e)    on top of the element
// g.ctx is already placed: draw with e.draw(image, pad) or at e.x e.y e.w e.h (e.scale = drawn px per image px).
// Helpers: e.silhouette(color) · e.outline(color, width?) → { c, pad } · e.glow(color) → { c, pad } ·
// e.mask((ctx, w, h) => paint, key?) → the paint cut out to the element's shape.
// e.target = 'lyrics' | 'telop' | 'chara', e.age = seconds since the effect was turned on, e.seed.
// Several effects combine; they stack in registration order (built-ins first). Pure functions of time.

export default function (api) {
  // behind the element: red / cyan copies pulled apart on each beat (every element)
  api.registerEffect({
    id: 'my-rgb',
    name: 'RGBずれ',
    key: 'i', // preferred key in the element tracks (free: i o p [ ]); a free one is used if taken
    under(g, e) {
      const d = (3 + 7 * g.beat.pulse) * g.u;
      g.ctx.globalCompositeOperation = 'lighter';
      g.ctx.globalAlpha *= 0.85;
      g.ctx.translate(-d, 0);
      e.draw(e.silhouette('#ff2050'));
      g.ctx.translate(2 * d, 0);
      e.draw(e.silhouette('#20e0ff'));
    },
  });

  // on top of the element: a moving rainbow cut out to its shape
  api.registerEffect({
    id: 'my-rainbow',
    name: '虹色',
    key: 'o',
    over(g, e) {
      const shift = (g.t * 0.35) % 1;
      const paint = e.mask((ctx, w, h) => {
        const gr = ctx.createLinearGradient(0, 0, w, h);
        for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, `hsl(${Math.round(((i / 6 + shift) % 1) * 360)},90%,62%)`);
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, w, h);
      }, 'rainbow');
      g.ctx.globalAlpha *= 0.55;
      e.draw(paint);
    },
  });

  // characters only (targets): a soft halo that breathes with the bass
  api.registerEffect({
    id: 'my-aura',
    name: 'オーラ',
    targets: ['chara'],
    under(g, e) {
      const o = e.glow(g.pal.accent2);
      g.ctx.globalCompositeOperation = 'lighter';
      g.ctx.globalAlpha *= 0.4 + 0.6 * g.audio.bass;
      const s = 1.04 + 0.03 * g.beat.pulse; // slightly larger than the figure, around its center
      g.ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
      g.ctx.scale(s, s);
      g.ctx.translate(-(e.x + e.w / 2), -(e.y + e.h / 2));
      e.draw(o.c, o.pad);
    },
  });
}
