// Plugin kinds in the real app (dev server running): lyric-only / look-only styles, camera framings / moves,
// palettes, element effects / motions (lyrics / telop / chara), element-targeted and overflowing FX — key assignment
// per track, keyless overflow, double-click menu, key rewrite, inspector, left panel, REC, compile fallback,
// rendering, and rejected ids. Uses the skill's templates as the plugins.
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import path from 'node:path';
import os from 'node:os';

const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let fails = 0;
const check = (name, cond, extra = '') => {
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};
await page.goto('http://localhost:5178/?demo=0');
await page.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function' && window.MinaMo, null, { timeout: 30000 });
await page.evaluate(async () => {
  const app = window.app;
  await app.setAudioFile(await (await fetch('/test-song')).blob(), 'music_bgm_200.wav');
  app.mutate((p) => {
    p.settings.bpm = 200;
    p.settings.eventSnap = 0;
    p.camEvents = [];
    p.lyricStyleEvents = [];
    p.lookEvents = [];
  });
  app.pause();
  app.seek(0);
  const T = '/.claude/skills/minamo-plugin/templates/';
  for (const f of ['lyric-style.js', 'look.js', 'camera.js', 'palette.js']) (await import(T + f)).default(window.MinaMo);
  const tl = window.timeline;
  tl.snap = false;
  tl.pps = 200;
  tl.start = 0;
});
await page.waitForTimeout(500);

const keysOf = (mode) => page.evaluate((mode) => {
  const app = window.app;
  app.setMode(mode);
  return app.perfKeyList().map((k) => ({ key: k.key, label: k.label, group: k.group }));
}, mode);
const find = (list, label) => list.find((k) => k.label === label);

// ---- styles: lyric-only / look-only appear on one side only, each side counts its own number keys
const ly = await keysOf('lyrics');
const lk = await keysOf('look');
check('lyric-only style on LYRICS key 8', find(ly, 'MY LYRIC')?.key === '8', JSON.stringify(find(ly, 'MY LYRIC')));
check('lyric-only style not in LOOK', !find(lk, 'MY LYRIC'));
check('look-only style on LOOK key 8', find(lk, 'MY LOOK')?.key === '8', JSON.stringify(find(lk, 'MY LOOK')));
check('look-only style not in LYRICS', !find(ly, 'MY LOOK'));
// ---- palettes: n / m in LOOK
check('plugin palettes on LOOK n / m', find(lk, 'Matcha')?.key === 'n' && find(lk, 'Night Pool')?.key === 'm', JSON.stringify([find(lk, 'Matcha'), find(lk, 'Night Pool')]));
// ---- camera: preferred keys
let cam = await keysOf('camera');
check('plugin framings on z / x', find(cam, 'ハイアングル')?.key === 'z' && find(cam, 'リビール')?.key === 'x');
check('plugin moves on p / [', find(cam, 'ゆらぎ')?.key === 'p' && find(cam, 'キック')?.key === '[');

// ---- validation
const rejects = await page.evaluate(() => {
  const api = window.MinaMo;
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  return {
    moveAuto: throws(() => api.registerCameraMove({ id: 'auto', name: 'x', apply() {} })),
    palCustom: throws(() => api.registerPalette({ id: 'custom', name: 'x', bg: '#000000', text: '#ffffff', accent: '#ff0000', accent2: '#00ff00' })),
    palBadColor: throws(() => api.registerPalette({ id: 'bad', name: 'x', bg: 'red', text: '#ffffff', accent: '#ff0000', accent2: '#00ff00' })),
    lyricNoLine: throws(() => api.registerStyle({ id: 'no-line', name: 'x', color: '#fff', use: 'lyric' })),
    badUse: throws(() => api.registerStyle({ id: 'bad-use', name: 'x', color: '#fff', use: 'both-ish', line() {} })),
    lookNoLine: !throws(() => api.registerStyle({ id: 'look-no-line', name: 'LOOK NO LINE', color: '#fff', use: 'look' })),
  };
});
for (const [k, v] of Object.entries(rejects)) check(`validation: ${k}`, v);

// ---- built-ins are plugins too: the same id replaces one (keeping its place and key), like styles / FX
const override = await page.evaluate(() => {
  const api = window.MinaMo, orig = api.listFramings().find((f) => f.id === 'wide');
  api.registerFraming({ ...orig, name: 'ワイド改' });
  const r = { count: api.listFramings().filter((f) => f.id === 'wide').length, name: api.listFramings()[0].name };
  api.registerFraming(orig);
  return r;
});
check('a built-in framing can be replaced by id (same place)', override.count === 1 && override.name === 'ワイド改', JSON.stringify(override));

