// Performance key maps per recording mode (MTR track). Used by both the keyboard handler and the key panel.

import type { App, EventTrack } from './app';
import type { CharacterRef, TrackId } from './core/types';
import { assignKeys, listPalettes, fxKeyMap, getFx, getVisualizer, listFx, listStylesFor, listVisualizers, styleKeyMap, type ElemTarget, type MotionStyle, type StyleRole } from './engine/api';
import { stateAt } from './engine/channels';
import { segmentAt } from './engine/compile';
import {
  allEffects, allFrames, allMotions, allMoves, cameraOf, EFFECT_AUTO_KEY, EFFECT_NONE_KEY, FRAME_AUTO_KEY, MOTION_AUTO_KEY, MOVE_AUTO_KEY,
  POS_AUTO_KEY, POSITIONS,
} from './engine/director';

export type Mode = TrackId;

export const MODES: { id: Mode; name: string; en: string; color: string; hint: string }[] = [
  { id: 'lyrics', name: '歌詞', en: 'LYRICS', color: '#08d9d6', hint: 'Space=1文字 / N=チャンク / Enter=1行 / 数字=歌詞スタイル / Q行=エフェクト / A行=モーション / ↑↓=入力位置（Shift で1文字）' },
  { id: 'telop', name: 'テロップ', en: 'TELOP', color: '#ffe600', hint: 'Space=次のテロップ（長押しで長さ指定、短押しは型の既定の長さ） / X=表示中のテロップを消す / Q行=エフェクト / A行=モーション / ↑↓=次に出すテロップ' },
  { id: 'chara', name: '立ち絵', en: 'CHARA', color: '#ffd36e', hint: '数字=キャラ / A行=位置 / Q行=エフェクト / Z行=モーション（未録音は固定。オートで自動演出）' },
  { id: 'camera', name: 'カメラ', en: 'CAMERA', color: '#7cf6ff', hint: 'A行=フレーミング（Shift=スムーズ） / Q行=カメラの動き（未録音は固定。オートで自動演出）' },
  { id: 'fx', name: 'FX', en: 'FX', color: '#ff2e63', hint: '各キー=FX（⏵は長押しで持続）' },
  { id: 'viz', name: 'ビジュアル', en: 'VISUAL', color: '#9dff6b', hint: '数字=種類（0=消す） / Q行=位置 / A行=色 / Z X C=大きさ / V B=キャラの後ろ・前' },
  { id: 'look', name: 'ルック', en: 'LOOK', color: '#b58bff', hint: '数字=ルックスタイル（Shift+数字=トランジションなし） / Q行=背景 / A行=パレット / Z行=明るさ' },
];

export const modeInfo = (m: Mode) => MODES.find((x) => x.id === m)!;

/** Display name of a character entry. MMD entries are named by their pose / motion (`full` adds the model). */
export function charLabel(c: CharacterRef, full = false): string {
  if (c.kind !== 'mmd') return c.name.replace(/\.[^.]+$/, '');
  const pose = c.mmdPose?.name ?? '基本姿勢';
  return full ? c.name : pose;
}

export interface PerfKey {
  /** codeKey name ('a', '1', ' ', 'Enter', '[' ...) */
  key: string;
  label: string;
  group: string;
  color: string;
  wide?: boolean;
  holdable?: boolean;
  /** Only works while recording (lyric taps). */
  recOnly?: boolean;
  /** Event list the key writes (a selected event is rewritten only by keys of its own list). */
  track?: EventTrack;
  /** Lit when this key's value is active at the playhead. */
  active?: (t: number) => boolean;
  run: (t: number, opts: { shift: boolean; key: string }) => void;
}

export const VIZ_POSITIONS = [
  { id: 'bottom', name: '下', key: 'q' },
  { id: 'center', name: '中央', key: 'w' },
  { id: 'top', name: '上', key: 'e' },
  { id: 'around', name: 'キャラの周り', key: 'r' },
  { id: 'full', name: '全面', key: 't' },
];
export const VIZ_COLORS = [
  { id: 'accent', name: 'アクセント', key: 'a' },
  { id: 'accent2', name: 'サブ', key: 's' },
  { id: 'text', name: '文字色', key: 'd' },
  { id: 'grad', name: 'グラデーション', key: 'f' },
  { id: 'rainbow', name: 'レインボー', key: 'g' },
];
export const VIZ_SIZES = [
  { id: 's', name: '小', key: 'z' },
  { id: 'm', name: '中', key: 'x' },
  { id: 'l', name: '大', key: 'c' },
];
export const VIZ_LAYERS = [
  { id: 'back', name: 'キャラの後ろ', key: 'v' },
  { id: 'front', name: 'キャラの前', key: 'b' },
];

