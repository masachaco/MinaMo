// Left panel: song, lyrics, assets, look, input, output, project.

import type { App } from '../app';
import { paletteOf } from '../core/project';
import type { CharacterRef, Palette } from '../core/types';
import { listPalettes, listLookStyles, listLyricStyles } from '../engine/api';
import { addPlugin, removePlugin, storedPlugins } from '../plugin-loader';
import { $, h, pickFile, pickFolder, toast } from './dom';
import { startTutorial } from './tutorial';

// ---------------------------------------------------------------- small controls
const sec = (title: string, jp: string, open: boolean, ...children: (Node | null)[]) =>
  h('details', { class: 'sec', open }, h('summary', null, title, h('span', { class: 'jp' }, jp)), h('div', { class: 'sec-body' }, ...children));

const row = (label: string, ...ctrl: (Node | string)[]) => h('div', { class: 'row' }, h('label', null, label), h('div', { class: 'grow row' }, ...ctrl));

function num(value: number, step: number, on: (v: number) => void, attrs: Record<string, any> = {}) {
  return h('input', { type: 'number', value: String(value), step: String(step), ...attrs, onchange: (e: Event) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) on(v);
  } });
}

function text(value: string, on: (v: string) => void) {
  return h('input', { type: 'text', value, onchange: (e: Event) => on((e.target as HTMLInputElement).value) });
}

