// Phone tutorial: play, press the スピン pad while playing (shown, not recorded), then REC + スピン (recorded),
// then play it back. Opens on the first visit (the demo); ？ opens it again; localStorage minamo.mobileTutorial.
import type { App } from '../app';
import { fxKeyMap } from '../engine/api';
import { $, h } from '../ui/dom';

const LS_KEY = 'minamo.mobileTutorial';
const FX_ID = 'spin';

export function mobileTutorialSeen(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === 'done';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(LS_KEY, 'done');
  } catch {
    /* private mode */
  }
}

interface Step {
  title: string;
  body: string;
  /** Element to point at (re-queried: the pads are rebuilt). */
  target?: () => HTMLElement | null;
  task?: string;
  enter?: () => void;
  done?: () => boolean;
  final?: boolean;
}

let close: (() => void) | null = null;

export function startMobileTutorial(app: App) {
  close?.();
  const spinKey = () => [...fxKeyMap()].find(([, id]) => id === FX_ID)?.[0] ?? '';
  const spinPad = () => $(`#pads .pad[data-key="${CSS.escape(spinKey())}"]`) ?? $('#pads .pad');
  const spins = () => app.project.fxEvents.filter((e) => e.fx === FX_ID).length;
  let tried = false;
  let base = 0;
  // a press of the スピン pad while just playing = a try (shown, not recorded)
  const onPress = (e: PointerEvent) => {
    const pad = (e.target as HTMLElement).closest('.pad');
    if (pad && pad === spinPad() && app.engine.playing && !app.recording) tried = true;
  };
  document.addEventListener('pointerdown', onPress, true);

  const steps: Step[] = [
    {
      title: 'ようこそ MinaMo へ',
      body: '画面のパッドを叩くと、歌に合わせてエフェクトがその場で出ます。FX の「スピン」で試してみましょう。',
    },
    {
      title: '再生する',
      body: '▶ を押して曲を再生します。',
      target: () => $('#btnPlay'),
      task: '▶ を押す',
      enter: () => app.setMode('fx'),
      done: () => app.engine.playing,
    },
    {
      title: '再生しながらスピン',
      body: '再生中に「スピン」のパッドを押すと、画面がくるっと回ります。これは試し弾きで、まだ記録はされません。',
      target: spinPad,
      task: '再生中に「スピン」を押す',
      enter: () => {
        app.setMode('fx');
        tried = false;
      },
      done: () => tried,
    },
    {
      title: '記録する',
      body: '● REC を押してから「スピン」を押すと、その時刻に記録されます。押せたら ■ 停止。',
      target: () => (app.recording ? spinPad() : $('#btnRec')),
      task: '● REC → 「スピン」 → ■ 停止',
      enter: () => {
        app.setMode('fx');
        base = spins();
      },
      done: () => !app.recording && spins() > base,
    },
    {
      title: '記録できました',
      body: '▶ で再生すると、記録したスピンが毎回出ます。録り直すときは ↶。ほかのトラック（歌詞・立ち絵・カメラ…）も同じように REC して重ねていけます。自分の曲は ☰ から読み込めます。',
      target: () => $('#btnPlay'),
      final: true,
    },
  ];

  let i = 0;
  let ticked = false;
  let timer = 0;
  const card = h('div', { class: 'mt-card' });
  document.body.append(card);
  const pads = $('#pads');
  let marked: HTMLElement | null = null;
  const mark = (el: HTMLElement | null) => {
    if (el === marked) return;
    marked?.classList.remove('mt-target');
    marked = el;
    marked?.classList.add('mt-target');
    // keep the target above the card (the card sits over the bottom of the pads)
    if (marked?.closest('#pads')) {
      const r = marked.getBoundingClientRect();
      const top = pads.getBoundingClientRect().top + 8;
      const bottom = card.getBoundingClientRect().top - 12;
      if (r.bottom > bottom) pads.scrollTop += r.bottom - bottom;
      else if (r.top < top) pads.scrollTop -= top - r.top;
    }
  };
  const fit = () => (pads.style.paddingBottom = `${card.offsetHeight + 16}px`);

  const finish = () => {
    markSeen();
    close?.();
  };
  const render = () => {
    const s = steps[i];
    const ok = !!s.done?.();
    card.replaceChildren(...[
      h('div', { class: 'mt-head' }, h('span', { class: 'mt-count' }, `${i + 1} / ${steps.length}`), h('button', { class: 'mt-skip', onclick: finish }, 'スキップ')),
      h('h3', null, s.title),
      h('p', null, s.body),
      s.task ? h('div', { class: `mt-task${ok ? ' done' : ''}` }, ok ? `✓ できました` : `▶ ${s.task}`) : null,
      h('div', { class: 'mt-actions' },
        i > 0 ? h('button', { onclick: () => go(i - 1) }, '戻る') : null,
        s.final ? h('button', { class: 'accent', onclick: finish }, 'はじめる')
          : s.task ? h('button', { class: ok ? 'accent' : '', onclick: () => go(i + 1) }, ok ? '次へ' : '飛ばす')
          : h('button', { class: 'accent', onclick: () => go(i + 1) }, '次へ')),
    ].filter(Boolean) as Node[]);
    fit();
  };
  const go = (n: number) => {
    i = Math.max(0, Math.min(steps.length - 1, n));
    ticked = false;
    steps[i].enter?.();
    render();
  };
  // follow the app: tick the task, move on by itself, keep the pointer on the right element
  timer = window.setInterval(() => {
    const s = steps[i];
    mark(s.target?.() ?? null);
    if (s.done && !ticked && s.done()) {
      ticked = true;
      render();
      setTimeout(() => ticked && steps[i] === s && go(i + 1), 900);
    }
  }, 150);
  close = () => {
    clearInterval(timer);
    document.removeEventListener('pointerdown', onPress, true);
    mark(null);
    card.remove();
    pads.style.paddingBottom = '';
    close = null;
  };
  go(0);
}
