// Runtime plugin loading. A plugin is an ES module (.js):
//
//   export default function (api) {
//     api.registerStyle({ id: 'my-style', name: 'MY STYLE', color: '#0ff', line(g, l) { ... } });
//     api.registerFx({ id: 'my-fx', name: 'MY FX', color: '#f0f', duration: 0.5, apply(s) { ... } });
//     api.registerVisualizer({ id: 'my-viz', name: 'MY VIZ', color: '#0f0', draw(g, v) { ... g.audio.spectrum ... } });
//     api.registerFraming({ id: 'my-frame', name: 'MY FRAME', pose(c) { return { sy: 1.4, fy: 0.3, zoom: 1.2, rot: 0 }; } });
//     api.registerCameraMove({ id: 'my-move', name: 'MY MOVE', apply(pose, c) { pose.rot += 0.05 * Math.sin(c.t); } });
//     api.registerPalette({ id: 'my-pal', name: 'MY PALETTE', bg: '#101018', text: '#ffffff', accent: '#ff3d7f', accent2: '#3dd6ff' });
//     api.registerEffect({ id: 'my-effect', name: 'MY EFFECT', under(g, e) { e.draw(e.silhouette(g.pal.accent)); } });
//     api.registerMotion({ id: 'my-motion', name: 'MY MOTION', offsets: (c) => ({ dy: -10 * c.u * c.beat.pulse }) });
//   }
//
// A style is both a lyric style and a look unless it sets use: 'lyric' (line / lyricFx only) or use: 'look'.
// Effects / motions work on the lyrics, the telops and the characters unless they set targets: [...].
//
// Loaded plugin sources are kept in localStorage and re-loaded on startup.

import {
  DEFAULT_CAMERA, DEFAULT_POST, listCameraMoves, listEffects, listFramings, listFx, listLookStyles, listLyricStyles, listMotions, listPalettes,
  listStyles, listTelops, listVisualizers,
  registerCameraMove, registerEffect, registerFraming, registerFx, registerMotion, registerPalette, registerStyle, registerTelop, registerVisualizer,
} from './engine/api';
import * as lib from './engine/lib';
import { lsGetMigrated } from './core/storage';
import * as helpers from './engine/helpers';

export const pluginApi = {
  version: 1,
  registerStyle,
  registerFx,
  registerVisualizer,
  registerTelop,
  registerFraming,
  registerCameraMove,
  registerPalette,
  registerEffect,
  registerMotion,
  listStyles,
  listLyricStyles,
  listLookStyles,
  listFramings,
  listCameraMoves,
  listPalettes,
  listTelops,
  listFx,
  listVisualizers,
  listEffects,
  listMotions,
  lib,
  /** Layout helpers used by the built-in styles: makeRows, lineGlyphs, rowText, exitK, hitPulse, latestLine. */
  helpers,
  DEFAULT_POST,
  DEFAULT_CAMERA,
};

/** What a plugin's default export receives (the built-in plugins in src/plugins/ are typed with it). */
export type PluginApi = typeof pluginApi;

const LS_KEY = 'minamo:plugins';
const LEGACY_LS_KEY = 'mv-otoge-creator:plugins'; // the app's former name

export interface StoredPlugin {
  name: string;
  code: string;
}

export function installGlobalApi() {
  (window as unknown as { MinaMo: typeof pluginApi }).MinaMo = pluginApi;
}

export function storedPlugins(): StoredPlugin[] {
  try {
    return JSON.parse(lsGetMigrated(LS_KEY, LEGACY_LS_KEY) || '[]');
  } catch {
    return [];
  }
}

function savePlugins(list: StoredPlugin[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export async function runPlugin(code: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    const fn = mod.default ?? mod.setup;
    if (typeof fn === 'function') await fn(pluginApi);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function addPlugin(name: string, code: string): Promise<void> {
  await runPlugin(code);
  const list = storedPlugins().filter((p) => p.name !== name);
  list.push({ name, code });
  savePlugins(list);
}

export function removePlugin(name: string) {
  savePlugins(storedPlugins().filter((p) => p.name !== name));
}

export async function loadStoredPlugins(): Promise<string[]> {
  const errors: string[] = [];
  for (const p of storedPlugins()) {
    try {
      await runPlugin(p.code);
    } catch (e) {
      errors.push(`${p.name}: ${(e as Error).message}`);
    }
  }
  return errors;
}
