// FX 「集中線」 (key U): a one-shot over the whole screen. apply() adds to the camera / post values, draw() paints on top.
import type { PluginApi } from '../../plugin-loader';
import type { DrawContext, FxState } from '../../engine/api';

export default (api: PluginApi) => {
  const { TAU, hash, rgba } = api.lib;
  function speedLines(g: DrawContext, s: FxState, alpha: number) {
    const { ctx, W, H, u, pal } = g;
    const seed = Math.floor(s.age * 30);
    const cx = W / 2, cy = H / 2;
    const R = Math.hypot(W, H) * 0.75;
    ctx.save();
    ctx.fillStyle = rgba(pal.text, alpha);
    ctx.beginPath();
    for (let i = 0; i < 140; i++) {
      const ang = hash(seed, i, s.seed) * TAU;
      const r0 = Math.min(W, H) * (0.25 + hash(seed, i, 2) * 0.3);
      const w = (2 + hash(seed, i, 3) * 12) * u;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      ctx.moveTo(cx + dx * r0, cy + dy * r0);
      ctx.lineTo(cx + dx * R - dy * w, cy + dy * R + dx * w);
      ctx.lineTo(cx + dx * R + dy * w, cy + dy * R - dx * w);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  api.registerFx({
    id: 'speedlines', name: '集中線', key: 'u', color: '#f0f0f0', duration: 0.8, holdable: true,
    draw: (g, s) => speedLines(g, s, 0.55 * (s.dur > 0.9 ? 1 : 1 - s.p)),
    apply: (s) => { s.camera.zoom += 0.03 * (1 - s.p); },
  });
};
