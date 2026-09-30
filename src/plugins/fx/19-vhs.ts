// FX 「VHS」 (key J): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'vhs', name: 'VHS', key: 'j', color: '#8fd3ff', duration: 2, unit: 'beat', holdable: true,
    apply: (s) => {
      s.post.scanline = Math.max(s.post.scanline, 0.35);
      s.post.chroma += 7;
      s.post.grain += 0.18;
      s.post.saturation *= 0.8;
      s.camera.x += (s.rand(Math.floor(s.age * 20)) - 0.5) * 8;
    },
  });
};
