// Effect 「縁取り」 (lyrics, telops and characters; `targets` narrows it down).
// A white edge around the element (under).
// Combined effects stack back to front in registration order (the file number).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerEffect({
    id: 'outline',
    name: '縁取り',
    key: 'w',
    under(g, e) {
      // text keeps a thin edge so small lines stay readable
      const o = e.outline('#ffffff', e.target === 'chara' ? undefined : 3 * g.u);
      e.draw(o.c, o.pad);
    },
  });
};