function select(options: [string, string][], value: string, on: (v: string) => void) {
  const s = h('select', { onchange: (e: Event) => on((e.target as HTMLSelectElement).value) },
    ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  return s;
}

function check(checked: boolean, label: string, on: (v: boolean) => void) {
  return h('label', { class: 'row', style: 'gap:6px;cursor:pointer' },
    h('input', { type: 'checkbox', checked, onchange: (e: Event) => on((e.target as HTMLInputElement).checked) }), label);
}

function range(min: number, max: number, step: number, value: number, on: (v: number) => void) {
  return h('input', { type: 'range', min, max, step, value: String(value), oninput: (e: Event) => on(parseFloat((e.target as HTMLInputElement).value)) });
}

// ---------------------------------------------------------------- left panel
/** 新規 after a confirmation (not undoable). Returns whether the project was cleared. */
export function confirmNewProject(app: App): boolean {
  if (!confirm('新規プロジェクトにしますか？ いまの歌詞・記録・曲・立ち絵・背景は外れます（元に戻せません。残すなら先に「保存 (.json)」）')) return false;
  app.newBlankProject();
  return true;
}

export function buildLeftPanel(app: App) {
  const root = $('#leftPanel');
  let internal = false;
  let lastSettings = JSON.stringify(app.settings);
  const render = () => {
    const s = app.settings;
    const set = (fn: () => void, history = true) => {
      internal = true;
      try {
        app.mutate(fn, { history });
      } finally {
        internal = false;
        lastSettings = JSON.stringify(app.settings);
      }
    };
    root.replaceChildren(
      sec('Music', '楽曲', true,
        dropZone(app.project.audio ? `♪ ${app.project.audio.name}` : '音楽ファイルを選択 / ドロップ', 'audio/*', async (f) => {
          await app.setAudioFile(f[0], f[0].name);
        }),
        row('タイトル', text(s.title, (v) => set(() => (s.title = v)))),
        row('アーティスト', text(s.artist, (v) => set(() => (s.artist = v)))),
        row('BPM', num(s.bpm, 0.01, (v) => set(() => (s.bpm = Math.max(20, Math.min(400, v))))), tapTempoButton(app)),
        row('拍子', select([2, 3, 4, 5, 6, 7].map((n) => [String(n), `${n} / 4`]), String(s.beatsPerBar), (v) => set(() => (s.beatsPerBar = +v)))),
        row('1拍目 (秒)', num(s.offset, 0.001, (v) => set(() => (s.offset = v))),
          h('button', { class: 'small', title: '再生位置を小節の頭（1拍目）にする', onclick: () => {
            const bar = (60 / s.bpm) * s.beatsPerBar;
            const t = app.time;
            set(() => (s.offset = +(t % bar).toFixed(4)));
            toast(`1拍目を ${t.toFixed(3)}s に合わせました`);
          } }, '現在位置')),
        check(s.metronome, 'メトロノーム（クリック音）', (v) => set(() => (s.metronome = v), false)),
      ),
      sec('Lyrics', '歌詞', true,
        lyricsBox(app),
        h('div', { class: 'hint', html: '1行 = 1フレーズ。<code>/</code> でチャンク（単語）区切り、<code>|</code> の後ろはサブテキスト（訳など）。<code>#</code> で始まる行はコメント。' }),
        h('div', { class: 'btns' },
          h('button', { class: 'small danger', onclick: () => {
            if (confirm('全トラック（歌詞・立ち絵・カメラ・FX・ルック）の記録をすべて消去しますか？')) app.newProjectKeepMedia(true);
          } }, 'タイミング全消去'),
        ),
      ),
      sec('Telop', 'テロップ', true,
        telopBox(app),
        h('div', { class: 'hint', html: '1行 = 1テロップ。<code>[型] 本文 | サブ</code>。型：<code>タイトル</code> <code>名前</code> <code>ラベル</code> <code>字幕</code> <code>チャプター</code> <code>クレジット</code>（省略時は字幕）。<code>{title}</code> <code>{artist}</code> は曲情報に置き換え。クレジットは <code>役職: 名前 / 役職: 名前</code>。テロップトラックで REC し、<kbd>Space</kbd> で次のテロップを表示（長押しで長さ指定）。' }),
      ),
      sec('Assets', '背景・立ち絵', true, ...assetsSection(app)),
      sec('Look', 'ルック', true,
        paletteGrid(app),
        s.paletteId === 'custom' ? customPalette(app) : null,
        row('歌詞スタイル', select(listLyricStyles().map((st) => [st.id, st.name]), s.lyricStyle, (v) => set(() => (s.lyricStyle = v)))),
        row('ルック', select(listLookStyles().map((st) => [st.id, st.name]), s.lookStyle, (v) => set(() => (s.lookStyle = v)))),
        h('div', { class: 'hint' }, '録音していない区間の初期スタイル。歌詞とルックは別々に選べます（例：NEON の世界観に MINIMAL の歌詞）。'),
        row('背景の暗さ', range(0, 0.9, 0.01, s.bgDim, (v) => set(() => (s.bgDim = v), false))),
        row('文字色の部分反転', select([['off', 'オフ'], ['low', '弱'], ['mid', '中'], ['high', '強']], s.textAdapt, (v) => set(() => (s.textAdapt = v as typeof s.textAdapt)))),
        h('div', { class: 'hint' }, '背景と同化する部分だけ、文字の塗りを同じ色味の濃い色／明るい色に切り替えます（それ以外は元の色）。強いほど早めに切り替わります。枠線だけの文字（NEON など）は対象外。'),
        row('FX強度', range(0, 2, 0.05, s.fxIntensity, (v) => set(() => (s.fxIntensity = v), false))),
        row('オート演出の間隔', select([['0.5', '速い (×0.5)'], ['1', '標準'], ['2', 'ゆっくり (×2)'], ['4', 'とてもゆっくり (×4)']], String(s.shotScale), (v) => set(() => (s.shotScale = +v)))),
        row('演出シード', num(s.seed, 1, (v) => set(() => (s.seed = Math.round(v)))),
          h('button', { class: 'small', title: 'カメラワーク・レイアウトの乱数を変える', onclick: () => set(() => (s.seed = Math.floor(Math.random() * 99999))) }, '🎲')),
        check(s.hud, 'HUD（タイトル・小節表示）', (v) => set(() => (s.hud = v))),
      ),
      sec('Input', '入力', false,
        row('歌詞クオンタイズ', select([['0', 'オフ'], ['1', '1拍'], ['2', '1/2拍'], ['4', '1/4拍'], ['3', '3連']], String(s.quantize), (v) => set(() => (s.quantize = +v), false))),
        row('イベントスナップ', select([['0', 'オフ'], ['1', '1拍'], ['2', '1/2拍'], ['4', '1/4拍']], String(s.eventSnap), (v) => set(() => (s.eventSnap = +v), false))),
        row('入力遅延補正', num(s.latencyMs, 1, (v) => set(() => (s.latencyMs = v), false)), 'ms'),
        row('自動消去', num(s.lineCapBars, 1, (v) => set(() => (s.lineCapBars = Math.max(1, v)))), '小節'),
        h('div', { class: 'hint' }, '入力遅延補正：タップが遅れがちなら正の値に。スタイル・FX・カメラはイベントスナップで拍に吸着します。'),
      ),
      sec('Output', '出力', false,
        row('解像度', select([
          ['1920x1080', '1920×1080 (16:9)'], ['1280x720', '1280×720 (16:9)'], ['3840x2160', '3840×2160 (4K)'],
          ['1080x1920', '1080×1920 (縦 9:16)'], ['1080x1080', '1080×1080 (1:1)'],
        ], `${s.width}x${s.height}`, (v) => {
          const [w, hh] = v.split('x').map(Number);
          set(() => { s.width = w; s.height = hh; });
        })),
        row('FPS', select([['30', '30'], ['60', '60']], String(s.fps), (v) => set(() => (s.fps = +v)))),
        row('プレビュー画質', select([['0.25', '低 (25%)'], ['0.5', '中 (50%)'], ['0.75', '高 (75%)'], ['1', '最高 (100%)']], String(s.previewScale), (v) => set(() => (s.previewScale = +v), false))),
      ),
      sec('Project', 'プロジェクト', false,
        h('div', { class: 'btns' },
          h('button', { class: 'small', onclick: () => confirmNewProject(app) }, '新規'),
          h('button', { class: 'small', onclick: () => app.saveProjectFile() }, '保存 (.json)'),
          h('button', { class: 'small', onclick: async () => {
            const f = await pickFile('.json,application/json');
            if (f[0]) await app.loadProjectFile(f[0]);
          } }, '読み込み'),
          h('button', { class: 'small', onclick: () => {
            if (confirm('いまのプロジェクトをデモに置き換えますか？（Ctrl+Z で戻せます）')) app.openDemo();
          } }, 'デモを開く'),
          h('button', { class: 'small', title: 'デモを使って、歌詞とエフェクトを付ける流れを体験する', onclick: () => startTutorial(app) }, 'チュートリアル'),
        ),
        h('div', { class: 'hint' }, 'プロジェクトと素材はブラウザ内に自動保存されます。.json には素材本体は含まれません。'),
        h('div', { class: 'hint' }, 'MIT ライセンス · ',
          h('a', { href: './LICENSE', target: '_blank', rel: 'noopener' }, 'ライセンス'), ' · ',
          h('a', { href: './THIRD_PARTY_LICENSES.txt', target: '_blank', rel: 'noopener' }, '使用ライブラリ'), ' · ',
          h('a', { href: './demo/LICENSE.md', target: '_blank', rel: 'noopener' }, 'デモ素材')),
        h('div', { style: 'height:6px' }),
        h('div', { class: 'row' }, h('b', null, 'プラグイン'), h('span', { class: 'hint' }, '（スタイル・FX・テロップ・カメラ・エフェクト・モーションなどを追加）')),
        h('div', { class: 'btns' },
          h('button', { class: 'small', onclick: async () => {
            const f = await pickFile('.js,.mjs,text/javascript');
            if (!f[0]) return;
            try {
              await addPlugin(f[0].name, await f[0].text());
              toast(`プラグイン ${f[0].name} を読み込みました`);
              render();
            } catch (e) {
              toast(`プラグインエラー: ${(e as Error).message}`, 4000);
            }
          } }, '.js を読み込む'),
        ),
        ...storedPlugins().map((pl) => h('div', { class: 'row' }, h('span', { class: 'grow' }, pl.name),
          h('button', { class: 'small danger', onclick: () => {
            removePlugin(pl.name);
            toast('削除しました（再読み込みで反映）');
            render();
          } }, '削除'))),
      ),
    );
  };
  // never rebuild while the user is typing in a field (focus would be lost)
  let pending = false;
  const safeRender = () => {
    if (root.contains(document.activeElement) && document.activeElement !== document.body) {
      pending = true;
      return;
    }
    pending = false;
    render();
  };
  root.addEventListener('focusout', () => setTimeout(() => pending && safeRender(), 0));
  render();
  app.on('assets', safeRender);
  app.on('registry', safeRender);
  app.on('project', () => {
    // re-render when settings change from outside the panel (undo, load, palette buttons)
    if (internal) return;
    const cur = JSON.stringify(app.settings);
    const lyr = root.querySelector('textarea.lyrics:not(.telops)') as HTMLTextAreaElement | null;
    const tel = root.querySelector('textarea.telops') as HTMLTextAreaElement | null;
    const stale = (lyr && document.activeElement !== lyr && lyr.value !== app.project.lyricsText) || (tel && document.activeElement !== tel && tel.value !== app.project.telopText);
    if (cur !== lastSettings || stale) safeRender();
    lastSettings = cur;
  });
}

function dropZone(label: string, accept: string, on: (f: File[]) => void) {
  const el = h('div', { class: 'drop', html: `<b>${label}</b>` });
  el.addEventListener('click', async () => {
    const f = await pickFile(accept, !accept.startsWith('audio'));
    if (f.length) on(f);
  });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('over');
    const f = Array.from(e.dataTransfer?.files ?? []);
    if (f.length) on(f);
  });
  return el;
}

