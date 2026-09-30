// Camera move 「ロール」 (CAMERA track, key U). Slow roll back and forth.
// apply() changes the pose of the current framing; keep it a pure function of the context.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerCameraMove({
    id: 'roll',
    name: 'ロール',
    key: 'u',
    apply(pose, c) {
      pose.rot += Math.sin(c.t * 0.7) * 0.04;
      pose.zoom *= 1.03;
    },
  });
};
