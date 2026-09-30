// Dev harness: renders deterministic frames without the UI (used by scripts/shot.mjs).
import '../plugins';
import { defaultPalette, newProject } from '../core/project';
import { reconcileLines } from '../core/lyrics';
import { reconcileTelops } from '../core/telops';
import type { BackgroundRef, CharacterRef, Project, VizEvent } from '../core/types';
import { analyzeAudio, type Analysis } from '../audio/analysis';
import { listCameraMoves, listEffects, listFramings, listFx, listLookStyles, listLyricStyles, listMotions, listPalettes, listStyles, listTelops, listVisualizers } from '../engine/api';
import { compileProject } from '../engine/compile';
import { ensureFonts } from '../engine/fonts';
import { Renderer } from '../engine/renderer';
import type { BgAsset, CharAsset } from '../engine/assets';
import { makeCanvas } from '../engine/lib';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') || 1280);
const H = Number(q.get('h') || 720);
const style = q.get('style') || 'kinetic';
const withChar = q.get('char') !== '0';
const withBg = q.get('bg') === '1' || q.get('bg') === 'bright';
const brightBg = q.get('bg') === 'bright';
const pal = q.get('pal') || 'midnight';

function makeChar(hue: number): HTMLCanvasElement {
  const c = makeCanvas(700, 1600);
  const x = c.getContext('2d')!;
  // legs
  x.fillStyle = '#1b1b2a';
  x.fillRect(260, 1050, 70, 500);
  x.fillRect(370, 1050, 70, 500);
  x.fillStyle = '#eee';
  x.fillRect(250, 1520, 90, 60);
  x.fillRect(360, 1520, 90, 60);
  // skirt / coat
  x.fillStyle = `hsl(${hue},55%,35%)`;
  x.beginPath();
  x.moveTo(220, 560); x.lineTo(480, 560); x.lineTo(560, 1120); x.lineTo(140, 1120); x.closePath(); x.fill();
  // arms
  x.fillStyle = `hsl(${hue},55%,30%)`;
  x.beginPath(); x.moveTo(220, 580); x.lineTo(150, 900); x.lineTo(190, 910); x.lineTo(260, 620); x.fill();
  x.beginPath(); x.moveTo(480, 580); x.lineTo(560, 900); x.lineTo(520, 910); x.lineTo(440, 620); x.fill();
  // neck/face
  x.fillStyle = '#ffe2d0';
  x.fillRect(320, 450, 60, 120);
  x.beginPath(); x.ellipse(350, 360, 120, 140, 0, 0, Math.PI * 2); x.fill();
  // hair
  x.fillStyle = `hsl(${(hue + 200) % 360},45%,22%)`;
  x.beginPath(); x.ellipse(350, 300, 150, 150, 0, Math.PI, 0); x.fill();
  x.fillRect(200, 290, 50, 330);
  x.fillRect(450, 290, 50, 330);
  // eyes
  x.fillStyle = `hsl(${hue},70%,45%)`;
  x.beginPath(); x.ellipse(305, 380, 18, 26, 0, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(395, 380, 18, 26, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff';
  x.fillRect(298, 366, 8, 8); x.fillRect(388, 366, 8, 8);
  return c;
}

function makeBrightBg(): HTMLCanvasElement {
  // left: bright sky, right: dark — text crossing both shows the per-pixel correction
  const c = makeCanvas(1920, 1080);
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 1920, 0);
  g.addColorStop(0, '#fdfbf2'); g.addColorStop(0.45, '#f2e9d8'); g.addColorStop(0.62, '#3b3450'); g.addColorStop(1, '#141024');
  x.fillStyle = g; x.fillRect(0, 0, 1920, 1080);
  return c;
}

function makeBg(): HTMLCanvasElement {
  const c = makeCanvas(1920, 1080);
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 1080);
  g.addColorStop(0, '#1d2b64'); g.addColorStop(1, '#f8cdda');
  x.fillStyle = g; x.fillRect(0, 0, 1920, 1080);
  for (let i = 0; i < 40; i++) {
    const w = 40 + (i * 37) % 90, h = 200 + (i * 131) % 500;
    const bx = (i * 53) % 1920;
    x.fillStyle = `rgba(10,10,30,${0.5 + ((i * 7) % 5) / 10})`;
    x.fillRect(bx, 1080 - h, w, h);
    x.fillStyle = 'rgba(255,230,150,0.6)';
    for (let wy = 1080 - h + 10; wy < 1070; wy += 24) for (let wx = bx + 6; wx < bx + w - 8; wx += 14) if ((wx * wy) % 7 < 3) x.fillRect(wx, wy, 6, 10);
  }
  return c;
}

