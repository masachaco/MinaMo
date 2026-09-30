// Palette 「Paper」 (LOOK track; keys follow the registration order).
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerPalette({ id: 'paper', name: 'Paper', bg: '#f2efe9', text: '#141414', accent: '#e63946', accent2: '#1d3557' });
};
