// Transition 「ワイプ」: an FX used when the look changes (hidden: no key, not in menus); starts `lead` seconds before the change.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { clamp, ease } = api.lib;

  api.registerFx({
    id: 'wipe', name: 'ワイプ', color: '#ff2e63', duration: 0.36, lead: 0.16, hidden: true,
    draw: (g, s) => {
      const { ctx, W, H, pal } = g;
      const slant = H * 0.5;
      const span = W + slant * 2;
      const cols = [pal.accent, pal.text, pal.accent2];
      ctx.save();
      cols.forEach((c, i) => {
        const p = clamp(s.p * 1.15 - i * 0.07);
        const lead = ease.inOutCubic(clamp(p * 2)) * span - slant;
        const tail = ease.inOutCubic(clamp(p * 2 - 1)) * span - slant;
        if (lead <= tail) return;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(tail, H);
        ctx.lineTo(tail + slant, 0);
        ctx.lineTo(lead + slant, 0);
        ctx.lineTo(lead, H);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();
    },
  });
};
