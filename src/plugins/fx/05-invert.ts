// FX 「ネガ反転」 (key T): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'invert', name: 'ネガ反転', key: 't', color: '#b0b0b0', duration: 0.18, holdable: true,
    apply: (s) => { s.post.invert = 1; },
  });
};
