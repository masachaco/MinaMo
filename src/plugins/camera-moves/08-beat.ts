// Camera move 「ビートズーム」 (CAMERA track, key I). Zoom pulse on every beat, stronger on the downbeat.
// apply() changes the pose of the current framing; keep it a pure function of the context.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerCameraMove({
    id: 'beat',
    name: 'ビートズーム',
    key: 'i',
    apply(pose, c) {
      pose.zoom *= 1 + 0.045 * c.beat.pulse + 0.02 * c.beat.downPulse;
    },
  });
};
