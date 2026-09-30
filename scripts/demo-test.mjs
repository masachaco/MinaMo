// Demo project (dev server running): a first visit opens public/demo with its song and 立ち絵, keeps it as the saved
// project, and Project → デモを開く brings it back (undo returns to the previous project).
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};
const manifest = JSON.parse(fs.readFileSync('public/demo/demo.json', 'utf8'));
const demo = JSON.parse(fs.readFileSync(path.join('public/demo', manifest.project), 'utf8'));
const ready = () => page.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function', null, { timeout: 60000 });
const state = () => page.evaluate(() => {
  const app = window.app, p = app.project;
  return {
    title: p.settings.title, lines: p.lines.length, fx: p.fxEvents.length, chars: p.characters.length,
    loadedChars: app.enabledChars().length, audio: p.audio?.name, analysis: !!app.analysis, duration: app.engine.duration,
    toast: document.querySelector('#toast')?.textContent ?? '',
  };
});

// ---- first visit
const t0 = Date.now();
await page.goto('http://localhost:5178/');
await ready();
await page.waitForFunction(() => window.app.analysis, null, { timeout: 60000 }).catch(() => {});
const first = await state();
console.log(`  first visit ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
check('first visit opens the demo project', first.title === demo.settings.title && first.lines === demo.lines.length && first.fx === demo.fxEvents.length, JSON.stringify(first));
check('demo song loaded and analysed', first.audio === path.basename(manifest.audio.file) && first.analysis && Math.abs(first.duration - 140.4) < 0.1, JSON.stringify(first));
check('every demo 立ち絵 loaded', first.chars === manifest.characters.length && first.loadedChars === manifest.characters.length, JSON.stringify(first));
check('no missing media', !first.toast.includes('見つからない'), first.toast);
check('the demo opens where the singing begins (demo.json start)', await page.evaluate((st) => Math.abs(window.app.time - st) < 0.05, manifest.start), `${await page.evaluate(() => window.app.time)} / ${manifest.start}`);
await page.evaluate(async () => {
  const app = window.app;
  app.seek(40);
  await new Promise((r) => setTimeout(r, 800));
});
await page.screenshot({ path: 'test-out/demo-first.png' });

// ---- the demo is now the saved project: a reload does not fetch it again, edits stay
await page.evaluate(() => window.app.mutate((p) => (p.settings.title = 'edited')));
await page.waitForTimeout(1200); // autosave debounce
let fetched = 0;
page.on('request', (r) => r.url().includes('/demo/') && fetched++);
await page.reload();
await ready();
const again = await state();
check('reload keeps the saved (edited) project', again.title === 'edited', JSON.stringify(again));
check('reload does not fetch the demo', fetched === 0, `(${fetched} requests)`);

// ---- Project → デモを開く replaces it; undo returns
page.on('dialog', (d) => d.accept());
await page.click('details:has(button:has-text("デモを開く")) > summary'); // the Project section starts closed
await page.click('button:has-text("デモを開く")');
await page.waitForFunction((t) => window.app.project.settings.title === t, demo.settings.title, { timeout: 60000 });
await page.waitForFunction((n) => window.app.enabledChars().length === n, manifest.characters.length, { timeout: 30000 }).catch(() => {});
check('デモを開く opens the demo', (await state()).loadedChars === manifest.characters.length);
await page.waitForFunction((st) => Math.abs(window.app.time - st) < 0.05, manifest.start, { timeout: 30000 }).catch(() => {});
check('デモを開く also starts at demo.json start', await page.evaluate((st) => Math.abs(window.app.time - st) < 0.05, manifest.start));
// let the demo's song finish decoding / analysing (the panels re-render while it loads)
await page.waitForFunction(() => window.app.analysis && !document.querySelector('#status')?.textContent?.includes('中…'), null, { timeout: 60000 });
await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('undo returns to the previous project', (await state()).title === 'edited');

// ---- Project → 新規: empty project without the demo's song / 立ち絵, and it stays after a reload
const openProjectSec = () => page.evaluate(() => {
  const d = [...document.querySelectorAll('details')].find((x) => x.querySelector('button')?.textContent === '新規');
  if (d) d.open = true; // the panel is rebuilt with the section closed after a project switch
});
await openProjectSec();
await page.click('button:has-text("新規")');
await page.waitForTimeout(500);
const blank = await page.evaluate(() => {
  const app = window.app, p = app.project;
  app.seek(5);
  return { chars: p.characters.length, audio: p.audio, fx: p.fxEvents.length, analysis: app.analysis, buffer: !!app.engine.buffer, undo: app.history.undo(p) };
});
check('新規 clears the song, 立ち絵 and records', blank.chars === 0 && blank.audio === null && blank.fx === 0 && !blank.analysis && !blank.buffer, JSON.stringify(blank));
check('新規 is not undoable (history cleared)', !blank.undo);
await page.waitForTimeout(1200);
await page.reload();
await ready();
check('the empty project stays after a reload (no demo again)', (await state()).chars === 0);

// ---- race: 新規 while the demo's song is still decoding / analysing must not bring the song back
const race = await page.evaluate(async (title) => {
  const app = window.app;
  const opening = app.openDemo();
  while (app.project.settings.title !== title) await new Promise((r) => setTimeout(r, 20));
  app.newBlankProject(); // the demo's song is loading now
  await opening;
  await new Promise((r) => setTimeout(r, 1500));
  return { buffer: !!app.engine.buffer, analysis: !!app.analysis, audio: app.project.audio, chars: app.project.characters.length, status: document.querySelector('#status').textContent };
}, demo.settings.title);
check('新規 during the demo load: the old song does not come back', !race.buffer && !race.analysis && race.audio === null && race.chars === 0 && race.status === '', JSON.stringify(race));

// ---- ?demo=0 starts empty (tests)
const p2 = await (await browser.newContext()).newPage();
await p2.goto('http://localhost:5178/?demo=0');
await p2.waitForFunction(() => window.app?.project, null, { timeout: 60000 });
check('?demo=0 skips the demo', await p2.evaluate((t) => window.app.project.settings.title !== t, demo.settings.title));
// ---- work saved under the former name (MV Otoge Creator) carries over: project, media, plugins
const p4 = await (await browser.newContext()).newPage();
p4.on('pageerror', (e) => errors.push(e.message));
// write the old storage from a page of the same origin that does not run the app (the app saves its own project on leaving)
await p4.goto('http://localhost:5178/LICENSE');
const sample = await (await fetch('http://localhost:5178/demo/demo.minamo.json')).json();
await p4.evaluate(async (sample) => {
  const c = document.createElement('canvas');
  c.width = 40; c.height = 80;
  c.getContext('2d').fillRect(5, 5, 30, 70);
  const png = await new Promise((r) => c.toBlob(r, 'image/png'));
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('mv-otoge-creator', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('media');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  await new Promise((res) => { const tx = db.transaction('media', 'readwrite'); tx.objectStore('media').put(png, 'legacy-chara'); tx.oncomplete = res; });
  db.close();
  const p = sample;
  p.settings.title = 'LEGACY';
  p.characters = [{ id: 'legacy-chara', name: 'old.png', mime: 'image/png', faceY: 0.2, scale: 1, offsetX: 0, offsetY: 0, flip: false, enabled: true }];
  localStorage.setItem('mv-otoge-creator:project', JSON.stringify(p));
  localStorage.setItem('mv-otoge-creator:plugins', '[]');
}, sample);
await p4.goto('http://localhost:5178/?demo=0');
await p4.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function', null, { timeout: 60000 });
await p4.waitForFunction(() => window.app.charAssets.get('legacy-chara'), null, { timeout: 10000 }).catch(() => {});
const legacy = await p4.evaluate(() => ({
  title: window.app.project.settings.title, image: !!window.app.charAssets.get('legacy-chara'),
  moved: localStorage.getItem('minamo:project') != null && localStorage.getItem('mv-otoge-creator:project') == null,
  plugins: localStorage.getItem('minamo:plugins'),
}));
check('the former name\'s project, media and settings carry over', legacy.title === 'LEGACY' && legacy.image && legacy.moved && legacy.plugins === '[]', JSON.stringify(legacy));
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
