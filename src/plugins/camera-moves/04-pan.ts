// Camera move 「パン」 (CAMERA track, key R). Drifts sideways (direction by seed) with a slight zoom.
// apply() changes the pose of the current framing; keep it a pure function of the context.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { clamp, ease, lerp } = api.lib;

  api.registerCameraMove({
    id: 'pan',
    name: 'パン',
    key: 'r',
    apply(pose, c) {
      const k = ease.inOutSine(clamp(c.p));
      const dir = c.seed % 3 === 0 ? -1 : 1;
      pose.x += lerp(-0.02, 0.02, k) * c.drift * dir;
      pose.zoom *= 1 + 0.03 * c.drift * k;
    },
  });
};
