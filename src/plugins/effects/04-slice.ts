// Effect 「スライス」 (lyrics, telops and characters; `targets` narrows it down).
// Cuts the element into horizontal strips shifted on 16th notes: body replaces how the element itself is drawn.
// Combined effects stack back to front in registration order (the file number).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { hash } = api.lib;

  api.registerEffect({
    id: 'slice',
    name: 'スライス',
    key: 'r',
    body(g, e) {
      const { beat, u } = g;
      if (hash(Math.floor(beat.beat * 4), 31) >= 0.28 + beat.pulse * 0.2) {
        e.draw(e.img);
        return;
      }
      // horizontal strips shifted on 16th notes
      const img = e.img, n = 9;
      for (let i = 0; i < n; i++) {
        const y0 = (i / n) * img.height, y1 = ((i + 1) / n) * img.height;
        const off = (hash(Math.floor(beat.beat * 8), i) - 0.5) * 40 * u * (hash(i, Math.floor(beat.beat * 4)) < 0.4 ? 1 : 0);
        g.ctx.drawImage(img, 0, y0, img.width, y1 - y0, e.x + off, e.y + y0 * e.scale, e.w, (y1 - y0) * e.scale + 0.5);
      }
    },
  });
};
