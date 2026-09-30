// Camera framing 「バスト」 (CAMERA track, key F). Chest up.
// pose() places the point fy of the character image (0 = top, 1 = feet, c.faceY = face) at the screen height sy (0 = top),
// zoom and rot; x comes from the character position.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFraming({
    id: 'bust',
    name: 'バスト',
    key: 'f',
    pose: (c) => ({ sy: 0.3, fy: c.faceY, zoom: 1.75, rot: 0 }),
  });
};
