// Guided tour over the demo project: a spotlight on one part of the screen and a card saying what to do.
// Steps that ask for an action watch the app and show ✓ (most then move on by themselves); every step can be
// skipped. Opens on the first visit (the demo was just opened) and from the ？ button.

import type { App } from '../app';
import { lastTimeBefore, lineChars, lineFirstTarget } from '../core/lyrics';
import { lsGetMigrated } from '../core/storage';
import { h } from './dom';
import { confirmNewProject } from './panels';

const LS_KEY = 'minamo.tutorial';
const LEGACY_LS_KEY = 'mvotoge.tutorial'; // the app's former name

export function tutorialSeen(): boolean {
  try {
    return lsGetMigrated(LS_KEY, LEGACY_LS_KEY) === 'done';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(LS_KEY, 'done');
  } catch {
    /* private mode: shown again next time */
  }
}

interface Step {
  title: string;
  /** HTML. */
  body: string;
  /** Selector of the part of the screen to light up (none: the card in the middle). */
  target?: string;
  enter?: () => void;
  /** What the user is asked to do; the card shows ✓ once `done` holds. */
  task?: string;
  done?: () => boolean;
  /** Go on by itself shortly after `done`. */
  auto?: boolean;
  /** Last step: 新規 / keep the demo. */
  final?: boolean;
}

interface Tour {
  app: App;
  steps: Step[];
  i: number;
  shade: HTMLElement;
  hole: HTMLElement;
  card: HTMLElement;
  /** Lyric taps since the lyric step started. */
  taps: number;
  /** Lyric effect events when the effect step started. */
  fx0: number;
  shownDone: boolean;
  autoTimer: number;
  raf: number;
}

let tour: Tour | null = null;
const tapWatch = new WeakSet<App>();

const kbd = (k: string) => `<kbd>${k}</kbd>`;

/**
 * A line for a lyric step: the named demo line (both have a rest before them, so REC does not warn about going back),
 * else the first timed line with a few characters (other than `not`).
 */
function pickLine(app: App, name = 'なんか爽やかな', not = -1): number {
  const ls = app.project.lines;
  const named = ls.findIndex((l) => l.text === name);
  if (named >= 0) return named;
  const timed = ls.findIndex((l, i) => i !== not && l.times[0] != null && lineChars(l).length >= 4);
  return timed >= 0 ? timed : ls.length ? 0 : -1;
}

function stopAll(app: App) {
  if (app.recording) app.stopRec();
  else app.pause();
}

/** Seek up to two bars before the line, but after the lyric before it (REC would warn about going back). */
function seekBefore(app: App, line: number) {
  if (line < 0) return;
  const tg = app.targets(), k = lineFirstTarget(tg, line);
  const at = app.project.lines[line].times.find((x) => x != null);
  if (at == null) return;
  const prev = lastTimeBefore(app.project.lines, tg, k);
  const bar = app.compiled?.grid.barDur ?? 2;
  app.seek(Math.max(0, at - 2 * bar, prev != null && prev < at ? prev + 0.05 : 0));
}

/** Put the lyric input position on the line and seek before it. */
function cueLine(app: App, line: number) {
  if (line < 0) return;
  app.setCursor(lineFirstTarget(app.targets(), line));
  seekBefore(app, line);
}

/** Scroll the key panel to a group heading. */
function showKeyGroup(prefix: string) {
  const g = [...document.querySelectorAll('#rightPanel h4')].find((x) => x.textContent?.startsWith(prefix));
  g?.scrollIntoView({ block: 'start' });
}

