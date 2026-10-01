// Persistence: project JSON in localStorage, media blobs in IndexedDB.
import type { Project } from './types';

const LS_KEY = 'minamo:project';
const DB_NAME = 'minamo';
const STORE = 'media';
// storage of the app's former name (MV Otoge Creator): read as a fallback, so saved work carries over
const LEGACY_LS_KEY = 'mv-otoge-creator:project';
const LEGACY_DB_NAME = 'mv-otoge-creator';

/** localStorage value of `key`, else of `legacy` (moved over to `key`). */
export function lsGetMigrated(key: string, legacy: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v != null) return v;
    const old = localStorage.getItem(legacy);
    if (old != null) {
      localStorage.setItem(key, old);
      localStorage.removeItem(legacy);
    }
    return old;
  } catch {
    return null;
  }
}

export function saveProjectLocal(p: Project) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* storage full or unavailable */
  }
}

export function loadProjectLocal(): any | null {
  try {
    const s = lsGetMigrated(LS_KEY, LEGACY_LS_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= openDb(DB_NAME));
/** The former name's media database, only if it exists (its media are copied over when first read). */
let legacyp: Promise<IDBDatabase | null> | null = null;
const legacyDb = () =>
  (legacyp ??= (async () => {
    try {
      const all = await indexedDB.databases();
      return all.some((d) => d.name === LEGACY_DB_NAME) ? await openDb(LEGACY_DB_NAME) : null;
    } catch {
      return null;
    }
  })());

function readBlob(d: IDBDatabase, id: string): Promise<Blob | null> {
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(id);
    r.onsuccess = () => res((r.result as Blob) ?? null);
    r.onerror = () => rej(r.error);
  });
}

// Media also kept in memory for the session: some browsers cannot store blobs in IndexedDB (private browsing,
// in-app browsers, a full disk), and the project still has to work until the page is closed.
const memory = new Map<string, Blob>();

export async function putMedia(id: string, blob: Blob): Promise<void> {
  memory.set(id, blob);
  try {
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    console.warn('putMedia failed', e);
  }
}

export async function getMedia(id: string): Promise<Blob | null> {
  const m = memory.get(id);
  if (m) return m;
  try {
    const b = await readBlob(await db(), id);
    if (b) return b;
    const old = await legacyDb();
    const ob = old ? await readBlob(old, id) : null;
    if (ob) await putMedia(id, ob);
    return ob;
  } catch {
    return null;
  }
}

export async function deleteMedia(id: string): Promise<void> {
  memory.delete(id);
  try {
    const d = await db();
    await new Promise<void>((res) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch {
    /* ignore */
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
