// Effect 「影」 (lyrics, telops and characters; `targets` narrows it down).
// The element silhouette, offset down-right behind it (under).
// Combined effects stack back to front in registration order (the file number).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerEffect({
    id: 'shadow',
    name: '影',
    key: 'q',
    under(g, e) {
      // drop shadow: further for bigger characters; text (lyrics / telops, any size) gets a shorter one
      const off = e.target === 'chara' ? 18 * g.u * Math.sqrt(e.h / g.H) : 9 * g.u;
      g.ctx.translate(off, off * 0.6);
      e.draw(e.silhouette(g.pal.accent2));
    },
  });
};
