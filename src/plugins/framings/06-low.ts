// Camera framing 「パンアップ」 (CAMERA track, key H). Pans up from the body to the face over the shot (c.p = 0 → 1).
// pose() places the point fy of the character image (0 = top, 1 = feet, c.faceY = face) at the screen height sy (0 = top),
// zoom and rot; x comes from the character position.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { clamp, ease, lerp } = api.lib;

  api.registerFraming({
    id: 'low',
    name: 'パンアップ',
    key: 'h',
    pose(c) {
      const k = ease.inOutSine(clamp(c.p));
      return { sy: lerp(0.62, 0.34, k), fy: lerp(0.78, c.faceY, k), zoom: 1.65, rot: 0 };
    },
  });
};
