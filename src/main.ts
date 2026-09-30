import './style.css';
import './plugins';
import { App } from './app';
import { lastTimeBefore, lineFirstTarget, previewTap, type TapUnit } from './core/lyrics';
import { findTelop } from './engine/api';
import { downloadBlob } from './core/storage';
import { segmentAt } from './engine/compile';
import { fmtTime, graphemes } from './engine/lib';
import { canExport, exportVideo, type ExportJob, type ExportOptions } from './export/exporter';
import { installGlobalApi, loadStoredPlugins } from './plugin-loader';
import { $, filesFromDrop, h, toast } from './ui/dom';
import { buildLeftPanel, confirmNewProject } from './ui/panels';
import { startTutorial, tutorialSeen } from './ui/tutorial';
import { buildRightPanel } from './ui/perform-panel';
import { MODES, modeInfo, trackStateText } from './perform';
import { Timeline } from './ui/timeline';

async function boot() {
  installGlobalApi();
  const pluginErrors = await loadStoredPlugins();
  if (pluginErrors.length) console.warn('plugin errors', pluginErrors);

  const app = new App($('#out') as HTMLCanvasElement);
  (window as any).app = app;
  await app.init().catch((e) => console.error(e));

  buildLeftPanel(app);
  buildRightPanel(app);
  const timeline = new Timeline(app, $('#timeline') as HTMLCanvasElement);
  (window as any).timeline = timeline; // for tests / console, like window.app
  buildTimelineToolbar(app, timeline);
  wireTransport(app);
  wireDrop(app);
  wireExport(app);
  const layout = frameLayout(app);
  app.on('project', layout);
  window.addEventListener('resize', layout);
  new ResizeObserver(layout).observe($('#viewport'));
  layout();
  timeline.fit();

  window.addEventListener('keydown', (e) => app.handleKeyDown(e));
  window.addEventListener('keyup', (e) => app.handleKeyUp(e));

  const prompter = buildPrompter(app);
  const leds = $('#beatLeds');
  let ledCount = -1;
  const loop = () => {
    app.tick();
    const t = app.time;
    timeline.draw(t);
    $('#tcTime').textContent = fmtTime(t);
    if (app.compiled) {
      const b = app.compiled.grid.state(t);
      $('#tcBar').textContent = `${String(Math.max(0, b.bar + 1)).padStart(3, '0')}.${b.inBar + 1}`;
      if (ledCount !== b.beatsPerBar) {
        ledCount = b.beatsPerBar;
        leds.replaceChildren(...Array.from({ length: ledCount }, () => h('i')));
      }
      leds.querySelectorAll('i').forEach((el, i) => {
        const on = i === b.inBar && b.beat >= 0 && b.phase < 0.35;
        el.classList.toggle('on', on);
        el.classList.toggle('down', on && i === 0);
      });
    }
    prompter();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const forced = new URLSearchParams(location.search).get('tutorial') === '1';
  if (forced || (app.firstVisit && !tutorialSeen())) startTutorial(app);
  else if (!app.project.audio) toast('音楽・画像をドロップして始めましょう（スペースで再生、Shift+R で REC）', 5000);
}

function wireTransport(app: App) {
  const play = $('#btnPlay');
  const rec = $('#btnRec');
  const tabs = $('#modeTabs');
  tabs.replaceChildren(...MODES.map((m) => h('button', {
    class: 'mode-tab', 'data-mode': m.id, style: `--c:${m.color}`, title: `${m.name}トラックを録音対象に（Tab で切替）`,
    onclick: () => app.setMode(m.id),
  }, m.name)));
  const stopMode = $('#btnStopMode');
  const sync = () => {
    play.textContent = app.engine.playing ? '❚❚' : '▶';
    const ret = app.settings.stopMode !== 'stay';
    stopMode.textContent = ret ? '↩ 開始位置に戻る' : '■ その場で止める';
    stopMode.classList.toggle('on', ret);
    stopMode.title = ret ? '停止すると再生を始めた位置に戻る（クリックで「その場で止める」に切替）' : '停止した位置で止まる（クリックで「開始位置に戻る」に切替）';
    rec.classList.toggle('on', app.recording);
    const info = modeInfo(app.mode);
    rec.textContent = `● REC ${info.name}`;
    rec.style.setProperty('--c', info.color);
    tabs.querySelectorAll('.mode-tab').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.mode === app.mode));
    tabs.classList.toggle('locked', app.recording);
  };
  app.on('mode', sync);
  play.addEventListener('click', () => app.togglePlay());
  stopMode.addEventListener('click', () => {
    app.mutate((p) => (p.settings.stopMode = p.settings.stopMode === 'stay' ? 'return' : 'stay'), { history: false });
    sync();
  });
  app.on('project', sync);
  const rate = $('#selRate') as HTMLSelectElement;
  rate.addEventListener('change', () => {
    rate.blur();
    app.setRate(parseFloat(rate.value));
  });
  app.on('transport', () => (rate.value = String(app.engine.rate)));
  rec.addEventListener('click', () => app.toggleRec());
  $('#btnHome').addEventListener('click', () => app.seek(0));
  $('#btnUndo').addEventListener('click', () => app.undo());
  $('#btnRedo').addEventListener('click', () => app.redo());
  $('#btnNew').addEventListener('click', () => confirmNewProject(app));
  $('#btnHelp').addEventListener('click', () => startTutorial(app));
  app.on('transport', sync);
  app.on('rec', sync);
  // buttons must not keep focus (Space would click them)
  document.querySelectorAll('button').forEach((b) => b.addEventListener('mouseup', () => b.blur()));
  document.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) b.blur();
  });
  sync();
}

