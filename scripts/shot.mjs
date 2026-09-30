// Render harness frames to PNG: node scripts/shot.mjs <outdir> <query> <t1,t2,...>
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const [outDir = 'test-out', query = 'style=kinetic', times = '5'] = process.argv.slice(2);
const exe = chromiumPath();
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:5178/test.html?${query}`);
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 60000 });
const err = await page.evaluate(() => window.__error);
if (err) { console.error(err); }
for (const t of times.split(',').map(Number)) {
  await page.evaluate((t) => window.__render(t), t);
  const canvas = await page.$('canvas');
  const name = `${query.replace(/[^a-z0-9=]+/gi, '_').slice(0, 120)}_t${t}.png`;
  await canvas.screenshot({ path: path.join(outDir, name) });
  console.log('saved', name);
}
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await browser.close();
