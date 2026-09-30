// Editing without REC (dev server running): timeline double-click placement, key rewrite of the selection,
// lyric / telop placement, per-line lyric style, playback speed.
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import path from 'node:path';
import os from 'node:os';

const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};
await page.goto('http://localhost:5178/?demo=0');
await page.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function', null, { timeout: 30000 });
await page.evaluate(async () => {
  const app = window.app;
  await app.setAudioFile(await (await fetch('/test-song')).blob(), 'music_bgm_200.wav');
  app.mutate((p) => { p.settings.bpm = 200; p.settings.eventSnap = 0; p.telops = p.telops.map((t) => ({ ...t, start: null, dur: null })); });
  app.pause();
  app.seek(0);
  // exact clicked times: no beat snapping, zoomed in (1 px = 5 ms)
  const tl = window.timeline;
  tl.snap = false;
  tl.pps = 200;
  tl.start = 0;
  tl.invalidate?.();
});
await page.waitForTimeout(500);

// screen position of time t on a timeline row
const at = (row, t, dy = 0.5) => page.evaluate(({ row, t, dy }) => {
  const tl = window.timeline, r = tl.row(row), box = tl.canvas.getBoundingClientRect();
  return { x: box.left + tl.x(t), y: box.top + r.y + r.h * dy };
}, { row, t, dy });
const dbl = async (row, t, dy) => {
  const p = await at(row, t, dy);
  await page.mouse.dblclick(p.x, p.y);
  await page.waitForSelector('.popup-menu', { timeout: 3000 });
};
const pick = async (text) => {
  await page.click(`.popup-menu .pm-item:has-text("${text}")`);
  await page.waitForTimeout(200);
};

// ---- FX lane: double-click → menu → placed at that time and selected
await dbl('fx', 3.0);
await pick('フラッシュ');
let fx = await page.evaluate(() => ({ list: window.app.project.fxEvents.map((e) => `${e.fx}@${e.time.toFixed(2)}`), sel: window.app.selection, mode: window.app.mode }));
check('FX placed by double-click', fx.list.length === 1 && fx.list[0].startsWith('flash@') && Math.abs(parseFloat(fx.list[0].split('@')[1]) - 3.0) < 0.05, JSON.stringify(fx.list));
check('placed element is selected and its track armed', fx.sel?.type === 'ev' && fx.sel.track === 'fx' && fx.mode === 'fx');
// ---- key rewrites the selected element (stopped, no REC)
await page.keyboard.press('KeyW');
await page.waitForTimeout(200);
fx = await page.evaluate(() => window.app.project.fxEvents.map((e) => `${e.fx}@${e.time.toFixed(2)}`));
check('key rewrites the selected FX (time kept)', fx.length === 1 && !fx[0].startsWith('flash@') && fx[0].endsWith('@3.00'), JSON.stringify(fx));
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
fx = await page.evaluate(() => window.app.project.fxEvents.map((e) => e.fx));
check('undo restores the value', fx[0] === 'flash', JSON.stringify(fx));

// ---- chara lane
await dbl('chara', 5.0);
await pick('右');
const ch = await page.evaluate(() => window.app.project.charaEvents.map((e) => `${e.kind}:${e.value}@${e.time.toFixed(1)}`));
check('CHARA position placed', ch.includes('pos:right@5.0'), JSON.stringify(ch));
await page.keyboard.press('KeyA');
await page.waitForTimeout(200);
check('key rewrites the chara event', (await page.evaluate(() => window.app.project.charaEvents.map((e) => `${e.kind}:${e.value}`))).includes('pos:left'));

// ---- lyrics lane: next glyph at the clicked time
await dbl('lyrics', 2.0, 0.75);
await pick('次の1文字');
const ly = await page.evaluate(() => window.app.project.lines[0].times[0]);
check('lyric glyph placed', ly != null && Math.abs(ly - 2.0) < 0.05, String(ly));
// ---- telop lane
await dbl('telop', 1.0);
await pick('1.');
const tp = await page.evaluate(() => window.app.project.telops[0].start);
check('telop placed', tp != null && Math.abs(tp - 1.0) < 0.05, String(tp));