export const keyLabel = (k: string) => (k === ' ' ? 'Space' : k === 'Backspace' ? 'BS' : k === 'Enter' ? 'Enter' : k === '' ? '·' : k.toUpperCase());

const DIM_PRESETS: { key: string; name: string; value: string }[] = [
  { key: 'z', name: '明るい', value: '0' },
  { key: 'x', name: '標準', value: '0.25' },
  { key: 'c', name: '暗め', value: '0.5' },
  { key: 'v', name: '真っ暗', value: '0.85' },
];
const BG_KEYS = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
// palettes in registration order (l = auto, b / z..v = brightness)
const PAL_KEYS = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'n', 'm'];
const VIZ_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Styles usable in a role with their number key ('' past the tenth: click it in the key panel / menu). */
function stylesWithKeys(role: StyleRole): [string, MotionStyle][] {
  const byId = new Map([...styleKeyMap(role)].map(([k, id]) => [id, k]));
  return listStylesFor(role).map((s) => [byId.get(s.id) ?? '', s]);
}

const EFFECT_GROUP = 'EFFECT（トグル）';
const MOTION_GROUP = 'MOTION';

/**
 * Effect (toggle) and motion keys of an element track — the same layout for the lyrics, the telops and the characters
 * (built-in effects Q–T, none Y; plugin effects I O P [ ]; motions on the Z row for characters, the A row for
 * lyrics / telops). `auto` adds the characters' オート keys.
 */
function elemKeys(app: App, out: PerfKey[], target: ElemTarget, auto: boolean) {
  const track: EventTrack = target === 'lyrics' ? 'lfx' : target === 'telop' ? 'tfx' : 'chara';
  const put = (kind: 'effect' | 'motion', value: string, t: number) => app.putEvent(track, { kind, value }, t);
  for (const ef of allEffects(target)) {
    out.push({
      key: ef.key, label: ef.name, group: EFFECT_GROUP, color: '#ff8fb8', track,
      active: (t) => app.effectsAt(target, t).includes(ef.id),
      run: (t) => {
        const cur = app.effectsAt(target, t);
        put('effect', (cur.includes(ef.id) ? cur.filter((x) => x !== ef.id) : [...cur, ef.id]).join(','), t);
      },
    });
  }
  out.push({ key: EFFECT_NONE_KEY, label: 'なし', group: EFFECT_GROUP, color: '#888', track, active: (t) => app.effectsAt(target, t).length === 0, run: (t) => put('effect', '', t) });
  if (auto) {
    out.push({
      key: EFFECT_AUTO_KEY, label: 'オート', group: EFFECT_GROUP, color: '#666', track,
      active: (t) => (stateAt(app.compiled.stage.effect, t)?.v ?? 'auto') === 'auto',
      run: (t) => put('effect', 'auto', t),
    });
  }
  for (const m of allMotions(target)) {
    out.push({ key: m.key, label: m.name, group: MOTION_GROUP, color: '#9dff6b', track, active: (t) => app.motionAt(target, t) === m.id, run: (t) => put('motion', m.id, t) });
  }
  if (auto) out.push({ key: MOTION_AUTO_KEY, label: 'オート', group: MOTION_GROUP, color: '#666', track, active: (t) => app.motionAt(target, t) === 'auto', run: (t) => put('motion', 'auto', t) });
}

