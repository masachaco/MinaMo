// FX 「ストロボ」 (key Y): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'strobe', name: 'ストロボ', key: 'y', color: '#fffbe0', duration: 1, unit: 'beat', holdable: true,
    apply: (s) => {
      const step = s.beat.spb / 4;
      s.post.flash = Math.max(s.post.flash, Math.floor(s.age / step) % 2 === 0 ? 0.75 * s.intensity : 0);
    },
  });
};
