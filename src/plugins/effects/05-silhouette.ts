// Effect 「シルエット」 (lyrics, telops and characters; `targets` narrows it down).
// Turns the element into a one-color silhouette: image replaces the element image itself.
// Combined effects stack back to front in registration order (the file number).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerEffect({
    id: 'silhouette',
    name: 'シルエット',
    key: 't',
    flat: true,
    // text in the sub accent: plates (stickers, bars) are often in the accent color
    image: (g, e) => e.silhouette(e.target === 'chara' ? g.pal.accent : g.pal.accent2),
  });
};
