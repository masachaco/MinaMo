// Transition 「スライド」: an FX used when the look changes (hidden: no key, not in menus); starts `lead` seconds before the change.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { clamp, ease } = api.lib;

  api.registerFx({
    id: 'slidewipe', name: 'スライド', color: '#e8e8e8', duration: 0.5, lead: 0.2, hidden: true,
    draw: (g, s) => {
      const { ctx, W, H, pal } = g;
      const lead = ease.inOutQuart(clamp(s.p * 2)) * W;
      const tail = ease.inOutQuart(clamp(s.p * 2 - 1)) * W;
      if (lead <= tail) return;
      ctx.fillStyle = pal.text;
      ctx.fillRect(tail, 0, lead - tail, H);
      ctx.fillStyle = pal.accent;
      ctx.fillRect(lead - 6 * g.u, 0, 6 * g.u, H);
    },
  });
};
