// IMPACT — screen-filling heavy type that zooms in, echo outlines on every beat, manga speed lines,
// flash / zoom-blur / negative frames. Made for the chorus (サビ).
import type { PluginApi } from '../../plugin-loader';
import type { DrawContext, LineCtx, MotionStyle } from '../../engine/api';
import type { GlyphInfo } from '../../engine/helpers';

interface IGlyph extends GlyphInfo {
  x: number;
}

interface IRow {
  glyphs: IGlyph[];
  text: string;
  y: number;
  width: number;
}

interface ILayout {
  rows: IRow[];
  size: number;
  bottom: number;
}

export default (api: PluginApi) => {
  const { clamp, ease, fitSize, font, glyphRun, hash, isCJK, lerp, mix, onPlate, rgba, TAU } = api.lib;
  const { exitK, hitPulse, latestLine, makeRows, rowText } = api.helpers;

  const F_IMP = '"Dela Gothic One", "Anton", "Noto Sans JP", sans-serif';
  const F_SUB = '"Montserrat", "Noto Sans JP", sans-serif';

  function layout(g: DrawContext, l: LineCtx): ILayout {
    const { ctx, W, H } = g;
    const cjk = isCJK(l.text);
    const rows0 = makeRows(l, { maxRows: 2, maxLen: cjk ? 6 : 12, perChunk: false, stagger: 0.035 });
    const size = Math.min(...rows0.map((r) => fitSize(ctx, rowText(r), 400, F_IMP, W * 0.9, H * 0.36, 10)));
    const lh = size * 1.12;
    const top = H / 2 - (lh * rows0.length) / 2;
    const rows = rows0.map((r, i) => {
      const text = rowText(r);
      const run = glyphRun(ctx, text, 400, F_IMP, size, 0);
      return { glyphs: r.map((gi, k) => ({ ...gi, x: run.glyphs[k].cx - run.width / 2 })), text, y: top + lh * i + lh / 2, width: run.width };
    });
    return { rows, size, bottom: top + lh * rows.length };
  }

  function drawLine(g: DrawContext, l: LineCtx) {
    const { ctx, t, u, W, pal, beat } = g;
    const L: ILayout = (l.cache.i ??= layout(g, l));
    const ex = exitK(l);
    const live = l.out < 0;
    const size = L.size;
    const cx = W / 2;
    ctx.save();
    if (live) {
      const k = (beat.pulse + hitPulse(l, 0.07) * 0.8) * g.intensity;
      ctx.translate((hash(beat.index, 1) - 0.5) * 18 * u * k, (hash(beat.index, 2) - 0.5) * 18 * u * k);
    }
    ctx.font = font(400, size, F_IMP);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const row of L.rows) {
      const shown = row.glyphs.filter((x) => t >= x.tg).length;
      // echo outlines expanding on each beat
      if (live && shown === row.glyphs.length && l.age > 0.12) {
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 2.5 * u;
        for (let k = 1; k <= 3; k++) {
          const sc = 1 + k * 0.09 + beat.phase * 0.14;
          ctx.save();
          ctx.globalAlpha = (0.45 / k) * (1 - beat.phase);
          ctx.translate(cx, row.y);
          ctx.scale(sc, sc);
          ctx.strokeText(row.text, 0, 0);
          ctx.restore();
        }
      }
      for (const gl of row.glyphs) {
        if (gl.g === ' ') continue;
        const a = t - gl.tg;
        if (a < 0) continue;
        const e = clamp(a / 0.28);
        let sc = lerp(2.8, 1, ease.outExpo(e));
        let alpha = clamp(a / 0.06);
        if (ex > 0) {
          sc *= 1 + ease.inExpo(ex) * 1.8;
          alpha *= 1 - ex;
        }
        if (alpha <= 0.001) continue;
        ctx.save();
        ctx.translate(cx + gl.x, row.y);
        ctx.scale(sc, sc);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pal.accent2;
        ctx.fillText(gl.g, size * 0.05, size * 0.05);
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = size * 0.1;
        ctx.strokeText(gl.g, 0, 0);
        ctx.fillStyle = pal.text;
        ctx.fillText(gl.g, 0, 0);
        ctx.restore();
      }
    }
    if (l.sub) {
      const e = ease.outExpo(clamp((l.age - 0.15) / 0.4)) * (1 - ex);
      if (e > 0) {
        ctx.font = font(800, 30 * u, F_SUB);
        const w = ctx.measureText(l.sub.toUpperCase()).width + 36 * u;
        const y = Math.min(g.H - 70 * u, L.bottom + 40 * u);
        ctx.globalAlpha = 1;
        onPlate(g, (pl) => {
          pl.fillStyle = pal.accent;
          pl.fillRect(cx - (w / 2) * e, y - 22 * u, w * e, 44 * u);
        });
        ctx.globalAlpha = e;
        ctx.fillStyle = pal.bg;
        ctx.fillText(l.sub.toUpperCase(), cx, y + 1 * u);
      }
    }
    ctx.restore();
  }

  const style: MotionStyle = {
    id: 'impact',
    name: 'IMPACT',
    description: '画面いっぱいの極太文字がズームで突っ込む。ビートごとの残響アウトライン、集中線、フラッシュ。サビ向け。',
    color: '#ff6b35',
    exitDuration: 0.28,
    transition: 'impactin',
    followCamera: false,
    fonts: ['400 "Dela Gothic One"', '800 "Montserrat"'],
    post: { bloom: 0.22, bloomThreshold: 0.85, chroma: 2, grain: 0.08, vignette: 0.55, contrast: 1.12, saturation: 1.1 },
    camera: { cut: true, shotBars: 1, pool: ['face', 'bust', 'low', 'full', 'tilt'], bounce: 2.2, tilt: 4, effects: ['shadow'], grade: 0.6, bgDim: 0.35 },
    postFx(g, post) {
      const k = g.intensity;
      post.chroma += g.beat.pulse * 6 * k;
      post.radialBlur += g.beat.downPulse * 0.3 * k;
    },
    // text-driven punches: follow the lyric style even over another look
    lyricFx(g, post) {
      const k = g.intensity;
      const l = latestLine(g);
      if (l && l.out < 0) {
        post.flash += 0.35 * Math.exp(-l.age / 0.07) * k;
        post.radialBlur += 0.7 * Math.exp(-l.age / 0.14) * k;
        if (hash(l.seed, 11) < 0.35 && l.age < 0.07) post.invert = 1;
        // every tapped character punches the zoom blur (音ハメ)
        for (const ch of l.chunks)
          ch.gt.forEach((gt, j) => {
            const a = g.t - gt;
            if (ch.gtap[j] && (ch.index > 0 || j > 0) && a >= 0 && a < 0.3) post.radialBlur += 0.3 * Math.exp(-a / 0.09) * k;
          });
      }
    },
    background(g) {
      const { ctx, W, H, pal, audio } = g;
      if (!g.hasBackground) {
        ctx.fillStyle = mix(pal.bg, '#000000', 0.2);
        ctx.fillRect(0, 0, W, H);
      }
      const r = Math.max(W, H) * 0.6;
      const gr = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
      gr.addColorStop(0, rgba(pal.accent, 0.22 + 0.3 * audio.bass));
      gr.addColorStop(1, rgba(pal.accent, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    },
    backDecor(g) {
      const { ctx, W, H, u, pal, beat } = g;
      const seed = Math.floor(beat.beat * 2);
      const cx = W / 2, cy = H / 2;
      const R = Math.hypot(W, H) * 0.75;
      ctx.save();
      ctx.fillStyle = rgba(pal.text, 0.16 + 0.34 * beat.pulse);
      ctx.beginPath();
      for (let i = 0; i < 110; i++) {
        const ang = hash(seed, i) * TAU;
        const r0 = Math.min(W, H) * (0.32 + hash(seed, i, 2) * 0.28);
        const w = (2 + hash(seed, i, 3) * 11) * u;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        ctx.moveTo(cx + dx * r0, cy + dy * r0);
        ctx.lineTo(cx + dx * R - dy * w, cy + dy * R + dx * w);
        ctx.lineTo(cx + dx * R + dy * w, cy + dy * R - dx * w);
        ctx.closePath();
      }
      ctx.fill();
      ctx.restore();
    },
    line: drawLine,
    overlay(g) {
      const { ctx, W, H, u, pal, beat } = g;
      if (beat.downPulse < 0.02) return;
      ctx.save();
      ctx.strokeStyle = pal.accent;
      ctx.globalAlpha = beat.downPulse;
      const lw = 14 * u * beat.downPulse;
      ctx.lineWidth = lw;
      ctx.strokeRect(lw / 2, lw / 2, W - lw, H - lw);
      ctx.restore();
    },
  };

  api.registerStyle(style);
};
