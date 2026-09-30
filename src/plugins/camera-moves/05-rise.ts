// Camera move 「上昇」 (CAMERA track, key T). Rises (the character sinks a little) with a slight zoom.
// apply() changes the pose of the current framing; keep it a pure function of the context.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { clamp, ease, lerp } = api.lib;

  api.registerCameraMove({
    id: 'rise',
    name: '上昇',
    key: 't',
    apply(pose, c) {
      const k = ease.inOutSine(clamp(c.p));
      pose.sy += lerp(0.015, -0.015, k) * c.drift;
      pose.zoom *= 1 + 0.04 * c.drift * k;
    },
  });
};