// Entries with key '' have no keyboard key; they still show in the key panel and the double-click menu.
export function perfKeys(app: App, mode: Mode): PerfKey[] {
  const C = () => app.compiled;
  const out: PerfKey[] = [];
  switch (mode) {
    case 'lyrics': {
      const tap = (label: string, key: string, unit: 'glyph' | 'chunk' | 'line', wide = false) =>
        out.push({ key, label, group: 'TAP', color: '#08d9d6', wide, recOnly: true, run: (t) => app.recTap(t, unit) });
      tap('1文字ずつ', ' ', 'glyph', true);
      tap('単語ごと', 'n', 'chunk');
      tap('1行ずつ', 'Enter', 'line');
      out.push({ key: 'x', label: '歌詞を消す', group: 'TAP', color: '#888', recOnly: true, run: (t) => app.recClear(t) });
      for (const [k, st] of stylesWithKeys('lyric')) {
        const id = st.id;
        out.push({
          key: k, label: st.name, group: 'LYRIC STYLE', color: st.color, track: 'lstyle',
          active: (t) => segmentAt(C().lyricSegs, t).styleId === id,
          run: (t) => app.putEvent('lstyle', { style: id }, t),
        });
      }
      elemKeys(app, out, 'lyrics', false);
      break;
    }
    case 'telop': {
      out.push({ key: ' ', label: '次のテロップ（長押し=長さ）', group: 'TELOP', color: '#ffe600', wide: true, recOnly: true, run: (t, o) => app.recTelop(t, o.key) });
      out.push({ key: 'x', label: '表示中を消す', group: 'TELOP', color: '#888', recOnly: true, run: (t) => app.recTelopClear(t) });
      elemKeys(app, out, 'telop', false);
      break;
    }
    case 'chara': {
      const ch = (kind: string, value: string, t: number) => app.putEvent('chara', { kind, value }, t);
      app.project.characters.slice(0, 9).forEach((c, i) => {
        out.push({
          key: String(i + 1), label: charLabel(c) + (c.enabled ? '' : '（未使用）'), group: 'CHARACTER', color: c.kind === 'mmd' ? '#ff9ecb' : '#ffd36e', track: 'chara',
          active: (t) => stateAt(C().stage.char, t)?.v === c.id,
          run: (t) => ch('char', c.id, t),
        });
      });
      out.push({ key: '0', label: '隠す', group: 'CHARACTER', color: '#888', track: 'chara', active: (t) => (stateAt(C().stage.char, t)?.v ?? null) === null, run: (t) => ch('char', 'none', t) });
      out.push({ key: '-', label: 'オート', group: 'CHARACTER', color: '#666', track: 'chara', active: (t) => !stateAt(C().stage.char, t)?.rec, run: (t) => ch('char', 'auto', t) });
      for (const p of POSITIONS) {
        out.push({ key: p.key, label: p.name, group: 'POSITION', color: '#7cf6ff', track: 'chara', active: (t) => stateAt(C().stage.pos, t)?.v === p.id, run: (t) => ch('pos', p.id, t) });
      }
      out.push({ key: POS_AUTO_KEY, label: 'オート', group: 'POSITION', color: '#666', track: 'chara', active: (t) => !stateAt(C().stage.pos, t)?.rec, run: (t) => ch('pos', 'auto', t) });
      elemKeys(app, out, 'chara', true);
      break;
    }
    case 'camera': {
      for (const f of allFrames()) {
        out.push({
          key: f.key, label: f.name, group: 'FRAMING（Shift=スムーズ）', color: '#7cf6ff', track: 'cam',
          active: (t) => stateAt(C().stage.frame, t)?.v === f.id,
          run: (t, o) => app.putEvent('cam', { kind: 'frame', value: f.id, smooth: o.shift }, t),
        });
      }
      out.push({ key: FRAME_AUTO_KEY, label: 'オート', group: 'FRAMING（Shift=スムーズ）', color: '#666', track: 'cam', active: (t) => !stateAt(C().stage.frame, t)?.rec, run: (t, o) => app.putEvent('cam', { kind: 'frame', value: 'auto', smooth: o.shift }, t) });
      for (const m of allMoves()) {
        out.push({ key: m.key, label: m.name, group: 'MOVE', color: '#b7a0ff', track: 'cam', active: (t) => stateAt(C().stage.move, t)?.v === m.id, run: (t) => app.putEvent('cam', { kind: 'move', value: m.id }, t) });
      }
      out.push({ key: MOVE_AUTO_KEY, label: 'オート', group: 'MOVE', color: '#666', track: 'cam', active: (t) => !stateAt(C().stage.move, t)?.rec, run: (t) => app.putEvent('cam', { kind: 'move', value: 'auto' }, t) });
      break;
    }
    case 'fx': {
      // FX on keys first; the ones past the free keys are keyless (key panel click / double-click menu)
      const keyed = fxKeyMap();
      const onKey = new Set(keyed.values());
      const entries: [string, string][] = [...keyed, ...listFx().filter((f) => !f.hidden && !onKey.has(f.id)).map((f): [string, string] => ['', f.id])];
      for (const [k, id] of entries) {
        const f = getFx(id)!;
        out.push({ key: k, label: f.name, group: 'FX', color: f.color, holdable: !!f.holdable, track: 'fx', run: (t, o) => app.putFx(id, t, o.key) });
      }
      break;
    }
    case 'viz': {
      const V = () => C().viz;
      const vz = (kind: string, value: string, t: number) => app.putEvent('viz', { kind, value }, t);
      const vizKeys = assignKeys(listVisualizers(), VIZ_KEYS);
      listVisualizers().forEach((v) => {
        out.push({ key: vizKeys.get(v.id) ?? '', label: v.name, group: 'TYPE', color: v.color, track: 'viz', active: (t) => stateAt(V().type, t)?.v === v.id, run: (t) => vz('type', v.id, t) });
      });
      out.push({ key: '0', label: '消す', group: 'TYPE', color: '#888', track: 'viz', active: (t) => (stateAt(V().type, t)?.v ?? 'none') === 'none', run: (t) => vz('type', 'none', t) });
      for (const p of VIZ_POSITIONS) out.push({ key: p.key, label: p.name, group: 'POSITION', color: '#7cf6ff', track: 'viz', active: (t) => stateAt(V().pos, t)?.v === p.id, run: (t) => vz('pos', p.id, t) });
      for (const c of VIZ_COLORS) out.push({ key: c.key, label: c.name, group: 'COLOR', color: '#ffb3c7', track: 'viz', active: (t) => stateAt(V().color, t)?.v === c.id, run: (t) => vz('color', c.id, t) });
      for (const s of VIZ_SIZES) out.push({ key: s.key, label: s.name, group: 'SIZE / LAYER', color: '#dddddd', track: 'viz', active: (t) => stateAt(V().size, t)?.v === s.id, run: (t) => vz('size', s.id, t) });
      for (const l of VIZ_LAYERS) out.push({ key: l.key, label: l.name, group: 'SIZE / LAYER', color: '#b7a0ff', track: 'viz', active: (t) => stateAt(V().layer, t)?.v === l.id, run: (t) => vz('layer', l.id, t) });
      break;
    }
    case 'look': {
      const lk = (kind: string, value: string, t: number) => app.putEvent('look', { kind, value }, t);
      for (const [k, st] of stylesWithKeys('look')) {
        const id = st.id;
        out.push({
          key: k, label: st.name, group: 'LOOK STYLE（Shift=トランジションなし）', color: st.color, track: 'look',
          active: (t) => segmentAt(C().lookSegs, t).styleId === id,
          run: (t, o) => app.putEvent('look', { kind: 'style', value: id, ...(o.shift ? { transition: 'none' } : {}) }, t),
        });
      }
      app.project.backgrounds.slice(0, BG_KEYS.length).forEach((b, i) => {
        out.push({
          key: BG_KEYS[i], label: `背景${i + 1} ${b.name.replace(/\.[^.]+$/, '')}`, group: 'BACKGROUND', color: '#6bdcff', track: 'look',
          active: (t) => app.bgIndexAt(t) === i,
          run: (t) => lk('bg', String(i), t),
        });
      });
      out.push({ key: '[', label: '背景なし', group: 'BACKGROUND', color: '#888', track: 'look', active: (t) => app.bgIndexAt(t) === -1, run: (t) => lk('bg', 'none', t) });
      out.push({ key: ']', label: 'オート', group: 'BACKGROUND', color: '#666', track: 'look', active: (t) => (stateAt(C().look.bg, t)?.v ?? 'auto') === 'auto', run: (t) => lk('bg', 'auto', t) });
      const palKeys = assignKeys(listPalettes(), PAL_KEYS);
      listPalettes().forEach((p) => {
        out.push({ key: palKeys.get(p.id) ?? '', label: p.name, group: 'PALETTE', color: p.accent, track: 'look', active: (t) => stateAt(C().look.palette, t)?.v === p.id, run: (t) => lk('palette', p.id, t) });
      });
      out.push({ key: 'l', label: 'オート', group: 'PALETTE', color: '#666', track: 'look', active: (t) => (stateAt(C().look.palette, t)?.v ?? 'auto') === 'auto', run: (t) => lk('palette', 'auto', t) });
      for (const d of DIM_PRESETS) {
        out.push({ key: d.key, label: d.name, group: 'BRIGHTNESS', color: '#dddddd', track: 'look', active: (t) => stateAt(C().look.dim, t)?.v === d.value, run: (t) => lk('dim', d.value, t) });
      }
      out.push({ key: 'b', label: 'オート', group: 'BRIGHTNESS', color: '#666', track: 'look', active: (t) => (stateAt(C().look.dim, t)?.v ?? 'auto') === 'auto', run: (t) => lk('dim', 'auto', t) });
      break;
    }
  }
  return out;
}

