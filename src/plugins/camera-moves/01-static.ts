// Camera move 「固定」 (CAMERA track, key Q). No movement.
// apply() changes the pose of the current framing; keep it a pure function of the context.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerCameraMove({
    id: 'static',
    name: '固定',
    key: 'q',
    apply: () => {},
  });
};
