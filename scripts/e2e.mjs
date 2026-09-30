// End-to-end test of the MTR workflow: node scripts/e2e.mjs <outdir>
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const outDir = process.argv[2] || 'test-out';
fs.mkdirSync(outDir, { recursive: true });
const exe = chromiumPath();
// persistent profile so the browser can be restarted mid-test with the saved project / media intact
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minamo-e2e-'));
const launch = () => chromium.launchPersistentContext(userDataDir, {
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  viewport: { width: 1600, height: 1000 },
});
const logs = [];
const watch = (pg) => {
  pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  pg.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
};
let context = await launch();
let page = context.pages()[0] ?? (await context.newPage());
watch(page);
let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};
const counts = () => page.evaluate(() => {
  const p = window.app.project;
  return { lstyle: p.lyricStyleEvents.length, chara: p.charaEvents.length, cam: p.camEvents.length, fx: p.fxEvents.length, viz: p.vizEvents.length, look: p.lookEvents.length, timed: p.lines.filter((l) => l.times[0] != null).length };
});
const press = async (k, wait = 120) => { await page.keyboard.press(k); await page.waitForTimeout(wait); };
// press, then wait until song time has moved on (events of one kind at the same snapped time replace each other)
const pressMoved = async (k, dt = 0.35) => {
  const t = await page.evaluate(() => window.app.time);
  await page.keyboard.press(k);
  await page.waitForFunction(({ t, dt }) => window.app.time > t + dt, { t, dt }, { timeout: 15000 }).catch(() => {});
};
// REC, wait until the (headless, sometimes slow to start) audio clock really moves, play `fn`, stop
const rec = async (fn) => {
  const t0 = await page.evaluate(() => window.app.time);
  await press('Shift+R', 100);
  await page.waitForFunction((t0) => window.app.time > t0 + 0.2, t0, { timeout: 15000 }).catch(() => {});
  await fn();
  await press('Shift+R', 300);
};
const toStart = () => page.evaluate(() => window.app.seek(0));

await page.goto('http://localhost:5178/?demo=0');
await page.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function', null, { timeout: 30000 });
await page.evaluate(async () => {
  const app = window.app;
  const b = await (await fetch('/test-song')).blob();
  await app.setAudioFile(b, 'music_bgm_200.wav');
  app.mutate((p) => { p.settings.bpm = 200; p.settings.title = 'NIGHT DRIVE'; p.settings.artist = 'TEST'; p.settings.previewScale = 0.25; });
  const mkChar = (hue) => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 1500;
    const x = c.getContext('2d');
    x.fillStyle = `hsl(${hue},50%,35%)`; x.beginPath(); x.moveTo(170, 520); x.lineTo(430, 520); x.lineTo(520, 1100); x.lineTo(80, 1100); x.fill();
    x.fillStyle = '#222'; x.fillRect(200, 1100, 70, 380); x.fillRect(330, 1100, 70, 380);
    x.fillStyle = '#ffe2d0'; x.beginPath(); x.ellipse(300, 330, 115, 135, 0, 0, 7); x.fill();
    x.fillStyle = `hsl(${(hue + 180) % 360},40%,25%)`; x.beginPath(); x.ellipse(300, 280, 145, 140, 0, Math.PI, 0); x.fill();
    return new Promise((r) => c.toBlob((bl) => r(new File([bl], `chara${hue}.png`, { type: 'image/png' })), 'image/png'));
  };
  const mkBg = (hue) => {
    const c = document.createElement('canvas'); c.width = 960; c.height = 540;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 540); g.addColorStop(0, `hsl(${hue},60%,25%)`); g.addColorStop(1, `hsl(${hue + 60},60%,60%)`);
    x.fillStyle = g; x.fillRect(0, 0, 960, 540);
    return new Promise((r) => c.toBlob((bl) => r(new File([bl], `bg${hue}.jpg`, { type: 'image/jpeg' })), 'image/jpeg'));
  };
  await app.addCharacterFile(await mkChar(320));
  await app.addCharacterFile(await mkChar(200));
  await app.addBackgroundFile(await mkBg(220));
  await app.addBackgroundFile(await mkBg(20));
});
await page.waitForTimeout(500);

// ---- BPM typing must not trigger performance keys (even after re-render)
const bpm = page.locator('#leftPanel input[type=number]').first();
await bpm.click();
await bpm.press('Control+a');
await page.keyboard.type('180', { delay: 60 });
await page.keyboard.press('Enter');
await page.keyboard.type('12345', { delay: 40 });
let c0 = await counts();
check('BPM typing adds no events', c0.lstyle + c0.chara + c0.cam + c0.fx + c0.viz + c0.look === 0, JSON.stringify(c0));
check('BPM value applied', (await page.evaluate(() => window.app.settings.bpm)) === 180);
await page.evaluate(() => { document.activeElement?.blur(); window.app.mutate((p) => (p.settings.bpm = 200)); });

