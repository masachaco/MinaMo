// FX 「グリッチ」 (key R): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'glitch', name: 'グリッチ', key: 'r', color: '#1fe4ff', duration: 0.5, holdable: true,
    apply: (s) => {
      const k = s.dur > 0.6 ? 1 : 1 - s.p * 0.6;
      s.post.glitch += 0.8 * k * s.intensity;
      s.post.chroma += 10 * k * s.intensity;
    },
  });
};
