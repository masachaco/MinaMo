// FX 「傾き」 (key K): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { ease } = api.lib;

  api.registerFx({
    id: 'dutch', name: '傾き', key: 'k', color: '#ffb36b', duration: 0.7,
    apply: (s) => {
      const k = 1 - ease.outCubic(s.p);
      s.camera.rot += (s.seed % 2 ? 1 : -1) * 0.14 * k;
      s.camera.zoom += 0.12 * k;
    },
  });
};
