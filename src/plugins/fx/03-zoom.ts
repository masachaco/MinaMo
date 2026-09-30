// FX 「ズームパンチ」 (key E): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { ease } = api.lib;

  api.registerFx({
    id: 'zoom', name: 'ズームパンチ', key: 'e', color: '#ffe600', duration: 0.45,
    apply: (s) => {
      const k = 1 - ease.outCubic(s.p);
      s.camera.zoom += 0.14 * k * s.intensity;
      s.post.radialBlur += 0.6 * k * s.intensity;
    },
  });
};