function frameLayout(app: App) {
  return () => {
    const vp = $('#viewport');
    const fr = $('#frame');
    const r = vp.getBoundingClientRect();
    const aw = r.width - 28, ah = r.height - 28;
    const ar = app.settings.width / app.settings.height;
    let w = aw, hh = aw / ar;
    if (hh > ah) {
      hh = ah;
      w = ah * ar;
    }
    fr.style.width = `${Math.max(10, w)}px`;
    fr.style.height = `${Math.max(10, hh)}px`;
  };
}

function wireDrop(app: App) {
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dragging');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    if (!e.dataTransfer) return;
    // folders are walked (MMD model folders, VPD / VMD); must start synchronously inside the event
    const files = await filesFromDrop(e.dataTransfer);
    if (files.length) await app.handleDropPaths(files);
  });
}

function buildTimelineToolbar(app: App, tl: Timeline) {
  const bar = $('#tlToolbar');
  const chk = (label: string, v: boolean, on: (v: boolean) => void) =>
    h('label', null, h('input', { type: 'checkbox', checked: v, onchange: (e: Event) => on((e.target as HTMLInputElement).checked) }), label);
  bar.replaceChildren(
    h('button', { class: 'small', title: 'ズームアウト', onclick: () => tl.zoom(1 / 1.5) }, '−'),
    h('button', { class: 'small', title: 'ズームイン', onclick: () => tl.zoom(1.5) }, '+'),
    h('button', { class: 'small', title: '全体表示', onclick: () => tl.fit() }, '全体'),
    chk('追従', tl.follow, (v) => (tl.follow = v)),
    chk('スナップ', tl.snap, (v) => (tl.snap = v)),
    h('span', { class: 'sp' }),
    h('span', null, 'トラック名クリック: 録音対象 / ホイール: スクロール / Ctrl+ホイール: ズーム / ドラッグ: 移動 / 右クリック: 削除'),
    h('span', { class: 'sp' }),
    h('select', { id: 'selQuantizeAll', title: 'すべての歌詞タイミングを音符の格子に吸着（Ctrl+Z で戻せます）', onchange: (e: Event) => {
      const sel = e.target as HTMLSelectElement;
      const note = +sel.value;
      sel.value = '';
      sel.blur();
      if (!note) return;
      const div = note / 4; // divisions per beat (a beat is a quarter note): 4分 = 1, 8分 = 2, 16分 = 4
      const q = (x: number) => app.compiled.grid.quantize(x, div);
      app.mutate((p) => {
        p.lines = p.lines.map((l) => ({ ...l, times: l.times.map((x) => (x == null ? null : q(x))), end: l.end == null ? null : q(l.end) }));
      });
      toast(`歌詞タイミングを ${note}分音符にクオンタイズしました`);
    } }, h('option', { value: '' }, '一括クオンタイズ…'), h('option', { value: '4' }, '4分音符'), h('option', { value: '8' }, '8分音符'), h('option', { value: '16' }, '16分音符')),
    h('select', { title: 'トラックを消去', onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      (e.target as HTMLSelectElement).value = '';
      if (!v || !confirm('このトラックのイベントを全て消去しますか？')) return;
      app.mutate((p) => {
        if (v === 'lyrics') p.lines = p.lines.map((l) => ({ ...l, times: l.times.map(() => null), end: null }));
        if (v === 'telop') p.telops = p.telops.map((x) => ({ ...x, start: null, dur: null }));
        if (v === 'lstyle') p.lyricStyleEvents = [];
        if (v === 'lfx') p.lyricEvents = [];
        if (v === 'tfx') p.telopEvents = [];
        if (v === 'chara') p.charaEvents = [];
        if (v === 'cam') p.camEvents = [];
        if (v === 'fx') p.fxEvents = [];
        if (v === 'viz') p.vizEvents = [];
        if (v === 'look') p.lookEvents = [];
      });
    } }, h('option', { value: '' }, 'トラック消去…'), h('option', { value: 'lyrics' }, '歌詞タイミング'), h('option', { value: 'lstyle' }, '歌詞スタイル'),
      h('option', { value: 'lfx' }, '歌詞のエフェクト・モーション'), h('option', { value: 'telop' }, 'テロップ'), h('option', { value: 'tfx' }, 'テロップのエフェクト・モーション'),
      h('option', { value: 'chara' }, '立ち絵'), h('option', { value: 'cam' }, 'カメラ'), h('option', { value: 'fx' }, 'FX'), h('option', { value: 'viz' }, 'ビジュアル'), h('option', { value: 'look' }, 'ルック')),
  );
}

