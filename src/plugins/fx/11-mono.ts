// FX 「モノクロ」 (key [): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'mono', name: 'モノクロ', key: '[', color: '#dddddd', duration: 2, unit: 'beat', holdable: true,
    apply: (s) => {
      s.post.saturation = 0;
      s.post.contrast += 0.2;
    },
  });
};
