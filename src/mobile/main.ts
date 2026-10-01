// Phone page (mobile/index.html): play, REC and on-screen pads for every track — no keyboard needed.
// The pads come from the same key definitions as the PC page (perform.ts) and go through App.handleKeyDown /
// handleKeyUp as if the key had been pressed, so taps, holds and REC behave exactly like the keyboard.
import '../style.css';
import './mobile.css';
import '../plugins';
import { App } from '../app';
import { lineFirstTarget } from '../core/lyrics';
import { downloadBlob } from '../core/storage';
import { findTelop } from '../engine/api';
import { fmtTime, graphemes } from '../engine/lib';
import { canExport, exportVideo, type ExportJob } from '../export/exporter';
import { installGlobalApi, loadStoredPlugins } from '../plugin-loader';
import { MODES, modeInfo, trackStateText, type PerfKey } from '../perform';
import { $, h, pickFile, toast } from '../ui/dom';
import { mobileTutorialSeen, startMobileTutorial } from './tutorial';

async function boot() {
  installGlobalApi();
  await loadStoredPlugins();
  const app = new App($('#out') as HTMLCanvasElement);
  (window as any).app = app;
  await app.init().catch((e) => console.error(e));
  // the phone page opens on the FX track (pads work while just playing)
  app.setMode('fx');

  wireTransport(app);
  const pads = buildPads(app);
  const prompter = buildPrompter(app);
  buildDrawer(app);
  const layout = frameLayout(app);
  app.on('project', layout);
  window.addEventListener('resize', layout);
  new ResizeObserver(layout).observe($('#viewport'));
  layout();

  const seek = $('#seek') as HTMLInputElement;
  let seeking = false;
  seek.addEventListener('pointerdown', () => (seeking = true));
  seek.addEventListener('input', () => app.seek(parseFloat(seek.value)));
  seek.addEventListener('change', () => (seeking = false));

  const loop = () => {
    app.tick();
    const t = app.time;
    $('#tcTime').textContent = fmtTime(t);
    if (app.compiled) {
      const b = app.compiled.grid.state(t);
      $('#tcBar').textContent = `${String(Math.max(0, b.bar + 1)).padStart(3, '0')}.${b.inBar + 1}`;
    }
    seek.max = String(Math.max(1, app.duration));
    if (!seeking) seek.value = String(t);
    pads();
    prompter();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  $('#btnHelp').addEventListener('click', () => startMobileTutorial(app));
  const forced = new URLSearchParams(location.search).get('tutorial') === '1';
  if (forced || (app.firstVisit && !mobileTutorialSeen())) startMobileTutorial(app);
  else if (!app.project.audio) toast('☰ から曲を読み込んで始めましょう', 4000);
}

/** A pad press, as the keyboard key it stands for (App.handleKeyDown reads only these fields). */
function keyEvent(key: string, e: PointerEvent): KeyboardEvent {
  return { key, code: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, timeStamp: e.timeStamp, target: document.body, preventDefault() {} } as unknown as KeyboardEvent;
}

function wireTransport(app: App) {
  const play = $('#btnPlay');
  const rec = $('#btnRec');
  const overdub = $('#btnOverdub');
  const tabs = $('#modeTabs');
  tabs.replaceChildren(...MODES.map((m) => h('button', {
    class: 'mode-tab', 'data-mode': m.id, style: `--c:${m.color}`, onclick: () => app.setMode(m.id),
  }, m.name)));
  const sync = () => {
    play.textContent = app.engine.playing ? '❚❚' : '▶';
    const info = modeInfo(app.mode);
    rec.classList.toggle('on', app.recording);
    rec.textContent = app.recording ? `■ 停止` : `● REC ${info.name}`;
    rec.style.setProperty('--c', info.color);
    overdub.textContent = app.overdub ? '重ね録り' : '上書き';
    overdub.classList.toggle('warn', !app.overdub);
    tabs.querySelectorAll<HTMLElement>('.mode-tab').forEach((b) => b.classList.toggle('on', b.dataset.mode === app.mode));
    tabs.classList.toggle('locked', app.recording);
    document.body.classList.toggle('recording', app.recording);
    tabs.querySelector('.mode-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  for (const ev of ['mode', 'transport', 'rec', 'project']) app.on(ev, sync);
  play.addEventListener('click', () => app.togglePlay());
  rec.addEventListener('click', () => app.toggleRec());
  overdub.addEventListener('click', () => {
    if (app.recording) return;
    app.setOverdub(!app.overdub);
    toast(app.overdub ? '重ね録り：今の記録に追加します' : '上書き：録音した区間のこのトラックを差し替えます');
  });
  const bar = () => app.compiled?.grid.barDur ?? 2;
  $('#btnHome').addEventListener('click', () => app.seek(0));
  $('#btnBack').addEventListener('click', () => app.seek(Math.max(0, app.time - bar())));
  $('#btnFwd').addEventListener('click', () => app.seek(Math.min(app.duration, app.time + bar())));
  $('#btnUndo').addEventListener('click', () => !app.recording && app.undo());
  $('#btnRedo').addEventListener('click', () => !app.recording && app.redo());
  sync();
}

function frameLayout(app: App) {
  return () => {
    const vp = $('#viewport');
    const fr = $('#frame');
    const r = vp.getBoundingClientRect();
    const ar = app.settings.width / app.settings.height;
    let w = r.width, hh = w / ar;
    if (hh > r.height) {
      hh = r.height;
      w = hh * ar;
    }
    fr.style.width = `${Math.max(10, w)}px`;
    fr.style.height = `${Math.max(10, hh)}px`;
  };
}

/** Pads of the armed track. Returns the per-frame update (lights). */
function buildPads(app: App) {
  const root = $('#pads');
  let lights: { el: HTMLElement; k: PerfKey }[] = [];
  const held = new Map<number, string>(); // pointerId → key

  const press = (k: PerfKey, el: HTMLElement, e: PointerEvent) => {
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    if (!app.recording && !app.engine.playing) {
      toast('▶ 再生中に押すと試せます。記録するには ● REC');
      return;
    }
    if (k.recOnly && !app.recording) {
      toast('● REC 中に押すと記録されます');
      return;
    }
    navigator.vibrate?.(8);
    // keys without a keyboard key (registered beyond the free slots) have no hold
    if (!k.key) {
      app.perform(k, app.eventTime(e), false);
      return;
    }
    held.set(e.pointerId, k.key);
    app.handleKeyDown(keyEvent(k.key, e));
  };
  const release = (e: PointerEvent) => {
    const key = held.get(e.pointerId);
    if (key == null) return;
    held.delete(e.pointerId);
    app.handleKeyUp(keyEvent(key, e));
  };

  const render = () => {
    const keys = app.perfKeyList();
    const groups = new Map<string, PerfKey[]>();
    for (const k of keys) {
      let g = groups.get(k.group);
      if (!g) groups.set(k.group, (g = []));
      g.push(k);
    }
    lights = [];
    const pad = (k: PerfKey) => {
      const el = h('button', { class: `pad${k.wide ? ' wide' : ''}`, 'data-key': k.key, style: `--c:${k.color}` },
        h('span', { class: 'chip', style: `background:${k.color}` }), h('span', { class: 'pname' }, k.label + (k.holdable ? ' ⏵' : '')));
      el.addEventListener('pointerdown', (e) => press(k, el, e));
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      if (k.active) lights.push({ el, k });
      return el;
    };
    const extra: HTMLElement[] = [];
    if (app.mode === 'lyrics') {
      const undo = h('button', { class: 'pad', style: '--c:#888' }, h('span', { class: 'pname' }, '↶ 直前の入力を取り消す'));
      undo.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (app.recording) app.recUndo();
        else toast('REC 中の入力を取り消します（REC 後は ↶ で元に戻せます）');
      });
      extra.push(undo);
    }
    const notes: string[] = [];
    if (app.mode === 'chara' && !app.project.characters.length) notes.push('☰ から立ち絵の画像を追加してください');
    if (app.mode === 'look' && !app.project.backgrounds.length) notes.push('☰ から背景画像を追加すると切り替えられます');
    root.replaceChildren(
      ...notes.map((n) => h('div', { class: 'm-note' }, n)),
      ...[...groups.entries()].flatMap(([name, ks], gi) => [
        h('h4', null, name),
        h('div', { class: `pad-grid${gi === 0 && (app.mode === 'lyrics' || app.mode === 'telop') ? ' big' : ''}` }, ...ks.map(pad), ...(gi === 0 ? extra : [])),
      ]),
    );
    root.scrollTop = 0;
    lastLight = '';
  };

  let lastLight = '';
  render();
  for (const ev of ['registry', 'mode', 'assets']) app.on(ev, render);
  return () => {
    if (!app.compiled) return;
    const t = app.time;
    let sig = '';
    const on = lights.map(({ k }) => {
      const v = !!k.active!(t);
      sig += v ? '1' : '0';
      return v;
    });
    if (sig === lastLight) return;
    lastLight = sig;
    lights.forEach(({ el }, i) => el.classList.toggle('active', on[i]));
  };
}

/** The line about to be tapped (lyrics), the next telop, or what the armed track shows now. */
function buildPrompter(app: App) {
  const root = $('#prompter');
  let tick = 0;
  app.on('compiled', () => tick++);
  let last = '';
  return () => {
    const t = app.time;
    const info = modeInfo(app.mode);
    if (app.mode === 'lyrics') {
      const targets = app.targets();
      const k = app.lyricCursor;
      const sig = `l|${k}|${targets.length}|${tick}|${app.recording}`;
      if (sig === last) return;
      last = sig;
      const lines = app.project.lines;
      const tg = targets[Math.min(k, targets.length - 1)];
      if (!tg) {
        root.replaceChildren(h('div', { class: 'p-now' }, '歌詞がありません（☰ → 歌詞）'));
        return;
      }
      const li = tg.line;
      const base = lineFirstTarget(targets, li);
      let gi = 0;
      const chars = lines[li].chunks.flatMap((c, ci) => [
        ci > 0 ? h('span', { class: 'gap' }) : null,
        ...graphemes(c).map((g) => {
          const idx = base + gi;
          const timed = lines[li].times[gi] != null;
          gi++;
          return h('span', { class: ['ch', idx < k ? 'done' : '', idx === k ? 'next' : '', timed ? 'timed' : ''].join(' '), onclick: () => !app.recording && app.setCursor(idx) }, g);
        }),
      ]).filter(Boolean) as Node[];
      const move = (d: number) => h('button', { class: 'icon small', onclick: () => !app.recording && app.moveCursor('line', d) }, d < 0 ? '▲' : '▼');
      root.replaceChildren(
        h('div', { class: 'p-row' }, h('span', { class: 'p-label', style: `color:${info.color}` }, app.recording ? '● REC' : '次に入れる行'), h('span', { class: 'sp' }), move(-1), move(1)),
        h('div', { class: 'p-now' }, ...chars, k >= targets.length ? h('span', { class: 'p-end' }, '　— 歌詞の最後 —') : null),
        h('div', { class: 'p-next' }, lines[li + 1] ? `NEXT ▸ ${lines[li + 1].text}` : ''),
      );
      return;
    }
    if (app.mode === 'telop') {
      const tl = app.project.telops;
      const k = app.telopCursor;
      const showing = trackStateText(app, 'telop', t);
      const sig = `t|${k}|${tl.length}|${tick}|${app.recording}|${showing}`;
      if (sig === last) return;
      last = sig;
      const tp = tl[k];
      const name = tp ? `[${findTelop(tp.template)?.name ?? tp.template}] ${tp.text.replace(/\{title\}/g, app.settings.title).replace(/\{artist\}/g, app.settings.artist)}` : '— 最後 —';
      const move = (d: number) => h('button', { class: 'icon small', onclick: () => !app.recording && app.moveTelopCursor(d) }, d < 0 ? '▲' : '▼');
      root.replaceChildren(
        h('div', { class: 'p-row' }, h('span', { class: 'p-label', style: `color:${info.color}` }, app.recording ? '● REC' : '次に出すテロップ'), h('span', { class: 'sp' }), move(-1), move(1)),
        h('div', { class: 'p-now small' }, name),
        h('div', { class: 'p-next' }, showing),
      );
      return;
    }
    const text = trackStateText(app, app.mode, t);
    const sig = `${app.mode}|${app.recording}|${text}`;
    if (sig === last) return;
    last = sig;
    root.replaceChildren(
      h('div', { class: 'p-row' }, h('span', { class: 'p-label', style: `color:${info.color}` }, app.recording ? `● REC ${info.name}` : `${info.name}トラック`)),
      h('div', { class: 'p-now small' }, text || '—'),
    );
  };
}

/** ☰: files, lyrics, BPM, project, export and a link to the PC page. */
function buildDrawer(app: App) {
  const drawer = $('#drawer');
  const body = $('#drawerBody');
  const close = () => (drawer.hidden = true);
  drawer.addEventListener('click', (e) => e.target === drawer && close());
  let job: ExportJob | null = null;

  const render = () => {
    const s = app.settings;
    const lyr = h('textarea', { class: 'lyrics', spellcheck: false, value: app.project.lyricsText, rows: 8 }) as HTMLTextAreaElement;
    const bpm = h('input', { type: 'number', step: '0.01', value: String(s.bpm), inputmode: 'decimal' }) as HTMLInputElement;
    const bar = h('div', { class: 'bar' });
    const status = h('div', { class: 'export-status' }, canExport() ? 'MP4 で曲の最初から最後まで書き出します。' : '⚠ このブラウザは動画の書き出し（WebCodecs）に対応していません');
    const addFiles = async (accept: string) => {
      const files = await pickFile(accept, true);
      if (files.length) {
        await app.handleDrop(files);
        render();
      }
    };
    body.replaceChildren(
      h('div', { class: 'm-drawer-head' }, h('b', null, 'メニュー'), h('button', { class: 'icon', 'aria-label': '閉じる', onclick: close }, '✕')),
      h('h4', null, '素材'),
      h('div', { class: 'm-btns' },
        h('button', { onclick: () => addFiles('audio/*') }, '♪ 曲を読み込む'),
        h('button', { onclick: () => addFiles('image/*') }, '立ち絵の画像を追加'),
        h('button', { onclick: () => addFiles('image/*,video/*') }, '背景を追加'),
      ),
      h('div', { class: 'hint' }, `曲：${app.project.audio?.name ?? 'なし'} · 立ち絵 ${app.project.characters.length} · 背景 ${app.project.backgrounds.length}（透過 PNG は立ち絵、それ以外は背景になります）`),
      h('h4', null, '歌詞'),
      h('div', { class: 'hint' }, '1行が1フレーズ。/ で単語を区切ります。'),
      lyr,
      h('div', { class: 'm-btns' }, h('button', { class: 'accent', onclick: () => {
        app.setLyrics(lyr.value);
        toast('歌詞を反映しました');
      } }, '歌詞を反映')),
      h('h4', null, 'テンポ'),
      h('div', { class: 'm-btns' }, h('label', null, 'BPM ', bpm), h('button', { onclick: () => {
        const v = parseFloat(bpm.value);
        if (Number.isFinite(v)) app.mutate((p) => (p.settings.bpm = Math.max(20, Math.min(400, v))));
        toast(`BPM ${app.settings.bpm}`);
      } }, '反映')),
      h('h4', null, 'プロジェクト'),
      h('div', { class: 'm-btns' },
        h('button', { onclick: () => app.saveProjectFile() }, '保存 (.json)'),
        h('button', { onclick: async () => {
          const [f] = await pickFile('.json,application/json');
          if (f) await app.loadProjectFile(f);
          render();
        } }, '読み込み'),
        h('button', { onclick: async () => {
          if (!confirm('いまのプロジェクトをデモに置き換えますか？（↶ で戻せます）')) return;
          await app.openDemo();
          render();
        } }, 'デモを開く'),
        h('button', { onclick: () => {
          if (!confirm('新規プロジェクトにしますか？ いまの歌詞・記録・曲・立ち絵・背景は外れます（元に戻せません。残すなら先に「保存 (.json)」）')) return;
          app.newBlankProject();
          render();
        } }, '新規'),
      ),
      h('h4', null, '書き出し'),
      h('div', { class: 'progress' }, bar),
      status,
      h('div', { class: 'm-btns' }, h('button', { class: 'accent', disabled: !canExport(), onclick: async () => {
        if (job) {
          job.cancelled = true;
          return;
        }
        if (app.recording) app.stopRec();
        app.pause();
        job = { cancelled: false };
        app.exporting = true;
        try {
          const blob = await exportVideo(app, { width: s.width, height: s.height, fps: s.fps, start: 0, end: app.duration, container: 'mp4', quality: 'high' }, job, (p, msg) => {
            bar.style.width = `${(p * 100).toFixed(1)}%`;
            status.textContent = msg;
          });
          downloadBlob(blob, `${s.title || 'mv'}.mp4`);
          status.textContent = `完了！ ${(blob.size / 1e6).toFixed(1)} MB`;
        } catch (e) {
          status.textContent = `⚠ ${(e as Error).message}`;
        } finally {
          job = null;
          app.exporting = false;
          app.invalidate();
        }
      } }, '⬇ 動画を書き出し（もう一度押すと中止）')),
      h('h4', null, 'このページについて'),
      h('div', { class: 'hint' }, 'スマホ版は試作です。演奏と録音のほかは最低限の機能だけで、タイムラインでの細かい編集・スタイルや見た目の設定・プラグインは PC 版で行います（同じブラウザならプロジェクトは共通です）。'),
      h('div', { class: 'm-links' },
        h('a', { href: '../' }, 'PC 版を開く'),
        h('a', { href: 'https://github.com/masachaco/MinaMo', target: '_blank', rel: 'noopener' }, 'GitHub'),
        h('a', { href: '../LICENSE', target: '_blank', rel: 'noopener' }, 'ライセンス'),
        h('a', { href: '../THIRD_PARTY_LICENSES.txt', target: '_blank', rel: 'noopener' }, 'サードパーティ'),
        h('a', { href: '../demo/LICENSE.md', target: '_blank', rel: 'noopener' }, 'デモ素材')),
    );
  };
  $('#btnMenu').addEventListener('click', () => {
    if (app.recording) app.stopRec();
    render();
    drawer.hidden = false;
  });
}

boot();
