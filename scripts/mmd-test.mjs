// MMD checks (dev server running): deterministic sampling, beat-synced loops, physics, lip sync.
// Needs your own MMD files inside the project (never commit them: models/ poses/ motions/ are git-ignored).
// Tell the test where they are, with environment variables or a git-ignored models/mmd-test.json:
//   MMD_MODEL=models/<folder>/<model>.pmx MMD_MOTION=motions/<folder>/<dance>.vmd [MMD_CAMERA=motions/<folder>/<camera>.vmd] npm run test:mmd
//   models/mmd-test.json: { "model": "models/…/….pmx", "motion": "motions/…/….vmd", "camera": "motions/…/….vmd" }
// The model's folder (textures) is read next to it. Skips when nothing is configured.
import { chromium } from 'playwright-core';
import { chromiumPath } from './_env.mjs';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const local = fs.existsSync('models/mmd-test.json') ? JSON.parse(fs.readFileSync('models/mmd-test.json', 'utf8')) : {};
const MODEL_PATH = process.env.MMD_MODEL ?? local.model ?? '';
const MOTION = process.env.MMD_MOTION ?? local.motion ?? '';
const CAMERA = process.env.MMD_CAMERA ?? local.camera ?? '';
if (!MODEL_PATH || !MOTION || !fs.existsSync(MODEL_PATH) || !fs.existsSync(MOTION)) {
  console.log('SKIP mmd test (set MMD_MODEL / MMD_MOTION or models/mmd-test.json to your local files)');
  process.exit(0);
}
const MODEL_DIR = path.dirname(MODEL_PATH).split(path.sep).join('/');
const MODEL = path.basename(MODEL_PATH);
const exe = chromiumPath();
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5178/?demo=0');
await page.waitForFunction(() => window.app?.project && typeof window.timeline?.row === 'function', null, { timeout: 30000 });
const files = fs.readdirSync(MODEL_DIR).filter((f) => /\.(bmp|png|jpe?g|tga|sph|spa)$/i.test(f) || f === MODEL);
const res = await page.evaluate(async ({ files, MODEL_DIR, MOTION, CAMERA, hasCamera }) => {
  const enc = (p) => '/' + p.split('/').map(encodeURIComponent).join('/');
  const blob = async (p) => (await fetch(enc(p))).blob();
  const out = [];
  const ok = (name, cond, extra = '') => out.push(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
  const app = window.app;
  const picked = [];
  for (const f of files) picked.push({ file: new File([await blob(`${MODEL_DIR}/${f}`)], f), path: `m/${f}` });
  const mid = await app.addMmdFolder(picked);
  ok('model added with a rest entry', !!mid && app.project.characters.length === 1 && app.project.characters[0].kind === 'mmd');
  await app.addMmdPoses(mid, [new File([await blob(MOTION)], 'motion.vmd')]);
  const [, moving] = app.project.characters;
  ok('motion entry added', moving?.mmdPose?.kind === 'vmd', moving?.name);
  const a = app.charAssets.get(moving.id);
  const model = a.mmd.model, clip = a.mmd.clip;
  // sampling is a pure function of the local time (no state carried between samples)
  const bones = () => model.mmd.mesh.skeleton.bones.map((b) => [...b.quaternion.toArray(), ...b.position.toArray()]);
  const at = (t) => { model.pose(clip, t); return bones(); };
  const maxDiff = (x, y) => Math.max(...x.map((v, i) => Math.max(...v.map((q, k) => Math.abs(q - y[i][k])))));
  const ref = at(0.45);
  at(1.2); at(0.1);
  ok('same time → same pose after other samples', maxDiff(ref, at(0.45)) < 1e-5);
  ok('loop wraps to the same pose', maxDiff(ref, at(0.45 + model.duration(clip))) < 1e-5);
  // beat sync: one loop spans a whole number of beats (1.8 s → 4 beats at 120 BPM)
  app.mutate((p) => { p.telops = []; p.settings.bpm = 120; p.charaEvents = [{ id: 'a', time: 1, kind: 'char', value: moving.id }]; });
  await new Promise((r) => setTimeout(r, 500));
  const frame = async (t) => { app.seek(t); app.requestFrame(); await new Promise((r) => setTimeout(r, 350)); return a.img.getContext('2d').getImageData(0, 0, a.img.width, a.img.height).data; };
  const px = (x, y) => { let d = 0; for (let i = 0; i < x.length; i += 16) d += Math.abs(x[i] - y[i]); return d; };
  const f0 = await frame(1.5), f4 = await frame(3.5), f2 = await frame(2.5);
  ok('beat sync: 4 beats later is the same frame', px(f0, f4) === 0, `diff=${px(f0, f4)}`);
  ok('beat sync: 2 beats later differs', px(f0, f2) > 0);
  // physics (spring bones): seek = reset + pre-roll (same result every time), consecutive frames = stepped
  const springs = model.mmd.mesh.skeleton.bones.filter((b) => /髪|Hair|Twin|裙|スカート|Skirt/.test(b.name));
  const hair = () => springs.map((b) => b.quaternion.toArray());
  const qd = (x, y) => Math.max(...x.map((v, i) => Math.max(...v.map((q, k) => Math.abs(q - y[i][k])))));
  const input = () => app.frameInput();
  const render = (t) => { app.renderer.render(t, input()); return hair(); };
  ok('spring bones found', springs.length > 0, `n=${springs.length}`);
  a.mmd.key = '';
  let t0 = performance.now();
  const s1 = render(5.0);
  const seekMs = performance.now() - t0;
  render(2.0);
  a.mmd.key = '';
  const s2 = render(5.0);
  ok('physics: seek gives the same hair', qd(s1, s2) < 1e-6, `pre-roll ${seekMs.toFixed(0)} ms`);
  const run = () => { render(3.0); let last; for (let i = 1; i <= 15; i++) last = render(3.0 + i / 30); return last; };
  const r1 = run(), r2 = run();
  ok('physics: consecutive frames reproduce (export)', qd(r1, r2) < 1e-6);
  app.setMmdPhysics(app.project.mmdModels[0].id, false);
  const off = render(3.5);
  app.setMmdPhysics(app.project.mmdModels[0].id, true);
  ok('physics changes the hair', qd(r1, off) > 1e-3, `max=${qd(r1, off).toFixed(3)}`);
  run();
  const held = hair();
  a.mmd.key = '';
  const again = render(3.5);
  ok('paused re-render keeps the simulated hair', qd(held, again) < 1e-6);

  // rotation (per entry, around the model centre): changes the frame, and is still a pure function of time
  const physOff = () => app.setMmdPhysics(app.project.mmdModels[0].id, false);
  physOff();
  const img = () => a.img.getContext('2d').getImageData(0, 0, a.img.width, a.img.height).data;
  a.mmd.key = '';
  app.renderer.render(3.5, input());
  const front = img();
  app.mutate(() => (moving.mmdRot = { x: 10, y: 90, z: -5 }));
  app.renderer.render(3.5, input());
  const side = img();
  app.renderer.render(2.2, input());
  a.mmd.key = '';
  app.renderer.render(3.5, input());
  ok('rotation changes the frame', px(front, side) > 0);
  ok('rotated frame reproduces', px(side, img()) === 0);
  app.mutate(() => delete moving.mmdRot);
  app.setMmdPhysics(app.project.mmdModels[0].id, true);

  // camera VMD: dropped with its motion → attached to that entry; the entry renders full-frame through it
  if (hasCamera) {
    app.mutate(() => delete moving.mmdCamera);
    await app.addMmdPoses(mid, [new File([await blob(MOTION)], 'motion2.vmd'), new File([await blob(CAMERA)], 'camera.vmd')]);
    const withCam = app.project.characters.find((c) => c.mmdCamera);
    ok('camera VMD attached to the motion added with it', !!withCam && withCam.name.endsWith('motion2') && app.project.characters.length === 3, withCam?.name);
    const ca = app.charAssets.get(withCam.id);
    app.mutate((p) => (p.charaEvents = [{ id: 'k', time: 1, kind: 'char', value: withCam.id }]));
    await new Promise((r) => setTimeout(r, 400));
    app.renderer.render(2.5, input());
    const W = app.renderer.W, H = app.renderer.H;
    ok('camera entry renders full-frame', ca.img.width === W && ca.img.height === H, `${ca.img.width}x${ca.img.height} vs ${W}x${H}`);
    const cimg = () => ca.img.getContext('2d').getImageData(0, 0, ca.img.width, ca.img.height).data;
    const c1 = cimg();
    app.renderer.render(1.7, input());
    ca.mmd.key = '';
    app.renderer.render(2.5, input());
    ok('camera frame reproduces (with physics)', px(c1, cimg()) === 0, `diff=${px(c1, cimg())}`);
    app.mutate((p) => (p.charaEvents = [{ id: 'a', time: 1, kind: 'char', value: moving.id }]));
  }

  // lip sync follows the song
  await app.setAudioFile(await blob('test-song'), 'music_bgm_200.wav');
  app.mutate(() => (moving.mmdLip = true));
  await new Promise((r) => setTimeout(r, 500));
  const mesh = model.mmd.mesh, mi = mesh.morphTargetDictionary['あ'];
  const mouth = new Set();
  for (let i = 0; i < 12; i++) { await frame(4 + i * 0.13); mouth.add(mesh.morphTargetInfluences[mi]); }
  ok('lip sync moves the mouth', mouth.size > 1, [...mouth].join(','));
  return out;
}, { files, MODEL_DIR, MOTION, CAMERA, hasCamera: !!CAMERA && fs.existsSync(CAMERA) });
res.forEach((l) => console.log(l));
const fails = res.filter((l) => l.startsWith('FAIL')).length + (errors.length ? 1 : 0);
if (errors.length) console.log('FAIL page errors', errors.slice(0, 3).join(' | '));
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
await browser.close();
process.exit(fails ? 1 : 0);
