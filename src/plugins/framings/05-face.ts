// Camera framing 「アップ」 (CAMERA track, key G). Close-up on the face.
// pose() places the point fy of the character image (0 = top, 1 = feet, c.faceY = face) at the screen height sy (0 = top),
// zoom and rot; x comes from the character position.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFraming({
    id: 'face',
    name: 'アップ',
    key: 'g',
    pose: (c) => ({ sy: 0.4, fy: c.faceY, zoom: 2.7, rot: 0 }),
  });
};