function tapTempoButton(app: App) {
  let taps: number[] = [];
  return h('button', { class: 'small', title: 'クリックを4回以上リズムに合わせて叩くとBPMを推定', onclick: () => {
    const now = performance.now();
    taps = taps.filter((x) => now - x < 2500);
    taps.push(now);
    if (taps.length >= 4) {
      const iv = taps.slice(1).map((x, i) => x - taps[i]).sort((a, b) => a - b);
      const med = iv[Math.floor(iv.length / 2)];
      const bpm = Math.round((60000 / med) * 10) / 10;
      app.mutate((p) => (p.settings.bpm = bpm));
      toast(`BPM ≈ ${bpm}`);
    } else toast(`TAP ${taps.length}…`);
  } }, 'TAP');
}

function lyricsBox(app: App) {
  let timer = 0;
  const ta = h('textarea', { class: 'lyrics', spellcheck: false, value: app.project.lyricsText });
  ta.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => app.setLyrics(ta.value), 350);
  });
  ta.addEventListener('blur', () => {
    clearTimeout(timer);
    if (ta.value !== app.project.lyricsText) app.setLyrics(ta.value);
  });
  return ta;
}

function telopBox(app: App) {
  let timer = 0;
  const ta = h('textarea', { class: 'lyrics telops', spellcheck: false, value: app.project.telopText });
  ta.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => app.setTelops(ta.value), 350);
  });
  ta.addEventListener('blur', () => {
    clearTimeout(timer);
    if (ta.value !== app.project.telopText) app.setTelops(ta.value);
  });
  return ta;
}

