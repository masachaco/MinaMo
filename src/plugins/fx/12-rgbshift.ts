// FX 「RGBシフト」 (key ]): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'rgbshift', name: 'RGBシフト', key: ']', color: '#ff00c8', duration: 0.6,
    apply: (s) => {
      const k = 1 - s.p;
      s.post.chroma += 28 * k * s.intensity;
      s.post.hue += k * 1.2 * s.intensity;
    },
  });
};
