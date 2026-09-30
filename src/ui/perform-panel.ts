// Right panel: performance keys of the armed track (with live state lights) and the inspector.

import type { App, EventTrack } from '../app';
import { listPalettes, getFx, getStyle, findTelop, listFx, listLookStyles, listLyricStyles, listTelops, listVisualizers, type ElemTarget } from '../engine/api';
import { parseEffects } from '../engine/compile';
import { allEffects, allFrames, allMotions, allMoves, POSITIONS } from '../engine/director';
import { fmtTime } from '../engine/lib';
import { keyLabel, modeInfo, VIZ_COLORS, VIZ_LAYERS, VIZ_POSITIONS, VIZ_SIZES, type PerfKey } from '../perform';
import { $, h } from './dom';

const row = (label: string, ...ctrl: (Node | string)[]) => h('div', { class: 'row' }, h('label', null, label), h('div', { class: 'grow row' }, ...ctrl));

function num(value: number, step: number, on: (v: number) => void) {
  return h('input', { type: 'number', value: String(value), step: String(step), onchange: (e: Event) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) on(v);
  } });
}

function select(options: [string, string][], value: string, on: (v: string) => void) {
  return h('select', { onchange: (e: Event) => on((e.target as HTMLSelectElement).value) },
    ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

function check(checked: boolean, label: string, on: (v: boolean) => void) {
  return h('label', { class: 'row', style: 'gap:6px;cursor:pointer' },
    h('input', { type: 'checkbox', checked, onchange: (e: Event) => on((e.target as HTMLInputElement).checked) }), label);
}

export function buildRightPanel(app: App) {
  const root = $('#rightPanel');
  const inspector = h('div', { class: 'sec-body inspector' });
  let lights: { el: HTMLElement; k: PerfKey }[] = [];

  const render = () => {
    const info = modeInfo(app.mode);
    const keys = app.perfKeyList();
    const groups = new Map<string, PerfKey[]>();
    for (const k of keys) {
      let g = groups.get(k.group);
      if (!g) groups.set(k.group, (g = []));
      g.push(k);
    }
    lights = [];
    const keyEl = (k: PerfKey) => {
      const el = h('div', {
        class: `key${k.wide ? ' wide' : ''}`,
        'data-key': k.key,
        style: `--c:${k.color}`,
        title: k.label,
        onmousedown: (e: MouseEvent) => {
          e.preventDefault();
          app.perform(k, app.eventTime(), e.shiftKey);
        },
      }, h('kbd', null, keyLabel(k.key)), h('span', { class: 'chip', style: `background:${k.color}` }), h('span', { class: 'kname' }, k.label + (k.holdable ? ' ⏵' : '')));
      if (k.active) lights.push({ el, k });
      return el;
    };
    root.replaceChildren(
      h('details', { class: 'sec', open: true },
        h('summary', null, 'Perform', h('span', { class: 'jp', style: `color:${info.color}` }, `${info.name}トラック`)),
        h('div', { class: 'sec-body' },
          h('div', { class: 'hint' }, h('kbd', null, 'Tab'), ' でトラック切替 · ', h('kbd', null, 'Shift'), '+', h('kbd', null, 'R'), ' で REC（一時停止・', h('kbd', null, 'Esc'), ' で REC 終了）· 再生中は押すと試し弾き（記録されない）'),
          h('div', { class: 'rec-opts' },
            h('label', null, h('input', { type: 'radio', name: 'recmode', checked: app.overdub, onchange: () => app.setOverdub(true) }), '重ね録り'),
            h('label', null, h('input', { type: 'radio', name: 'recmode', checked: !app.overdub, onchange: () => app.setOverdub(false) }), '上書き'),
            h('span', { class: 'hint' }, app.overdub ? '既存の記録に追加' : '録音した区間のこのトラックを差し替え'),
          ),
          h('div', { class: 'hint' }, info.hint),
          ...[...groups.entries()].flatMap(([name, ks]) => [h('h4', null, name), h('div', { class: 'keys' }, ...ks.map(keyEl))]),
          app.mode === 'lyrics' ? h('div', { class: 'hint' }, h('kbd', null, 'BS'), ' 直前の入力を取り消し（REC中） · 歌詞スタイルはその後に始まる行に適用') : null,
          app.mode === 'chara' && !app.project.characters.length ? h('div', { class: 'hint' }, '左パネルで立ち絵を追加してください') : null,
          app.mode === 'look' && !app.project.backgrounds.length ? h('div', { class: 'hint' }, '背景画像を追加すると Q行で切り替えられます') : null,
        ),
      ),
      h('details', { class: 'sec', open: true }, h('summary', null, 'Inspector', h('span', { class: 'jp' }, '選択中')), inspector),
    );
    updateLights(true);
    renderInspector(app, inspector);
  };

  let lastLight = '';
  const updateLights = (force = false) => {
    if (!app.compiled) return;
    const t = app.time;
    let sig = '';
    const on = lights.map(({ k }) => {
      const v = !!k.active!(t);
      sig += v ? '1' : '0';
      return v;
    });
    if (!force && sig === lastLight) return;
    lastLight = sig;
    lights.forEach(({ el }, i) => el.classList.toggle('active', on[i]));
  };

  const safeInspector = () => {
    if (inspector.contains(document.activeElement)) return; // re-rendered on focusout
    renderInspector(app, inspector);
  };
  inspector.addEventListener('focusout', () => setTimeout(() => !inspector.contains(document.activeElement) && renderInspector(app, inspector), 0));

  render();
  for (const ev of ['registry', 'mode', 'assets']) app.on(ev, render);
  app.on('frame', () => updateLights());
  app.on('selection', () => renderInspector(app, inspector));
  app.on('project', safeInspector);
}

const CHARA_KINDS: [string, string][] = [['char', 'キャラ'], ['pos', '位置'], ['effect', 'エフェクト'], ['motion', 'モーション']];
const ELEM_KINDS: [string, string][] = [['effect', 'エフェクト'], ['motion', 'モーション']];
const CAM_KINDS: [string, string][] = [['frame', 'フレーミング'], ['move', 'ムーブ']];
const LOOK_KINDS: [string, string][] = [['style', 'スタイル'], ['bg', '背景'], ['palette', 'パレット'], ['dim', '明るさ']];
const VIZ_KINDS: [string, string][] = [['type', '種類'], ['pos', '位置'], ['color', '色'], ['size', '大きさ'], ['layer', '重なり']];
const TRACK_TITLE: Record<EventTrack, string> = {
  lstyle: 'LYRIC STYLE', lfx: 'LYRICS エフェクト / モーション', tfx: 'TELOP エフェクト / モーション', chara: 'CHARA', cam: 'CAMERA', fx: 'FX', viz: 'VISUAL', look: 'LOOK',
};
/** Element whose effects / motions an event list holds. */
const ELEM_OF: Partial<Record<EventTrack, ElemTarget>> = { lfx: 'lyrics', tfx: 'telop', chara: 'chara' };

function valueOptions(app: App, track: EventTrack, kind: string): [string, string][] {
  const auto: [string, string] = ['auto', 'オート'];
  const named = (list: { id: string; name: string }[]) => list.map((x) => [x.id, x.name] as [string, string]);
  const elem = ELEM_OF[track];
  if (elem && kind === 'motion') return track === 'chara' ? [...named(allMotions('chara')), auto] : named(allMotions(elem));
  if (elem && kind === 'effect') return track === 'chara' ? [['', 'なし'], auto] : [['', 'なし']];
  if (track === 'chara') {
    if (kind === 'char') return [...app.project.characters.map((c) => [c.id, c.name] as [string, string]), ['none', '隠す'], auto];
    if (kind === 'pos') return [...named(POSITIONS), auto];
  }
  if (track === 'cam') return [...named(kind === 'frame' ? allFrames() : allMoves()), auto];
  if (track === 'viz') {
    if (kind === 'type') return [...listVisualizers().map((v) => [v.id, v.name] as [string, string]), ['none', '消す']];
    return named(kind === 'pos' ? VIZ_POSITIONS : kind === 'color' ? VIZ_COLORS : kind === 'size' ? VIZ_SIZES : VIZ_LAYERS);
  }
  if (track === 'look') {
    if (kind === 'style') return listLookStyles().map((s) => [s.id, s.name]);
    if (kind === 'bg') return [...app.project.backgrounds.map((b, i) => [String(i), `背景${i + 1} ${b.name}`] as [string, string]), ['none', '背景なし'], auto];
    if (kind === 'palette') return [...listPalettes().map((p) => [p.id, p.name] as [string, string]), ['custom', 'Custom'], auto];
    if (kind === 'dim') return [['0', '明るい'], ['0.25', '標準'], ['0.5', '暗め'], ['0.85', '真っ暗'], auto];
  }
  return [auto];
}

function renderInspector(app: App, root: HTMLElement) {
  const s = app.selection;
  const p = app.project;
  const time = (v: number, on: (v: number) => void) => num(+v.toFixed(3), 0.001, on);
  const del = h('button', { class: 'small danger', onclick: () => app.deleteSelection() }, '削除 (Del)');
  if (!s) {
    root.replaceChildren(h('div', { class: 'empty' }, 'タイムラインの項目をクリックで選択。ドラッグで移動、Alt+ドラッグでスナップ無効、右クリックで削除。トラック名をクリックでそのトラックを録音対象に。'));
    return;
  }
  if (s.type === 'line' || s.type === 'glyph' || s.type === 'end') {
    const l = p.lines[s.index];
    if (!l) return root.replaceChildren();
    const tapped = l.times.filter((x) => x != null).length;
    const kids: Node[] = [h('h4', null, `LINE #${s.index + 1}`), h('div', null, l.text)];
    if (l.sub) kids.push(h('div', { class: 'hint' }, l.sub));
    if (l.times[0] != null) {
      kids.push(row('開始', time(l.times[0], (v) => app.mutate(() => {
        const d = v - (l.times[0] ?? 0);
        p.lines[s.index] = { ...l, times: l.times.map((x) => (x == null ? null : x + d)), end: l.end == null ? null : l.end + d };
      })), h('button', { class: 'small', onclick: () => app.seek(l.times[0] ?? 0) }, '▶')));
    }
    kids.push(h('div', { class: 'hint' }, `文字タイミング ${tapped} / ${l.times.length}（未入力の文字は自動）`));
    const cl = app.compiled.lines.find((x) => x.index === s.index);
    if (cl) {
      // the style of this line only (an event at its start, the previous style restored at the next line)
      const own = p.lyricStyleEvents.find((e) => Math.abs(e.time - cl.start) < 1e-3);
      kids.push(row('この行の歌詞スタイル', select([['', `流れに従う（${cl.style.name}）`], ...listLyricStyles().map((x) => [x.id, x.name] as [string, string])], own?.style ?? '', (v) => app.setLineStyle(s.index, v || null))));
    }
    if (s.type === 'glyph') {
      const t = l.times[s.glyph];
      kids.push(h('h4', null, `文字「${Array.from(l.chunks.join(''))[s.glyph] ?? ''}」`));
      if (t != null) kids.push(row('時刻', time(t, (v) => app.mutate(() => {
        const times = [...l.times];
        times[s.glyph] = v;
        p.lines[s.index] = { ...l, times };
      }))));
    }
    kids.push(row('明示的な終了', check(l.end != null, l.end != null ? fmtTime(l.end) : 'なし（次の行まで）', (v) => app.mutate(() => {
      p.lines[s.index] = { ...l, end: v ? Math.max((l.times[0] ?? 0) + 0.5, app.time) : null };
    }))));
    if (l.end != null) kids.push(row('終了', time(l.end, (v) => app.mutate(() => (p.lines[s.index] = { ...l, end: v })))));
    kids.push(h('div', { class: 'btns' },
      h('button', { class: 'small', onclick: () => app.mutate(() => (p.lines[s.index] = { ...l, times: l.times.map((x, i) => (i === 0 ? x : null)) })) }, '文字タイミングだけ消去'),
      h('button', { class: 'small danger', onclick: () => app.mutate(() => (p.lines[s.index] = { ...l, times: l.times.map(() => null), end: null })) }, 'この行を未入力に'),
    ));
    root.replaceChildren(...kids);
    return;
  }
  if (s.type === 'telop') {
    const tp = p.telops[s.index];
    const ct = app.compiled.telops.find((x) => x.index === s.index);
    if (!tp) return root.replaceChildren();
    const def = findTelop(tp.template);
    const kids: Node[] = [h('h4', null, `TELOP #${s.index + 1}`), h('div', null, `[${def?.name ?? tp.template}] ${ct?.text ?? tp.text}`)];
    if (tp.sub) kids.push(h('div', { class: 'hint' }, ct?.sub ?? tp.sub));
    if (tp.start != null) {
      kids.push(row('開始', time(tp.start, (v) => app.mutate(() => (p.telops[s.index] = { ...tp, start: Math.max(0, v) }))), h('button', { class: 'small', onclick: () => app.seek(tp.start ?? 0) }, '▶')));
      kids.push(row('長さ（秒）', time(ct?.dur ?? 1, (v) => app.mutate(() => (p.telops[s.index] = { ...tp, dur: Math.max(0.1, v) })))));
      kids.push(check(tp.dur == null, `型の既定の長さ（${def?.bars ?? 4}小節）`, (v) => app.mutate(() => (p.telops[s.index] = { ...tp, dur: v ? null : ct?.dur ?? 1 }))));
    } else kids.push(h('div', { class: 'hint' }, '未配置。テロップトラックで REC して Space で出します。'));
    kids.push(row('型', select([...listTelops().map((d) => [d.id, d.name] as [string, string])], def?.id ?? 'caption', (v) => {
      // rewrite the template tag in the source line so the list stays the source of truth
      const lines = p.telopText.split(/\r?\n/);
      const li = lines.findIndex((l) => l.trim() === tp.raw);
      if (li < 0) return;
      const body = tp.raw.replace(/^\[[^\]]+\]\s*/, '');
      const raw = `[${listTelops().find((d) => d.id === v)?.name ?? v}] ${body}`;
      lines[li] = raw;
      app.mutate(() => (p.telops[s.index] = { ...tp, raw, template: v }), { silent: true });
      app.setTelops(lines.join('\n'));
    })));
    kids.push(h('div', { class: 'hint' }, '本文は左パネルのテロップ一覧で編集。タイムラインで帯の右端をドラッグすると長さを変えられます。'));
    kids.push(h('div', { class: 'btns' }, h('button', { class: 'small danger', onclick: () => app.deleteSelection() }, '未配置に戻す')));
    root.replaceChildren(...kids);
    return;
  }
  const ev = app.eventList(s.track).find((e) => e.id === s.id) as any;
  if (!ev) return root.replaceChildren();
  const kids: Node[] = [h('h4', null, TRACK_TITLE[s.track])];
  kids.push(row('時刻', time(ev.time, (v) => app.mutate(() => (ev.time = Math.max(0, v)))), h('button', { class: 'small', onclick: () => app.seek(ev.time) }, '▶')));
  if (s.track === 'lstyle') {
    kids.push(row('歌詞スタイル', select(listLyricStyles().map((x) => [x.id, x.name]), ev.style, (v) => app.mutate(() => (ev.style = v)))));
    kids.push(h('div', { class: 'hint' }, getStyle(ev.style)?.description ?? ''));
  } else if (s.track === 'fx') {
    kids.push(row('FX', select(listFx().map((x) => [x.id, x.name]), ev.fx, (v) => app.mutate(() => (ev.fx = v)))));
    kids.push(row('長押し (秒)', num(+ev.hold.toFixed(3), 0.01, (v) => app.mutate(() => (ev.hold = Math.max(0, v))))));
  } else {
    const kinds = s.track === 'chara' ? CHARA_KINDS : s.track === 'lfx' || s.track === 'tfx' ? ELEM_KINDS : s.track === 'cam' ? CAM_KINDS : s.track === 'viz' ? VIZ_KINDS : LOOK_KINDS;
    kids.push(row('種類', select(kinds, ev.kind, (v) => app.mutate(() => {
      ev.kind = v;
      ev.value = valueOptions(app, s.track, v)[0]?.[0] ?? 'auto';
    }))));
    const elem = ELEM_OF[s.track];
    if (elem && ev.kind === 'effect') {
      // several at once (ids of plugins that are not loaded are kept)
      const cur = ev.value === 'auto' ? [] : parseEffects(ev.value);
      if (elem === 'chara') kids.push(check(ev.value === 'auto', 'オート（ルックの設定に従う）', (v) => app.mutate(() => (ev.value = v ? 'auto' : ''))));
      if (ev.value !== 'auto')
        kids.push(h('div', { class: 'btns' }, ...allEffects(elem).map((ef) => check(cur.includes(ef.id), ef.name, (v) => app.mutate(() => {
          const next = v ? [...cur, ef.id] : cur.filter((x) => x !== ef.id);
          ev.value = next.join(',');
        })))));
    } else {
      kids.push(row('値', select(valueOptions(app, s.track, ev.kind), ev.value, (v) => app.mutate(() => (ev.value = v)))));
    }
    if (s.track === 'cam' && ev.kind === 'frame') kids.push(check(!!ev.smooth, 'スムーズに移動（オフ = カット）', (v) => app.mutate(() => (ev.smooth = v))));
    if (s.track === 'look' && ev.kind === 'style') {
      const st = getStyle(ev.value);
      const def = st?.transition ? getFx(st.transition)?.name ?? st.transition : 'なし';
      const opts: [string, string][] = [['', `スタイルの既定（${def}）`], ['none', 'なし（None）'], ...listFx().filter((f) => f.hidden).map((f) => [f.id, f.name] as [string, string])];
      kids.push(row('トランジション', select(opts, ev.transition ?? '', (v) => app.mutate(() => {
        if (v) ev.transition = v;
        else delete ev.transition;
      }))));
    }
  }
  kids.push(h('div', { class: 'btns' }, del));
  root.replaceChildren(...kids);
}