function thumb(src: HTMLCanvasElement | HTMLVideoElement | undefined) {
  const c = h('canvas', { width: 108, height: 108 });
  if (src) {
    const x = c.getContext('2d')!;
    const sw = (src as HTMLVideoElement).videoWidth || src.width;
    const sh = (src as HTMLVideoElement).videoHeight || src.height;
    const k = Math.min(108 / sw, 108 / sh);
    try {
      x.drawImage(src, (108 - sw * k) / 2, (108 - sh * k) / 2, sw * k, sh * k);
    } catch {
      /* not ready */
    }
  }
  return c;
}

function assetsSection(app: App): Node[] {
  const p = app.project;
  const out: Node[] = [];
  out.push(h('div', { class: 'row' }, h('b', null, '背景'), h('span', { class: 'hint' }, 'セクション（スタイル切替）ごとに順番に使用')));
  for (const b of p.backgrounds) {
    const a = app.bgAssets.get(b.id);
    out.push(h('div', { class: 'asset' }, thumb(a?.img ?? a?.video),
      h('div', { class: 'meta' }, h('div', { class: 'name', title: b.name }, (b.kind === 'video' ? '🎞 ' : '🖼 ') + b.name),
        h('div', { class: 'mini' }, a ? '' : '⚠ 未読込', h('button', { class: 'small danger', onclick: () => app.removeBackground(b.id) }, '削除')))));
  }
  out.push(dropZone('＋ 背景画像 / 動画を追加', 'image/*,video/*', async (f) => {
    for (const x of f) await app.addBackgroundFile(x);
  }));
  out.push(h('div', { style: 'height:4px' }));
  out.push(h('div', { class: 'row' }, h('b', null, '立ち絵'), h('span', { class: 'hint' }, '透過PNG推奨。立ち絵トラックの数字キーで切替')));
  const keyOf = (id: string) => {
    const i = p.characters.findIndex((c) => c.id === id);
    return i >= 0 && i < 9 ? String(i + 1) : '–';
  };
  const card = (c: CharacterRef, label: string) => {
    const a = app.charAssets.get(c.id);
    const upd = (fn: () => void, history = true) => app.mutate(fn, { history });
    const image = c.kind !== 'mmd';
    const replace = (f: File[]) => {
      const img = f.find((x) => x.type.startsWith('image'));
      if (img) app.replaceCharacterImage(c.id, img);
    };
    const el = h('div', { class: 'asset', title: image ? '画像をドロップすると差し替え（記録と調整はそのまま）' : '' }, faceThumb(a?.img, c.faceY),
      h('div', { class: 'meta' },
        h('div', { class: 'name', title: c.name }, h('span', { class: 'key', title: '立ち絵トラックのキー' }, keyOf(c.id)), label, a ? '' : '  ⚠ 未読込'),
        h('div', { class: 'mini' },
          check(c.enabled, '使う', (v) => upd(() => (c.enabled = v))),
          check(c.flip, '反転', (v) => upd(() => (c.flip = v))),
          h('button', { class: 'small danger', onclick: () => app.removeCharacter(c.id) }, '削除')),
        h('div', { class: 'mini', title: '顔の位置（アップ時の中心）' }, '顔', range(0, 0.6, 0.005, c.faceY, (v) => {
          upd(() => (c.faceY = v), false);
        })),
        h('div', { class: 'mini' }, '大きさ', range(0.5, 1.6, 0.01, c.scale, (v) => upd(() => (c.scale = v), false))),
        offsetRow('横', c.offsetX, (v) => upd(() => (c.offsetX = v), false), '左右の位置（＋で右）'),
        offsetRow('縦', c.offsetY, (v) => upd(() => (c.offsetY = v), false), '上下の位置（＋で下）'),
        h('div', { class: 'mini' }, h('button', { class: 'small', title: '横・縦のオフセットを0に戻す', onclick: () => {
          upd(() => { c.offsetX = 0; c.offsetY = 0; });
          app.emit('assets');
        } }, '位置リセット'),
        image ? h('button', { class: 'small', title: '画像だけ入れ替える（録音した切替・顔の位置・大きさ・位置・反転はそのまま）。カードに画像をドロップしても可', onclick: async () => replace(await pickFile('image/*', false)) }, '差し替え') : null),
        c.kind === 'mmd' ? mmdControls(app, c) : null,
      ));
    if (image) {
      // an image dropped on the card replaces this entry's image (instead of adding a new 立ち絵);
      // other files (a song, a video…) fall through to the page-wide drop
      const hasImage = (e: DragEvent) => Array.from(e.dataTransfer?.items ?? []).some((i) => i.kind === 'file' && i.type.startsWith('image'));
      el.addEventListener('dragover', (e) => {
        if (!hasImage(e)) return;
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('over');
      });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => {
        el.classList.remove('over');
        const f = Array.from(e.dataTransfer?.files ?? []);
        if (!f.some((x) => x.type.startsWith('image'))) return;
        e.preventDefault();
        e.stopPropagation();
        replace(f);
      });
    }
    return el;
  };
  for (const c of p.characters) if (c.kind !== 'mmd') out.push(card(c, c.name));
  out.push(dropZone('＋ 立ち絵を追加 (PNG)', 'image/*', async (f) => {
    for (const x of f) await app.addCharacterFile(x);
  }));
  // MMD models: each pose / motion is its own 立ち絵 entry of the model
  for (const m of p.mmdModels) {
    const head = h('div', { class: 'mmd-model', title: 'ここに .vpd / .vmd をドロップしても追加できます' },
      h('div', { class: 'row' }, h('b', null, `🧊 ${m.name}`), app.mmdModels.has(m.id) ? null : h('span', { class: 'hint' }, '⚠ 未読込')),
      h('div', { class: 'btns' },
        h('button', { class: 'small', onclick: async () => {
          const f = await pickFile('.vpd,.vmd', true);
          if (f.length) await app.addMmdPoses(m.id, f);
        } }, '＋ ポーズ / モーション'),
        h('button', { class: 'small danger', onclick: () => {
          if (confirm(`${m.name} とそのポーズ / モーションをすべて削除しますか？`)) app.removeMmdModel(m.id);
        } }, 'モデル削除')),
      h('div', { class: 'mini', title: '髪・スカートを揺らす（シーク時は直前0.5秒ぶん計算して落ち着かせます。書き出しは毎回同じ結果）' },
        check(m.physics !== false, '揺れもの（髪・スカート）', (v) => app.setMmdPhysics(m.id, v))),
      ...p.characters.filter((c) => c.mmdModel === m.id).map((c) =>
        card(c, c.mmdPose ? `${c.mmdPose.kind === 'vmd' ? '🎞' : '🧍'} ${c.mmdPose.name}` : '基本姿勢')),
    );
    head.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    head.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const f = Array.from(e.dataTransfer?.files ?? []);
      if (f.length) app.addMmdPoses(m.id, f);
    });
    out.push(head);
  }
  out.push(h('div', { class: 'btns' }, h('button', { class: 'small', title: 'PMX / PMD とテクスチャが入ったフォルダを選ぶ（ウィンドウにフォルダをドロップしても可）', onclick: async () => {
    const files = await pickFolder();
    if (files.length) await app.addMmdFolder(files);
  } }, '＋ MMD モデル（フォルダを選択）')));
  return out;
}

