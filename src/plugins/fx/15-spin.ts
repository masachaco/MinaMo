// FX 「スピン」 (key D): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { ease } = api.lib;

  api.registerFx({
    id: 'spin', name: 'スピン', key: 'd', color: '#ffe600', duration: 0.6,
    apply: (s) => {
      const k = ease.inOutCubic(s.p);
      s.camera.rot += k * Math.PI * 2 * (s.seed % 2 ? 1 : -1);
      s.camera.zoom += Math.sin(s.p * Math.PI) * 0.35;
      s.post.radialBlur += Math.sin(s.p * Math.PI) * 0.5;
    },
  });
};
