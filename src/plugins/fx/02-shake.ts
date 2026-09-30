// FX 「シェイク」 (key W): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'shake', name: 'シェイク', key: 'w', color: '#ffb36b', duration: 0.5,
    apply: (s) => {
      const k = Math.pow(1 - s.p, 2) * s.intensity;
      const f = Math.floor(s.age * 60);
      s.camera.x += (s.rand(f, 1) - 0.5) * 50 * k;
      s.camera.y += (s.rand(f, 2) - 0.5) * 50 * k;
      s.camera.rot += (s.rand(f, 3) - 0.5) * 0.03 * k;
    },
  });
};
