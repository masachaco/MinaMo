// Transition 「インパクトイン」: an FX used when the look changes (hidden: no key, not in menus); starts `lead` seconds before the change.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { ease } = api.lib;

  api.registerFx({
    id: 'impactin', name: 'インパクトイン', color: '#ff6b35', duration: 0.5, hidden: true,
    apply: (s) => {
      const k = 1 - ease.outCubic(s.p);
      s.post.flash = Math.max(s.post.flash, Math.pow(1 - s.p, 3) * 0.8);
      s.camera.zoom += 0.18 * k;
      s.post.radialBlur += 0.8 * k;
    },
  });
};
