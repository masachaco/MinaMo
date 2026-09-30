// GLITCH — scramble-decode text, RGB split, sliced displacement, terminal HUD.
import type { PluginApi } from '../../plugin-loader';
import type { DrawContext, LineCtx, MotionStyle } from '../../engine/api';
import type { GlyphInfo } from '../../engine/helpers';

interface GGlyph extends GlyphInfo {
  x: number;
  w: number;
}

interface GRow {
  glyphs: GGlyph[];
  y: number;
  width: number;
}

interface GLayout {
  rows: GRow[];
  size: number;
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export default (api: PluginApi) => {
  const { clamp, fitSize, font, glyphRun, hash, isCJK, mix, rgba } = api.lib;
  const { exitK, hitPulse, makeRows, rowText } = api.helpers;

  const F_MAIN = '"DotGothic16", "Share Tech Mono", monospace';
  const F_MONO = '"Share Tech Mono", "DotGothic16", monospace';
  const POOL = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモラリルレロワン#$%&*+=<>?/|01ｱｲｳｴｵ';
  const RESOLVE = 0.14;

  function layout(g: DrawContext, l: LineCtx): GLayout {
    const { ctx, u } = g;
    const box = l.box;
    const cjk = isCJK(l.text);
    const rows0 = makeRows(l, { maxRows: 2, maxLen: cjk ? 10 : 22, perChunk: false, stagger: 0.035 });
    const maxSize = Math.min(box.h * 0.3, 150 * u);
    const size = Math.min(...rows0.map((r) => fitSize(ctx, rowText(r), 400, F_MAIN, box.w * 0.86, maxSize, 10, 0.04)));
    const lh = size * 1.3;
    const top = box.y + box.h / 2 - (lh * rows0.length) / 2;
    const rows: GRow[] = rows0.map((r, i) => {
      const run = glyphRun(ctx, rowText(r), 400, F_MAIN, size, size * 0.04);
      return {
        glyphs: r.map((gi, k) => ({ ...gi, x: run.glyphs[k].x, w: run.glyphs[k].w })),
        y: top + lh * i + lh / 2,
        width: run.width,
      };
    });
    const width = Math.max(...rows.map((r) => r.width));
    return { rows, size, left: box.x + (box.w - width) / 2, top, bottom: top + lh * rows.length, width };
  }

  function drawLine(g: DrawContext, l: LineCtx) {
    const { ctx, t, u, pal, beat } = g;
    const L: GLayout = (l.cache.g ??= layout(g, l));
    const ex = exitK(l);
    const size = L.size;
    const moment = hash(l.seed, Math.floor(t * 10)) < 0.1 || l.age < 0.16;
    const burst = Math.exp(-l.age / 0.15);
    const d = (2 + 10 * burst + 14 * hitPulse(l, 0.08) + (moment ? 12 : 0) + beat.downPulse * 8 + ex * 40) * u * g.intensity;
    let alpha = 1;
    if (ex > 0) alpha = (hash(l.seed, Math.floor(t * 40)) < ex ? 0.15 : 1) * (1 - ex * ex);
    if (alpha <= 0.001) return;

    ctx.save();
    ctx.font = font(400, size, F_MAIN);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const pass = (ox: number, color: string | null, a: number) => {
      for (const row of L.rows) {
        for (const gl of row.glyphs) {
          const age = t - gl.tg;
          if (age < 0 || gl.g === ' ') continue;
          const resolved = age >= RESOLVE + gl.j * 0.012;
          const ch = resolved ? gl.g : POOL[Math.floor(hash(l.seed, gl.k, Math.floor(t * 28)) * POOL.length)];
          ctx.globalAlpha = a * alpha * (resolved ? 1 : 0.85);
          ctx.fillStyle = color ?? (resolved ? pal.text : pal.accent2);
          ctx.fillText(ch, L.left + gl.x + ox, row.y);
        }
      }
    };

    // chromatic split
    ctx.globalCompositeOperation = 'lighter';
    pass(-d, '#ff1f4b', 0.75);
    pass(d, '#1fe4ff', 0.75);
    ctx.globalCompositeOperation = 'source-over';

    // main pass, sliced when glitching
    if (moment || ex > 0) {
      const bands = 7;
      const h = L.bottom - L.top + size * 0.4;
      for (let b = 0; b < bands; b++) {
        const y0 = L.top - size * 0.2 + (b / bands) * h;
        const off = (hash(l.seed, b, Math.floor(t * 20)) - 0.5) * ((moment ? 60 : 0) + ex * 140) * u;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y0, g.W, h / bands + 1);
        ctx.clip();
        pass(off, null, 1);
        ctx.restore();
      }
    } else pass(0, null, 1);

    // block cursor
    let last: { x: number; y: number } | null = null;
    let typing = false;
    for (const row of L.rows)
      for (const gl of row.glyphs) {
        const age = t - gl.tg;
        if (age >= 0) last = { x: L.left + gl.x + gl.w, y: row.y };
        if (age < RESOLVE) typing = true;
      }
    if (last && (typing || beat.phase < 0.5) && ex < 0.5) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pal.accent;
      ctx.fillRect(last.x + size * 0.08, last.y - size * 0.42, size * 0.42, size * 0.84);
    }