function buildSteps(app: App, t: Tour): Step[] {
  const line = pickLine(app);
  const lineE = pickLine(app, '君の洗濯物', line);
  const lineEText = lineE >= 0 ? app.project.lines[lineE].text : '';
  const lineText = line >= 0 ? app.project.lines[line].text : '';
  const cueSeek = () => seekBefore(app, line);
  return [
    {
      title: 'ようこそ！',
      body: `デモのプロジェクト（曲・歌詞・立ち絵・演出入り）が開いています。<br>
        数分で <b>歌に合わせて歌詞を出す</b>・<b>エフェクトを付ける</b> をひととおり体験できます。<br>
        <span class="dim">画面はそのまま操作できます。いつでも「スキップ」で終われます。</span>`,
    },
    {
      title: 'まずは見てみる',
      target: '#btnPlay',
      body: `▶ ボタンか ${kbd('Space')} で再生・停止します。デモがどう動くか見てみましょう。`,
      task: '再生してみる',
      done: () => app.engine.playing,
    },
    {
      title: 'タイムライン',
      target: '.timeline-wrap',
      body: `トラックごとの記録です。◆ はキーを叩いて記録した演出、帯は表示中の歌詞やテロップ。<br>
        クリックで選ぶと、右下のインスペクタで時刻や値を直せます。`,
    },
    {
      title: 'トラックを選ぶ',
      target: '#modeTabs',
      enter: () => stopAll(app),
      body: `上のタブが、キーで演出する（録音する）トラックです。<br>「歌詞」を選んでください（${kbd('Tab')} でも切り替わります）。`,
      task: '「歌詞」トラックを選ぶ',
      done: () => app.mode === 'lyrics',
      auto: true,
    },
    {
      title: '歌に合わせて歌詞を出す',
      target: '#prompter',
      enter: () => {
        stopAll(app);
        app.setMode('lyrics');
        cueLine(app, line);
        t.taps = 0;
      },
      body: `次に出る文字がここで光っています${lineText ? `（「${lineText}」）` : ''}。<br>
        ${kbd('Shift')}+${kbd('R')} で REC → 歌に合わせて ${kbd('Space')} を <b>1文字ずつ</b> 押します
        （1行まとめて出すなら ${kbd('Enter')}）。<br>押し終わったら ${kbd('Esc')} で止めます。`,
      task: 'REC して Space で歌詞を出し、Esc で止める',
      done: () => t.taps > 0 && !app.recording,
      auto: true,
    },
    {
      title: '確かめる',
      target: '#frame',
      enter: () => {
        stopAll(app);
        cueSeek();
      },
      body: `▶ で再生して、いま付けたタイミングで文字が出るか見てみましょう。<br>
        やり直すときは ${kbd('Ctrl')}+${kbd('Z')}（録音ごと戻ります）。`,
      task: '再生して確かめる',
      done: () => app.engine.playing,
    },
    {
      title: '1行ずつ出す',
      target: '#prompter',
      enter: () => {
        stopAll(app);
        cueLine(app, lineE);
        t.taps = 0;
      },
      body: `1行まとめて出したいときは ${kbd('Enter')}。行の頭で1回押すだけで、その行が出ます${lineEText ? `（次は「${lineEText}」）` : ''}。<br>
        ${kbd('Shift')}+${kbd('R')} で REC → 歌い出しに合わせて ${kbd('Enter')} → ${kbd('Esc')} で止めます。<br>
        <span class="dim">1文字ずつ（${kbd('Space')}）と1行ずつ（${kbd('Enter')}）は、行ごとに混ぜて使えます。</span>`,
      task: 'REC して Enter で1行出し、Esc で止める',
      done: () => t.taps > 0 && !app.recording,
      auto: true,
    },
    {
      title: 'エフェクトを付ける',
      target: '#rightPanel',
      enter: () => {
        stopAll(app);
        app.setMode('lyrics');
        cueSeek();
        app.setCursorFollow(true); // back to following the playhead (the lyric step pinned the input position)
        showKeyGroup('EFFECT');
        t.fx0 = app.project.lyricEvents.length;
      },
      body: `右のキーパネルは、いまのトラックで使えるキーの一覧です。歌詞トラックの ${kbd('Q')}〜${kbd('T')} は
        文字のエフェクト（影・縁取り・グロー…。押すたびにオン / オフ）。<br>
        ${kbd('Shift')}+${kbd('R')} で REC して、歌の途中で ${kbd('Q')}〜${kbd('T')} を押してみましょう。${kbd('Esc')} で止めます。<br>
        <span class="dim">REC 中の ${kbd('Space')} は歌詞の入力になるので、止めるのは ${kbd('Esc')} で。</span>`,
      task: 'REC してエフェクトのキーを押し、Esc で止める',
      done: () => app.project.lyricEvents.length > t.fx0 && !app.recording,
      auto: true,
    },
    {
      title: 'ほかのトラックも同じ',
      target: '#modeTabs',
      enter: () => stopAll(app),
      body: `立ち絵・カメラ・FX・ルック…も「トラックを選ぶ → REC → キーを叩く」の繰り返しです。<br>
        録音は重ね録りなので、何度でも演出を足していけます。`,
    },
    {
      title: '止めたまま置く・直す',
      target: '.timeline-wrap',
      body: `停止中でも、タイムラインを <b>ダブルクリック</b> するとメニューから演出を置けます。<br>
        ◆ を選んでキーを押すと、その値に書き換わります。`,
    },
    {
      title: '書き出し',
      target: '#btnExport',
      body: 'できたら「書き出し」で動画ファイル（MP4 / WebM）に。プレビューで見えているとおりに書き出されます。',
    },
    {
      title: '自分の曲で作るには',
      target: '#btnNew',
      final: true,
      body: `「新規」でデモを片付けて、<b>まっさらなプロジェクト</b> から始めます（歌詞は見本に戻り、曲・立ち絵・背景・記録は外れます）。<br>
        デモは左パネル「プロジェクト → デモを開く」でいつでも戻せます。<br>
        このチュートリアルは右上の「？」からもう一度見られます。`,
    },
  ];
}

export function tutorialOpen(): boolean {
  return !!tour;
}