async function main() {
  // ?plugin=/plugins/x.js : load a runtime plugin first (its styles / FX / telops can then be used below)
  const plug = q.get('plugin');
  if (plug) {
    const { runPlugin } = await import('../plugin-loader');
    await runPlugin(await (await fetch(plug)).text());
  }
  const p: Project = newProject();
  p.settings.title = 'SAMPLE SONG';
  p.settings.artist = 'Sample Artist';
  p.settings.bpm = 120;
  p.settings.paletteId = pal;
  p.settings.lyricStyle = q.get('lyric') || style;
  p.settings.lookStyle = style;
  if (q.get('adapt')) p.settings.textAdapt = q.get('adapt') as Project['settings']['textAdapt'];
  if (brightBg) {
    p.settings.bgDim = 0;
    p.lookEvents.push({ id: 'dim0', time: 0, kind: 'dim', value: '0' });
  }
  if (q.get('lyrics')) p.lyricsText = q.get('lyrics')!.split('~').join('\n');
  p.lines = reconcileLines([], p.lyricsText);
  p.lines.forEach((l, i) => {
    l.id = `line${i}`; // deterministic layouts across runs
    l.times[0] = 4 + i * 2;
  });
  const chars: CharAsset[] = [];
  if (withChar) {
    const refs: CharacterRef[] = [
      { id: 'c1', name: 'a', mime: 'image/png', faceY: 0.22, scale: 1, offsetX: 0, offsetY: 0, flip: false, enabled: true },
      { id: 'c2', name: 'b', mime: 'image/png', faceY: 0.22, scale: 1, offsetX: 0, offsetY: 0, flip: true, enabled: true },
    ];
    p.characters = refs;
    chars.push({ ref: refs[0], img: makeChar(330), cache: new Map() }, { ref: refs[1], img: makeChar(190), cache: new Map() });
  }
  const bgs: BgAsset[] = [];
  if (withBg) {
    const ref: BackgroundRef = { id: 'b1', name: 'bg', mime: 'image/png', kind: 'image' };
    p.backgrounds = [ref];
    const img = brightBg ? makeBrightBg() : makeBg();
    bgs.push({ ref, img, blurred: img });
  }
  const tel = q.get('tel');
  if (tel) {
    const samples: Record<string, string> = {
      title: '[タイトル] {title} | {artist}',
      lower: '[名前] 水面みなも | Vocal',
      corner: '[ラベル] #01 OPENING | 2026.09.29',
      caption: '[字幕] ここから2番が始まります | Verse 2',
      chapter: '[チャプター] CHORUS | 02',
      credit: '[クレジット] Music: masa / Lyrics: masa / Illust: someone / Movie: MinaMo | STAFF',
    };
    p.telopText = samples[tel] ?? tel;
    p.telops = reconcileTelops([], p.telopText).map((t) => ({ ...t, start: 0.5 }));
  } else if (q.get('notitle') === '1') p.telops = [];
  // ?fx=flash@4.5,shake@6 : FX events (id@seconds)
  for (const item of (q.get('fx') || '').split(',').filter(Boolean)) {
    const [fx, at] = item.split('@');
    p.fxEvents.push({ id: `fx${p.fxEvents.length}`, time: parseFloat(at) || 4, fx, hold: 0 });
  }
  // ?frame=closeup&move=push : camera framing / move from t=0 (built-in or plugin ids)
  for (const kind of ['frame', 'move'] as const) {
    const v = q.get(kind);
    if (v) p.camEvents.push({ id: `cam-${kind}`, time: 0, kind, value: v });
  }
  // ?leffect=glow,shadow&lmotion=sway : lyric effects / motion from t=0; teffect / tmotion for telops, ceffect / cmotion for characters
  for (const [pre, list] of [['l', p.lyricEvents], ['t', p.telopEvents], ['c', p.charaEvents]] as const) {
    for (const kind of ['effect', 'motion'] as const) {
      const v = q.get(pre + kind);
      if (v != null) (list as { id: string; time: number; kind: string; value: string }[]).push({ id: `${pre}-${kind}`, time: 0, kind, value: v });
    }
  }
  const viz = q.get('viz');
  if (viz) {
    const ev = (kind: VizEvent['kind'], value: string | null) => value && p.vizEvents.push({ id: kind, time: 0, kind, value });
    ev('type', viz);
    ev('pos', q.get('vpos'));
    ev('color', q.get('vcolor'));
    ev('size', q.get('vsize'));
    ev('layer', q.get('vlayer'));
  }
  let analysis: Analysis | null = null;
  if (q.get('audio') === '1') {
    const ac = new OfflineAudioContext(2, 44100, 44100);
    const buf = await ac.decodeAudioData(await (await fetch('/test-song')).arrayBuffer());
    analysis = await analyzeAudio(buf);
    p.settings.bpm = 200;
  }
  await ensureFonts(p.lines.map((l) => l.text + l.sub).join('') + p.settings.title + p.settings.artist, 15000);
  const renderer = new Renderer(W, H);
  document.body.appendChild(renderer.output);
  const compiled = compileProject(p, 60, W, H);
  (window as any).__render = (t: number) => {
    renderer.render(t, { compiled, project: p, palette: listPalettes().find((x) => x.id === pal) ?? defaultPalette(), analysis, chars, bgs, exporting: false });
    return true;
  };
  (window as any).__compiled = compiled;
  (window as any).__registry = () => ({
    styles: listStyles().map((x) => x.id), lyricStyles: listLyricStyles().map((x) => x.id), lookStyles: listLookStyles().map((x) => x.id),
    fx: listFx().map((x) => x.id), viz: listVisualizers().map((x) => x.id), telops: listTelops().map((x) => x.id),
    framings: listFramings().map((x) => x.id), moves: listCameraMoves().map((x) => x.id), palettes: listPalettes().map((x) => x.id),
    effects: listEffects().map((x) => x.id), motions: listMotions().map((x) => x.id),
  });
  (window as any).__ready = true;
}
main().catch((e) => {
  (window as any).__error = String(e?.stack || e);
});