// ---- more framings than free keys: the rest are keyless but still listed (key panel / menu / inspector)
await page.evaluate(() => {
  for (let i = 0; i < 5; i++) window.MinaMo.registerFraming({ id: `extra${i}`, name: `追加${i}`, pose: () => ({ sy: 1.02, fy: 1, zoom: 1 + i * 0.1, rot: 0 }) });
});
cam = await keysOf('camera');
const extras = cam.filter((k) => k.label.startsWith('追加'));
check('overflow framings listed', extras.length === 5, JSON.stringify(extras.map((k) => k.key)));
check('first 3 extra framings get c v b, the rest are keyless', extras.map((k) => k.key).join(',') === 'c,v,b,,', JSON.stringify(extras.map((k) => k.key)));
const keyless = await page.evaluate(() => document.querySelectorAll('.key[data-key=""]').length);
check('keyless entries shown in the key panel', keyless >= 2, `(${keyless})`);

// ---- double-click on the CAMERA lane → plugin framing in the menu → placed; key rewrites it
const at = (row, t, dy = 0.5) => page.evaluate(({ row, t, dy }) => {
  const tl = window.timeline, r = tl.row(row), box = tl.canvas.getBoundingClientRect();
  return { x: box.left + tl.x(t), y: box.top + r.y + r.h * dy };
}, { row, t, dy });
let p = await at('camera', 2.0);
await page.mouse.dblclick(p.x, p.y);
await page.waitForSelector('.popup-menu', { timeout: 3000 });
check('menu lists a keyless plugin framing', await page.$('.popup-menu .pm-item:has-text("追加4")') !== null);
await page.click('.popup-menu .pm-item:has-text("ハイアングル")');
await page.waitForTimeout(200);
let evs = await page.evaluate(() => window.app.project.camEvents.map((e) => `${e.kind}:${e.value}@${e.time.toFixed(2)}`));
check('plugin framing placed from the menu', evs.length === 1 && evs[0].startsWith('frame:my-high@2.0'), JSON.stringify(evs));
await page.keyboard.press('KeyX');
await page.waitForTimeout(200);
evs = await page.evaluate(() => window.app.project.camEvents.map((e) => `${e.kind}:${e.value}`));
check('key rewrites it to another plugin framing', evs[0] === 'frame:my-reveal', JSON.stringify(evs));
const inspOpts = await page.evaluate(() => [...document.querySelectorAll('.inspector select option')].map((o) => o.textContent));
check('inspector offers plugin framings (keyless too)', inspOpts.includes('ハイアングル') && inspOpts.includes('追加4'), JSON.stringify(inspOpts.slice(0, 20)));
// a move from the key panel's plugin key while stopped with nothing selected → nothing recorded
await page.evaluate(() => window.app.select(null));
await page.keyboard.press('BracketLeft');
await page.waitForTimeout(200);
evs = await page.evaluate(() => window.app.project.camEvents.length);
check('stopped + no selection: plugin key records nothing', evs === 1);

// ---- left panel: lyric style / look selects list only fitting styles; palette grid has plugin palettes
const panel = await page.evaluate(() => {
  const selOf = (label) => {
    const row = [...document.querySelectorAll('.row')].find((r) => r.querySelector(':scope > label')?.textContent === label);
    return row ? [...row.querySelectorAll('select option')].map((o) => o.value) : null;
  };
  return { lyric: selOf('歌詞スタイル'), look: selOf('ルック'), pals: [...document.querySelectorAll('.palettes .pal')].map((b) => b.title) };
});
check('panel 歌詞スタイル: has my-lyric, no my-look', panel.lyric?.includes('my-lyric') && !panel.lyric.includes('my-look') && !panel.lyric.includes('look-no-line'), JSON.stringify(panel.lyric));
check('panel ルック: has my-look, no my-lyric', panel.look?.includes('my-look') && panel.look.includes('look-no-line') && !panel.look.includes('my-lyric'), JSON.stringify(panel.look));
check('panel palettes include plugin palettes', panel.pals.includes('Matcha') && panel.pals.includes('Night Pool'), JSON.stringify(panel.pals));

