// FX 「モザイク」 (key A): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'pixel', name: 'モザイク', key: 'a', color: '#9dff6b', duration: 1, unit: 'beat', holdable: true,
    apply: (s) => { s.post.pixelate = Math.max(s.post.pixelate, 0.35 * (s.dur > s.beat.spb * 1.1 ? 1 : 1 - s.p * 0.5)); },
  });
};
