// Transition 「フラッシュイン」: an FX used when the look changes (hidden: no key, not in menus); starts `lead` seconds before the change.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'flashin', name: 'フラッシュイン', color: '#ffffff', duration: 0.45, hidden: true,
    apply: (s) => { s.post.flash = Math.max(s.post.flash, Math.pow(1 - s.p, 2.2) * 0.9); },
  });
};