// ---- compile: role fallback, and a full render with every plugin kind active
const comp = await page.evaluate(async () => {
  const app = window.app;
  const wait = () => new Promise((r) => setTimeout(r, 400));
  app.mutate((p) => { p.settings.lyricStyle = 'my-look'; p.settings.lookStyle = 'my-lyric'; });
  await wait();
  const fallback = { lyric: app.compiled.lyricSegs[0].style.id, look: app.compiled.lookSegs[0].style.id };
  app.mutate((p) => {
    p.settings.lyricStyle = 'my-lyric';
    p.settings.lookStyle = 'my-look';
    p.settings.paletteId = 'my-matcha';
    p.camEvents.push({ id: 'mv1', time: 0, kind: 'move', value: 'my-kick' });
  });
  app.seek(3);
  await wait();
  return { fallback, lyric: app.compiled.lyricSegs[0].style.id, look: app.compiled.lookSegs[0].style.id };
});
check('look-only style as lyric style falls back', comp.fallback.lyric !== 'my-look', JSON.stringify(comp.fallback));
check('lyric-only style as look falls back', comp.fallback.look !== 'my-lyric');
check('compiled with the plugin styles', comp.lyric === 'my-lyric' && comp.look === 'my-look', JSON.stringify(comp));

// ---- element effects / motions: one API for the lyrics, the telops and the characters, same keys in each track
await page.evaluate(async () => {
  const app = window.app;
  app.select(null);
  app.mutate((p) => { p.camEvents = []; p.settings.lyricStyle = 'kinetic'; p.settings.lookStyle = 'kinetic'; p.settings.paletteId = 'midnight'; });
  app.seek(0);
  const T = '/.claude/skills/minamo-plugin/templates/';
  for (const f of ['effect.js', 'motion.js', 'fx.js']) (await import(T + f)).default(window.MinaMo);
});
await page.waitForTimeout(300);
const lyK = await keysOf('lyrics'), teK = await keysOf('telop'), chK = await keysOf('chara');
const keyOf = (list, label, group) => list.find((k) => k.label === label && (!group || k.group.startsWith(group)))?.key;
check('built-in effects on Q W E R T in every element track', ['影', '縁取り', 'グロー', 'スライス', 'シルエット'].every((n, i) => [lyK, teK, chK].every((l) => keyOf(l, n, 'EFFECT') === 'qwert'[i])));
check('built-in motions: lyrics / telop on the A row, chara on the Z row',
  keyOf(lyK, '静止', 'MOTION') === 'a' && keyOf(lyK, 'バウンス', 'MOTION') === 's' && keyOf(teK, 'ブルブル', 'MOTION') === 'h' && keyOf(chK, 'バウンス', 'MOTION') === 'x' && keyOf(chK, 'オート', 'MOTION') === 'm');
check('plugin effects on the same keys in every track', [lyK, teK, chK].every((l) => keyOf(l, 'RGBずれ', 'EFFECT') === 'i' && keyOf(l, '虹色', 'EFFECT') === 'o'));
check('targets: chara-only effect only in CHARA', keyOf(chK, 'オーラ', 'EFFECT') === 'p' && keyOf(lyK, 'オーラ') === undefined && keyOf(teK, 'オーラ') === undefined);
check('plugin motions on J K, text-only one on L (not CHARA)',
  [lyK, teK, chK].every((l) => keyOf(l, 'パルス', 'MOTION') === 'j' && keyOf(l, '点滅', 'MOTION') === 'k') && keyOf(lyK, 'スライドイン') === 'l' && keyOf(teK, 'スライドイン') === 'l' && keyOf(chK, 'スライドイン') === undefined);
check('lyric taps keep N / X, telop keeps X', keyOf(lyK, '単語ごと') === 'n' && keyOf(lyK, '歌詞を消す') === 'x' && keyOf(teK, '表示中を消す') === 'x');
const dupKeys = (l) => {
  const ks = l.map((k) => k.key).filter(Boolean);
  return ks.filter((k, i) => ks.indexOf(k) !== i);
};
check('no key used twice in LYRICS / TELOP / CHARA', ![lyK, teK, chK].some((l) => dupKeys(l).length), JSON.stringify([lyK, teK, chK].map(dupKeys)));

const rejE = await page.evaluate(() => {
  const api = window.MinaMo;
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  return {
    effectNoHook: throws(() => api.registerEffect({ id: 'x-nohook', name: 'x' })),
    effectComma: throws(() => api.registerEffect({ id: 'a,b', name: 'x', under() {} })),
    effectReserved: throws(() => api.registerEffect({ id: 'none', name: 'x', under() {} })),
    effectBadTarget: throws(() => api.registerEffect({ id: 'x-bad', name: 'x', targets: ['look'], under() {} })),
    motionNoOffsets: throws(() => api.registerMotion({ id: 'x-nooff', name: 'x' })),
    motionReserved: throws(() => api.registerMotion({ id: 'auto', name: 'x', offsets() {} })),
  };
});
for (const [k, v] of Object.entries(rejE)) check(`validation: ${k}`, v);

