// KINETIC — justified kinetic typography: stacked rows (one size, justified by letter spacing) that slam, drop and slide in on the beat.
import type { PluginApi } from '../../plugin-loader';
import type { DrawContext, LineCtx, MotionStyle } from '../../engine/api';
import type { GlyphInfo } from '../../engine/helpers';

type Mode = 'fill' | 'accent' | 'bar';

type Enter = 'drop' | 'zoom' | 'flip' | 'slide' | 'rise';

interface KGlyph extends GlyphInfo {
  x: number;
  w: number;
}

interface KRow {
  glyphs: KGlyph[];
  size: number;
  width: number;
  y: number;
  mode: Mode;
  enter: Enter;
  dir: number;
  t0: number;
}

interface KLayout {
  rows: KRow[];
  family: string;
  weight: number;
  cx: number;
  cy: number;
  rot: number;
  top: number;
  bottom: number;
  left: number;
  exit: 'up' | 'side' | 'scale';
}

export default (api: PluginApi) => {
  const { clamp, ease, fitSize, font, glyphRun, hash, isCJK, lerp, mix, onColor, onPlate, rgba } = api.lib;
  const { exitK, hitPulse, latestLine, makeRows, rowText } = api.helpers;

  const F_CJK = '"Noto Sans JP", "Zen Kaku Gothic New", sans-serif';
  const F_LAT = '"Anton", "Bebas Neue", "Noto Sans JP", sans-serif';
  const F_SUB = '"Montserrat", "Noto Sans JP", sans-serif';
  const F_MONO = '"Share Tech Mono", monospace';

  function layout(g: DrawContext, l: LineCtx): KLayout {
    const { ctx, u, W } = g;
    const box = l.box;
    const cjk = isCJK(l.text);
    const family = cjk ? F_CJK : F_LAT;
    const weight = cjk ? 900 : 400;
    const r = (k: number) => hash(l.seed, k);
    const rows0 = makeRows(l, { maxRows: 3, maxLen: cjk ? 7 : 14, perChunk: true, stagger: 0.028 });
    const maxW = box.w * 0.92;
    const maxSize = Math.min(box.h * 0.46, 250 * u);
    const track = cjk ? -0.02 : 0.01;
    // one size for the whole line (the longest row decides it), so no row ever looks smaller than the others
    const gap = 0.12;
    let size = Math.min(...rows0.map((row) => fitSize(ctx, rowText(row), weight, family, maxW, maxSize, 10, track)));
    const lim = box.h * 0.9;
    const tall = rows0.length * size * (1 + gap) - size * gap;
    if (tall > lim) size *= lim / tall;
    const total = rows0.length * size * (1 + gap) - size * gap;
    // justify: shorter rows are widened with letter spacing (not size), up to a limit
    const plain = rows0.map((row) => glyphRun(ctx, rowText(row), weight, family, size, size * track));
    const blockW = Math.max(...plain.map((r) => r.width));
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    let y = cy - total / 2;
    const enters: Enter[] = ['drop', 'zoom', 'flip', 'slide', 'rise'];
    const barRow = r(1) < 0.4 ? Math.floor(r(2) * rows0.length) : -1;
    const rows: KRow[] = rows0.map((row, i) => {
      const n = row.length;
      const extra = n > 1 ? Math.min(size * 0.3, (blockW - plain[i].width) / (n - 1)) : 0;
      const run = extra > 0.5 ? glyphRun(ctx, rowText(row), weight, family, size, size * track + extra) : plain[i];
      const glyphs: KGlyph[] = row.map((gi, k) => ({ ...gi, x: run.glyphs[k].cx - run.width / 2, w: run.glyphs[k].w }));
      const m = r(10 + i);
      const mode: Mode = i === barRow ? 'bar' : m < 0.7 ? 'fill' : 'accent';
      const rowY = y + size / 2;
      y += size * (1 + gap);
      return {
        glyphs,
        size,
        width: run.width,
        y: rowY,
        mode,
        enter: enters[Math.floor(r(20 + i) * enters.length)],
        dir: r(30 + i) < 0.5 ? -1 : 1,
        t0: glyphs[0]?.tg ?? l.start,
      };
    });
    const widest = Math.max(...rows.map((rw) => rw.width));
    return {
      rows,
      family,
      weight,
      cx,
      cy,
      rot: r(3) < 0.3 ? ((r(4) - 0.5) * 10 * Math.PI) / 180 : 0,
      top: cy - total / 2,
      bottom: cy + total / 2,
      left: cx - widest / 2,
      exit: (['up', 'side', 'scale'] as const)[Math.floor(r(5) * 3)],
    };
  }

  function drawLine(g: DrawContext, l: LineCtx) {
    const { ctx, t, u, W, pal, beat } = g;
    const L: KLayout = (l.cache.k ??= layout(g, l));
    const ex = exitK(l);
    const live = l.out < 0;
    const dur = Math.max(0.3, l.end - l.start);
    let blockScale = 1 + 0.04 * clamp(l.age / dur) + (live ? (0.035 * beat.pulse + 0.035 * hitPulse(l)) * g.intensity : 0);
    let blockAlpha = 1;
    if (L.exit === 'scale' && ex > 0) {
      blockScale *= lerp(1, 0.55, ease.inCubic(ex));
      blockAlpha = 1 - ease.inQuad(ex);
    }
    ctx.save();
    ctx.translate(L.cx, L.cy);
    ctx.rotate(L.rot);
    ctx.scale(blockScale, blockScale);
    ctx.translate(-L.cx, -L.cy);
    ctx.globalAlpha = blockAlpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    L.rows.forEach((row, ri) => {
      const size = row.size;
      ctx.font = font(L.weight, size, L.family);
      let rowDx = 0;
      if (L.exit === 'side' && ex > 0) {
        const e = clamp((l.out - ri * 0.04) / (l.exitDur * 0.8));
        rowDx = row.dir * ease.inExpo(e) * W * 0.8;
      }
      // slide entrance is row-level
      let slideDx = 0;
      let slideE = 1;
      if (row.enter === 'slide') {
        slideE = clamp((t - row.t0) / 0.5);
        slideDx = -row.dir * (1 - ease.outExpo(slideE)) * W * 0.6;
      }
      const left = L.cx - row.width / 2;
      // highlight bar
      if (row.mode === 'bar') {
        const be = ease.outExpo(clamp((t - row.t0 + 0.04) / 0.35));
        if (be > 0) {
          const pad = size * 0.14;
          let x0 = left - pad;
          const full = row.width + pad * 2;
          let w = full * be;
          if (ex > 0) {
            const k = ease.inCubic(clamp(ex * 1.4));
            x0 += full * k;
            w = full * (1 - k);
          }
          onPlate(g, (pl) => {
            pl.fillStyle = pal.accent;
            pl.fillRect(x0 + rowDx + slideDx, row.y - size * 0.56, w, size * 1.1);
          });
        }
      }
      const fill = row.mode === 'bar' ? onColor(pal.accent) : row.mode === 'accent' ? pal.accent : pal.text;
      for (const gl of row.glyphs) {
        if (gl.g === ' ') continue;
        const a = t - gl.tg;
        if (a < 0) continue;
        let dx = 0, dy = 0, sc = 1, sy = 1, alpha = clamp(a / 0.05);
        let clip = false;
        switch (row.enter) {
          case 'drop': {
            const e = clamp(a / 0.4);
            dy = -(1 - ease.outExpo(e)) * size * 0.9;
            sc = lerp(1.6, 1, ease.outExpo(e));
            break;
          }
          case 'zoom': {
            const e = clamp(a / 0.35);
            sc = lerp(3, 1, ease.outExpo(e));
            alpha = clamp(a / 0.1);
            break;
          }
          case 'flip': {
            const e = clamp(a / 0.42);
            sy = ease.outBack(e, 3);
            break;
          }
          case 'rise': {
            const e = clamp(a / 0.45);
            dy = (1 - ease.outExpo(e)) * size * 1.1;
            clip = true;
            break;
          }
          case 'slide':
            dx = slideDx;
            break;
        }
        if (L.exit === 'up' && ex > 0) {
          const e = clamp((l.out - gl.k * 0.014) / (l.exitDur * 0.8));
          dy -= ease.inCubic(e) * size * 0.6;
          alpha *= 1 - e;
          sc *= 1 - 0.25 * e;
        }
        if (alpha <= 0.001) continue;
        const x = left + row.width / 2 + gl.x + dx + rowDx;
        const y = row.y + dy;
        ctx.save();
        if (clip) {
          ctx.beginPath();
          ctx.rect(x - gl.w, row.y - size * 0.62, gl.w * 2, size * 1.24);
          ctx.clip();
        }
        ctx.translate(x, y);
        ctx.scale(sc, sc * sy);
        ctx.globalAlpha = blockAlpha * alpha;
        if (row.enter === 'slide' && slideE < 1) {
          // motion trail
          for (let k = 1; k <= 2; k++) {
            ctx.globalAlpha = blockAlpha * alpha * (0.28 / k) * (1 - slideE);
            ctx.fillStyle = fill;
            ctx.fillText(gl.g, (-slideDx * 0.18 * k) / sc, 0);
          }
          ctx.globalAlpha = blockAlpha * alpha;
        }
        ctx.fillStyle = fill;
        ctx.fillText(gl.g, 0, 0);
        ctx.restore();
      }
    });

    // index tag
    const tagA = clamp((l.age - 0.08) / 0.2) * (1 - ex);
    if (tagA > 0) {
      ctx.globalAlpha = tagA * 0.9;
      ctx.fillStyle = pal.accent;
      const ty = L.top - 22 * u;
      ctx.fillRect(L.left, ty - 5 * u, 10 * u, 10 * u);
      ctx.fillStyle = pal.text;
      ctx.font = font(400, 18 * u, F_MONO);
      ctx.textAlign = 'left';
      ctx.fillText(`LYRIC_${String(l.index + 1).padStart(2, '0')} / ${String(l.total).padStart(2, '0')}`, L.left + 18 * u, ty + 1 * u);
      const lw = Math.min(160 * u, (l.age - 0.08) * 800 * u);
      ctx.fillRect(L.left + 200 * u, ty, Math.max(0, lw), 1.5 * u);
    }
    // sub text
    if (l.sub) {
      const sa = clamp((l.age - 0.2) / 0.3) * (1 - ex);
      if (sa > 0) {
        ctx.globalAlpha = sa * 0.9;
        ctx.fillStyle = pal.text;
        ctx.textAlign = 'center';
        const n = Math.ceil(l.sub.length * clamp((l.age - 0.2) / 0.5));
        ctx.font = font(600, 28 * u, F_SUB);
        ctx.fillText(l.sub.slice(0, n).toUpperCase(), L.cx, L.bottom + 40 * u);
      }
    }
    ctx.restore();
  }

  const style: MotionStyle = {
    id: 'kinetic',
    name: 'KINETIC',
    description: '行の左右を字間でそろえる“ジャスティファイ”組版（文字サイズは1行の中で統一）。文字が落下・ズーム・スライドで叩き込まれる王道キネティックタイポ。',
    color: '#ff2e63',
    exitDuration: 0.35,
    transition: 'wipe',
    fonts: ['900 "Noto Sans JP"', '400 "Anton"', '600 "Montserrat"', '400 "Share Tech Mono"'],
    post: { bloom: 0.3, bloomThreshold: 0.8, chroma: 1, grain: 0.06, vignette: 0.4 },
    camera: { cut: true, shotBars: 2, pool: ['full', 'bust', 'face', 'left', 'right', 'low', 'duo'], bounce: 1, effects: ['shadow'], grade: 0.5, bgDim: 0.2 },
    postFx(g, post) {
      post.chroma += g.beat.downPulse * 3 * g.intensity;
    },
    background(g) {
      if (g.hasBackground) return;
      const { ctx, W, H, u, pal, beat } = g;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate((-20 * Math.PI) / 180);
      const sw = 70 * u;
      const off = ((beat.beat * 24 * u) % (sw * 2)) - sw * 2;
      ctx.fillStyle = mix(pal.bg, pal.accent, 0.05);
      const R = Math.hypot(W, H);
      for (let x = -R + off; x < R; x += sw * 2) ctx.fillRect(x, -R, sw, R * 2);
      ctx.restore();
    },
    backDecor(g) {
      const { ctx, W, H, u, pal, beat } = g;
      const l = latestLine(g);
      if (l) {
        // huge scrolling outline typography behind the character
        const size = H * 0.52;
        const fam = isCJK(l.text) ? F_CJK : F_LAT;
        ctx.save();
        ctx.font = font(900, size, fam);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const txt = l.text + '  ';
        const w = ctx.measureText(txt).width;
        const x0 = -((beat.beat * 36 * u) % w);
        ctx.strokeStyle = rgba(pal.text, 0.08 * (1 - exitK(l)));
        ctx.lineWidth = 2 * u;
        for (let x = x0; x < W; x += w) ctx.strokeText(txt, x, H * 0.5);
        ctx.restore();
      }
      // cross markers
      ctx.save();
      const cols = 8, rows = 5;
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) {
          const x = ((i + 0.5) / cols) * W, y = ((j + 0.5) / rows) * H;
          const on = hash(i, j, beat.index) < 0.12;
          const s = (6 + (on ? 8 * beat.pulse : 0)) * u;
          ctx.globalAlpha = on ? 0.25 + 0.6 * beat.pulse : 0.14;
          ctx.fillStyle = on ? pal.accent : pal.text;
          ctx.fillRect(x - s, y - 0.75 * u, s * 2, 1.5 * u);
          ctx.fillRect(x - 0.75 * u, y - s, 1.5 * u, s * 2);
        }
      ctx.restore();
    },
    line: drawLine,
    overlay(g) {
      const { ctx, W, H, u, pal, beat } = g;
      const m = 28 * u, s = 44 * u;
      ctx.save();
      ctx.strokeStyle = pal.text;
      ctx.globalAlpha = 0.35 + 0.65 * beat.downPulse;
      ctx.lineWidth = 3 * u;
      const corner = (x: number, y: number, sx: number, sy: number) => {
        ctx.beginPath();
        ctx.moveTo(x + sx * s, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * s);
        ctx.stroke();
      };
      corner(m, m, 1, 1);
      corner(W - m, m, -1, 1);
      corner(m, H - m, 1, -1);
      corner(W - m, H - m, -1, -1);
      ctx.restore();
    },
  };

  api.registerStyle(style);
};
