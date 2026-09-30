// FX 「フラッシュ」 (key Q): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  api.registerFx({
    id: 'flash', name: 'フラッシュ', key: 'q', color: '#ffffff', duration: 0.35,
    apply: (s) => { s.post.flash = Math.max(s.post.flash, Math.pow(1 - s.p, 2) * 0.85 * s.intensity); },
  });
};