/** MMD entry options: motion tempo (beat sync / original) and speed, lip sync. */
function mmdControls(app: App, c: CharacterRef): Node {
  const upd = (fn: () => void) => app.mutate(fn);
  const hasMouth = !!(c.mmdModel && app.mmdModels.get(c.mmdModel)?.hasMouth);
  const kids: Node[] = [];
  if (c.mmdPose?.kind === 'vmd') {
    kids.push(h('div', { class: 'mini', title: '拍に合わせる：1ループが BPM のちょうど何拍かになるよう速さを自動調整' },
      'テンポ', select([['beat', '拍に合わせる'], ['orig', '元の速さ']], c.mmdSync ?? 'beat', (v) => upd(() => (c.mmdSync = v as 'beat' | 'orig'))),
      select([['0.5', '×0.5'], ['1', '×1'], ['2', '×2']], String(c.mmdSpeed ?? 1), (v) => upd(() => (c.mmdSpeed = +v)))));
  }
  const rot = () => (c.mmdRot ??= { x: 0, y: 0, z: 0 });
  const setRot = (k: 'x' | 'y' | 'z') => (v: number) => app.mutate(() => (rot()[k] = v), { history: false });
  kids.push(
    rotRow('回転Y', c.mmdRot?.y ?? 0, setRot('y'), '向き（体の向きを左右に回す）'),
    rotRow('回転X', c.mmdRot?.x ?? 0, setRot('x'), '前後の傾き（＋で前かがみ）'),
    rotRow('回転Z', c.mmdRot?.z ?? 0, setRot('z'), '左右の傾き（首をかしげるように体ごと傾ける）'),
  );
  kids.push(h('div', { class: 'mini', title: 'カメラ VMD：この立ち絵の間は MMD のカメラで全画面表示（カメラトラックのフレーミングは使わない）。タイミングはモーションと同じ' },
    'カメラ',
    c.mmdCamera
      ? h('span', null, `🎥 ${c.mmdCamera.name} `, h('button', { class: 'small', onclick: () => app.setMmdCamera(c.id, null) }, '外す'))
      : h('button', { class: 'small', onclick: async () => {
        const f = await pickFile('.vmd');
        if (f.length) await app.setMmdCamera(c.id, f[0]);
      } }, '＋ カメラ VMD')));
  kids.push(h('div', { class: 'mini', title: hasMouth ? '曲の歌声の帯域の大きさで口（モーフ「あ」）を動かす' : 'このモデルには口のモーフ「あ」がありません' },
    check(!!c.mmdLip && hasMouth, '口パク（曲の音量）', (v) => upd(() => (c.mmdLip = v)))));
  return h('div', null, ...kids);
}

