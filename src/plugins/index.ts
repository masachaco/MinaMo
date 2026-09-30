// Built-in plugins: every element effect, motion, FX, transition, visualizer and telop template the app ships with,
// written exactly like a runtime plugin — `export default (api) => { api.registerXxx({...}) }`, using only `api`
// (plus `import type` and the folder's _shared.ts) — so each file doubles as a sample for plugin authors.
// Registered at start-up in path order; inside a folder the NN- prefix is the order (menus, visualizer keys,
// the stacking order of effects). Files starting with _ are helpers, not plugins.

import { pluginApi, type PluginApi } from '../plugin-loader';

const mods = import.meta.glob<{ default: (api: PluginApi) => void }>('./*/[0-9]*.ts', { eager: true });
for (const path of Object.keys(mods).sort()) mods[path].default(pluginApi);
