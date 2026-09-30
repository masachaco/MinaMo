// Palette 「Midnight」 (LOOK track; keys follow the registration order). The first palette is the default of a new project.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerPalette({ id: 'midnight', name: 'Midnight', bg: '#07070d', text: '#ffffff', accent: '#ff2e63', accent2: '#08d9d6' });
};