// ---- per-line lyric style: event at the line start + the previous style back at the next line
const ls = await page.evaluate(async () => {
  const app = window.app;
  app.mutate((p) => { p.lines[1].times = p.lines[1].times.map((_, k) => 6 + k * 0.1); });
  await new Promise((r) => setTimeout(r, 300));
  app.setLineStyle(0, 'neon');
  await new Promise((r) => setTimeout(r, 300));
  return app.project.lyricStyleEvents.map((e) => `${e.style}@${e.time.toFixed(1)}`);
});
check('line style set for one line', ls.some((x) => x.startsWith('neon@2.0')) && ls.some((x) => x.endsWith('@6.0') && !x.startsWith('neon')), JSON.stringify(ls));

// ---- bulk quantize to a chosen note value (BPM 200: 8th note = 0.15 s)
await page.evaluate(() => window.app.mutate((p) => { p.lines[2].times = p.lines[2].times.map((_, k) => 20.07 + k * 0.11); }));
await page.selectOption('#selQuantizeAll', '8');
await page.waitForTimeout(200);
const qt = await page.evaluate(() => window.app.project.lines[2].times);
const off = await page.evaluate(() => window.app.settings.offset);
check('bulk quantize to 8th notes', qt.every((x) => Math.abs(((x - off) / 0.15) - Math.round((x - off) / 0.15)) < 1e-6), JSON.stringify(qt.map((x) => +x.toFixed(3))));

