// POP — chunk stickers that pop with overshoot, sunburst, halftone, confetti, bouncy shapes.
import type { PluginApi } from '../../plugin-loader';
import type { DrawContext, LineCtx, MotionStyle } from '../../engine/api';

interface Sticker {
  ci: number;
  /** character offsets from the sticker center, with appear times */
  glyphs: { g: string; x: number; tg: number; tap: boolean }[];
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  dir: number;
  color: string;
  ink: string;
}

interface PLayout {
  size: number;
  stickers: Sticker[];
  bottom: number;
  cx: number;
}

export default (api: PluginApi) => {
  const { clamp, deg, ease, font, glyphRun, hash, makeCanvas, mix, onColor, onPlate, polygon, rgba, roundRect, star, width100 } = api.lib;
  const { exitK, lineGlyphs } = api.helpers;

  const F_POP = '"Mochiy Pop One", "M PLUS Rounded 1c", sans-serif';
  const F_ROUND = '"M PLUS Rounded 1c", "Mochiy Pop One", sans-serif';

  function layout(g: DrawContext, l: LineCtx): PLayout {
    const { ctx, u, pal } = g;
    const box = l.box;
    const maxW = box.w * 0.94;
    let size = Math.min(box.h * 0.26, 124 * u);
    type Item = { ci: number; w: number };
    let rows: Item[][] = [];
    let h = 0, gap = 0;
    for (let iter = 0; iter < 16; iter++) {
      const padX = size * 0.34;
      gap = size * 0.2;
      h = size * 1.38;
      const items: Item[] = l.chunks.map((ch) => ({ ci: ch.index, w: (width100(ctx, ch.text, 400, F_POP) * size) / 100 + padX * 2 }));
      rows = [];
      let cur: Item[] = [];
      let curW = 0;
      for (const it of items) {
        if (cur.length && curW + gap + it.w > maxW) {
          rows.push(cur);
          cur = [];
          curW = 0;
        }
        curW += (cur.length ? gap : 0) + it.w;
        cur.push(it);
      }
      if (cur.length) rows.push(cur);
      const fits = rows.length <= 3 && rows.length * h * 1.18 <= box.h * 0.92 && items.every((it) => it.w <= maxW);
      if (fits) break;
      size *= 0.9;
    }
    const colors = [pal.text, pal.accent, pal.accent2, mix(pal.accent, pal.accent2, 0.5)];
    const c0 = Math.floor(hash(l.seed, 1) * colors.length);
    const lg = lineGlyphs(l, 0.05);
    const lh = h * 1.18;
    const cx = box.x + box.w / 2;
    const top = box.y + box.h / 2 - (rows.length * lh) / 2;
    const stickers: Sticker[] = [];
    rows.forEach((row, ri) => {
      const rw = row.reduce((a, it) => a + it.w, 0) + gap * (row.length - 1);
      let x = cx - rw / 2;
      for (const it of row) {
        const n = stickers.length;
        const color = colors[(c0 + n) % colors.length];
        const ch = l.chunks[it.ci];
        const run = glyphRun(ctx, ch.text, 400, F_POP, size, 0);
        stickers.push({
          ci: it.ci,
          glyphs: run.glyphs.map((rg, j) => ({ g: rg.g, x: rg.cx - run.width / 2, tg: lg[it.ci]?.[j]?.tg ?? ch.t, tap: !!ch.gtap[j] })),
          x: x + it.w / 2,
          y: top + ri * lh + lh / 2 + (hash(l.seed, n, 2) - 0.5) * size * 0.16,
          w: it.w,
          h,
          rot: deg((hash(l.seed, n, 3) - 0.5) * 10),
          dir: hash(l.seed, n, 4) < 0.5 ? -1 : 1,
          color,
          ink: onColor(color, pal.bg, '#ffffff'),
        });
        x += it.w + gap;
      }
    });
    return { size, stickers, bottom: top + rows.length * lh, cx };
  }

  function drawLine(g: DrawContext, l: LineCtx) {
    const { ctx, t, u, pal, beat } = g;
    const L: PLayout = (l.cache.p ??= layout(g, l));
    const ex = exitK(l);
    const live = l.out < 0;
    const size = L.size;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    L.stickers.forEach((s, i) => {
      const ch = l.chunks[s.ci];
      if (!ch) return;
      const a = t - ch.t;
      if (a < 0) return;
      const e = clamp(a / 0.45);
      let sc = ease.outBack(e, 2.8);
      const rot = s.rot + s.dir * deg(25) * (1 - ease.outCubic(e));
      if (ex > 0) sc *= 1 - ease.inBack(clamp((l.out - i * 0.04) / (l.exitDur * 0.75)));
      let y = s.y;
      // bounce when one of this sticker's characters is hit
      let hp = 0;
      for (const gl of s.glyphs) if (gl.tap && t >= gl.tg) hp = Math.max(hp, Math.exp(-(t - gl.tg) / 0.1));
      sc *= 1 + 0.1 * hp * g.intensity;
      if (live) {
        sc *= 1 + 0.05 * beat.pulse * (i % 2 ? 1 : 0.6) * g.intensity;
        y -= 6 * u * beat.pulse * (i % 2 ? 1 : -1) * g.intensity;
      }
      // burst lines
      const e2 = clamp(a / 0.35);
      if (e2 < 1 && ex === 0) {
        ctx.save();
        ctx.strokeStyle = i % 2 ? pal.accent2 : pal.text;
        ctx.lineCap = 'round';
        ctx.lineWidth = 5 * u * (1 - e2);
        const r0 = (Math.max(s.w, s.h) / 2) * (0.85 + 0.5 * ease.outCubic(e2));
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 + hash(l.seed, i, 9);
          ctx.beginPath();
          ctx.moveTo(s.x + Math.cos(ang) * r0, y + Math.sin(ang) * r0 * 0.7);
          const r1 = r0 + size * 0.35 * (1 - e2);
          ctx.lineTo(s.x + Math.cos(ang) * r1, y + Math.sin(ang) * r1 * 0.7);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (sc <= 0.001) return;
      ctx.save();
      ctx.translate(s.x, y);
      ctx.rotate(rot);
      ctx.scale(sc, sc);
      const off = size * 0.09;
      onPlate(g, (pl) => {
        pl.fillStyle = rgba(mix(pal.bg, '#000000', 0.5), 0.55);
        roundRect(pl, -s.w / 2 + off, -s.h / 2 + off, s.w, s.h, s.h * 0.32);
        pl.fill();
        pl.fillStyle = s.color;
        roundRect(pl, -s.w / 2, -s.h / 2, s.w, s.h, s.h * 0.32);
        pl.fill();
        if (s.color !== pal.text) {
          pl.strokeStyle = pal.text;
          pl.lineWidth = size * 0.05;
          pl.stroke();
        }
      });
      ctx.fillStyle = s.ink;
      ctx.font = font(400, size, F_POP);
      for (const gl of s.glyphs) {
        const ga = t - gl.tg;
        if (ga < 0) continue;
        const gs = ease.outBack(clamp(ga / 0.25), 3);
        ctx.save();
        ctx.translate(gl.x, size * 0.04);
        ctx.scale(gs, gs);
        ctx.fillText(gl.g, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    });
    if (l.sub) {
      const e = clamp((l.age - 0.3) / 0.4);
      if (e > 0) {
        const sc = ease.outBack(e, 2) * (1 - ex);
        ctx.save();
        ctx.translate(L.cx, L.bottom + 20 * u);
        ctx.scale(sc, sc);
        ctx.font = font(800, 30 * u, F_ROUND);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = pal.bg;
        ctx.lineWidth = 8 * u;
        ctx.strokeText(l.sub, 0, 0);
        ctx.fillStyle = pal.text;
        ctx.fillText(l.sub, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  const halftoneCache = new Map<string, HTMLCanvasElement>();
  function halftone(S: number, step: number, color: string): HTMLCanvasElement {
    const key = `${S}|${step}|${color}`;
    let c = halftoneCache.get(key);
    if (!c) {
      c = makeCanvas(S, S);
      const x = c.getContext('2d')!;
      x.fillStyle = color;
      for (let yy = step / 2; yy < S; yy += step)
        for (let xx = step / 2; xx < S; xx += step) {
          const d = Math.hypot(xx, yy) / S;
          const r = (step / 2) * 0.9 * (1 - d);
          if (r <= 0.3) continue;
          x.beginPath();
          x.arc(xx, yy, r, 0, Math.PI * 2);
          x.fill();
        }
      halftoneCache.set(key, c);
    }
    return c;
  }

  const style: MotionStyle = {
    id: 'pop',
    name: 'POP',
    description: 'フレーズがステッカーになってバウンス。集中する放射線、ハーフトーン、紙吹雪。',
    color: '#ffd36e',
    exitDuration: 0.35,
    transition: 'circlewipe',
    fonts: ['400 "Mochiy Pop One"', '800 "M PLUS Rounded 1c"'],
    post: { bloom: 0.12, bloomThreshold: 0.85, chroma: 0.3, grain: 0.03, vignette: 0.15, saturation: 1.15 },
    camera: { cut: true, shotBars: 2, pool: ['full', 'bust', 'left', 'right', 'face', 'tilt', 'duo'], bounce: 1.8, tilt: 3, effects: ['outline', 'shadow'], grade: 0.15, bgDim: 0.05 },
    background(g) {
      const { ctx, W, H, pal, t, beat } = g;
      if (!g.hasBackground) {
        const gr = ctx.createLinearGradient(0, 0, W, H);
        gr.addColorStop(0, mix(pal.bg, pal.accent, 0.55));
        gr.addColorStop(1, mix(pal.bg, pal.accent2, 0.4));
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W, H);
      }
      // sunburst
      ctx.save();
      ctx.translate(W / 2, H * 0.55);
      ctx.rotate(t * 0.25 + beat.pulse * 0.03);
      ctx.fillStyle = rgba(pal.text, g.hasBackground ? 0.06 : 0.1);
      const R = Math.hypot(W, H);
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = a0 + Math.PI / n;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
        ctx.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
    backDecor(g) {
      const { ctx, W, H, u, pal, t, beat, segIndex } = g;
      // halftone corners
      const S = Math.round(H * 0.45);
      const ht = halftone(S, Math.max(6, Math.round(18 * u)), rgba(pal.text, 0.22));
      ctx.drawImage(ht, 0, 0);
      ctx.save();
      ctx.translate(W, H);
      ctx.rotate(Math.PI);
      ctx.drawImage(ht, 0, 0);
      ctx.restore();
      // shapes
      const colors = [pal.accent, pal.accent2, pal.text];
      ctx.save();
      for (let i = 0; i < 8; i++) {
        const r = (k: number) => hash(segIndex, i, k, 55);
        let x = r(1), y = r(2);
        if (Math.abs(x - 0.5) < 0.3 && Math.abs(y - 0.5) < 0.3) x = x < 0.5 ? x * 0.3 : 1 - (1 - x) * 0.3;
        const px = (0.03 + x * 0.94) * W;
        const py = (0.06 + y * 0.88) * H + Math.sin(t * 2 + i) * 10 * u;
        const pop = (i + beat.index) % 3 === 0 ? 0.3 * beat.pulse : 0;
        const s = (18 + r(3) * 30) * u * (1 + pop);
        const rot = t * (0.5 + r(4)) * (r(5) < 0.5 ? -1 : 1);
        ctx.fillStyle = ctx.strokeStyle = colors[i % 3];
        ctx.lineWidth = 6 * u;
        ctx.lineCap = 'round';
        const kind = Math.floor(r(6) * 5);
        if (kind === 0) {
          star(ctx, px, py, s, s * 0.45, 5, rot);
          ctx.fill();
        } else if (kind === 1) {
          ctx.beginPath();
          ctx.arc(px, py, s * 0.7, 0, Math.PI * 2);
          ctx.fill();
        } else if (kind === 2) {
          polygon(ctx, px, py, s, 3, rot);
          ctx.fill();
        } else if (kind === 3) {
          ctx.beginPath();
          for (let k = 0; k <= 12; k++) {
            const xx = px - s + (k / 12) * s * 2;
            const yy = py + Math.sin(k * 1.2 + t * 6) * s * 0.3;
            if (k === 0) ctx.moveTo(xx, yy);
            else ctx.lineTo(xx, yy);
          }
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(px, py, s * 0.6, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
    frontDecor(g) {
      const { ctx, W, H, u, pal, t } = g;
      const colors = [pal.accent, pal.accent2, pal.text, mix(pal.accent, pal.accent2, 0.5)];
      ctx.save();
      for (let i = 0; i < 34; i++) {
        const r = (k: number) => hash(i, k, 808);
        const sp = 0.08 + r(1) * 0.1;
        const y = (((t * sp + r(2)) % 1.15) - 0.075) * H;
        const x = r(3) * W + Math.sin(t * 1.5 + i) * 30 * u;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * (2 + r(4) * 4));
        ctx.scale(Math.cos(t * 5 + i), 1);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(-5 * u, -8 * u, 10 * u, 16 * u);
        ctx.restore();
      }
      ctx.restore();
    },
    line: drawLine,
  };

  api.registerStyle(style);
};
