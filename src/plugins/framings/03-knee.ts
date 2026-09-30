// Camera framing 「膝上」 (CAMERA track, key D). From the knees up: the face (faceY) at 22% from the top of the screen.
// pose() places the point fy of the character image (0 = top, 1 = feet, c.faceY = face) at the screen height sy (0 = top),
// zoom and rot; x comes from the character position.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFraming({
    id: 'knee',
    name: '膝上',
    key: 'd',
    pose: (c) => ({ sy: 0.22, fy: c.faceY, zoom: 1.2, rot: 0 }),
  });
};
