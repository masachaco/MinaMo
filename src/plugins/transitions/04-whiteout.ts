// Transition 「ホワイトアウト」: an FX used when the look changes (hidden: no key, not in menus); starts `lead` seconds before the change.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { ease } = api.lib;
  const bump = (p: number, peak: number) => (p < peak ? ease.outCubic(p / peak) : 1 - ease.inCubic((p - peak) / (1 - peak)));

  api.registerFx({
    id: 'whiteout', name: 'ホワイトアウト', color: '#ffffff', duration: 1.1, lead: 0.45, hidden: true,
    apply: (s) => {
      s.post.flash = Math.max(s.post.flash, bump(s.p, 0.41) * 0.95);
      s.post.bloom += bump(s.p, 0.41) * 0.8;
    },
  });
};