function buildPrompter(app: App) {
  const label = $('#pLabel');
  const keys = $('#pKeys');
  const now = $('#pNow');
  const next = $('#pNext');
  const cursorBox = $('#pCursor');

  // ---- start-position controls (lyrics mode)
  let unit: 'glyph' | 'line' = 'glyph';
  const slider = h('input', { type: 'range', min: 0, max: 1, step: 1, value: '0', title: '歌詞の入力開始位置（↑↓ で行、Shift+↑↓ で文字）' });
  const unitBtns = (['glyph', 'line'] as const).map((u) => h('button', { class: 'small', onclick: () => {
    unit = u;
    key = '';
  } }, u === 'glyph' ? '文字' : '行'));
  const pos = h('span', { class: 'p-pos' });
  const follow = h('input', { type: 'checkbox', checked: app.cursorFollow, onchange: (e: Event) => app.setCursorFollow((e.target as HTMLInputElement).checked) });
  const warn = h('span', { class: 'p-warn' });
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    app.setCursor(unit === 'glyph' ? v : lineFirstTarget(app.targets(), v));
  });
  cursorBox.replaceChildren(
    h('span', { class: 'seg-btns' }, ...unitBtns),
    slider,
    pos,
    h('label', { class: 'p-follow', title: 'オン：再生位置の次の未入力文字から入力' }, follow, '再生位置に追従'),
    h('button', { class: 'small', title: '入力位置の1小節前へ移動', onclick: () => app.cueToCursor() }, '⏮ 頭出し'),
    warn,
  );

  let compiledTick = 0;
  app.on('compiled', () => compiledTick++);
  let key = '';
  let lastState = '';
  return () => {
    const t = app.time;
    const lines = app.project.lines;
    const lyricsMode = app.mode === 'lyrics';
    keys.hidden = !lyricsMode && app.mode !== 'telop';
    cursorBox.hidden = !lyricsMode;
    if (app.mode === 'telop') {
      const tl = app.project.telops;
      const k = app.telopCursor;
      const showing = trackStateText(app, 'telop', t);
      const sig = `telop|${k}|${tl.length}|${compiledTick}|${app.recording}|${app.telopFollow}|${showing}`;
      if (sig === lastState) return;
      lastState = sig;
      key = '';
      label.textContent = app.recording ? '● REC' : 'TELOP';
      const nameOf = (i: number) => {
        const tp = tl[i];
        if (!tp) return '';
        const def = findTelop(tp.template);
        const txt = tp.text.replace(/\{title\}/g, app.settings.title).replace(/\{artist\}/g, app.settings.artist);
        return `[${def?.name ?? tp.template}] ${txt}`;
      };
      keys.replaceChildren(
        h('span', { class: 'pk' }, h('kbd', null, 'Space'), tl[k] ? h('b', null, nameOf(k)) : h('span', { class: 'skip' }, '— 最後 —'), h('span', { class: 'skip' }, '（長押しで長さ）')),
        h('span', { class: 'pk' }, h('kbd', null, 'X'), h('span', null, '表示中を消す')),
        h('label', { class: 'p-follow', title: 'オン：再生位置の次の未配置テロップから' },
          h('input', { type: 'checkbox', checked: app.telopFollow, onchange: (e: Event) => app.setTelopFollow((e.target as HTMLInputElement).checked) }), '再生位置に追従'),
        h('span', { class: 'p-pos' }, `${Math.min(k + 1, tl.length)}/${tl.length}  ↑↓で選択`),
      );
      now.replaceChildren(...tl.slice(Math.max(0, k - 1), k + 3).map((_, j) => {
        const i = Math.max(0, k - 1) + j;
        return h('span', { class: `ch${i < k ? ' done' : ''}${i === k ? ' next' : ''}${tl[i].start != null ? ' timed' : ''}`, style: 'font-size:16px;margin-right:14px', onclick: () => app.setTelopCursor(i) }, nameOf(i));
      }));
      next.textContent = showing;
      return;
    }
    if (!lyricsMode) {
      const info = modeInfo(app.mode);
      const text = trackStateText(app, app.mode, t);
      const k = `${app.mode}:${app.recording}:${text}`;
      if (k === lastState) return;
      lastState = k;
      key = '';
      label.textContent = app.recording ? `● ${info.en}` : info.en;
      now.textContent = text;
      next.textContent = info.hint;
      return;
    }
    lastState = '';
    const targets = app.targets();
    const n = targets.length;
    const k = app.lyricCursor;
    // live warning (depends on the playhead only)
    const prev = lastTimeBefore(lines, targets, k);
    warn.textContent = !app.recording && prev != null && t < prev - 0.05 ? `⚠ 再生位置が直前の歌詞（${fmtTime(prev)}）より前` : '';

    const sig = `${k}|${n}|${compiledTick}|${app.recording}|${app.cursorFollow}|${unit}`;
    if (sig === key) return;
    key = sig;
    label.textContent = app.recording ? '● REC' : 'LYRICS';
    unitBtns.forEach((b, i) => b.classList.toggle('on', (i === 0) === (unit === 'glyph')));
    follow.checked = app.cursorFollow;

    // key previews: what each key will reveal next
    const chip = (kbd: string, u: TapUnit) => {
      const pv = previewTap(lines, targets, k, u);
      return h('span', { class: 'pk', title: pv ? `${lines[pv.line].text}` : '' },
        h('kbd', null, kbd),
        pv ? h('b', null, pv.text) : h('span', { class: 'skip' }, '— 最後 —'),
        pv && pv.skipped > 0 ? h('span', { class: 'skip' }, `（残り${pv.skipped}字は自動）`) : null);
    };
    keys.replaceChildren(chip('Space', 'glyph'), chip('N', 'chunk'), chip('Enter', 'line'));

    // current line with per-character states (click to start from there)
    const tg = targets[Math.min(k, n - 1)];
    if (!tg) {
      now.textContent = '歌詞がありません';
      next.textContent = '';
    } else {
      const li = tg.line;
      const line = lines[li];
      const base = lineFirstTarget(targets, li);
      let gi = 0;
      now.replaceChildren(...line.chunks.flatMap((c, ci) => [
        ci > 0 ? h('span', { class: 'gap' }) : null,
        ...graphemes(c).map((g) => {
          const idx = base + gi;
          const timed = line.times[gi] != null;
          gi++;
          const cls = ['ch', idx < k ? 'done' : '', idx === k ? 'next' : '', timed ? 'timed' : ''].join(' ');
          return h('span', { class: cls, title: timed ? `記録済み ${fmtTime(line.times[gi - 1]!)}` : '未入力', onclick: () => app.setCursor(idx) }, g);
        }),
      ]).filter(Boolean) as Node[]);
      if (k >= n) now.append(h('span', { class: 'p-end' }, '　— 歌詞の最後 —'));
      const nl = lines[li + 1];
      next.textContent = nl ? `NEXT ▸ ${nl.text}` : '';
    }

    // slider
    const lineOf = k >= n ? lines.length : targets[k].line;
    slider.max = String(unit === 'glyph' ? n : lines.length);
    if (document.activeElement !== slider || app.engine.playing) slider.value = String(unit === 'glyph' ? k : lineOf);
    pos.textContent = `行 ${Math.min(lineOf + 1, lines.length)}/${lines.length} · 文字 ${Math.min(k + 1, n)}/${n}`;
  };
}