/** Rotation slider (-180°..180°) with a live readout. Double-click resets to 0. */
function rotRow(label: string, value: number, on: (v: number) => void, title: string) {
  const fmt = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}°`;
  const out = h('span', { class: 'val' }, fmt(value));
  const r = range(-180, 180, 1, value, (v) => {
    out.textContent = fmt(v);
    on(v);
  });
  r.addEventListener('dblclick', () => {
    r.value = '0';
    out.textContent = fmt(0);
    on(0);
  });
  return h('div', { class: 'mini', title: `${title}・ダブルクリックで0に戻す` }, label, r, out);
}

/** Offset slider (-50%..+50% of the screen) with a live readout. Double-click resets to 0. */
function offsetRow(label: string, value: number, on: (v: number) => void, title: string) {
  const fmt = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
  const out = h('span', { class: 'val' }, fmt(value));
  const r = range(-0.5, 0.5, 0.005, value, (v) => {
    out.textContent = fmt(v);
    on(v);
  });
  r.addEventListener('dblclick', () => {
    r.value = '0';
    out.textContent = fmt(0);
    on(0);
  });
  return h('div', { class: 'mini', title: `${title}・ダブルクリックで0に戻す` }, label, r, out);
}

function faceThumb(img: HTMLCanvasElement | undefined, faceY: number) {
  const c = thumb(img);
  if (img) {
    const x = c.getContext('2d')!;
    const k = Math.min(108 / img.width, 108 / img.height);
    const y = (108 - img.height * k) / 2 + img.height * k * faceY;
    x.strokeStyle = '#08d9d6';
    x.lineWidth = 2;
    x.setLineDash([4, 3]);
    x.beginPath();
    x.moveTo(0, y);
    x.lineTo(108, y);
    x.stroke();
  }
  return c;
}

function paletteGrid(app: App) {
  const s = app.settings;
  const all: Palette[] = [...listPalettes(), { ...s.customPalette, id: 'custom', name: 'Custom' }];
  return h('div', { class: 'palettes' }, ...all.map((pl) => h('button', {
    class: 'pal' + (s.paletteId === pl.id ? ' on' : ''),
    title: pl.name,
    onclick: () => app.mutate(() => {
      if (pl.id === 'custom' && s.paletteId !== 'custom') s.customPalette = { ...paletteOf(s), id: 'custom', name: 'Custom' };
      s.paletteId = pl.id;
    }),
  }, h('span', { style: `background:${pl.bg}` }), h('span', { style: `background:${pl.accent}` }), h('span', { style: `background:${pl.accent2}` }))));
}

function customPalette(app: App) {
  const cp = app.settings.customPalette;
  const col = (k: keyof Palette, label: string) => h('label', { class: 'row', style: 'gap:4px;font-size:11px;color:var(--dim)' },
    h('input', { type: 'color', value: cp[k], oninput: (e: Event) => app.mutate(() => ((cp as any)[k] = (e.target as HTMLInputElement).value), { history: false }) }), label);
  return h('div', { class: 'btns' }, col('bg', '背景'), col('text', '文字'), col('accent', 'アクセント'), col('accent2', 'サブ'));
}