// lyrics' effect / motion strip: double-click → only lyric effects / motions → placed; keys edit the selection
const menuTexts = () => page.evaluate(() => [...document.querySelectorAll('.popup-menu .pm-item')].map((e) => e.textContent));
p = await at('lyrics', 3.0, 0.93);
await page.mouse.dblclick(p.x, p.y);
await page.waitForSelector('.popup-menu', { timeout: 3000 });
let items = await menuTexts();
check('lyric effect strip menu: effects + motions only', items.some((x) => x.includes('グロー')) && items.some((x) => x.includes('RGBずれ')) && items.some((x) => x.includes('スライドイン')) && !items.some((x) => x.includes('オーラ')) && !items.some((x) => x.includes('GLITCH')), JSON.stringify(items));
await page.click('.popup-menu .pm-item:has-text("グロー")');
await page.waitForTimeout(200);
let le = await page.evaluate(() => window.app.project.lyricEvents.map((e) => `${e.kind}:${e.value}@${e.time.toFixed(2)}`));
check('lyric effect placed from the strip menu', le.length === 1 && le[0].startsWith('effect:glow@3.0'), JSON.stringify(le));
await page.keyboard.press('KeyI');
await page.waitForTimeout(200);
le = await page.evaluate(() => window.app.project.lyricEvents.map((e) => `${e.kind}:${e.value}`));
check('effect key toggles into the selected lyric event', le.length === 1 && le[0] === 'effect:glow,my-rgb', JSON.stringify(le));
await page.keyboard.press('Digit2');
await page.waitForTimeout(200);
const afterStyleKey = await page.evaluate(() => ({ le: window.app.project.lyricEvents.map((e) => e.value), ls: window.app.project.lyricStyleEvents.length }));
check('a style key does not rewrite an effect event', afterStyleKey.le.join() === 'glow,my-rgb' && afterStyleKey.ls === 0, JSON.stringify(afterStyleKey));
const insp = await page.evaluate(() => [...document.querySelectorAll('.inspector label')].map((l) => l.textContent));
check('inspector: effect checkboxes (plugins too, chara-only excluded)', insp.includes('RGBずれ') && insp.includes('グロー') && !insp.includes('オーラ'), JSON.stringify(insp));
p = await at('lyrics', 4.0, 0.08);
await page.mouse.dblclick(p.x, p.y);
await page.waitForSelector('.popup-menu', { timeout: 3000 });
items = await menuTexts();
check('lyric style strip menu: styles only', items.some((x) => x.includes('GLITCH')) && !items.some((x) => x.includes('グロー')), JSON.stringify(items));
await page.keyboard.press('Escape');
// telop strip → motion
p = await at('telop', 5.0, 0.9);
await page.mouse.dblclick(p.x, p.y);
await page.waitForSelector('.popup-menu', { timeout: 3000 });
await page.click('.popup-menu .pm-item:has-text("ゆらゆら")');
await page.waitForTimeout(200);
const te = await page.evaluate(() => ({ ev: window.app.project.telopEvents.map((e) => `${e.kind}:${e.value}@${e.time.toFixed(1)}`), mode: window.app.mode }));
check('telop motion placed from the strip menu (TELOP armed)', te.ev.join() === 'motion:sway@5.0' && te.mode === 'telop', JSON.stringify(te));

// ---- FX past the free keys: keyless, but in the key panel and the double-click menu
await page.evaluate(() => {
  window.app.select(null);
  for (let i = 0; i < 8; i++) window.MinaMo.registerFx({ id: `xfx${i}`, name: `追加FX${i}`, color: '#ffffff', duration: 0.3, apply() {} });
});
const fxK = await keysOf('fx');
const extraFx = fxK.filter((k) => k.label.startsWith('追加FX'));
check('FX past the free keys are listed keyless', extraFx.length === 8 && extraFx.filter((k) => k.key === '').length === 5 && keyOf(fxK, '歌詞パンチ') === 'n', JSON.stringify(extraFx.map((k) => k.key)));
check('keyless FX shown in the key panel', (await page.evaluate(() => document.querySelectorAll('.key[data-key=""]').length)) >= 5);
p = await at('fx', 6.0);
await page.mouse.dblclick(p.x, p.y);
await page.waitForSelector('.popup-menu', { timeout: 3000 });
await page.click('.popup-menu .pm-item:has-text("追加FX7")');
await page.waitForTimeout(200);
check('keyless FX placed from the menu', await page.evaluate(() => window.app.project.fxEvents.some((e) => e.fx === 'xfx7' && Math.abs(e.time - 6) < 0.05)));

