// Transition 「グリッチカット」: an FX used when the look changes (hidden: no key, not in menus); starts `lead` seconds before the change.
import type { PluginApi } from '../../plugin-loader';

export default (api: PluginApi) => {
  const { ease, hash } = api.lib;
  const bump = (p: number, peak: number) => (p < peak ? ease.outCubic(p / peak) : 1 - ease.inCubic((p - peak) / (1 - peak)));

  api.registerFx({
    id: 'glitchcut', name: 'グリッチカット', color: '#1fe4ff', duration: 0.32, lead: 0.1, hidden: true,
    apply: (s) => {
      const k = bump(s.p, 0.3);
      s.post.glitch += 1.2 * k;
      s.post.chroma += 18 * k;
    },
    draw: (g, s) => {
      const { ctx, W, H, pal } = g;
      const k = bump(s.p, 0.3);
      const f = Math.floor(s.age * 40);
      ctx.save();
      for (let i = 0; i < 14; i++) {
        if (hash(f, i, s.seed) > k) continue;
        ctx.fillStyle = i % 3 === 0 ? pal.accent2 : i % 3 === 1 ? pal.accent : pal.bg;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(0, hash(f, i, 1) * H, W, hash(f, i, 2) * H * 0.12);
      }
      ctx.restore();
    },
  });
};
