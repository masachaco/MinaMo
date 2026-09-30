// Tutorial (dev server running): opens over the demo on the first visit, walks through play → lyric track →
// Space taps → lyric effect → 新規, skip closes it for good, ?demo=0 never shows it. Screenshots in test-out/.
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
fs.mkdirSync('test-out', { recursive: true });
const errors = [];
let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};
const open = async (url) => {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await page.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function', null, { timeout: 60000 });
  return page;
};
const card = (page) => page.evaluate(() => {
  const c = document.querySelector('.tut-card');
  return c ? { title: c.querySelector('h3')?.textContent, count: c.querySelector('.tut-count')?.textContent, task: c.querySelector('.tut-task')?.textContent ?? null } : null;
});
const waitTitle = (page, title, timeout = 8000) => page.waitForFunction((t) => document.querySelector('.tut-card h3')?.textContent === t, title, { timeout }).then(() => true, () => false);
const next = (page) => page.click('.tut-actions button:last-child');
let shot = 0;
const snap = async (page) => (await page.waitForTimeout(400), page.screenshot({ path: `test-out/tutorial-${String(++shot).padStart(2, '0')}.png` }));

// ---- first visit: the tour opens over the demo
const page = await open('http://localhost:5178/');
await page.waitForSelector('.tut-card', { timeout: 30000 }).catch(() => {});
const c0 = await card(page);
check('first visit opens the tutorial', c0?.title === 'ようこそ！', JSON.stringify(c0));
await snap(page);
await next(page);

check('step: play', await waitTitle(page, 'まずは見てみる'));
await snap(page);
await page.keyboard.press('Space');
await page.waitForFunction(() => document.querySelector('.tut-task.done'), null, { timeout: 5000 }).catch(() => {});
check('playing ticks the task', (await card(page))?.task?.includes('できました'), JSON.stringify(await card(page)));
await next(page);

check('step: timeline', await waitTitle(page, 'タイムライン'));
await snap(page);
await next(page);

check('step: choose a track', await waitTitle(page, 'トラックを選ぶ'));
await snap(page);
await page.click('.mode-tab[data-mode="lyrics"]');
check('choosing the lyric track moves on by itself', await waitTitle(page, '歌に合わせて歌詞を出す'));
await snap(page);
const before = await page.evaluate(() => {
  const app = window.app, i = app.project.lines.findIndex((l) => l.text === 'なんか爽やかな');
  return { i, times: app.project.lines[i].times, cursorLine: app.targets()[app.lyricCursor]?.line, t: app.time };
});
check('the lyric step cues the line', before.i >= 0 && before.cursorLine === before.i && before.t < before.times[0], JSON.stringify(before));

await page.keyboard.press('Shift+R');
await page.waitForFunction(() => window.app.recording, null, { timeout: 5000 });
// wait until the line comes, then tap its characters
await page.waitForFunction((t0) => window.app.time > t0 - 0.2, before.times[0], { timeout: 15000 }).catch(() => {});
for (let k = 0; k < 7; k++) {
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
}
await page.keyboard.press('Escape');
const warned = await page.evaluate(() => document.querySelector('#toast').textContent.includes('より前'));
check('no going-back warning on REC', !warned);
const after = await page.evaluate((i) => window.app.project.lines[i].times, before.i);
check('Space taps timed the line character by character', after.filter((x) => x != null).length === after.length, JSON.stringify(after));
check('the lyric step moves on after Esc', await waitTitle(page, '確かめる'));
await snap(page);
await page.keyboard.press('Space');
await page.waitForFunction(() => document.querySelector('.tut-task.done'), null, { timeout: 5000 }).catch(() => {});
check('playing ticks the check step', (await card(page))?.task?.includes('できました'));
await next(page);

check('step: effect', await waitTitle(page, 'エフェクトを付ける'));
check('the effect step stopped playback', !(await page.evaluate(() => window.app.engine.playing)));
await snap(page);
const fx0 = await page.evaluate(() => window.app.project.lyricEvents.length);
await page.keyboard.press('Shift+R');
await page.waitForTimeout(800);
await page.keyboard.press('KeyE'); // グロー
await page.waitForTimeout(600);
await page.keyboard.press('Escape');
const fx1 = await page.evaluate(() => window.app.project.lyricEvents.map((e) => e.value));
check('an effect key while recording adds a lyric effect', fx1.length > fx0, JSON.stringify(fx1));
check('the effect step moves on after Esc', await waitTitle(page, 'ほかのトラックも同じ'));
await snap(page);
await next(page);
check('step: place without REC', await waitTitle(page, '止めたまま置く・直す'));
await snap(page);
await next(page);
check('step: export', await waitTitle(page, '書き出し'));
await snap(page);
await next(page);
check('last step: start from scratch', await waitTitle(page, '自分の曲で作るには'));
await snap(page);
await page.click('.tut-actions button:has-text("新規")');
await page.waitForTimeout(600);
const end = await page.evaluate(() => ({
  open: !!document.querySelector('.tut-card'), chars: window.app.project.characters.length, audio: window.app.project.audio,
  fx: window.app.project.fxEvents.length, seen: localStorage.getItem('minamo.tutorial'),
}));
check('新規 from the last step clears the demo and closes the tour', !end.open && end.chars === 0 && end.audio === null && end.fx === 0 && end.seen === 'done', JSON.stringify(end));
await page.reload();
await page.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function', null, { timeout: 60000 });
await page.waitForTimeout(500);
check('not shown again after a reload', !(await card(page)));
// the ？ button opens it again
await page.click('#btnHelp');
check('the ？ button opens the tour', (await card(page))?.title === 'ようこそ！');
await page.click('.tut-skip');

// ---- skip on the first visit: closed, not shown again (even with the demo re-opened on a reload)
const p2 = await open('http://localhost:5178/');
await page.waitForTimeout(100);
await p2.waitForSelector('.tut-card', { timeout: 30000 }).catch(() => {});
check('first visit (2nd browser) shows the tour', !!(await card(p2)));
await p2.click('.tut-skip');
check('スキップ closes the tour', !(await card(p2)));
check('スキップ remembers it', await p2.evaluate(() => localStorage.getItem('minamo.tutorial')) === 'done');
check('the demo stays after skipping', await p2.evaluate(() => window.app.project.characters.length) > 0);

// ---- tests open with ?demo=0: no tour
const p3 = await open('http://localhost:5178/?demo=0');
await p3.waitForTimeout(500);
check('?demo=0 shows no tour', !(await card(p3)));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
