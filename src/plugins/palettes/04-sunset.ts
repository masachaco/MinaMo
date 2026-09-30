// Palette 「Sunset」 (LOOK track; keys follow the registration order).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerPalette({ id: 'sunset', name: 'Sunset', bg: '#170911', text: '#fff4e8', accent: '#ff6b35', accent2: '#8a5cff' });
};
