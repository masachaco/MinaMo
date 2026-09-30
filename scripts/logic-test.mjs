// Logic tests for lyrics tapping, run in the browser through the Vite dev server.
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import path from 'node:path';
import os from 'node:os';
const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
await page.goto('http://localhost:5178/test.html?style=kinetic&char=0');
const res = await page.evaluate(async () => {
  const L = await import('/src/core/lyrics.ts');
  const lib = await import('/src/engine/lib.ts');
  const out = [];
  const ok = (name, cond, extra = '') => out.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
  let lines = L.reconcileLines([], '夜を/駆け抜けて | Run\nabc/def\n君の声');
  ok('glyph counts', lines.map((l) => l.times.length).join() === '7,6,3', lines.map((l) => l.times.length).join());
  const tg = L.tapTargets(lines);
  ok('targets', tg.length === 16);
  let cur = 0, r;
  // 3 single taps
  for (let i = 0; i < 3; i++) { r = L.assignTap(lines, tg, cur, 1 + i * 0.1, 'glyph'); lines = r.lines; cur = r.next; }
  ok('glyph taps', lines[0].times.slice(0, 3).join() === '1,1.1,1.2' && cur === 3, lines[0].times.join());
  // chunk tap from mid-chunk (cursor at glyph 3 = start of chunk 2 "駆け抜けて"? chunk0 = 夜を (2), so glyph 3 is mid chunk 1)
  r = L.assignTap(lines, tg, cur, 2, 'chunk'); lines = r.lines; cur = r.next;
  ok('chunk skips to next chunk boundary', r.next === 10 && lines[1].times[0] === 2, `next=${r.next} line1=${lines[1].times.join()}`);
  // line tap
  r = L.assignTap(lines, tg, cur, 3, 'line'); lines = r.lines; cur = r.next;
  ok('line tap -> next line start', cur === 16 && lines[2].times[0] === 3 && lines[2].times[1] === null, `cur=${cur}`);
  // punch-in: re-tap line 0 glyph 0 at 5 clears later earlier times
  r = L.assignTap(lines, tg, 0, 5, 'glyph'); lines = r.lines;
  ok('punch-in clears later', lines[0].times[1] === null && lines[1].times[0] === null && lines[2].times[0] === null);
  // firstTargetAfter skips untapped rest of a started line
  let l2 = L.reconcileLines([], 'あいう\nえお');
  const tg2 = L.tapTargets(l2);
  l2 = L.assignTap(l2, tg2, 0, 1, 'line').lines;
  ok('resume after started line', L.firstTargetAfter(l2, tg2, 2) === 3, String(L.firstTargetAfter(l2, tg2, 2)));
  ok('resume before line', L.firstTargetAfter(l2, tg2, 0.5) === 0);
  // resolveTimes spreads auto glyphs between taps
  const rt = lib.resolveTimes([0, null, null, 0.3], 0, 0.2);
  ok('resolveTimes spread', rt.times.map((x) => x.toFixed(2)).join() === '0.00,0.10,0.20,0.30', rt.times.join());
  // reconcile keeps timings when a line is inserted
  const kept = L.reconcileLines(l2, 'new line\nあいう\nえお');
  ok('reconcile insert keeps', kept[1].times[0] === 1 && kept[0].times[0] === null, kept.map((l) => l.times[0]).join());
  // migration of v0 projects (single style track + shot camera events)
  const P = await import('/src/core/project.ts');
  const legacy = { settings: { defaultStyle: 'neon' }, lines: [], styleEvents: [{ id: 'a', time: 3, style: 'pop' }],
    camEvents: [{ id: 'c1', time: 1, shot: 'face' }, { id: 'c2', time: 2, shot: 'left' }, { id: 'c3', time: 4, shot: 'hide' }] };
  const m = P.normalizeProject(legacy);
  ok('migrate styles', m.settings.lyricStyle === 'neon' && m.settings.lookStyle === 'neon' && m.lyricStyleEvents.length === 1 && m.lookEvents.length === 1 && !('styleEvents' in m));
  ok('migrate camera', m.camEvents.length === 1 && m.camEvents[0].kind === 'frame' && m.charaEvents.length === 2, JSON.stringify(m.charaEvents));
  // channel merge: recorded value holds, 'auto' hands back to the director
  const Ch = await import('/src/engine/channels.ts');
  const merged = Ch.mergeChannel([{ t: 0, v: 'A', smooth: false, rec: false }, { t: 4, v: 'B', smooth: false, rec: false }, { t: 8, v: 'C', smooth: false, rec: false }],
    [{ t: 2, v: 'X', smooth: true }, { t: 6, v: 'auto', smooth: true }], 'A');
  ok('channel merge', merged.map((s) => `${s.t}:${s.v}`).join(',') === '0:A,2:X,6:B,8:C', merged.map((s) => `${s.t}:${s.v}`).join(','));
  // defaults: no automatic direction until 'auto' is recorded
  const Comp = await import('/src/engine/compile.ts');
  const proj = P.newProject();
  proj.characters = [{ id: 'A', name: 'a', mime: '', faceY: 0.2, scale: 1, flip: false, enabled: true }, { id: 'B', name: 'b', mime: '', faceY: 0.2, scale: 1, flip: false, enabled: true }];
  proj.backgrounds = [{ id: 'bg1', name: 'x', mime: '', kind: 'image' }, { id: 'bg2', name: 'y', mime: '', kind: 'image' }];
  proj.lookEvents = [{ id: 'l', time: 20, kind: 'style', value: 'neon' }];
  let C = Comp.compileProject(proj, 60, 1920, 1080);
  const vals = (steps) => [...new Set(steps.map((s) => JSON.stringify(s.v)))].join('|');
  ok('default stage is fixed', vals(C.stage.char) === '"A"' && vals(C.stage.pos) === '"center"' && vals(C.stage.frame) === '"full"' && vals(C.stage.move) === '"static"' && vals(C.stage.motion) === '"idle"' && vals(C.stage.effect) === '[]',
    [vals(C.stage.char), vals(C.stage.pos), vals(C.stage.frame), vals(C.stage.move), vals(C.stage.motion), vals(C.stage.effect)].join(' / '));
  ok('default background fixed across sections', Comp.bgIndexAt(C, 5, 2) === 0 && Comp.bgIndexAt(C, 25, 2) === 0);
  ok('visualizer off by default', vals(C.viz.type) === '"none"');
  // element effects / motions (lyrics / telop): none / 静止 until recorded; unknown ids kept; stacking = registration order
  ok('lyric / telop effects and motions off by default', vals(C.elem.lyrics.effect) === '[]' && vals(C.elem.lyrics.motion) === '"idle"' && vals(C.elem.telop.effect) === '[]' && vals(C.elem.telop.motion) === '"idle"',
    [vals(C.elem.lyrics.effect), vals(C.elem.lyrics.motion), vals(C.elem.telop.effect), vals(C.elem.telop.motion)].join(' / '));
  const bare = P.normalizeProject({ settings: {}, lines: [] });
  ok('normalize adds the element event lists', Array.isArray(bare.lyricEvents) && Array.isArray(bare.telopEvents));
  ok('parseEffects keeps unknown ids, drops duplicates', Comp.parseEffects('glow, foo,glow,').join() === 'glow,foo', Comp.parseEffects('glow, foo,glow,').join());
  const elP = P.newProject();
  elP.lyricEvents = [{ id: 'a', time: 2, kind: 'effect', value: 'outline,glow' }, { id: 'b', time: 3, kind: 'motion', value: 'sway' }, { id: 'c', time: 5, kind: 'effect', value: '' }];
  elP.telopEvents = [{ id: 'd', time: 1, kind: 'motion', value: 'not-loaded' }];
  const elC = Comp.compileProject(elP, 60, 1920, 1080);
  const at = (steps, t) => Ch.stateAt(steps, t)?.v;
  ok('lyric effect / motion channels', at(elC.elem.lyrics.effect, 2.5).join() === 'outline,glow' && at(elC.elem.lyrics.motion, 4) === 'sway' && at(elC.elem.lyrics.effect, 6).length === 0 && at(elC.elem.telop.motion, 2) === 'not-loaded');
  const E = await import('/src/engine/elements.ts');
  const act = E.activeEffects(elC.elem.lyrics.effect, 2.5, 'lyrics', (v) => v);
  ok('effects stack in registration order (glow → outline), since kept', act.map((a) => a.def.id).join() === 'glow,outline' && act.every((a) => a.since === 2), act.map((a) => `${a.def.id}@${a.since}`).join());
  const beat = { bpm: 120, spb: 0.5, beatsPerBar: 4, beat: 2, index: 2, phase: 0, bar: 0, barPhase: 0.5, inBar: 2, pulse: 1, downPulse: 0, halfPulse: 1 };
  const mc = { target: 'lyrics', t: 1, age: 1, beat, audio: { level: 0, bass: 0, high: 0, spectrum: new Float32Array(64), wave: new Float32Array(256) }, u: 1, amount: 1.5, seed: 3 };
  const bo = E.motionOffsets('bounce', mc);
  ok('bounce motion hops on the beat', bo.dy < -8 && bo.sx > 1, JSON.stringify(bo));
  ok('unknown motion = no offsets', JSON.stringify(E.motionOffsets('not-loaded', mc)) === JSON.stringify({ dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, alpha: 1 }));
  // derived images (silhouette per color...) are capped per sprite, least recently used dropped first
  const A = await import('/src/engine/assets.ts');
  const spr = { img: lib.makeCanvas(8, 8), cache: new Map() };
  A.silhouette(spr, 'red');
  for (let i = 0; i < 40; i++) {
    A.silhouette(spr, `hsl(${i * 9},80%,50%)`); // an effect painting a new color every frame
    A.silhouette(spr, 'red'); // one in steady use
  }
  ok('derived images capped per sprite (LRU keeps the one in use)', spr.cache.size <= 16 && spr.cache.has('sil:red') && spr.cache.has('sil:hsl(351,80%,50%)') && !spr.cache.has('sil:hsl(0,80%,50%)'), `${spr.cache.size} ${[...spr.cache.keys()].slice(0, 3)}`);
  // telops
  const T = await import('/src/core/telops.ts');
  const pt = T.parseTelops('# c\n[名前] Minamo | Vocal\nplain caption\n[chapter] CHORUS');
  ok('telop parse (alias / default / id)', pt.map((x) => x.template).join() === 'lower,caption,chapter' && pt[0].sub === 'Vocal', pt.map((x) => x.template).join());
  {
    const A = await import('/src/engine/api.ts');
    A.registerTelop({ id: 'MyCap', name: 'マイ字幕', color: '#fff', bars: 2, draw() {} });
    const byName = T.parseTelopLine('[マイ字幕] x').template, byId = T.parseTelopLine('[mycap] x').template;
    ok('plugin telop by registered name or id (any case)', A.findTelop(byName)?.id === 'MyCap' && A.findTelop(byId)?.id === 'MyCap', `${byName} ${byId}`);
  }
  let tl = T.reconcileTelops([], '[名前] A\n[字幕] B');
  tl = T.assignTelop(tl, 1, 5);
  tl = T.reconcileTelops(tl, '[チャプター] NEW\n[名前] A\n[字幕] B');
  ok('telop reconcile keeps timing', tl[2].start === 5 && tl[0].start === null);
  const np = P.newProject();
  ok('new project has a title telop at 0s', np.telops.length === 1 && np.telops[0].template === 'title' && np.telops[0].start === 0);
  const leg = P.normalizeProject({ settings: { intro: true }, lines: [] });
  const legOff = P.normalizeProject({ settings: { intro: false }, lines: [] });
  ok('legacy intro → title telop', leg.telops[0]?.start === 0 && legOff.telops[0]?.start === null && !('intro' in leg.settings));
  np.settings.bpm = 120;
  const CT = Comp.compileProject(np, 60, 1920, 1080);
  // look style transition: style default / none / override
  const trP = P.newProject();
  trP.lookEvents = [
    { id: 'a', time: 5, kind: 'style', value: 'minimal' },
    { id: 'b', time: 10, kind: 'style', value: 'minimal', transition: 'none' },
    { id: 'c', time: 15, kind: 'style', value: 'kinetic', transition: 'glitchcut' },
  ];
  trP.lookEvents[1].value = 'neon';
  const trC = Comp.compileProject(trP, 60, 1920, 1080);
  const trs = trC.fx.map((f) => `${f.id}@${Math.round(f.start + (f.def.lead ?? 0))}`).join(',');
  ok('look transition default / none / override', trs === 'slidewipe@5,glitchcut@15', trs);
  ok('telop default length = template bars', Math.abs(CT.telops[0].dur - 4 * 2) < 1e-6 && CT.telops[0].text === np.settings.title, `${CT.telops[0].dur} ${CT.telops[0].text}`);
  proj.charaEvents = [{ id: 'e1', time: 10, kind: 'char', value: 'auto' }];
  proj.camEvents = [{ id: 'e2', time: 10, kind: 'frame', value: 'auto' }];
  C = Comp.compileProject(proj, 60, 1920, 1080);
  const before10 = C.stage.frame.filter((s) => s.t < 10).map((s) => s.v);
  const after10 = C.stage.frame.filter((s) => s.t >= 10);
  ok('recorded auto opts into the director', before10.every((v) => v === 'full') && after10.some((s) => !s.rec) && new Set(after10.map((s) => s.v)).size > 1, `${before10.join()} | ${after10.map((s) => s.v).join()}`);
  // row layout (KINETIC): even rows for auto chunks, author "/" chunks kept as rows
  const Sh = await import('/src/engine/helpers.ts');
  const rowsOf = (raw) => {
    const [line] = L.reconcileLines([], raw);
    const l = {
      text: line.text, start: 0, manualChunks: line.raw.includes('/'),
      chunks: line.chunks.map((c, i) => { const g = lib.graphemes(c); return { index: i, text: c, glyphs: g, gt: g.map(() => 0), gtap: g.map(() => false) }; }),
    };
    return Sh.makeRows(l, { maxRows: 3, maxLen: 7, perChunk: true, stagger: 0.03 }).map(Sh.rowText);
  };
  const even = rowsOf('忘れないでいつまでもここにいるよ');
  const lens = even.map((r) => r.length);
  ok('rows balanced', even.length === 3 && Math.max(...lens) / Math.min(...lens) <= 1.25, even.join('|'));
  ok('author chunks stay rows', rowsOf('今/この瞬間を/刻め').join('|') === '今|この瞬間を|刻め', rowsOf('今/この瞬間を/刻め').join('|'));
  // text drawn on the plate layer uses the text layer's font (outline rows were 10px with readability correction on)
  const mk2 = () => document.createElement('canvas').getContext('2d');
  const pg = { ctx: mk2(), plate: mk2() };
  pg.ctx.font = '900 80px sans-serif'; pg.ctx.textAlign = 'center'; pg.ctx.textBaseline = 'middle';
  let plateFont = '';
  lib.onPlate(pg, (pl) => { plateFont = `${pl.font}|${pl.textAlign}|${pl.textBaseline}`; });
  ok('onPlate copies text state', plateFont.includes('80px') && plateFont.endsWith('center|middle'), plateFont);
  // MMD: early format (model folder on the character entry) migrates to a model + entry
  const oldMmd = P.normalizeProject({ settings: {}, lines: [], poseEvents: [{ id: 'x', time: 1, value: 'rest' }], mmdClips: [],
    characters: [{ id: 'c9', name: 'm.pmd', mime: 'model/mmd', kind: 'mmd', model: 'm.pmd', files: ['m.pmd', 'a.bmp'], faceY: 0.2, scale: 1, flip: false, enabled: true }] });
  const oc = oldMmd.characters[0];
  ok('mmd migration', oldMmd.mmdModels.length === 1 && oldMmd.mmdModels[0].id === 'c9' && oldMmd.mmdModels[0].files.length === 2 && oc.mmdModel === 'c9' && !('files' in oc) && !('poseEvents' in oldMmd), JSON.stringify(oldMmd.mmdModels));
  const MM = await import('/src/engine/mmd-files.ts');
  ok('mmd path keys', MM.normPath('Tex\\Hair.BMP') === 'tex/hair.bmp' && MM.normPath('./a/../b/c.png') === 'b/c.png', MM.normPath('Tex\\Hair.BMP'));
  ok('pre-noun joins the next word', L.reconcileLines([], 'どこまでも続くこの道を')[0].chunks.includes('この道を'), L.reconcileLines([], 'どこまでも続くこの道を')[0].chunks.join('/'));
  return out;
});
console.log(res.join('\n'));
await browser.close();
