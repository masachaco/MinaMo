// Lyric input cursor: previews, slider, click-to-set, ↑↓, recording from a chosen position.
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const outDir = process.argv[2] || 'test-out';
fs.mkdirSync(outDir, { recursive: true });
const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};
const chips = () => page.$$eval('#pKeys .pk', (els) => els.map((e) => e.textContent));
const cursor = () => page.evaluate(() => ({ k: window.app.lyricCursor, follow: window.app.cursorFollow }));

await page.goto('http://localhost:5178/?demo=0');
await page.waitForSelector('.mode-tab');
await page.evaluate(async () => {
  const b = await (await fetch('/test-song')).blob();
  await window.app.setAudioFile(b, 'music_bgm_200.wav');
  window.app.mutate((p) => { p.settings.bpm = 200; p.settings.previewScale = 0.25; });
});
await page.waitForTimeout(400);

let c = await chips();
check('preview Space = first char', c[0].includes('夜'), c[0]);
check('preview N = first chunk', c[1].includes('夜を'), c[1]);
check('preview Enter = first line', c[2].includes('夜を駆け抜けて'), c[2]);

await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
let cu = await cursor();
check('↓ moves to next line & stops following', cu.k === 7 && !cu.follow, JSON.stringify(cu));
c = await chips();
check('preview follows cursor', c[0].includes('君') && c[2].includes('君の声が聞こえる'), c.join(' | '));
await page.keyboard.press('Shift+ArrowDown');
await page.keyboard.press('Shift+ArrowDown');
await page.waitForTimeout(200);
c = await chips();
check('Shift+↓ moves by character', (await cursor()).k === 9 && c[1].includes('聞こえる') && c[1].includes('自動'), c[1]);

// slider in line units
await page.click('.seg-btns button:nth-child(2)');
await page.waitForTimeout(150);
await page.$eval('#pCursor input[type=range]', (el) => { el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(200);
const line3 = await page.evaluate(() => { const tg = window.app.targets(); return tg[window.app.lyricCursor]; });
check('slider (line) sets line start', line3.line === 3 && line3.lineFirst, JSON.stringify(line3));
check('prompter shows that line', (await page.textContent('#pNow')).includes('光の向こうへ'));

// click a character
await page.locator('#pNow .ch').nth(2).click();
await page.waitForTimeout(150);
const clicked = await page.evaluate(() => window.app.targets()[window.app.lyricCursor]);
check('click char sets cursor', clicked.line === 3 && clicked.glyph === 2, JSON.stringify(clicked));
await page.screenshot({ path: path.join(outDir, 'cursor.png'), clip: { x: 300, y: 600, width: 990, height: 170 } });

// record from the chosen position
await page.evaluate(() => window.app.setCursor(window.app.targets().findIndex((t) => t.line === 3)));
await page.evaluate(() => window.app.seek(3));
await page.keyboard.press('Shift+R');
await page.waitForTimeout(400);
for (let i = 0; i < 3; i++) { await page.keyboard.press('Space'); await page.waitForTimeout(150); }
await page.keyboard.press('Shift+R');
await page.waitForTimeout(300);
const res = await page.evaluate(() => window.app.project.lines.map((l) => l.times.filter((x) => x != null).length));
check('taps went to the chosen line only', res[3] === 3 && res.filter((_, i) => i !== 3).every((n) => n === 0), res.join(','));

// follow back on → cursor tracks the playhead
await page.check('#pCursor .p-follow input');
await page.evaluate(() => window.app.seek(0));
await page.waitForTimeout(250);
cu = await cursor();
check('follow on: cursor from playhead', cu.follow && cu.k === 0, JSON.stringify(cu));

// cue: one bar before the cursor's recorded time
await page.uncheck('#pCursor .p-follow input');
await page.evaluate(() => window.app.setCursor(window.app.targets().findIndex((t) => t.line === 3)));
await page.click('text=頭出し');
await page.waitForTimeout(200);
const cue = await page.evaluate(() => ({ t: window.app.time, start: window.app.project.lines[3].times[0], bar: window.app.compiled.grid.barDur }));
check('cue seeks one bar before', Math.abs(cue.t - Math.max(0, cue.start - cue.bar)) < 0.02, JSON.stringify(cue));

check('no page errors', errs.length === 0, errs.join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(fails ? 1 : 0);
