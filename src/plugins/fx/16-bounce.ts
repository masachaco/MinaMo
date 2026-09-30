// FX 「画面バウンス」 (key F): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'bounce', name: '画面バウンス', key: 'f', color: '#7cf6ff', duration: 2, unit: 'beat', holdable: true,
    apply: (s) => {
      s.camera.y -= 34 * s.beat.pulse * s.intensity;
      s.camera.zoom += 0.03 * s.beat.pulse * s.intensity;
    },
  });
};
