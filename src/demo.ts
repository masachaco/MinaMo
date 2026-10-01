// Demo project opened on the first visit (no saved project) and from Project → デモを開く.
// public/demo/demo.json lists a project file (as saved by 保存 (.json)) and the files of its media, keyed by the
// ids the project uses, so a re-saved project can be dropped in as is. ?demo=0 skips it (tests).

import { putMedia } from './core/storage';
import type { Project } from './core/types';

interface DemoManifest {
  /** Project JSON, relative to demo/. */
  project: string;
  /** Where the playhead starts when the demo opens (seconds; e.g. where the singing begins). */
  start?: number;
  audio?: { file: string };
  characters?: { id: string; file: string; name?: string }[];
  backgrounds?: { id: string; file: string; name?: string }[];
}

// relative to the bundle (assets/ in the build, src/ on the dev server), so pages in subfolders (mobile/) find it too;
// a variable, so Vite leaves the URL to the browser
const DEMO_DIR = '../demo/';
const base = () => new URL(DEMO_DIR, import.meta.url).href;

export const demoEnabled = () => new URLSearchParams(location.search).get('demo') !== '0';

async function get(file: string): Promise<Response> {
  const r = await fetch(base() + file);
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return r;
}

export interface DemoProject {
  /** Not yet normalized. */
  project: Project;
  /** Playhead position to open at (seconds). */
  start: number;
}

/**
 * Fetch the demo project and store its media in IndexedDB under the keys the project refers to.
 * Returns null when the build has no demo.
 */
export async function loadDemoProject(): Promise<DemoProject | null> {
  let m: DemoManifest;
  try {
    m = await (await get('demo.json')).json();
  } catch {
    return null;
  }
  const p = (await (await get(m.project)).json()) as Project;
  const store = async (file: string, key: string) => {
    const b = await (await get(file)).blob();
    await putMedia(key, b);
    return b;
  };
  const jobs: Promise<unknown>[] = [];
  const audio = m.audio;
  if (audio && p.audio) {
    const ref = p.audio;
    jobs.push(store(audio.file, ref.id).then((b) => {
      p.audio = { ...ref, name: audio.file.split('/').pop() ?? ref.name, mime: b.type || ref.mime };
    }));
  }
  for (const c of m.characters ?? []) {
    const ref = p.characters?.find((x) => x.id === c.id);
    if (!ref || ref.kind === 'mmd') continue;
    jobs.push(store(c.file, ref.media ?? ref.id).then((b) => (ref.mime = b.type || ref.mime)));
  }
  for (const g of m.backgrounds ?? []) {
    const ref = p.backgrounds?.find((x) => x.id === g.id);
    if (ref) jobs.push(store(g.file, ref.id).then((b) => (ref.mime = b.type || ref.mime)));
  }
  await Promise.all(jobs);
  return { project: p, start: Number.isFinite(m.start) ? Math.max(0, m.start!) : 0 };
}
