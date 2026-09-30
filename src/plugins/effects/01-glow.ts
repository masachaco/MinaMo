// Effect 「グロー」 (lyrics, telops and characters; `targets` narrows it down).
// A blurred copy of the element shape, added behind it (under) and pulsing on the beat.
// Combined effects stack back to front in registration order (the file number).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerEffect({
    id: 'glow',
    name: 'グロー',
    key: 'e',
    under(g, e) {
      const o = e.glow(g.pal.accent);
      g.ctx.globalCompositeOperation = 'lighter';
      g.ctx.globalAlpha *= 0.55 + 0.45 * g.beat.pulse;
      e.draw(o.c, o.pad);
    },
  });
};