/** Human-readable current state of a track (prompter). */
export function trackStateText(app: App, mode: Mode, t: number): string {
  const C = app.compiled;
  if (!C) return '';
  const name = <T extends string>(list: { id: T; name: string }[], id: string | undefined) => list.find((x) => x.id === id)?.name ?? id ?? '—';
  const auto = (rec: boolean | undefined) => (rec ? '' : '（オート）');
  const effectsText = (target: ElemTarget) => app.effectsAt(target, t).map((e) => name(allEffects(target), e)).join('+') || 'なし';
  switch (mode) {
    case 'chara': {
      const cs = stateAt(C.stage.char, t), ps = stateAt(C.stage.pos, t), mo = app.motionAt('chara', t);
      const ch = app.project.characters.find((c) => c.id === cs?.v);
      const moName = mo === 'auto' ? `オート(${cameraOf(segmentAt(C.lookSegs, t).style).bounce > 0 ? 'バウンス' : '静止'})` : name(allMotions('chara'), mo);
      return `キャラ ${ch ? charLabel(ch, true) : 'なし'}${auto(cs?.rec)}  ·  位置 ${name(POSITIONS, ps?.v)}${auto(ps?.rec)}  ·  エフェクト ${effectsText('chara')}  ·  モーション ${moName}`;
    }
    case 'camera': {
      const fs = stateAt(C.stage.frame, t), ms = stateAt(C.stage.move, t);
      return `フレーミング ${name(allFrames(), fs?.v)}${auto(fs?.rec)}  ·  ムーブ ${name(allMoves(), ms?.v)}${auto(ms?.rec)}`;
    }
    case 'look': {
      const seg = segmentAt(C.lookSegs, t);
      const pal = stateAt(C.look.palette, t)?.v ?? 'auto';
      const bg = app.bgIndexAt(t);
      const dim = stateAt(C.look.dim, t)?.v ?? 'auto';
      return `スタイル ${seg.style.name}  ·  背景 ${bg < 0 ? 'なし' : bg + 1}  ·  パレット ${pal === 'auto' ? 'オート' : listPalettes().find((p) => p.id === pal)?.name ?? pal}  ·  明るさ ${dim === 'auto' ? 'オート' : `${Math.round((1 - parseFloat(dim)) * 100)}%`}`;
    }
    case 'telop': {
      const showing = C.telops.filter((x) => x.start <= t && t < x.start + x.dur).map((x) => `[${x.def.name}] ${x.text}`);
      const efs = app.effectsAt('telop', t), mo = app.motionAt('telop', t);
      const fx = efs.length || mo !== 'idle' ? `  ·  エフェクト ${effectsText('telop')}  ·  モーション ${name(allMotions('telop'), mo)}` : '';
      return (showing.length ? `表示中: ${showing.join(' / ')}` : 'テロップなし') + fx;
    }
    case 'viz': {
      const ty = stateAt(C.viz.type, t)?.v ?? 'none';
      if (ty === 'none') return 'ビジュアライザーなし（数字キーで種類を選ぶ）';
      const nm = (list: { id: string; name: string }[], id: string | undefined) => list.find((x) => x.id === id)?.name ?? '—';
      return `${getVisualizer(ty)?.name ?? ty}  ·  位置 ${nm(VIZ_POSITIONS, stateAt(C.viz.pos, t)?.v)}  ·  色 ${nm(VIZ_COLORS, stateAt(C.viz.color, t)?.v)}  ·  大きさ ${nm(VIZ_SIZES, stateAt(C.viz.size, t)?.v)}  ·  ${nm(VIZ_LAYERS, stateAt(C.viz.layer, t)?.v)}`;
    }
    case 'fx': {
      const act = C.fx.filter((f) => !f.def.hidden && t >= f.start && t < f.start + f.dur).map((f) => f.def.name);
      return act.length ? `発動中: ${act.join(' / ')}` : 'FX キーでエフェクトを叩き込む';
    }
    default:
      return '';
  }
}
