// Palette 「Cyber」 (LOOK track; keys follow the registration order).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerPalette({ id: 'cyber', name: 'Cyber', bg: '#030712', text: '#e8fffd', accent: '#00f0ff', accent2: '#ff00c8' });
};
