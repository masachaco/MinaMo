// Palette 「Lemon」 (LOOK track; keys follow the registration order).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerPalette({ id: 'lemon', name: 'Lemon', bg: '#0e0e0e', text: '#ffffff', accent: '#ffe600', accent2: '#00e5a8' });
};