    // sub
    if (l.sub) {
      const n = Math.floor(clamp((l.age - 0.25) / 0.6) * l.sub.length);
      if (n > 0) {
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = pal.accent2;
        ctx.font = font(400, 26 * u, F_MONO);
        ctx.fillText('> ' + l.sub.slice(0, n) + (n < l.sub.length ? '_' : ''), L.left, L.bottom + 26 * u);
      }
    }
    ctx.restore();
  }

  function timecode(t: number) {
    const f = Math.floor((t % 1) * 30);
    const s = Math.floor(t);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`;
  }

  const style: MotionStyle = {
    id: 'glitch',
    name: 'GLITCH',
    description: 'スクランブル・デコードで文字が確定。RGBずれ、スライス、ノイズ、端末風HUD。',
    color: '#1fe4ff',
    exitDuration: 0.35,
    transition: 'glitchcut',
    hideHud: true,
    fonts: ['400 "DotGothic16"', '400 "Share Tech Mono"'],
    post: { bloom: 0.3, bloomThreshold: 0.65, chroma: 3, scanline: 0.18, grain: 0.12, glitch: 0.03, vignette: 0.45, saturation: 0.9, contrast: 1.08 },
    camera: { cut: true, shotBars: 1, pool: ['bust', 'face', 'left', 'right', 'full', 'tilt'], effects: ['slice'], bounce: 0.6, grade: 0.6, bgDim: 0.35 },
    postFx(g, post) {
      const moment = hash(Math.floor(g.t * 8), 99) < 0.07;
      post.glitch += (g.beat.downPulse * 0.45 + (moment ? 0.25 : 0)) * g.intensity;
      post.chroma += g.beat.pulse * 4 * g.intensity;
    },
    background(g) {
      if (g.hasBackground) return;
      const { ctx, W, H, u, pal, t } = g;
      ctx.fillStyle = mix(pal.bg, '#000000', 0.3);
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = rgba(pal.text, 0.07);
      const step = 40 * u;
      for (let x = step / 2; x < W; x += step) for (let y = step / 2; y < H; y += step) ctx.fillRect(x, y, 1.5 * u, 1.5 * u);
      const f = Math.floor(t * 30);
      for (let i = 0; i < 50; i++) {
        ctx.fillStyle = rgba(pal.text, 0.02 + hash(i, f, 2) * 0.07);
        ctx.fillRect(0, hash(i, f) * H, W, (1 + hash(i, f, 3) * 2) * u);
      }
    },
    backDecor(g) {
      const { ctx, W, H, u, pal, t, beat } = g;
      ctx.save();
      // glitch blocks
      const q = Math.floor(beat.beat * 4);
      for (let i = 0; i < 7; i++) {
        if (hash(q, i, 1) > 0.55) continue;
        ctx.globalAlpha = 0.08 + 0.3 * hash(q, i, 6);
        ctx.fillStyle = i % 2 ? pal.accent : pal.accent2;
        ctx.fillRect(hash(q, i, 2) * W, hash(q, i, 3) * H, (0.05 + hash(q, i, 4) * 0.3) * W, (2 + hash(q, i, 5) * 28) * u);
      }
      // data streams
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = pal.accent2;
      ctx.font = font(400, 14 * u, F_MONO);
      ctx.textBaseline = 'top';
      const lh = 20 * u;
      const scroll = (t * 60 * u) % lh;
      const base = Math.floor((t * 60 * u) / lh);
      for (let i = -1; i < H / lh + 1; i++) {
        const n = base + i;
        const hex = Math.floor(hash(n, 7) * 0xffffffff).toString(16).padStart(8, '0').toUpperCase();
        ctx.fillText(`0x${hex}`, 44 * u, i * lh - scroll + 80 * u);
        const hex2 = Math.floor(hash(n, 9) * 0xffffff).toString(2).padStart(24, '0').slice(0, 12);
        ctx.fillText(hex2, W - 170 * u, H - (i * lh - scroll) - 80 * u);
      }
      // scan bar
      const sy = ((t * 0.35) % 1) * H;
      const gr = ctx.createLinearGradient(0, sy - 90 * u, 0, sy);
      gr.addColorStop(0, rgba(pal.accent2, 0));
      gr.addColorStop(1, rgba(pal.accent2, 0.12));
      ctx.globalAlpha = 1;
      ctx.fillStyle = gr;
      ctx.fillRect(0, sy - 90 * u, W, 90 * u);
      ctx.fillStyle = rgba(pal.accent2, 0.4);
      ctx.fillRect(0, sy, W, 1.5 * u);
      ctx.restore();
    },
    line: drawLine,
    overlay(g) {
      const { ctx, W, H, u, pal, t, beat, audio } = g;
      ctx.save();
      const m = 40 * u;
      ctx.font = font(400, 20 * u, F_MONO);
      ctx.textBaseline = 'middle';
      ctx.fillStyle = pal.text;
      ctx.globalAlpha = 0.85;
      // REC
      ctx.textAlign = 'left';
      if (beat.phase < 0.6) {
        ctx.fillStyle = '#ff2a3d';
        ctx.beginPath();
        ctx.arc(m + 8 * u, m + 8 * u, 7 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = pal.text;
      ctx.fillText(`REC  CH-${String(g.segIndex + 1).padStart(2, '0')}  ${g.title.toUpperCase()}`, m + 24 * u, m + 8 * u);
      ctx.textAlign = 'right';
      ctx.fillText(timecode(Math.max(0, t)), W - m, m + 8 * u);
      ctx.fillText(`BPM ${Math.round(beat.bpm)} // BAR ${String(Math.max(0, beat.bar + 1)).padStart(3, '0')}.${beat.inBar + 1}`, W - m, H - m);
      ctx.textAlign = 'left';
      ctx.fillText(`SIG`, m, H - m);
      const blocks = 12;
      const lv = Math.round(audio.level * blocks);
      for (let i = 0; i < blocks; i++) {
        ctx.globalAlpha = i < lv ? 0.9 : 0.2;
        ctx.fillStyle = i < lv ? (i > 9 ? '#ff2a3d' : pal.accent2) : pal.text;
        ctx.fillRect(m + 50 * u + i * 13 * u, H - m - 8 * u, 9 * u, 16 * u);
      }
      // brackets
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = pal.text;
      ctx.lineWidth = 1.5 * u;
      const s = 26 * u, mm = 18 * u;
      for (const [x, y, sx, sy] of [[mm, mm, 1, 1], [W - mm, mm, -1, 1], [mm, H - mm, 1, -1], [W - mm, H - mm, -1, -1]] as const) {
        ctx.beginPath();
        ctx.moveTo(x + sx * s, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * s);
        ctx.stroke();
      }
      ctx.restore();
    },
  };

  api.registerStyle(style);
};
