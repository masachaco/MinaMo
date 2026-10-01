// Share-card image (Open Graph / X card) → public/og.jpg, 1200×630 (dev server running).
// Background: a KINETIC frame (ocean palette: water blues) from the test page; foreground: the logo and tagline
// in the brand aqua (#08d9d6, the UI's accent2).
// --mobile → public/og-mobile.jpg: the phone page (mobile/, the demo) in a phone frame on the right.
// Fonts (Montserrat, Noto Sans JP; SIL OFL) are fetched from Google Fonts in Node and embedded, since the
// headless browser may not reach them.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { chromiumPath } from './_env.mjs';

const MOBILE = process.argv.includes('--mobile');
const OUT = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? (MOBILE ? 'public/og-mobile.jpg' : 'public/og.jpg');
const TAG = MOBILE ? 'スマホで叩いて作るリリックMV' : 'キーを叩いて作るリリックMV';
const TAG2 = MOBILE ? '再生しながらパッドを叩くと、エフェクトがその場で広がる' : '歌に合わせて、歌詞とエフェクトが広がる ブラウザアプリ';
const SUB = MOBILE ? 'スマホ版 · MUSIC MOVIE' : '水面 · MUSIC MOVIE';
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
  + (await fontFaces(`family=Noto+Sans+JP:wght@500;700&text=${encodeURIComponent(TAG + TAG2 + SUB)}`));

const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto('http://localhost:5178/test.html?style=kinetic&bg=1&notitle=1&char=0&w=1200&h=630&pal=ocean&lyrics=' + encodeURIComponent('水面に/広がる|RIPPLES ON THE WATER'));
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 60000 });
await page.evaluate((t) => window.__render(t), 4.9);
const bg = (await (await page.$('canvas')).screenshot()).toString('base64');

// the phone page, as on a phone (tutorial marked as seen so it stays out of the shot)
let phone = '';
if (MOBILE) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await ctx.newPage();
  await mp.addInitScript(() => localStorage.setItem('minamo.mobileTutorial', 'done'));
  await mp.goto('http://localhost:5178/mobile/');
  await mp.waitForFunction(() => window.app?.project?.audio && window.app.time > 0 && document.querySelector('#pads .pad'), null, { timeout: 60000 });
  await mp.evaluate(() => window.app.seek(27.2));
  await mp.waitForTimeout(1500);
  phone = (await mp.screenshot()).toString('base64');
  await ctx.close();
}

const ripple = '<svg viewBox="0 0 24 24" width="64" height="64"><circle cx="12" cy="12" r="2.6" fill="#08d9d6"/><circle cx="12" cy="12" r="6.4" fill="none" stroke="#08d9d6" stroke-width="1.6" opacity=".75"/><circle cx="12" cy="12" r="10.2" fill="none" stroke="#08d9d6" stroke-width="1.2" opacity=".4"/></svg>';
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#040d1a}
.bg{position:absolute;inset:0;background:#040d1a url(data:image/png;base64,${bg}) no-repeat ${MOBILE ? '200px' : '330px'} 0/1200px 630px}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,13,26,1) 0%,rgba(4,13,26,.9) 40%,rgba(4,13,26,${MOBILE ? '.45' : '0'}) 62%)}
.phone{position:absolute;right:96px;top:34px;width:262px;height:566px;border-radius:38px;background:#05050a;border:3px solid #2a3a4a;
  box-shadow:0 20px 60px rgba(0,0,0,.7),0 0 0 8px #0d1520,0 0 40px rgba(8,217,214,.35);padding:12px;box-sizing:border-box}
.phone img{width:100%;height:100%;border-radius:28px;display:block;object-fit:cover;object-position:top}
.brand{position:absolute;left:72px;top:170px;color:#fff;font-family:Montserrat,'Noto Sans JP',sans-serif}
.logo{display:flex;align-items:center;gap:18px}
.name{font-weight:800;font-size:92px;letter-spacing:.02em;line-height:1}
.name b{color:#08d9d6}
.sub{margin-top:14px;font-weight:500;font-size:20px;letter-spacing:.35em;color:#7fa6c9}
.tag{margin-top:40px;font-family:'Noto Sans JP',sans-serif;font-weight:700;font-size:34px;line-height:1.5}
.tag2{margin-top:6px;font-family:'Noto Sans JP',sans-serif;font-weight:500;font-size:22px;color:#c4d8ea}
</style></head><body><div class="bg"></div><div class="shade"></div>
<div class="brand"><div class="logo">${ripple}<div class="name">Mina<b>Mo</b></div></div>
<div class="sub">${SUB}</div><div class="tag">${TAG}</div><div class="tag2">${TAG2}</div></div>
${phone ? `<div class="phone"><img src="data:image/png;base64,${phone}"></div>` : ''}</body></html>`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, type: 'jpeg', quality: 88 });
await browser.close();
console.log('saved', OUT);
