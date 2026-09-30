// Camera framing 「ダッチ」 (CAMERA track, key J). Dutch angle: tilted by the look's tilt (at least 4°), left or right by seed. Sets its own roll, so the look's random tilt is not added.
// pose() places the point fy of the character image (0 = top, 1 = feet, c.faceY = face) at the screen height sy (0 = top),
// zoom and rot; x comes from the character position.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFraming({
    id: 'tilt',
    name: 'ダッチ',
    key: 'j',
    lookTilt: false,
    pose(c) {
      const dir = c.seed % 2 ? 1 : -1;
      return { sy: 0.32, fy: c.faceY, zoom: 1.6, rot: (dir * Math.max(4, c.policy.tilt || 6) * Math.PI) / 180 };
    },
  });
};