// ---- paused key press records nothing
await press('Digit3');
c0 = await counts();
check('paused key press records nothing', c0.lstyle === 0);

// ---- stop mode: 'return' (default) goes back to where playback / REC started, 'stay' stops in place
check('default stop mode returns to start', await page.evaluate(() => window.app.settings.stopMode === 'return'));
// play from 1.0 s until the clock has really moved, then stop with `stop`; returns [time before stop, time after]
const playAndStop = async (stop) => {
  await page.evaluate(() => { window.app.setMode('fx'); window.app.seek(1.0); });
  await stop.start();
  await page.waitForFunction(() => window.app.time > 1.4, null, { timeout: 15000 }).catch(() => {});
  const before = await page.evaluate(() => window.app.time);
  await stop.end();
  await page.waitForTimeout(250);
  return [before, await page.evaluate(() => window.app.time)];
};
const byButton = { start: () => page.click('#btnPlay'), end: () => page.click('#btnPlay') };
let [b0, a0] = await playAndStop(byButton);
check('stop returns to where playback started', b0 > 1.3 && Math.abs(a0 - 1.0) < 0.02, `${b0.toFixed(2)} → ${a0.toFixed(2)}`);
[b0, a0] = await playAndStop({ start: () => press('Shift+R', 50), end: () => press('Escape', 50) });
check('ending REC returns to the take start', b0 > 1.3 && Math.abs(a0 - 1.0) < 0.02 && !(await page.evaluate(() => window.app.recording)), `${b0.toFixed(2)} → ${a0.toFixed(2)}`);
await page.click('#btnStopMode');
[b0, a0] = await playAndStop(byButton);
check('stay mode stops in place', (await page.evaluate(() => window.app.settings.stopMode)) === 'stay' && b0 > 1.3 && a0 > 1.3, `${b0.toFixed(2)} → ${a0.toFixed(2)}`);
await page.click('#btnStopMode');

await page.evaluate(() => window.app.setMode('lyrics'));

// ---- LYRICS take
await toStart();
await rec(async () => {
  await press('Digit2', 60);
  for (let i = 0; i < 7; i++) await press('Space', 110);
  await press('Enter', 500);
  await press('Digit4', 60);
  await press('Enter', 500);
  await press('Enter', 400);
});
let c = await counts();
check('lyrics take: timings', c.timed >= 3, `timed=${c.timed}`);
check('lyrics take: lyric styles', c.lstyle === 2, `lstyle=${c.lstyle}`);
check('lyrics take: other tracks untouched', c.chara + c.cam + c.fx + c.viz + c.look === 0);

// ---- TELOP take: short tap = default length, hold = explicit length, X = end now
await page.evaluate(() => window.app.setTelops('[タイトル] {title} | {artist}\n[名前] Minamo | Vocal\n[チャプター] CHORUS\n[字幕] caption'));
await toStart();
await press('Tab', 150);
check('Tab → TELOP mode', (await page.evaluate(() => window.app.mode)) === 'telop');
await page.evaluate(() => window.app.setTelopCursor(1));
await rec(async () => {
  await press('Space', 400);
  await page.keyboard.down('Space'); await page.waitForTimeout(900); await page.keyboard.up('Space'); await page.waitForTimeout(200);
  await press('Space', 500);
  await press('KeyX', 300);
});
const tls = await page.evaluate(() => window.app.project.telops.map((x) => ({ s: x.start, d: x.dur })));
check('telop take: 3 telops placed', tls.slice(1).every((x) => x.s != null), JSON.stringify(tls));
check('telop: tap = default length', tls[1].d === null);
check('telop: hold = explicit length', tls[2].d != null && tls[2].d > 0.5, JSON.stringify(tls[2]));
check('telop: X ends the showing telop', tls[3].d != null && tls[3].d < 1.5, JSON.stringify(tls[3]));
check('telop take: event tracks untouched', (await counts()).chara === 0);

