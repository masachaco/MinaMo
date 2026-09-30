// FX 「ミラー」 (key O): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'mirror', name: 'ミラー', key: 'o', color: '#9d7bff', duration: 2, unit: 'beat', holdable: true,
    apply: (s) => { s.post.mirror = 1; },
  });
};
