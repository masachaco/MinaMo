// FX 「色相回転」 (key S): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'hue', name: '色相回転', key: 's', color: '#ff9df0', duration: 2, unit: 'beat', holdable: true,
    apply: (s) => {
      s.post.hue += s.age * 5;
      s.post.saturation += 0.3;
    },
  });
};
