// Camera framing 「全身」 (CAMERA track, key S). The whole character (also the framing of unrecorded sections).
// pose() places the point fy of the character image (0 = top, 1 = feet, c.faceY = face) at the screen height sy (0 = top),
// zoom and rot; x comes from the character position.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFraming({
    id: 'full',
    name: '全身',
    key: 's',
    pose: () => ({ sy: 1.02, fy: 1, zoom: 1, rot: 0 }),
  });
};
