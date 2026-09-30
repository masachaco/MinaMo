// MINIMAL — clean type rising out of a mask, growing underline, Swiss/UI grid details.
import type { PluginApi } from '../../plugin-loader';
import type { DrawContext, LineCtx, MotionStyle } from '../../engine/api';
import type { GlyphInfo } from '../../engine/helpers';

interface MGlyph extends GlyphInfo {
  x: number;
}

interface MLayout {
  rows: { glyphs: MGlyph[]; y: number; width: number }[];
  size: number;
  x0: number;
  family: string;
  weight: number;
  width: number;
}

export default (api: PluginApi) => {
  const { clamp, ease, fitSize, fmtTime, font, glyphRun, isCJK, lerp, mix, rgba } = api.lib;
  const { exitK, makeRows, rowText } = api.helpers;

  const F_JP = '"Zen Kaku Gothic New", "Noto Sans JP", sans-serif';
  const F_EN = '"Montserrat", "Zen Kaku Gothic New", sans-serif';
  const F_MONO = '"Share Tech Mono", monospace';

  function layout(g: DrawContext, l: LineCtx): MLayout {
    const { ctx, u } = g;
    const box = l.box;
    const cjk = isCJK(l.text);
    const family = cjk ? F_JP : F_EN;
    const weight = cjk ? 500 : 600;
    const rows0 = makeRows(l, { maxRows: 2, maxLen: cjk ? 14 : 28, perChunk: false, stagger: 0.03 });
    const size = Math.min(...rows0.map((r) => fitSize(ctx, rowText(r), weight, family, box.w * 0.86, 84 * u, 10, 0.06)));
    const lh = size * 1.3;
    const lastY = box.y + box.h * 0.72;
    const rows = rows0.map((r, i) => {
      const run = glyphRun(ctx, rowText(r), weight, family, size, size * 0.06);
      return { glyphs: r.map((gi, k) => ({ ...gi, x: run.glyphs[k].cx })), y: lastY - lh * (rows0.length - 1 - i), width: run.width };
    });
    return { rows, size, x0: box.x + box.w * 0.07, family, weight, width: Math.max(...rows.map((r) => r.width)) };
  }

  function drawLine(g: DrawContext, l: LineCtx) {
    const { ctx, t, u, pal } = g;
    const L: MLayout = (l.cache.m ??= layout(g, l));
    const ex = exitK(l);
    const size = L.size;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = font(L.weight, size, L.family);
    for (const row of L.rows) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.x0 - 20 * u, row.y - size * 0.64, row.width + 60 * u, size * 1.28);
      ctx.clip();
      for (const gl of row.glyphs) {
        if (gl.g === ' ') continue;
        const a = t - gl.tg;
        if (a < 0) continue;
        const e = ease.outExpo(clamp(a / 0.7));
        let dy = (1 - e) * size * 1.1;
        if (ex > 0) dy -= ease.inCubic(clamp((l.out - gl.k * 0.01) / (l.exitDur * 0.8))) * size * 1.2;
        ctx.fillStyle = pal.text;
        ctx.fillText(gl.g, L.x0 + gl.x, row.y + dy);
      }
      ctx.restore();
    }
    const first = L.rows[0], last = L.rows[L.rows.length - 1];
    // index
    const ia = clamp((l.age - 0.1) / 0.3) * (1 - ex);
    if (ia > 0 && first) {
      ctx.globalAlpha = ia * 0.7;
      ctx.textAlign = 'left';
      ctx.font = font(400, 17 * u, F_MONO);
      ctx.fillStyle = pal.accent;
      ctx.fillText(`${String(l.index + 1).padStart(2, '0')} — ${String(l.total).padStart(2, '0')}`, L.x0, first.y - size * 0.95);
    }
    // underline
    if (last) {
      const y = last.y + size * 0.66 + 8 * u;
      const k = ease.outExpo(clamp(l.age / 0.9));
      const cut = ease.inOutCubic(ex);
      const w = L.width * k;
      ctx.globalAlpha = 1;
      ctx.fillStyle = pal.accent;
      ctx.fillRect(L.x0 + w * cut, y, w * (1 - cut), 2 * u);
      if (l.sub) {
        const sa = clamp((l.age - 0.35) / 0.5) * (1 - ex);
        if (sa > 0) {
          const sp = lerp(0.35, 0.18, ease.outCubic(clamp((l.age - 0.35) / 0.9)));
          const fs = 20 * u;
          const run = glyphRun(ctx, l.sub.toUpperCase(), 500, F_EN, fs, fs * sp);
          ctx.font = font(500, fs, F_EN);
          ctx.textAlign = 'center';
          ctx.globalAlpha = sa * 0.75;
          ctx.fillStyle = pal.text;
          for (const gl of run.glyphs) ctx.fillText(gl.g, L.x0 + gl.cx, y + 34 * u);
        }
      }
    }
    ctx.restore();
  }

  const style: MotionStyle = {
    id: 'minimal',
    name: 'MINIMAL',
    description: 'マスクからせり上がる端正な文字と伸びるアンダーライン。グリッドやタイムコードのスイス/UI風ディテール。',
    color: '#e8e8e8',
    exitDuration: 0.5,
    transition: 'slidewipe',
    hideHud: true,
    fonts: ['500 "Zen Kaku Gothic New"', '600 "Montserrat"', '500 "Montserrat"', '400 "Share Tech Mono"'],
    post: { bloom: 0.15, bloomThreshold: 0.8, grain: 0.05, vignette: 0.25, chroma: 0.3, saturation: 0.95 },
    camera: { cut: false, shotBars: 4, pool: ['left', 'right', 'full', 'bust'], drift: 0.8, bounce: 0, effects: [], grade: 0.4, bgDim: 0.35, center: false },
    background(g) {
      if (g.hasBackground) return;
      const { ctx, W, H, pal } = g;
      const gr = ctx.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, mix(pal.bg, pal.text, 0.04));
      gr.addColorStop(1, pal.bg);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    },
    line: drawLine,
    overlay(g) {
      const { ctx, W, H, u, pal, t, beat, audio } = g;
      ctx.save();
      // thirds grid
      ctx.fillStyle = rgba(pal.text, 0.06);
      for (let i = 1; i < 3; i++) {
        ctx.fillRect((W * i) / 3, 0, 1 * u, H);
        ctx.fillRect(0, (H * i) / 3, W, 1 * u);
      }
      // crop marks
      const m = 40 * u, s = 22 * u;
      ctx.fillStyle = rgba(pal.text, 0.6);
      for (const [x, y] of [[m, m], [W - m, m], [m, H - m], [W - m, H - m]]) {
        ctx.fillRect(x - s / 2, y - 0.5 * u, s, 1 * u);
        ctx.fillRect(x - 0.5 * u, y - s / 2, 1 * u, s);
      }
      ctx.textBaseline = 'middle';
      ctx.fillStyle = pal.text;
      ctx.globalAlpha = 0.85;
      ctx.textAlign = 'left';
      ctx.font = font(600, 16 * u, F_EN);
      ctx.fillText(g.title.toUpperCase().split('').join(' '), m + 24 * u, m);
      ctx.globalAlpha = 0.5;
      ctx.font = font(500, 14 * u, F_EN);
      ctx.fillText(g.artist.toUpperCase(), m + 24 * u, m + 22 * u);
      ctx.globalAlpha = 0.85;
      ctx.textAlign = 'right';
      ctx.font = font(400, 18 * u, F_MONO);
      ctx.fillText(`${String(Math.max(0, beat.bar + 1)).padStart(3, '0')}.${beat.inBar + 1}`, W - m - 24 * u, m);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 0.6;
      ctx.fillText(`${fmtTime(t)} / ${fmtTime(g.duration)}`, m + 24 * u, H - m);
      // spectrum
      const n = audio.spectrum.length;
      const bw = 4 * u, gap = 3 * u;
      const x0 = W - m - 24 * u - n * (bw + gap);
      ctx.fillStyle = pal.accent;
      for (let i = 0; i < n; i++) {
        const h = 3 * u + audio.spectrum[i] * 46 * u;
        ctx.globalAlpha = 0.35 + 0.5 * audio.spectrum[i];
        ctx.fillRect(x0 + i * (bw + gap), H - m - h / 2, bw, h);
      }
      ctx.restore();
    },
  };

  api.registerStyle(style);
};
