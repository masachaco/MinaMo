// Render a plugin with the dev harness and check it (dev server must be running: npm run dev;
// Chromium: npx playwright-core install chromium once, or CHROMIUM_PATH=<chrome>).
//
//   node .claude/skills/minamo-plugin/scripts/check-plugin.mjs <plugin.js | -> "<test.html query>" <t1,t2,...>
//   camera:  ... plugins/my-camera.js "style=kinetic&notitle=1&frame=my-high&move=my-sway" 4.5,6
//   palette: ... plugins/my-palette.js "style=neon&notitle=1&pal=my-matcha" 4.5
//   effect:  ... plugins/my-effect.js "style=kinetic&notitle=1&bg=1&leffect=my-rgb&ceffect=my-rgb" 4.4,5.2
//   motion:  ... plugins/my-motion.js "style=kinetic&notitle=1&lmotion=my-pulse&cmotion=my-pulse&tel=lower&tmotion=my-pulse" 1,4.4
//
// - <plugin.js>: path from the repo root (served by Vite), or "-" for built-ins only
// - frames → test-out/plugin-check/<name>_t<t>.png  (look at them!)
// - fails (exit 1) on load / page errors, or when the same time renders differently (not a pure function of t)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [plugin = '-', query = 'style=kinetic', times = '4.5,5.5'] = process.argv.slice(2);
const ts = times.split(',').map(Number).filter((x) => Number.isFinite(x));
const outDir = 'test-out/plugin-check';
fs.mkdirSync(outDir, { recursive: true });
if (plugin !== '-' && !fs.existsSync(plugin)) {
  console.error(`plugin not found: ${plugin}`);
  process.exit(1);
}
// Chromium: CHROMIUM_PATH, else the one installed with `npx playwright-core install chromium`
const exe = process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH) ? process.env.CHROMIUM_PATH : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  const s = m.text();
  // failed resources are reported below with their URL
  if ((m.type() === 'error' || m.type() === 'warning') && !s.includes('404') && !s.startsWith('Failed to load resource')) errors.push(`${m.type()}: ${s}`);
});
// unreachable web fonts (offline / sandboxed) fall back to other fonts: not a plugin error
page.on('requestfailed', (r) => {
  if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.url())) errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`);
});
const params = new URLSearchParams(query);
if (plugin !== '-') params.set('plugin', '/' + plugin.replace(/^\.?\//, ''));
await page.goto(`http://localhost:5178/test.html?${params}`);
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 60000 });
const loadErr = await page.evaluate(() => window.__error);
if (loadErr) {
  console.log(`FAIL load\n${loadErr}`);
  await browser.close();
  process.exit(1);
}
const registered = await page.evaluate(() => window.__registry?.() ?? { styles: [], fx: [], viz: [], telops: [] });
const canvas = await page.$('canvas');
const shot = async (t) => {
  await page.evaluate((t) => window.__render(t), t);
  return canvas.screenshot();
};
const name = plugin === '-' ? 'builtin' : path.basename(plugin, '.js');
for (const t of ts) {
  const png = await shot(t);
  const file = path.join(outDir, `${name}_t${t}.png`);
  fs.writeFileSync(file, png);
  console.log('saved', file);
}
// determinism: the first time again after rendering the others must give the identical image
const a = await shot(ts[0]);
if (ts.length > 1) await shot(ts[ts.length - 1]);
const b = await shot(ts[0]);
const same = Buffer.compare(a, b) === 0;
console.log(`${same ? 'PASS' : 'FAIL'} same time → same frame (t=${ts[0]})`);
console.log(`${errors.length ? 'FAIL' : 'PASS'} no page errors${errors.length ? '\n  ' + errors.slice(0, 5).join('\n  ') : ''}`);
const only = (a, b) => a.filter((x) => !b.includes(x));
console.log(`registered styles: ${registered.styles.join(', ')}`);
const lyricOnly = only(registered.lyricStyles ?? [], registered.lookStyles ?? []), lookOnly = only(registered.lookStyles ?? [], registered.lyricStyles ?? []);
if (lyricOnly.length || lookOnly.length) console.log(`  lyric only: ${lyricOnly.join(', ') || '-'} / look only: ${lookOnly.join(', ') || '-'}`);
console.log(`registered fx (last 5): ${registered.fx.slice(-5).join(', ')} / viz: ${registered.viz.join(', ')} / telops: ${registered.telops.join(', ')}`);
console.log(`framings: ${registered.framings?.join(', ') || '-'} / moves: ${registered.moves?.join(', ') || '-'} / palettes: ${registered.palettes?.join(', ') || '-'}`);
console.log(`effects: ${registered.effects?.join(', ') || '-'} / motions: ${registered.motions?.join(', ') || '-'}`);
await browser.close();
process.exit(same && !errors.length ? 0 : 1);
