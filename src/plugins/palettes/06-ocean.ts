// Palette 「Ocean」 (LOOK track; keys follow the registration order).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerPalette({ id: 'ocean', name: 'Ocean', bg: '#040d1a', text: '#eaf6ff', accent: '#3d8bff', accent2: '#7cf6ff' });
};
