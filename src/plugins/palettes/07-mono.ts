// Palette 「Mono」 (LOOK track; keys follow the registration order).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerPalette({ id: 'mono', name: 'Mono', bg: '#0a0a0a', text: '#ffffff', accent: '#ffffff', accent2: '#8a8a8a' });
};
