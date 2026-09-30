// EMOTIONAL — vertical (tategaki) mincho with blur-in glyphs, previous lines drift left like a poem,
// light leaks, bokeh and cinematic letterbox.
import type { PluginApi } from '../../plugin-loader';
import type { DrawContext, LineCtx, MotionStyle } from '../../engine/api';

interface EGlyph {
  g: string;
  tg: number;
  k: number;
  x: number;
  y: number;
  rotate: boolean;
}

interface ELayout {
  vertical: boolean;
  size: number;
  glyphs: EGlyph[];
  /** column x (vertical) or center x (horizontal) */
  x: number;
  y0: number;
  height: number;
  width: number;
}

export default (api: PluginApi) => {
  const { clamp, ease, fitSize, font, glyphRun, hash, isCJK, lerp, mix, noise1, rgba, softDot, tinted, verticalRun } = api.lib;
  const { exitK, lineGlyphs } = api.helpers;

  const F_MIN = '"Shippori Mincho B1", "Noto Serif JP", "Yu Mincho", serif';
  const F_SUB = '"Cormorant Garamond", "Shippori Mincho B1", serif';
  const ORDER_ALPHA = [1, 0.42, 0.22, 0.1, 0.05];

  function layout(g: DrawContext, l: LineCtx): ELayout {
    const { ctx, u } = g;
    const box = l.box;
    const all = lineGlyphs(l, 0.07).flat().map((x) => ({ g: x.g, tg: x.tg }));
    const vertical = isCJK(l.text) && box.h > box.w * 0.6;
    if (vertical) {
      const n = all.filter((x) => x.g.trim()).length || 1;
      const size = clamp((box.h * 0.8) / (n * 1.04), 40 * u, 92 * u);
      const run = verticalRun(all.map((x) => x.g).join(''), size, 1.04);
      const vis = all.filter((x) => x.g !== ' ' && x.g !== '　');
      const x = box.x + box.w * 0.7;
      const stag = [0, 1.4, 0.6, 2.0][Math.floor(hash(l.seed, 2) * 4)];
      const y0 = box.y + box.h * 0.06 + stag * size * 0.5;
      return {
        vertical,
        size,
        glyphs: run.glyphs.map((vg, k) => ({ g: vg.g, tg: vis[k]?.tg ?? l.start, k, x: vg.dx, y: y0 + vg.cy + vg.dy, rotate: vg.rotate })),
        x,
        y0,
        height: run.height,
        width: size,
      };
    }
    const text = all.map((x) => x.g).join('');
    const size = fitSize(ctx, text, 600, F_SUB, box.w * 0.86, 96 * u, 12, 0.02);
    const run = glyphRun(ctx, text, 600, F_SUB, size, size * 0.02);
    const cx = box.x + box.w / 2;
    const y = box.y + box.h * 0.62;
    return {
      vertical,
      size,
      glyphs: run.glyphs.map((rg, k) => ({ g: rg.g, tg: all[k].tg, k, x: rg.cx - run.width / 2, y, rotate: false })),
      x: cx,
      y0: y,
      height: size,
      width: run.width,
    };
  }

  /** Smoothly increasing "how many newer lines exist" (for the drift-left layout). */
  function smoothOrder(l: LineCtx, t: number): number {
    let o = 0;
    for (const s of l.newerStarts) o += ease.inOutCubic(clamp((t - s) / 0.9));
    return o;
  }

  function orderAlpha(o: number): number {
    const i = Math.floor(o);
    const f = o - i;
    const a = ORDER_ALPHA[Math.min(i, ORDER_ALPHA.length - 1)];
    const b = ORDER_ALPHA[Math.min(i + 1, ORDER_ALPHA.length - 1)];
    return lerp(a, b, f);
  }

  function drawLine(g: DrawContext, l: LineCtx) {
    const { ctx, t, u, pal } = g;
    const L: ELayout = (l.cache.e ??= layout(g, l));
    const ex = exitK(l);
    const order = smoothOrder(l, t);
    const oa = orderAlpha(order) * (1 - ease.inQuad(ex));
    if (oa <= 0.003) return;
    const size = L.size;
    const shift = L.vertical ? -order * size * 1.9 : 0;
    const lift = L.vertical ? 0 : -order * size * 1.5;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(800, size, L.vertical ? F_MIN : F_SUB);
    if (!L.vertical) ctx.font = `italic ${font(600, size, F_SUB)}`;
    const baseX = L.x + shift;
    // vertical rule next to the column
    if (L.vertical) {
      const le = ease.outExpo(clamp(l.age / 1.4));
      ctx.globalAlpha = 0.45 * oa;
      ctx.fillStyle = pal.text;
      ctx.fillRect(baseX + size * 0.95, L.y0 - size * 0.2, 1.2 * u, (L.height + size * 0.4) * le);
      ctx.fillStyle = pal.accent;
      ctx.globalAlpha = oa;
      ctx.beginPath();
      ctx.arc(baseX, L.y0 - size * 0.55, 4 * u * clamp(l.age / 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const gl of L.glyphs) {
      const a = t - gl.tg;
      if (a < 0) continue;
      const e = ease.outCubic(clamp(a / 0.9));
      const blur = (1 - e) * 10 * u + ex * 8 * u;
      const alpha = e * oa;
      if (alpha <= 0.003) continue;
      const dy = -(1 - e) * size * 0.35 + ex * size * 0.3;
      const sc = lerp(1.25, 1, e);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (blur > 0.4) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      const x = L.vertical ? baseX + gl.x : L.x + gl.x;
      ctx.translate(x, gl.y + dy + lift);
      if (gl.rotate) ctx.rotate(Math.PI / 2);
      ctx.scale(sc, sc);
      ctx.fillStyle = pal.text;
      ctx.fillText(gl.g, 0, 0);
      ctx.restore();
    }
    // sub text: vertical along the column, or below the line
    if (l.sub) {
      const sa = clamp((l.age - 0.5) / 0.8) * oa;
      if (sa > 0) {
        ctx.save();
        ctx.globalAlpha = sa * 0.85;
        ctx.fillStyle = pal.text;
        ctx.font = `italic ${font(500, 26 * u, F_SUB)}`;
        if (L.vertical) {
          ctx.translate(baseX - size * 0.95, L.y0 - size * 0.3);
          ctx.rotate(Math.PI / 2);
          ctx.textAlign = 'left';
          ctx.fillText(l.sub, 0, 0);
        } else {
          ctx.fillText(l.sub, L.x, L.y0 + size * 0.9 + lift);
        }
        ctx.restore();
      }
    }
    ctx.restore();
  }

  const style: MotionStyle = {
    id: 'emotional',
    name: 'EMOTIONAL',
    description: '縦書き明朝がぼかしから一文字ずつ浮かび、前の行は左へ流れて残る。光のにじみ・玉ボケ・シネスコ帯。',
    color: '#ffb3c7',
    exitDuration: 1.2,
    persist: 3,
    transition: 'whiteout',
    fonts: ['800 "Shippori Mincho B1"', 'italic 500 "Cormorant Garamond"', 'italic 600 "Cormorant Garamond"'],
    post: { bloom: 0.55, bloomThreshold: 0.62, chroma: 0.3, grain: 0.09, vignette: 0.45, saturation: 0.9, contrast: 0.96, brightness: 0.01 },
    camera: { cut: false, shotBars: 4, pool: ['full', 'bust', 'left', 'right', 'face'], drift: 1.6, bounce: 0, effects: [], bgBlur: true, grade: 0.7, bgDim: 0.12, center: false },
    background(g) {
      if (g.hasBackground) return;
      const { ctx, W, H, pal } = g;
      const gr = ctx.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, mix(pal.bg, pal.accent2, 0.16));
      gr.addColorStop(0.55, pal.bg);
      gr.addColorStop(1, mix(pal.bg, pal.accent, 0.14));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    },
    backDecor(g) {
      const { ctx, W, H, u, pal, t, audio } = g;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      // light leaks
      const leaks = [pal.accent, pal.accent2, mix(pal.accent, '#ffffff', 0.4)];
      leaks.forEach((c, i) => {
        const x = (0.5 + 0.45 * noise1(t * 0.06 + i * 10, i)) * W;
        const y = (0.4 + 0.4 * noise1(t * 0.05 + i * 20, i + 5)) * H;
        const r = (0.35 + 0.1 * i) * Math.max(W, H);
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(c, 0.16 + 0.08 * audio.level));
        gr.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W, H);
      });
      // bokeh
      const dot = softDot(128, 0.55);
      for (let i = 0; i < 28; i++) {
        const r = (k: number) => hash(i, k, 404);
        const sp = 0.02 + r(1) * 0.05;
        const yy = 1.1 - ((t * sp + r(2)) % 1.2);
        const x = r(3) * W + Math.sin(t * 0.3 + i) * 30 * u;
        const s = (8 + r(4) * 46) * u;
        ctx.globalAlpha = (0.08 + r(5) * 0.3) * (0.7 + 0.3 * Math.sin(t * 1.5 + i * 2));
        const tint = tinted(dot, i % 3 === 0 ? pal.accent : i % 3 === 1 ? pal.text : pal.accent2, 'bokeh');
        ctx.drawImage(tint, x - s, yy * H - s, s * 2, s * 2);
      }
      ctx.restore();
    },
    line: drawLine,
    overlay(g) {
      const { ctx, W, H, styleAge } = g;
      const k = ease.inOutCubic(clamp(styleAge / 1.2));
      const bar = H * 0.075 * k;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, bar);
      ctx.fillRect(0, H - bar, W, bar);
    },
  };

  api.registerStyle(style);
};
