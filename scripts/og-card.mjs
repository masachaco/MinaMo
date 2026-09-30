// Share-card image (Open Graph / X card) → public/og.jpg, 1200×630 (dev server running).
// Background: a KINETIC frame from the test page; foreground: the MinaMo logo and tagline.
// Fonts (Montserrat, Noto Sans JP; SIL OFL) are fetched from Google Fonts in Node and embedded, since the
// headless browser may not reach them.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { chromiumPath } from './_env.mjs';

const OUT = process.argv[2] ?? 'public/og.jpg';
const TAG = 'キーを叩いて作るリリックMV';
const TAG2 = '歌に合わせて、歌詞とエフェクトが広がる ブラウザアプリ';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

async function fontFaces(query, keep = () => true) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?${query}`, { headers: { 'User-Agent': UA } })).text();
  const out = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    if (!keep(block)) continue;
    const url = block.match(/url\((https:[^)]+)\)/)[1];
    const b64 = Buffer.from(await (await fetch(url)).arrayBuffer()).toString('base64');
    out.push(block.replace(url, `data:font/woff2;base64,${b64}`));
  }
  return out.join('\n');
}
const fonts = (await fontFaces('family=Montserrat:wght@500;800', (b) => b.includes('U+0000-00FF')))
  + (await fontFaces(`family=Noto+Sans+JP:wght@500;700&text=${encodeURIComponent(TAG + TAG2 + '水面')}`));

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto('http://localhost:5178/test.html?style=kinetic&bg=1&notitle=1&char=0&w=1200&h=630&lyrics=' + encodeURIComponent('水面に/広がる|RIPPLES ON THE WATER'));
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 60000 });
await page.evaluate((t) => window.__render(t), 4.9);
const bg = (await (await page.$('canvas')).screenshot()).toString('base64');

const ripple = '<svg viewBox="0 0 24 24" width="64" height="64"><circle cx="12" cy="12" r="2.6" fill="#08d9d6"/><circle cx="12" cy="12" r="6.4" fill="none" stroke="#08d9d6" stroke-width="1.6" opacity=".75"/><circle cx="12" cy="12" r="10.2" fill="none" stroke="#08d9d6" stroke-width="1.2" opacity=".4"/></svg>';
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#07070d}
.bg{position:absolute;inset:0;background:#07070d url(data:image/png;base64,${bg}) no-repeat 330px 0/1200px 630px}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(7,7,13,1) 0%,rgba(7,7,13,.9) 40%,rgba(7,7,13,0) 62%)}
.brand{position:absolute;left:72px;top:170px;color:#fff;font-family:Montserrat,'Noto Sans JP',sans-serif}
.logo{display:flex;align-items:center;gap:18px}
.name{font-weight:800;font-size:92px;letter-spacing:.02em;line-height:1}
.name b{color:#ff2e63}
.sub{margin-top:14px;font-weight:500;font-size:20px;letter-spacing:.35em;color:#8a8aa0}
.tag{margin-top:40px;font-family:'Noto Sans JP',sans-serif;font-weight:700;font-size:34px;line-height:1.5}
.tag2{margin-top:6px;font-family:'Noto Sans JP',sans-serif;font-weight:500;font-size:22px;color:#c9c9d6}
</style></head><body><div class="bg"></div><div class="shade"></div>
<div class="brand"><div class="logo">${ripple}<div class="name">Mina<b>Mo</b></div></div>
<div class="sub">水面 · MUSIC MOVIE</div><div class="tag">${TAG}</div><div class="tag2">${TAG2}</div></div></body></html>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, type: 'jpeg', quality: 88 });
await browser.close();
console.log('saved', OUT);