// ---- CHARA take
await toStart();
await press('Tab', 150);
check('Tab → CHARA mode', (await page.evaluate(() => window.app.mode)) === 'chara');
await rec(async () => {
  await press('Digit1', 80); await press('KeyD', 80); await press('KeyQ', 80); await press('KeyX', 500);
  await press('Digit2', 80); await press('KeyA', 500); await press('Digit0', 400); await press('Digit1', 300);
});
c = await counts();
check('chara take', c.chara >= 7, `chara=${c.chara}`);
const charaSt = await page.evaluate(() => {
  const ev = window.app.project.charaEvents;
  return ev.map((e) => `${e.kind}:${e.value.length > 12 ? 'id' : e.value}`).join(' ');
});
console.log('   chara events:', charaSt);
await page.screenshot({ path: path.join(outDir, 'mode_chara.png') });

// ---- CAMERA take
await toStart();
await press('Tab', 150);
await rec(async () => { await pressMoved('KeyG'); await pressMoved('Shift+KeyS'); await pressMoved('KeyW'); });
c = await counts();
check('camera take', c.cam === 3, `cam=${c.cam} ` + JSON.stringify(await page.evaluate(() => window.app.project.camEvents.map((e) => `${e.kind}:${e.value}@${e.time.toFixed(2)}`))));
check('Shift = smooth frame', await page.evaluate(() => window.app.project.camEvents.some((e) => e.kind === 'frame' && e.value === 'full' && e.smooth)));

// ---- FX take (with hold)
await toStart();
await press('Tab', 150);
await rec(async () => {
  await press('KeyQ', 200);
  await page.keyboard.down('KeyR'); await page.waitForTimeout(700); await page.keyboard.up('KeyR'); await page.waitForTimeout(150);
  await press('KeyL', 300);
});
c = await counts();
check('fx take', c.fx === 3, `fx=${c.fx}`);
check('held FX has hold', await page.evaluate(() => window.app.project.fxEvents.some((e) => e.fx === 'glitch' && e.hold > 0.2)));

// ---- restart the browser: headless Chrome's fake audio device stalls in long sessions (a page reload is not
// enough). Same profile, so this also checks autosave flushing and project / media restore.
const beforeReload = await counts();
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await context.close();
context = await launch();
page = context.pages()[0] ?? (await context.newPage());
watch(page);
await page.goto('http://localhost:5178/?demo=0');
await page.waitForSelector('.mode-tab');
await page.waitForFunction(() => window.app.analysis && window.app.enabledChars().length === 2, null, { timeout: 30000 });
const afterReload = await counts();
check('project + media restored after reload', JSON.stringify(beforeReload) === JSON.stringify(afterReload), `${JSON.stringify(beforeReload)} vs ${JSON.stringify(afterReload)}`);
// a fresh browser's audio output takes a moment to start: play until the clock really moves
await page.evaluate(async () => {
  const app = window.app;
  await app.play();
  const t0 = app.time;
  for (let i = 0; i < 50 && app.time - t0 < 0.3; i++) await new Promise((r) => setTimeout(r, 100));
  app.pause();
  app.seek(0);
});
await page.evaluate(() => window.app.setMode('fx'));

// ---- VISUAL take
await toStart();
await press('Tab', 150);
check('Tab → VISUAL mode', (await page.evaluate(() => window.app.mode)) === 'viz');
await rec(async () => { await press('Digit3', 200); await press('KeyR', 200); await press('KeyG', 200); await press('KeyC', 200); await press('KeyB', 300); });
c = await counts();
check('visual take', c.viz === 5, `viz=${c.viz}`);
const vizNow = await page.evaluate(() => { const C = window.app.compiled, t = Math.max(...window.app.project.vizEvents.map((e) => e.time)) + 0.01; const st = (s) => { let v; for (const x of s) if (x.t <= t) v = x.v; return v; }; return [st(C.viz.type), st(C.viz.pos), st(C.viz.color), st(C.viz.size), st(C.viz.layer)].join(','); });
check('visual state applied', vizNow === 'circle,around,rainbow,l,front', vizNow + ' ' + JSON.stringify(await page.evaluate(() => window.app.project.vizEvents.map((e) => `${e.kind}:${e.value}@${e.time.toFixed(2)}`))));
await page.screenshot({ path: path.join(outDir, 'mode_viz.png') });

// ---- LOOK take
await toStart();
await press('Tab', 150);
await rec(async () => { await press('Digit3', 200); await press('KeyQ', 200); await press('KeyA', 200); await press('KeyC', 300); await press('Shift+Digit7', 300); });
c = await counts();
check('look take', c.look === 5, `look=${c.look} ` + JSON.stringify(await page.evaluate(() => window.app.project.lookEvents.map((e) => `${e.kind}:${e.value}@${e.time.toFixed(2)}${e.transition ? '/' + e.transition : ''}`))));
check('Shift+number = style switch without transition', await page.evaluate(() => window.app.project.lookEvents.some((e) => e.kind === 'style' && e.value === 'minimal' && e.transition === 'none')));
await page.screenshot({ path: path.join(outDir, 'mode_look.png') });

