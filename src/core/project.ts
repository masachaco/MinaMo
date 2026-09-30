import type { CamEvent, CharacterRef, Palette, Project, ProjectSettings } from './types';
import { glyphCount, reconcileLines } from './lyrics';
import { DEFAULT_TELOP_TEXT, reconcileTelops } from './telops';
import { graphemes } from '../engine/lib';
import { listPalettes } from '../engine/api';

// Palettes are registered through the plugin API (built-ins: src/plugins/palettes). This one is only the fallback
// while none is registered (the first registered palette is the default).
const FALLBACK_PALETTE: Palette = { id: 'midnight', name: 'Midnight', bg: '#07070d', text: '#ffffff', accent: '#ff2e63', accent2: '#08d9d6' };
export const defaultPalette = (): Palette => listPalettes()[0] ?? FALLBACK_PALETTE;

export function paletteOf(s: ProjectSettings): Palette {
  if (s.paletteId === 'custom') return s.customPalette;
  return listPalettes().find((p) => p.id === s.paletteId) ?? defaultPalette();
}

export const SAMPLE_LYRICS = `# 1行 = 1フレーズ（スペースキー1回）
# "/" でチャンク区切り、"|" の後ろはサブテキスト
夜を/駆け抜けて | Run through the night
君の声が/聞こえる | I can hear your voice
止まらない/鼓動の/リズム
光の/向こうへ
今/この瞬間を/刻め | Carve this moment
二度と/来ない/夜だから
叫べ/もっと/高く
世界を/塗り替えろ | Repaint the world`;

export function defaultSettings(): ProjectSettings {
  return {
    title: 'UNTITLED',
    artist: 'ARTIST',
    bpm: 120,
    beatsPerBar: 4,
    offset: 0,
    width: 1920,
    height: 1080,
    fps: 60,
    previewScale: 0.5,
    quantize: 0,
    eventSnap: 2,
    latencyMs: 0,
    lineCapBars: 4,
    shotScale: 1,
    paletteId: defaultPalette().id,
    customPalette: { ...defaultPalette(), id: 'custom', name: 'Custom' },
    bgDim: 0.25,
    textAdapt: 'off',
    hud: true,
    metronome: false,
    stopMode: 'return',
    fxIntensity: 1,
    seed: 1,
    lyricStyle: 'kinetic',
    lookStyle: 'kinetic',
  };
}

export function newProject(): Project {
  return {
    version: 1,
    settings: defaultSettings(),
    lyricsText: SAMPLE_LYRICS,
    lines: reconcileLines([], SAMPLE_LYRICS),
    telopText: DEFAULT_TELOP_TEXT,
    // the title card is an ordinary telop placed at 0s (default length), free to move or delete
    telops: reconcileTelops([], DEFAULT_TELOP_TEXT).map((t, i) => (i === 0 ? { ...t, start: 0 } : t)),
    lyricStyleEvents: [],
    lyricEvents: [],
    telopEvents: [],
    charaEvents: [],
    camEvents: [],
    fxEvents: [],
    vizEvents: [],
    lookEvents: [],
    audio: null,
    backgrounds: [],
    characters: [],
    mmdModels: [],
  };
}

/** Fill in missing fields of a loaded project (forward compatibility). */
export function normalizeProject(p: any): Project {
  const base = newProject();
  const out: Project = {
    ...base,
    ...p,
    settings: { ...base.settings, ...(p?.settings ?? {}) },
  };
  out.lines ??= [];
  out.lyricStyleEvents ??= [];
  out.lyricEvents ??= [];
  out.telopEvents ??= [];
  out.charaEvents ??= [];
  out.fxEvents ??= [];
  out.camEvents ??= [];
  out.lookEvents ??= [];
  out.mmdModels ??= [];
  out.vizEvents ??= [];
  out.backgrounds ??= [];
  out.characters ??= [];
  out.characters = out.characters.map((c) => ({ ...c, offsetX: c.offsetX ?? 0, offsetY: c.offsetY ?? 0 }));
  // early MMD format: the model folder lived on the character entry itself (same blob keys)
  for (const c of out.characters as (CharacterRef & { model?: string; files?: string[] })[]) {
    if (c.kind !== 'mmd' || !c.files) continue;
    if (!out.mmdModels.some((m) => m.id === c.id)) out.mmdModels.push({ id: c.id, name: c.name, model: c.model ?? '', files: c.files });
    c.mmdModel = c.id;
    delete c.files;
    delete c.model;
  }
  delete (out as any).poseEvents;
  delete (out as any).mmdClips;
  out.fxEvents = out.fxEvents.map((e) => ({ ...e, hold: e.hold ?? 0 }));
  const legacy = p ?? {};
  const st = out.settings as any;
  delete st.tapMode;
  // v1: automatic intro title → title telop at 0s
  if (typeof legacy.telopText !== 'string') {
    out.telopText = DEFAULT_TELOP_TEXT;
    out.telops = reconcileTelops([], DEFAULT_TELOP_TEXT).map((t, i) => (i === 0 && legacy.settings?.intro !== false ? { ...t, start: 0 } : t));
  }
  out.telops ??= [];
  delete st.intro;
  // v0: one style track drove both lyrics and look
  if (st.defaultStyle) {
    if (!p?.settings?.lyricStyle) st.lyricStyle = st.defaultStyle;
    if (!p?.settings?.lookStyle) st.lookStyle = st.defaultStyle;
    delete st.defaultStyle;
  }
  if (Array.isArray(legacy.styleEvents)) {
    for (const e of legacy.styleEvents) {
      out.lyricStyleEvents.push({ id: e.id, time: e.time, style: e.style });
      out.lookEvents.push({ id: e.id + ':look', time: e.time, kind: 'style', value: e.style });
    }
    delete (out as any).styleEvents;
  }
  // v0 camera events: { shot }
  out.camEvents = out.camEvents.flatMap((e: any): CamEvent[] => {
    if (e.kind) return [e];
    const s = String(e.shot);
    if (['full', 'bust', 'face', 'low', 'tilt'].includes(s)) return [{ id: e.id, time: e.time, kind: 'frame', value: s }];
    if (s === 'left' || s === 'right' || s === 'duo') out.charaEvents.push({ id: e.id, time: e.time, kind: 'pos', value: s });
    if (s === 'hide') out.charaEvents.push({ id: e.id, time: e.time, kind: 'char', value: 'none' });
    return [];
  });
  // migrate per-chunk timings to per-character timings
  out.lines = out.lines.map((l) => {
    const n = glyphCount(l);
    if (l.times.length === n) return l;
    const times: (number | null)[] = new Array(n).fill(null);
    if (l.times.length === l.chunks.length) {
      let k = 0;
      l.chunks.forEach((c, i) => {
        times[k] = l.times[i] ?? null;
        k += graphemes(c).length;
      });
    } else times[0] = l.times[0] ?? null;
    return { ...l, times };
  });
  return out;
}

/** Undo/redo history of timing/lyric edits (snapshots). */
export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  constructor(private limit = 150) {}

  push(p: Project) {
    const snap = JSON.stringify(p);
    if (this.undoStack[this.undoStack.length - 1] === snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  undo(current: Project): Project | null {
    const s = this.undoStack.pop();
    if (!s) return null;
    this.redoStack.push(JSON.stringify(current));
    return JSON.parse(s);
  }

  redo(current: Project): Project | null {
    const s = this.redoStack.pop();
    if (!s) return null;
    this.undoStack.push(JSON.stringify(current));
    return JSON.parse(s);
  }
}
