// Palette 「Sakura」 (LOOK track; keys follow the registration order).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerPalette({ id: 'sakura', name: 'Sakura', bg: '#1a0e1c', text: '#fff6f9', accent: '#ff8fb8', accent2: '#ffd36e' });
};