// ---- 上書き (replace, opt-in): re-record CHARA over the start → old events in the range are replaced
check('default REC mode is overdub', await page.evaluate(() => window.app.overdub === true));
await page.evaluate(() => { window.app.setMode('chara'); window.app.setOverdub(false); });
const before = await page.evaluate(() => window.app.project.charaEvents.map((e) => e.time));
await toStart();
let recEnd = 0;
await rec(async () => { await press('KeyF', 600); recEnd = await page.evaluate(() => window.app.time); });
const after = await page.evaluate(() => window.app.project.charaEvents.map((e) => ({ t: e.time, k: e.kind, v: e.value })));
const oldInRange = before.filter((t) => t <= recEnd - 0.05).length;
const survivors = after.filter((e) => !(e.k === 'pos' && e.v === 'duo'));
check('replace: old events in range removed', survivors.every((e) => e.t > recEnd - 0.05), `oldInRange=${oldInRange} after=${after.length} recEnd=${recEnd.toFixed(2)}`);
check('replace: new event recorded', after.some((e) => e.k === 'pos' && e.v === 'duo'));

// ---- 重ね (overdub): FX events are added, nothing removed
await page.evaluate(() => { window.app.setMode('fx'); window.app.setOverdub(true); });
const fxBefore = (await counts()).fx;
await toStart();
await rec(async () => { await press('KeyW', 500); });
check('overdub keeps old FX', (await counts()).fx === fxBefore + 1, `${fxBefore} → ${(await counts()).fx}`);

// ---- audition: playing without REC shows live but records nothing
await toStart();
const fxNow = (await counts()).fx;
await press('Space', 300);
await press('KeyE', 200);
const live = await page.evaluate(() => window.app.compiled.fx.filter((f) => !f.def.hidden).length);
check('audition is not recorded', (await counts()).fx === fxNow);
check('audition shows live', live === fxNow + 1, `compiled=${live}`);
await press('Space', 300);
check('audition cleared on stop', (await page.evaluate(() => window.app.compiled.fx.filter((f) => !f.def.hidden).length)) === fxNow);

// ---- mode switch is locked while recording
await rec(async () => { await press('Tab', 150); check('mode locked during REC', (await page.evaluate(() => window.app.mode)) === 'fx'); });

// ---- undo whole take
const fxB = (await counts()).fx;
await toStart();
await rec(async () => { await press('KeyT', 300); });
await press('Control+z', 200);
check('Ctrl+Z undoes a whole take', (await counts()).fx === fxB);

// ---- pausing ends REC
const recState = () => page.evaluate(() => ({ rec: window.app.recording, playing: window.app.engine.playing }));
// overdub, so earlier FX in the same range are not replaced (this checks pausing, not punch-in)
await page.evaluate(() => { window.app.setMode('fx'); window.app.setOverdub(true); });
await toStart();
const fxPause0 = (await counts()).fx;
await press('Shift+R', 400);
await press('KeyQ', 200);
await page.click('#btnPlay');
await page.waitForTimeout(300);
let st = await recState();
check('pause button ends REC', !st.rec && !st.playing, JSON.stringify(st));
check('take kept after pause', (await counts()).fx === fxPause0 + 1);
await press('Space', 400);
st = await recState();
check('resume after pause is plain playback', !st.rec && st.playing, JSON.stringify(st));
await press('Space', 300);
await press('Shift+R', 400);
await press('Space', 300);
st = await recState();
check('Space pauses and ends REC (non-lyrics track)', !st.rec && !st.playing, JSON.stringify(st));
await page.evaluate(() => window.app.setMode('lyrics'));
await press('Shift+R', 400);
await press('Space', 300);
st = await recState();
check('Space still taps in the lyrics track', st.rec && st.playing, JSON.stringify(st));
await press('Escape', 300);
check('Esc ends REC', !(await recState()).rec);

await page.evaluate(() => window.app.setMode('lyrics'));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(outDir, 'ui_after.png') });
for (const t of [0.6, 1.4, 2.2, 3.4]) {
  await page.evaluate((t) => { window.app.seek(t); window.app.requestFrame(); }, t);
  await page.waitForTimeout(300);
  await (await page.$('#out')).screenshot({ path: path.join(outDir, `preview_${t}.png`) });
}
const errs = logs.filter((l) => !l.includes('404'));
check('no page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
await context.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
