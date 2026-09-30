// Camera move 「手ブレ」 (CAMERA track, key Y). Handheld shake from smooth noise over time.
// apply() changes the pose of the current framing; keep it a pure function of the context.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { noise1 } = api.lib;

  api.registerCameraMove({
    id: 'handheld',
    name: '手ブレ',
    key: 'y',
    apply(pose, c) {
      pose.x += noise1(c.t * 1.3, c.seed) * 0.007;
      pose.sy += noise1(c.t * 1.1, c.seed + 3) * 0.007;
      pose.rot += noise1(c.t * 0.9, c.seed + 7) * 0.008;
    },
  });
};
