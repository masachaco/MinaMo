type Child = Node | string | number | null | undefined | false;

/** Tiny hyperscript helper. on* attrs become listeners; class/style/html handled specially. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, any> | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'string') el.setAttribute('style', v);
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== 'list') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

let toastTimer = 0;
export function toast(msg: string, ms = 1800) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', accept, multiple });
    inp.addEventListener('change', () => res(Array.from(inp.files ?? [])));
    inp.click();
  });
}

/** A file with its path relative to the picked / dropped folder (just the name for loose files). */
export interface PathFile {
  file: File;
  path: string;
}

/** Pick a whole folder (all files inside, with relative paths). */
export function pickFolder(): Promise<PathFile[]> {
  return new Promise((res) => {
    const inp = h('input', { type: 'file', multiple: true }) as HTMLInputElement;
    inp.webkitdirectory = true;
    inp.addEventListener('change', () => res(Array.from(inp.files ?? [], (f) => ({ file: f, path: f.webkitRelativePath || f.name }))));
    inp.click();
  });
}

/** Files of a drop, walking into dropped folders. */
export async function filesFromDrop(dt: DataTransfer): Promise<PathFile[]> {
  const entries = Array.from(dt.items ?? [], (it) => it.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return Array.from(dt.files, (f) => ({ file: f, path: f.name }));
  const out: PathFile[] = [];
  const walk = async (e: FileSystemEntry, dir: string): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push({ file: f, path: dir + f.name });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c, `${dir}${e.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

export interface MenuItem {
  label: string;
  key?: string;
  color?: string;
  pick: (e: MouseEvent) => void;
}

/** Popup menu at a screen position (grouped items); closes on pick, outside click or Esc. */
export function popupMenu(x: number, y: number, title: string, groups: { title: string; items: MenuItem[] }[]) {
  document.querySelector('.popup-menu')?.remove();
  const close = () => {
    el.remove();
    window.removeEventListener('mousedown', outside, true);
    window.removeEventListener('keydown', esc, true);
  };
  const outside = (e: MouseEvent) => !el.contains(e.target as Node) && close();
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const el = h('div', { class: 'popup-menu' },
    h('div', { class: 'pm-title' }, title),
    ...groups.filter((g) => g.items.length).map((g) => h('div', { class: 'pm-group' },
      h('div', { class: 'pm-head' }, g.title),
      h('div', { class: 'pm-items' }, ...g.items.map((it) => h('button', {
        class: 'pm-item', style: it.color ? `--c:${it.color}` : undefined,
        onclick: (e: MouseEvent) => {
          close();
          it.pick(e);
        },
      }, it.key ? h('kbd', null, it.key === ' ' ? 'Space' : it.key.toUpperCase()) : null, it.label))),
    )));
  document.body.appendChild(el);
  // keep inside the window
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - r.width - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y - r.height, window.innerHeight - r.height - 8))}px`;
  setTimeout(() => {
    window.addEventListener('mousedown', outside, true);
    window.addEventListener('keydown', esc, true);
  }, 0);
}

/** Small modal list: resolves with the chosen value, or null when cancelled. */
export function chooseOne(title: string, options: { value: string; label: string }[]): Promise<string | null> {
  return new Promise((res) => {
    const close = (v: string | null) => {
      wrap.remove();
      res(v);
    };
    const wrap = h('div', { class: 'modal' },
      h('div', { class: 'modal-card' },
        h('h2', null, title),
        h('div', { class: 'choose-list' }, ...options.map((o) => h('button', { onclick: () => close(o.value) }, o.label))),
        h('div', { class: 'modal-actions' }, h('button', { onclick: () => close(null) }, 'キャンセル')),
      ));
    wrap.addEventListener('click', (e) => e.target === wrap && close(null));
    document.body.appendChild(wrap);
  });
}

/** Map KeyboardEvent.code to a layout-independent key name (works with IME on). */
export function codeKey(e: KeyboardEvent): string {
  const c = e.code;
  if (c.startsWith('Key')) return c.slice(3).toLowerCase();
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad') && /\d$/.test(c)) return c.slice(-1);
  switch (c) {
    case 'Space': return ' ';
    case 'BracketLeft': return '[';
    case 'BracketRight': return ']';
    case 'Enter':
    case 'NumpadEnter': return 'Enter';
    default: return e.key;
  }
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'color'].includes((t as HTMLInputElement).type)) || t.isContentEditable;
}
