// Phone page (dev server running): /mobile/ opens the demo at a phone size, the pads of each track come from the
// key definitions, a REC take with the pads records lyric taps / FX / 立ち絵, and the PC page is not changed by it.
// Screenshots in test-out/mobile-*.png.
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import fs from 'node:fs';

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
fs.mkdirSync('test-out', { recursive: true });
const errors = [];
let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.goto('http://localhost:5178/mobile/');
// ready: the demo is loaded and sought to its start, the pads are built
await page.waitForFunction(() => window.app?.project?.audio && window.app.time > 0 && document.querySelector('#pads .pad'), null, { timeout: 60000 });
await page.waitForTimeout(800);
const st = await page.evaluate(() => ({ t: window.app.time, chars: window.app.project.characters.length, scrollW: document.documentElement.scrollWidth }));
check('the demo opens at the start of the singing', Math.abs(st.t - 22.5) < 0.05 && st.chars > 0, JSON.stringify(st));
check('opens on the FX track', await page.evaluate(() => window.app.mode === 'fx' && document.querySelector('.mode-tab.on')?.dataset.mode === 'fx'));
check('no horizontal scroll at 390px', st.scrollW <= 390, String(st.scrollW));
await page.screenshot({ path: 'test-out/mobile-1.png' });

// pads follow the track tabs
const padsOf = (mode) => page.evaluate((m) => {
  window.app.setMode(m);
  return { pads: document.querySelectorAll('#pads .pad[data-key]').length, keys: window.app.perfKeyList().length };
}, mode);
for (const m of ['lyrics', 'telop', 'chara', 'camera', 'fx', 'viz', 'look']) {
  const r = await padsOf(m);
  check(`pads of the ${m} track = its keys`, r.pads === r.keys && r.keys > 0, JSON.stringify(r));
}

// lyrics: REC, tap the 1文字ずつ pad along a line
await page.tap('.mode-tab[data-mode="lyrics"]');
const line = await page.evaluate(() => {
  const app = window.app, i = app.project.lines.findIndex((l) => l.text === 'なんか爽やかな');
  app.setCursorFollow(false);
  app.setCursor(app.targets().findIndex((t) => t.line === i));
  app.seek(app.project.lines[i].times[0] - 1.5);
  return { i, t0: app.project.lines[i].times[0] };
});
await page.tap('#btnRec');
await page.waitForFunction(() => window.app.recording, null, { timeout: 5000 });
await page.screenshot({ path: 'test-out/mobile-2.png' });
await page.waitForFunction((t0) => window.app.time > t0 - 0.2, line.t0, { timeout: 15000 }).catch(() => {});
for (let k = 0; k < 7; k++) {
  await page.tap('#pads .pad[data-key=" "]');
  await page.waitForTimeout(200);
}
await page.screenshot({ path: 'test-out/mobile-3.png' });
await page.tap('#btnRec');
const times = await page.evaluate((i) => window.app.project.lines[i].times, line.i);
check('the 1文字ずつ pad timed the line character by character', times.every((x) => x != null) && times[0] > line.t0 - 1, JSON.stringify(times));
check('■ 停止 ends REC', !(await page.evaluate(() => window.app.recording)));

// FX: a held pad (holdable FX) records its length
await page.tap('.mode-tab[data-mode="fx"]');
const fx = await page.evaluate(() => {
  const k = window.app.perfKeyList().find((x) => x.holdable && x.key);
  return { key: k?.key, ids: window.app.project.fxEvents.map((e) => e.id) };
});
await page.tap('#btnRec');
await page.waitForFunction(() => window.app.recording, null, { timeout: 5000 });
await page.waitForTimeout(300);
const box = await page.locator(`#pads .pad[data-key="${fx.key}"]`).boundingBox();
const cdp = await ctx.newCDPSession(page);
const pt = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
await page.waitForTimeout(700);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(100);
await page.tap('#btnRec');
const fx1 = await page.evaluate((ids) => window.app.project.fxEvents.filter((e) => !ids.includes(e.id)), fx.ids);
check('a held FX pad records an FX with its length', fx1.length === 1 && fx1[0].hold > 0.3, JSON.stringify(fx1));

// 立ち絵: switch the character with a pad
await page.tap('.mode-tab[data-mode="chara"]');
const c0 = await page.evaluate(() => window.app.project.charaEvents.filter((e) => e.kind === 'char').length);
await page.tap('#btnRec');
await page.waitForFunction(() => window.app.recording, null, { timeout: 5000 });
await page.waitForTimeout(300);
await page.tap('#pads .pad[data-key="2"]');
await page.waitForTimeout(200);
await page.tap('#btnRec');
const c1 = await page.evaluate(() => window.app.project.charaEvents.filter((e) => e.kind === 'char').length);
check('a 立ち絵 pad switches the character while recording', c1 > c0, `${c0} → ${c1}`);
await page.screenshot({ path: 'test-out/mobile-4.png' });

// stopped: a pad only explains (nothing recorded)
const n0 = await page.evaluate(() => window.app.project.charaEvents.length);
await page.tap('#pads .pad[data-key="3"]');
check('a pad while stopped records nothing', (await page.evaluate(() => window.app.project.charaEvents.length)) === n0);

// the menu
await page.tap('#btnMenu');
await page.waitForTimeout(300);
check('☰ opens the menu', await page.isVisible('#drawer'));
await page.screenshot({ path: 'test-out/mobile-5.png' });

// the PC page still opens as before
const pc = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
pc.on('pageerror', (e) => errors.push(e.message));
await pc.goto('http://localhost:5178/?demo=0');
await pc.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function', null, { timeout: 60000 });
check('the PC page is unchanged (key panel, timeline)', await pc.evaluate(() => !!document.querySelector('#rightPanel .key') && !!document.querySelector('#leftPanel .sec')));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
