// Camera move 「ズームイン」 (CAMERA track, key W). Slowly zooms in over the move (c.p = 0 → 1), more with the look's drift.
// apply() changes the pose of the current framing; keep it a pure function of the context.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { clamp, ease, lerp } = api.lib;

  api.registerCameraMove({
    id: 'push',
    name: 'ズームイン',
    key: 'w',
    apply(pose, c) {
      pose.zoom *= lerp(1, 1 + 0.08 * c.drift, ease.inOutSine(clamp(c.p)));
    },
  });
};
