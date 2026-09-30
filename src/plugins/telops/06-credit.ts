// Telop template 「クレジット」 (credits): picked with [型] in the telop list. Drawn from the seconds since it appeared (tl.age) and the exit progress (tl.outK).
import type { PluginApi } from '../../plugin-loader';
import { F_SANS, F_JP, F_MONO, inK } from './_shared';

export default (api: PluginApi) => {
  const { clamp, ease, fitSize, font, onPlate, rgba } = api.lib;

  api.registerTelop({
    id: 'credit',
    name: 'クレジット',
    color: '#ffd36e',
    bars: 8,
    exitDur: 0.6,
    pivot: { x: 0.76, y: 0.5 },
    draw(g, tl) {
      const { ctx, W, H, u, pal } = g;
      const lines = tl.lines.length ? tl.lines : [tl.text];
      const roleSize = 16 * u, nameSize = 34 * u, gap = 26 * u;
      const itemH = roleSize * 1.4 + nameSize * 1.2 + gap;
      const header = tl.sub ? 60 * u : 0;
      const total = header + lines.length * itemH;
      // scroll when the list is taller than the screen
      const overflow = Math.max(0, total - H * 0.8);
      const scroll = overflow * clamp(tl.age / Math.max(0.1, tl.dur));
      const top = H / 2 - Math.min(total, H * 0.8) / 2 - scroll;
      const fade = 1 - ease.inCubic(tl.outK);
      // right-hand column with a soft dark backing, clear of a centered character
      const cx = W * 0.76;
      ctx.save();
      const back = ctx.createLinearGradient(W * 0.5, 0, W, 0);
      back.addColorStop(0, rgba(pal.bg, 0));
      back.addColorStop(0.35, rgba(pal.bg, 0.62));
      back.addColorStop(1, rgba(pal.bg, 0.78));
      ctx.globalAlpha = fade * ease.outCubic(inK(tl, 0, 0.5));
      onPlate(g, (pl) => {
        pl.fillStyle = back;
        pl.fillRect(W * 0.5, 0, W * 0.5, H);
      });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (tl.sub) {
        ctx.globalAlpha = fade * inK(tl, 0, 0.4);
        ctx.fillStyle = pal.accent;
        ctx.font = font(400, 20 * u, F_MONO);
        ctx.fillText(tl.sub.toUpperCase().split('').join(' '), cx, top + 16 * u);
      }
      lines.forEach((line, i) => {
        const k = ease.outExpo(inK(tl, 0.15 + i * 0.12, 0.7));
        if (k <= 0) return;
        const ci = line.indexOf(':');
        const role = ci >= 0 ? line.slice(0, ci).trim() : '';
        const name = ci >= 0 ? line.slice(ci + 1).trim() : line.trim();
        const y = top + header + i * itemH + (1 - k) * 20 * u;
        ctx.globalAlpha = fade * k;
        if (role) {
          ctx.fillStyle = pal.accent2;
          ctx.font = font(600, roleSize, F_SANS);
          ctx.fillText(role.toUpperCase(), cx, y + roleSize * 0.7);
        }
        ctx.fillStyle = pal.text;
        ctx.font = font(700, Math.min(nameSize, fitSize(ctx, name, 700, F_JP, W * 0.4, nameSize)), F_JP);
        ctx.fillText(name, cx, y + roleSize * 1.4 + nameSize * 0.6);
      });
      ctx.restore();
    },
  });
};
