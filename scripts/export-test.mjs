// Export smoke test: node scripts/export-test.mjs <outdir>
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const outDir = process.argv[2] || 'test-out';
fs.mkdirSync(outDir, { recursive: true });
const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await page.goto('http://localhost:5178/?demo=0');
await page.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function');
await page.evaluate(async () => {
  const app = window.app;
  const b = await (await fetch('/test-song')).blob();
  await app.setAudioFile(b, 'music_bgm_200.wav');
  app.mutate((p) => {
    p.settings.bpm = 200; p.settings.width = Number(new URLSearchParams(location.search).get('w') || 640); p.settings.height = Math.round(p.settings.width * 9 / 16); p.settings.fps = 30; p.settings.intro = false;
    p.lines.forEach((l, i) => { l.times = l.times.map((_, k) => 0.3 + i * 1.2 + k * 0.1); });
    p.lyricStyleEvents = [{ id: 's1', time: 0, style: 'impact' }];
    p.lookEvents = [{ id: 'l1', time: 0, kind: 'style', value: 'impact' }];
    p.fxEvents = [{ id: 'f1', time: 1.5, fx: 'shockwave', hold: 0 }];
  });
});
await page.click('#btnExport');
await page.fill('#exportForm input[type=number] >> nth=1', process.argv[3] || '1');
await page.dispatchEvent('#exportForm input[type=number] >> nth=1', 'change');
const dl = page.waitForEvent('download', { timeout: 600000 });
await page.click('#exportStart');
const poll = setInterval(async () => { try { console.log('..', await page.textContent('#exportStatus')); } catch {} }, 5000);
dl.finally(() => clearInterval(poll));
const d = await dl;
const file = path.join(outDir, d.suggestedFilename());
await d.saveAs(file);
console.log('status:', await page.textContent('#exportStatus'));
console.log('saved', file, fs.statSync(file).size);
await browser.close();