// ---- REC: effect / motion keys record into the lyrics track; 上書き prunes them with the styles
// REC from the current time: press `keys` (250 ms apart), stop once song time is `minDur` past the start
const recTake = async (keys, minDur = 0) => {
  const t0 = await page.evaluate(() => window.app.time);
  await page.keyboard.press('Shift+R');
  await page.waitForFunction((t0) => window.app.time > t0 + 0.25, t0, { timeout: 15000 }).catch(() => {});
  for (const k of keys) {
    await page.keyboard.press(k);
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(({ t0, minDur }) => window.app.time > t0 + minDur, { t0, minDur }, { timeout: 15000 }).catch(() => {});
  await page.keyboard.press('Shift+R');
  await page.waitForTimeout(300);
};
await page.evaluate(() => { const app = window.app; app.select(null); app.setMode('lyrics'); app.setOverdub(true); app.mutate((p) => { p.lyricEvents = []; p.settings.eventSnap = 0; }); app.seek(10); });
await recTake(['KeyW', 'KeyD']);
const rec1 = await page.evaluate(() => window.app.project.lyricEvents.map((e) => `${e.kind}:${e.value}`));
check('REC records lyric effect / motion keys', rec1.includes('effect:outline') && rec1.includes('motion:sway'), JSON.stringify(rec1));
const rec1Times = await page.evaluate(() => window.app.project.lyricEvents.map((e) => e.time));
await page.evaluate(() => { window.app.setOverdub(false); window.app.seek(10); });
await recTake([], Math.max(...rec1Times) - 10 + 0.3);
const rec2 = await page.evaluate(() => window.app.project.lyricEvents.length);
check('上書き REC prunes the lyric effect / motion events in the range', rec2 === 0, `${rec2} left (take 1 at ${rec1Times.map((x) => x.toFixed(2))})`);
await page.evaluate(() => window.app.setOverdub(true));

// ---- render with every element effect / motion kind on, plus an element-only FX
const drawn = await page.evaluate(async () => {
  const app = window.app;
  const wait = () => new Promise((r) => setTimeout(r, 400));
  const c = document.createElement('canvas');
  c.width = 300; c.height = 700;
  const x = c.getContext('2d');
  x.fillStyle = '#e05080'; x.fillRect(80, 100, 140, 560); x.fillStyle = '#ffe2d0'; x.beginPath(); x.arc(150, 90, 70, 0, 7); x.fill();
  await app.addCharacterFile(await new Promise((r) => c.toBlob((b) => r(new File([b], 'chara.png', { type: 'image/png' })), 'image/png')));
  app.mutate((p) => {
    p.lines[0].times = p.lines[0].times.map((_, k) => 1 + k * 0.1);
    p.telops = p.telops.map((t, i) => (i === 0 ? { ...t, start: 0.5, dur: null } : t));
    p.lyricEvents = [{ id: 'l1', time: 0, kind: 'effect', value: 'shadow,my-rgb,glow' }, { id: 'l2', time: 0, kind: 'motion', value: 'my-slide' }];
    p.telopEvents = [{ id: 't1', time: 0, kind: 'effect', value: 'outline,my-rainbow' }, { id: 't2', time: 0, kind: 'motion', value: 'my-blink' }];
    p.charaEvents = [{ id: 'c1', time: 0, kind: 'effect', value: 'my-aura,silhouette,slice,missing-plugin' }, { id: 'c2', time: 0, kind: 'motion', value: 'my-pulse' }];
    p.fxEvents = [{ id: 'f1', time: 1.2, fx: 'my-lyric-punch', hold: 0 }];
  });
  const shots = [];
  for (const t of [1.25, 2.0]) {
    app.seek(t);
    await wait();
    shots.push(app.renderer.output.toDataURL('image/png').length);
  }
  const C = app.compiled;
  return { shots, lyr: C.elem.lyrics.effect.at(-1).v, tel: C.elem.telop.motion.at(-1).v, chara: app.effectsAt('chara', 2) };
});
check('element effects / motions compiled (unknown ids kept)', drawn.lyr.join() === 'shadow,my-rgb,glow' && drawn.tel === 'my-blink' && drawn.chara.includes('missing-plugin'), JSON.stringify(drawn));
check('frames rendered with every element effect / motion kind', drawn.shots.every((n) => n > 5000), JSON.stringify(drawn.shots));
await page.screenshot({ path: 'test-out/plugin-test.png' });
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