/** Start the tour (from the first step). */
export function startTutorial(app: App) {
  endTutorial(false);
  if (!tapWatch.has(app)) {
    tapWatch.add(app);
    app.on('tap', () => tour && tour.taps++);
  }
  const shade = h('div', { class: 'tut-shade' });
  const hole = h('div', { class: 'tut-hole' });
  const card = h('div', { class: 'tut-card', role: 'dialog', 'aria-label': 'チュートリアル' });
  // clicks on the card must not take the focus (Space would press the focused button)
  card.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) e.preventDefault();
  });
  document.body.append(shade, hole, card);
  const t: Tour = { app, steps: [], i: -1, shade, hole, card, taps: 0, fx0: 0, shownDone: false, autoTimer: 0, raf: 0 };
  t.steps = buildSteps(app, t);
  tour = t;
  go(0);
  const loop = () => {
    if (tour !== t) return;
    frame(t);
    t.raf = requestAnimationFrame(loop);
  };
  t.raf = requestAnimationFrame(loop);
}

/** Close the tour. `seen`: do not open it again on start-up. */
export function endTutorial(seen = true) {
  const t = tour;
  if (!t) return;
  tour = null;
  cancelAnimationFrame(t.raf);
  clearTimeout(t.autoTimer);
  t.shade.remove();
  t.hole.remove();
  t.card.remove();
  if (seen) markSeen();
}

function go(i: number) {
  const t = tour;
  if (!t) return;
  clearTimeout(t.autoTimer);
  t.i = Math.max(0, Math.min(t.steps.length - 1, i));
  t.shownDone = false;
  t.steps[t.i].enter?.();
  render(t);
  frame(t);
}

function render(t: Tour) {
  const s = t.steps[t.i];
  const done = !!s.done?.();
  const btn = (label: string, cls: string, on: () => void) => h('button', { class: cls, onclick: on }, label);
  const actions = s.final
    ? [
      btn('デモのまま続ける', 'small', () => endTutorial()),
      btn('新規（まっさらにする）', 'small accent', () => {
        if (confirmNewProject(t.app)) endTutorial();
      }),
    ]
    : [
      t.i > 0 ? btn('← 戻る', 'small', () => go(t.i - 1)) : null,
      btn(t.i === 0 ? 'はじめる →' : '次へ →', `small${!s.task || done ? ' accent' : ''}`, () => go(t.i + 1)),
    ];
  const parts: (HTMLElement | null)[] = [
    h('div', { class: 'tut-head' },
      h('span', { class: 'tut-count' }, `チュートリアル ${t.i + 1} / ${t.steps.length}`),
      s.final ? null : h('button', { class: 'tut-skip', onclick: () => endTutorial() }, 'スキップ')),
    h('h3', null, s.title),
    h('div', { class: 'tut-body', html: s.body }),
    s.task ? h('div', { class: `tut-task${done ? ' done' : ''}` }, done ? '✓ できました！' : `やってみよう：${s.task}`) : null,
    h('div', { class: 'tut-actions' }, ...actions),
  ];
  t.card.replaceChildren(...parts.filter((x) => x !== null));
  t.card.classList.toggle('center', !s.target);
}

function frame(t: Tour) {
  const s = t.steps[t.i];
  // task state
  if (s.task) {
    const done = !!s.done?.();
    if (done !== t.shownDone) {
      t.shownDone = done;
      render(t);
      clearTimeout(t.autoTimer);
      const i = t.i;
      if (done && s.auto) t.autoTimer = window.setTimeout(() => tour === t && t.i === i && go(i + 1), 1400);
    }
  }
  // spotlight
  const el = s.target ? document.querySelector(s.target) : null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const cw = t.card.offsetWidth, ch = t.card.offsetHeight;
  if (!el) {
    t.hole.hidden = true;
    t.shade.hidden = false;
    t.card.style.left = `${(vw - cw) / 2}px`;
    t.card.style.top = `${(vh - ch) / 2}px`;
    return;
  }
  const r = el.getBoundingClientRect();
  const pad = 6;
  t.shade.hidden = true;
  t.hole.hidden = false;
  Object.assign(t.hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  // the card next to the lit part: below, above, then the side with more room
  const gap = 14;
  let x: number, y: number;
  if (r.bottom + gap + ch < vh - 8) {
    x = r.left + r.width / 2 - cw / 2;
    y = r.bottom + gap;
  } else if (r.top - gap - ch > 8) {
    x = r.left + r.width / 2 - cw / 2;
    y = r.top - gap - ch;
  } else {
    x = r.left > vw - r.right ? r.left - gap - cw : r.right + gap;
    y = r.top + r.height / 2 - ch / 2;
  }
  t.card.style.left = `${Math.max(8, Math.min(vw - cw - 8, x))}px`;
  t.card.style.top = `${Math.max(8, Math.min(vh - ch - 8, y))}px`;
}