// ---- replace a 立ち絵's image: same entry (recorded switches, face / size / offsets kept), undo / redo swap the image back
const png = (w, h, color, name) => page.evaluate(async ({ w, h, color, name }) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(w * 0.2, h * 0.05, w * 0.6, h * 0.9); // transparent margins are trimmed on load
  window.__files ??= {};
  window.__files[name] = await new Promise((r) => c.toBlob((b) => r(new File([b], name, { type: 'image/png' })), 'image/png'));
}, { w, h, color, name });
await png(300, 800, '#e05080', 'old.png');
await png(500, 700, '#50a0e0', 'new.png');
const charState = () => page.evaluate(() => {
  const app = window.app, c = app.project.characters[0], a = app.charAssets.get(c?.id);
  return { id: c?.id, name: c?.name, media: c?.media ?? null, faceY: c?.faceY, scale: c?.scale, offsetX: c?.offsetX, size: a ? `${a.img.width}x${a.img.height}` : null, events: app.project.charaEvents.map((e) => `${e.kind}:${e.value === c?.id ? 'ID' : e.value}`).join() };
});
const beforeRep = await page.evaluate(async () => {
  const app = window.app;
  await app.addCharacterFile(window.__files['old.png']);
  const c = app.project.characters[0];
  app.mutate((p) => {
    Object.assign(p.characters[0], { faceY: 0.33, scale: 1.2, offsetX: 0.1 });
    p.charaEvents = [{ id: 'k1', time: 1, kind: 'char', value: c.id }, { id: 'k2', time: 2, kind: 'effect', value: 'glow' }];
  });
});
void beforeRep;
await page.waitForTimeout(300);
const s0 = await charState();
check('card has a 差し替え button', await page.evaluate(() => [...document.querySelectorAll('#leftPanel .asset button')].some((b) => b.textContent === '差し替え')));
// drop the new image on the card
await page.evaluate(() => {
  const card = [...document.querySelectorAll('#leftPanel .asset')].find((el) => el.textContent.includes('old.png'));
  const dt = new DataTransfer();
  dt.items.add(window.__files['new.png']);
  card.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await page.waitForFunction(() => window.app.project.characters[0].name === 'new.png', null, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(300);
const s1 = await charState();
const count1 = await page.evaluate(() => window.app.project.characters.length);
check('drop on the card replaces the image (same entry)', s1.id === s0.id && s1.name === 'new.png' && s1.media && s1.size !== s0.size && count1 === 1, JSON.stringify([s0, s1]));
check('replace keeps recorded switches and settings', s1.events === s0.events && s1.events.includes('char:ID') && s1.faceY === 0.33 && s1.scale === 1.2 && s1.offsetX === 0.1, JSON.stringify(s1));
await page.evaluate(() => window.app.undo());
await page.waitForFunction((sz) => { const a = window.app.charAssets.get(window.app.project.characters[0].id); return a && `${a.img.width}x${a.img.height}` === sz; }, s0.size, { timeout: 5000 }).catch(() => {});
const s2 = await charState();
check('undo brings the old image back', s2.name === 'old.png' && s2.media === null && s2.size === s0.size, JSON.stringify(s2));
await page.evaluate(() => window.app.redo());
await page.waitForFunction((sz) => { const a = window.app.charAssets.get(window.app.project.characters[0].id); return a && `${a.img.width}x${a.img.height}` === sz; }, s1.size, { timeout: 5000 }).catch(() => {});
const s3 = await charState();
check('redo brings the new image back', s3.name === 'new.png' && s3.media === s1.media && s3.size === s1.size, JSON.stringify(s3));
// a song dropped on the card is not taken as an image (it falls through to the page-wide drop)
const nonImage = await page.evaluate(() => {
  const card = [...document.querySelectorAll('#leftPanel .asset')].find((el) => el.textContent.includes('new.png'));
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(64)], 'song.wav', { type: 'audio/wav' }));
  const ev = new DragEvent('drop', { dataTransfer: dt, bubbles: false, cancelable: true });
  card.dispatchEvent(ev);
  return { taken: ev.defaultPrevented, name: window.app.project.characters[0].name };
});
check('a non-image drop on the card is left to the page', !nonImage.taken && nonImage.name === 'new.png', JSON.stringify(nonImage));
// loading a project whose entry points at another image of the same id reloads that image
const loaded = await page.evaluate(async () => {
  const app = window.app, p = JSON.parse(JSON.stringify(app.project));
  delete p.characters[0].media; // the image before the replacement (still in this browser)
  await app.loadProjectFile(new File([JSON.stringify(p)], 'p.json', { type: 'application/json' }));
  const c = app.project.characters[0], a = app.charAssets.get(c.id);
  return { media: c.media ?? null, size: a ? `${a.img.width}x${a.img.height}` : null };
});
check('a loaded project gets the image it points at', loaded.media === null && loaded.size === s0.size, JSON.stringify(loaded));
// an entry whose image is missing (e.g. another browser) is re-linked by replacing it, keeping its switches
const relink = await page.evaluate(async () => {
  const app = window.app;
  app.mutate((p) => p.characters.push({ id: 'lost1', name: 'lost.png', mime: 'image/png', faceY: 0.2, scale: 1, offsetX: 0, offsetY: 0, flip: false, enabled: true }));
  app.emit('assets'); // as after loading a project whose image is not in this browser
  await new Promise((r) => setTimeout(r, 300));
  const missingShown = [...document.querySelectorAll('#leftPanel .asset')].some((el) => el.textContent.includes('lost.png') && el.textContent.includes('未読込'));
  await app.replaceCharacterImage('lost1', window.__files['old.png']);
  const loaded = !!app.charAssets.get('lost1');
  app.undo();
  await new Promise((r) => setTimeout(r, 500));
  const afterUndo = !!app.charAssets.get('lost1');
  app.redo();
  await new Promise((r) => setTimeout(r, 500));
  return { missingShown, loaded, afterUndo, afterRedo: !!app.charAssets.get('lost1') };
});
check('missing image re-linked by replacing (undo / redo follow)', relink.missingShown && relink.loaded && !relink.afterUndo && relink.afterRedo, JSON.stringify(relink));

// ---- playback speed
await page.selectOption('#selRate', '0.75');
await page.waitForFunction(() => window.app.engine.rate === 0.75, null, { timeout: 60000 }).catch(() => {});
const rate = await page.evaluate(async () => {
  const app = window.app;
  app.seek(10);
  await app.play();
  await new Promise((r) => setTimeout(r, 300));
  const a = app.time, ca = app.engine.ctx.currentTime;
  await new Promise((r) => setTimeout(r, 1200));
  const b = app.time, cb = app.engine.ctx.currentTime;
  app.pause();
  return { rate: app.engine.rate, perCtx: (b - a) / (cb - ca) };
});
check('playback speed 0.75×', rate.rate === 0.75 && Math.abs(rate.perCtx - 0.75) < 0.05, JSON.stringify(rate));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(fails ? 1 : 0);
