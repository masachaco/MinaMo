// Camera move 「ズームアウト」 (CAMERA track, key E). Slowly zooms out over the move.
// apply() changes the pose of the current framing; keep it a pure function of the context.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { clamp, ease, lerp } = api.lib;

  api.registerCameraMove({
    id: 'pull',
    name: 'ズームアウト',
    key: 'e',
    apply(pose, c) {
      pose.zoom *= lerp(1 + 0.08 * c.drift, 1, ease.inOutSine(clamp(c.p)));
    },
  });
};
