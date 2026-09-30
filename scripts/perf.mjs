// Relative render cost per style (software GL in headless — compare styles, not absolute numbers).
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const style of ['kinetic', 'glitch', 'neon', 'emotional', 'pop', 'impact', 'minimal']) {
  const page = await browser.newPage();
  await page.goto(`http://localhost:5178/test.html?style=${style}&w=960&h=540`);
  await page.waitForFunction(() => window.__ready);
  const ms = await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.__render(5 + i * 0.1);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) window.__render(5 + i / 30);
    return (performance.now() - t0) / 20;
  });
  console.log(style.padEnd(10), ms.toFixed(1), 'ms/frame');
  await page.close();
}
// plugin load test
const page = await browser.newPage();
await page.goto('http://localhost:5178/?demo=0');
await page.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function');
const code = fs.readFileSync('plugins/example-typewriter.js', 'utf8');
const r = await page.evaluate(async (code) => {
  const { addPlugin } = await import('/src/plugin-loader.ts');
  await addPlugin('example-typewriter.js', code);
  const api = window.MinaMo;
  return { styles: api.listStyles().map((s) => s.id), fx: api.listFx().filter((f) => !f.hidden).map((f) => f.id) };
}, code);
console.log(JSON.stringify(r));
await browser.close();
