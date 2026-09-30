// NEON — tube strokes drawn on with line dashes, ignition flicker, synthwave grid & sun.
import type { PluginApi } from '../../plugin-loader';
import type { DrawContext, LineCtx, MotionStyle } from '../../engine/api';
import type { GlyphInfo } from '../../engine/helpers';

interface NGlyph extends GlyphInfo {
  x: number;
}

interface NRow {
  glyphs: NGlyph[];
  y: number;
  width: number;
  color: 0 | 1;
}

interface NLayout {
  rows: NRow[];
  size: number;
  cx: number;
  cy: number;
  rot: number;
  skew: number;
  bottom: number;
  weight: number;
}

export default (api: PluginApi) => {
  const { clamp, ease, fitSize, font, glyphRun, hash, isCJK, mix, polygon, rgba } = api.lib;
  const { exitK, hitPulse, makeRows, rowText } = api.helpers;

  const F_NEON = '"Orbitron", "M PLUS Rounded 1c", sans-serif';
  const F_SUB = '"Orbitron", "M PLUS Rounded 1c", sans-serif';

  function layout(g: DrawContext, l: LineCtx): NLayout {
    const { ctx, u } = g;
    const box = l.box;
    const cjk = isCJK(l.text);
    const weight = cjk ? 800 : 900;
    const rows0 = makeRows(l, { maxRows: 2, maxLen: cjk ? 9 : 18, perChunk: false, stagger: 0.05 });
    const maxSize = Math.min(box.h * 0.32, 150 * u);
    const size = Math.min(...rows0.map((r) => fitSize(ctx, rowText(r), weight, F_NEON, box.w * 0.84, maxSize, 10, 0.06)));
    const lh = size * 1.35;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const top = cy - (lh * rows0.length) / 2;
    const first = hash(l.seed, 3) < 0.5 ? 0 : 1;
    const rows: NRow[] = rows0.map((r, i) => {
      const run = glyphRun(ctx, rowText(r), weight, F_NEON, size, size * 0.06);
      return {
        glyphs: r.map((gi, k) => ({ ...gi, x: run.glyphs[k].cx - run.width / 2 })),
        y: top + lh * i + lh / 2,
        width: run.width,
        color: ((i + first) % 2) as 0 | 1,
      };
    });
    return {
      rows,
      size,
      cx,
      cy,
      rot: ((hash(l.seed, 1) - 0.5) * 6 * Math.PI) / 180,
      skew: cjk ? 0 : -0.12,
      bottom: top + lh * rows.length,
      weight,
    };
  }

  function flick(seed: number, k: number, a: number, t: number): number {
    if (a < 0.55) return 0.85;
    if (a < 0.9) return hash(seed, k, Math.floor(t * 30)) < 0.45 ? 0.2 : 1;
    const broken = hash(seed, k, 5) < 0.08;
    if (broken && hash(seed, k, Math.floor(t * 12)) < 0.22) return 0.18;
    return 0.93 + 0.07 * hash(k, Math.floor(t * 24));
  }

  function drawLine(g: DrawContext, l: LineCtx) {
    const { ctx, t, u, pal, beat } = g;
    const L: NLayout = (l.cache.n ??= layout(g, l));
    const ex = exitK(l);
    const size = L.size;
    const colors = [pal.accent, pal.accent2];
    const dashL = size * 6;
    ctx.save();
    ctx.translate(L.cx, L.cy);
    ctx.rotate(L.rot);
    ctx.transform(1, 0, L.skew, 1, 0, 0);
    ctx.translate(-L.cx, -L.cy);
    ctx.font = font(L.weight, size, F_NEON);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const pulse = 0.9 + 0.1 * beat.pulse;
    const flare = hitPulse(l, 0.12) * g.intensity;
    for (const row of L.rows) {
      const color = colors[row.color];
      const core = mix(color, '#ffffff', 0.75);
      for (const gl of row.glyphs) {
        if (gl.g === ' ') continue;
        const a = t - gl.tg;
        if (a < 0) continue;
        if (ex > 0 && hash(l.seed, gl.k, 77) < ex * 1.3) continue;
        const A = flick(l.seed, gl.k, a, t) * pulse * (1 - ex * 0.6);
        const x = L.cx + gl.x, y = row.y;
        const e = clamp(a / 0.55);
        const drawing = e < 1;
        if (drawing) {
          ctx.setLineDash([dashL, dashL]);
          ctx.lineDashOffset = dashL * (1 - ease.outCubic(e));
        }
        ctx.strokeStyle = color;
        ctx.globalAlpha = Math.min(1, A * (0.28 + 0.45 * flare));
        ctx.lineWidth = size * (0.1 + 0.05 * flare);
        ctx.strokeText(gl.g, x, y);
        ctx.globalAlpha = A;
        ctx.lineWidth = size * 0.045;
        ctx.strokeText(gl.g, x, y);
        ctx.strokeStyle = core;
        ctx.lineWidth = Math.max(1, size * 0.016);
        ctx.strokeText(gl.g, x, y);
        if (drawing) ctx.setLineDash([]);
        if (a > 0.5) {
          ctx.globalAlpha = A * 0.14 * clamp((a - 0.5) / 0.3);
          ctx.fillStyle = color;
          ctx.fillText(gl.g, x, y);
        }
      }
    }
    if (l.sub) {
      const sa = clamp((l.age - 0.5) / 0.4) * (1 - ex);
      if (sa > 0) {
        ctx.globalAlpha = sa * (hash(l.seed, Math.floor(t * 20)) < 0.04 ? 0.3 : 1);
        ctx.font = font(500, 24 * u, F_SUB);
        ctx.fillStyle = pal.text;
        ctx.fillText(l.sub.toUpperCase(), L.cx, L.bottom + 18 * u);
      }
    }
    ctx.restore();
  }

  const style: MotionStyle = {
    id: 'neon',
    name: 'NEON',
    description: 'ネオン管のように文字の輪郭が描かれて点灯。シンセウェーブのグリッドと太陽。',
    color: '#ff00c8',
    exitDuration: 0.4,
    transition: 'flashin',
    // glowing outline tubes: per-pixel fill switching would break the strokes
    adaptText: false,
    fonts: ['900 "Orbitron"', '500 "Orbitron"', '800 "M PLUS Rounded 1c"'],
    post: { bloom: 0.8, bloomThreshold: 0.55, chroma: 1.2, grain: 0.05, vignette: 0.5, saturation: 1.2, scanline: 0.06 },
    camera: { cut: false, shotBars: 4, pool: ['full', 'left', 'right', 'bust', 'low'], effects: ['glow'], bounce: 0.5, grade: 0.85, bgDim: 0.45, center: false },
    postFx(g, post) {
      post.bloom += g.beat.pulse * 0.25 * g.intensity;
    },
    background(g) {
      const { ctx, W, H, pal } = g;
      const hz = H * 0.64;
      if (!g.hasBackground) {
        const sky = ctx.createLinearGradient(0, 0, 0, hz);
        sky.addColorStop(0, mix(pal.bg, '#000000', 0.2));
        sky.addColorStop(1, mix(pal.bg, pal.accent, 0.28));
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, hz);
        ctx.fillStyle = mix(pal.bg, '#000000', 0.3);
        ctx.fillRect(0, hz, W, H - hz);
        // sun
        const r = H * 0.21, cx = W / 2, cy = hz - H * 0.07;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, hz);
        ctx.clip();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        const sg = ctx.createLinearGradient(0, cy - r, 0, cy + r);
        sg.addColorStop(0, mix(mix(pal.accent2, '#ffffff', 0.2), pal.bg, 0.35));
        sg.addColorStop(1, mix(pal.accent, pal.bg, 0.3));
        ctx.fillStyle = sg;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.fillStyle = mix(pal.bg, pal.accent, 0.28);
        for (let s = 0; s < 7; s++) {
          const yy = cy + r * (0.05 + s * 0.14) + ((g.beat.beat * 0.25) % 1) * r * 0.14;
          ctx.fillRect(cx - r, yy, r * 2, r * 0.025 * (s + 1));
        }
        ctx.restore();
      }
    },
    backDecor(g) {
      const { ctx, W, H, u, pal, beat, segIndex, t } = g;
      const hz = H * 0.64;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, hz, W, H - hz);
      ctx.clip();
      const baseA = g.hasBackground ? 0.35 : 0.7;
      ctx.strokeStyle = pal.accent2;
      ctx.lineWidth = 2 * u;
      const ph = beat.beat - Math.floor(beat.beat);
      for (let i = 0; i < 26; i++) {
        const z = 0.45 + i - ph;
        if (z <= 0.05) continue;
        const y = hz + (H * 0.5) / z;
        if (y > H + 4) continue;
        ctx.globalAlpha = baseA * clamp(1.2 - z / 12) * (0.8 + 0.2 * beat.pulse);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.globalAlpha = baseA * 0.8;
      for (let k = -14; k <= 14; k++) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + k * W * 0.012, hz);
        ctx.lineTo(W / 2 + k * W * 0.2, H * 1.3);
        ctx.stroke();
      }
      ctx.restore();
      // horizon glow
      const hg = ctx.createLinearGradient(0, hz - 40 * u, 0, hz + 40 * u);
      hg.addColorStop(0, rgba(pal.accent, 0));
      hg.addColorStop(0.5, rgba(pal.accent, 0.6));
      hg.addColorStop(1, rgba(pal.accent, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(0, hz - 40 * u, W, 80 * u);
      // floating neon shapes
      ctx.save();
      ctx.lineWidth = 4 * u;
      ctx.lineJoin = 'round';
      for (let i = 0; i < 3; i++) {
        const r = (k: number) => hash(segIndex, i, k);
        const x = (0.1 + r(1) * 0.8) * W;
        const y = (0.12 + r(2) * 0.38) * H + Math.sin(t * 0.8 + i) * 12 * u;
        const s = (40 + r(3) * 50) * u * (1 + 0.15 * beat.pulse);
        ctx.strokeStyle = i % 2 ? pal.accent : pal.accent2;
        ctx.globalAlpha = 0.75;
        const kind = Math.floor(r(4) * 3);
        const rot = t * 0.3 * (r(5) < 0.5 ? -1 : 1);
        if (kind === 0) {
          ctx.beginPath();
          ctx.arc(x, y, s * 0.8, 0, Math.PI * 2);
        } else polygon(ctx, x, y, s, kind === 1 ? 3 : 4, rot);
        ctx.stroke();
      }
      ctx.restore();
    },
    line: drawLine,
  };

  api.registerStyle(style);
};
