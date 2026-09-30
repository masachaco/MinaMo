// Camera framing 「ワイド」 (CAMERA track, key A). The whole stage, a little further away than 全身.
// pose() places the point fy of the character image (0 = top, 1 = feet, c.faceY = face) at the screen height sy (0 = top),
// zoom and rot; x comes from the character position.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFraming({
    id: 'wide',
    name: 'ワイド',
    key: 'a',
    pose: () => ({ sy: 0.97, fy: 1, zoom: 0.78, rot: 0 }),
  });
};