function wireExport(app: App) {
  const modal = $('#exportModal');
  const form = $('#exportForm');
  const bar = $('#exportBar');
  const status = $('#exportStatus');
  const startBtn = $('#exportStart') as HTMLButtonElement;
  let job: ExportJob | null = null;
  let opts: ExportOptions;
  const open = () => {
    const s = app.settings;
    opts = { width: s.width, height: s.height, fps: s.fps, start: 0, end: app.duration, container: 'mp4', quality: 'high' };
    const inp = (v: number, on: (v: number) => void, step = 0.01) =>
      h('input', { type: 'number', step: String(step), value: String(+v.toFixed(3)), onchange: (e: Event) => on(parseFloat((e.target as HTMLInputElement).value)) });
    form.replaceChildren(
      h('label', null, '解像度'), h('div', null, `${s.width} × ${s.height} @ ${s.fps}fps（出力設定で変更）`),
      h('label', null, '形式'), h('select', { onchange: (e: Event) => (opts.container = (e.target as HTMLSelectElement).value as any) },
        h('option', { value: 'mp4' }, 'MP4 (H.264 / AAC)'), h('option', { value: 'webm' }, 'WebM (VP9 / Opus)')),
      h('label', null, '画質'), h('select', { onchange: (e: Event) => (opts.quality = (e.target as HTMLSelectElement).value as any) },
        h('option', { value: 'high', selected: true }, '高'), h('option', { value: 'veryhigh' }, '最高'), h('option', { value: 'medium' }, '中（軽量）')),
      h('label', null, '開始 (秒)'), inp(opts.start, (v) => (opts.start = Math.max(0, v))),
      h('label', null, '終了 (秒)'), inp(opts.end, (v) => (opts.end = Math.min(app.duration, v))),
    );
    bar.style.width = '0%';
    status.textContent = canExport() ? 'オフライン・レンダリングで1フレームずつ正確に書き出します。' : '⚠ このブラウザは WebCodecs 非対応です（Chrome / Edge 推奨）';
    startBtn.disabled = !canExport();
    modal.hidden = false;
  };
  $('#btnExport').addEventListener('click', () => {
    if (app.recording) app.stopRec();
    app.pause();
    open();
  });
  $('#exportCancel').addEventListener('click', () => {
    if (job) job.cancelled = true;
    else modal.hidden = true;
  });
  startBtn.addEventListener('click', async () => {
    if (job) return;
    job = { cancelled: false };
    startBtn.disabled = true;
    app.exporting = true;
    try {
      const blob = await exportVideo(app, opts, job, (p, msg) => {
        bar.style.width = `${(p * 100).toFixed(1)}%`;
        status.textContent = msg;
      });
      const ext = opts.container;
      downloadBlob(blob, `${app.settings.title || 'mv'}.${ext}`);
      status.textContent = `完了！ ${(blob.size / 1e6).toFixed(1)} MB`;
    } catch (e) {
      status.textContent = `⚠ ${(e as Error).message}`;
      console.error(e);
    } finally {
      job = null;
      startBtn.disabled = false;
      app.exporting = false;
      app.invalidate();
    }
  });
}

boot();
