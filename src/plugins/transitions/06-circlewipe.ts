// Transition 「サークルワイプ」: an FX used when the look changes (hidden: no key, not in menus); starts `lead` seconds before the change.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { TAU, clamp, ease } = api.lib;

  api.registerFx({
    id: 'circlewipe', name: 'サークルワイプ', color: '#ffd36e', duration: 0.5, lead: 0.22, hidden: true,
    draw: (g, s) => {
      const { ctx, W, H, pal } = g;
      const R = Math.hypot(W, H) * 0.55;
      const cols = [pal.accent2, pal.text, pal.accent];
      const cx = W / 2, cy = H / 2;
      ctx.save();
      cols.forEach((c, i) => {
        const p = clamp(s.p * 1.12 - i * 0.06);
        const outer = ease.inOutCubic(clamp(p * 2)) * R;
        const inner = ease.inOutCubic(clamp(p * 2 - 1)) * R;
        if (outer <= inner) return;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, TAU);
        if (inner > 0) ctx.arc(cx, cy, inner, 0, TAU, true);
        ctx.fill('evenodd');
      });
      ctx.restore();
    },
  });
};
