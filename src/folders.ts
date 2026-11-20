// The two folders the player picks: the game install (MidgardSurvivors.pck) and the save folder
// (~/.local/share/godot/app_userdata/Midgard Survivors). Nothing is uploaded: files are read in the browser.

export interface Folder {
  label: string;
  /** true when the folder can be re-read later (File System Access API), so live updates work */
  live: boolean;
  file(path: string): Promise<File | null>;
  /** names of the files directly inside `dir` ('' = the folder itself) */
  list(dir?: string): Promise<string[]>;
}

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>;
};

export const canPickFolders = typeof (globalThis as any).showDirectoryPicker === 'function';

function handleFolder(root: DirHandle): Folder {
  async function dir(path: string): Promise<DirHandle | null> {
    let d: DirHandle = root;
    for (const part of path.split('/').filter(Boolean)) {
      try { d = (await d.getDirectoryHandle(part)) as DirHandle; } catch { return null; }
    }
    return d;
  }
  return {
    label: root.name, live: true,
    async file(path) {
      const parts = path.split('/');
      const d = await dir(parts.slice(0, -1).join('/'));
      if (!d) return null;
      try { return await (await d.getFileHandle(parts[parts.length - 1])).getFile(); } catch { return null; }
    },
    async list(path = '') {
      const d = await dir(path);
      const out: string[] = [];
      if (d) for await (const h of d.values()) if (h.kind === 'file') out.push(h.name);
      return out;
    },
  };
}

/** A folder chosen with <input webkitdirectory>: a snapshot of its files. */
export function listFolder(files: FileList): Folder {
  const byPath = new Map<string, File>();
  let label = '';
  for (const f of Array.from(files)) {
    const rel = (f as any).webkitRelativePath as string || f.name;
    const parts = rel.split('/');
    label = parts[0];
    byPath.set(parts.slice(1).join('/'), f);
  }
  return {
    label, live: false,
    async file(path) { return byPath.get(path) ?? null; },
    async list(dir = '') {
      const pre = dir ? dir.replace(/\/$/, '') + '/' : '';
      return [...byPath.keys()].filter(p => p.startsWith(pre) && !p.slice(pre.length).includes('/')).map(p => p.slice(pre.length));
    },
  };
}

/** Dev only (`npm run dev` with MIDGARD_GAME / MIDGARD_SAVE): a folder served by the Vite dev server, read lazily. */
export function devFolder(key: 'game' | 'save'): Folder {
  const base = `/__folders/${key}`;
  return {
    label: key + ' (dev server)', live: true,
    async file(path) {
      const url = `${base}/file/${path.split('/').map(encodeURIComponent).join('/')}`;
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) return null;
      const size = Number(head.headers.get('Content-Length')), lastModified = Number(head.headers.get('X-Mtime'));
      const part = (a: number, b: number) => ({
        arrayBuffer: async () => (await fetch(url, { headers: { Range: `bytes=${a}-${b - 1}` } })).arrayBuffer(),
        text: async () => new TextDecoder().decode(await (await fetch(url, { headers: { Range: `bytes=${a}-${b - 1}` } })).arrayBuffer()),
      });
      const whole = part(0, size);
      return { name: path.split('/').pop()!, size, lastModified, slice: (a = 0, b = size) => part(a, Math.min(b, size)), ...whole } as unknown as File;
    },
    async list(dir = '') {
      const r = await fetch(`${base}/list?dir=${encodeURIComponent(dir)}`);
      return r.ok ? r.json() : [];
    },
  };
}

// ---- remembering picked folders between visits (IndexedDB can store directory handles)

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open('midgard-build', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((ok, fail) => {
    const r = d.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => ok(r.result as T);
    r.onerror = () => fail(r.error);
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  return new Promise((ok, fail) => {
    const t = d.transaction('kv', 'readwrite');
    t.objectStore('kv').put(value, key);
    t.oncomplete = () => ok();
    t.onerror = () => fail(t.error);
  });
}

export async function pickFolder(key: 'game' | 'save'): Promise<Folder> {
  const h = (await (window as any).showDirectoryPicker({ id: 'midgard-' + key, mode: 'read' })) as DirHandle;
  await kvSet('handle-' + key, h);
  return handleFolder(h);
}

/** Folders picked on an earlier visit. `ask` may only be true inside a click (the browser asks again for access). */
export async function rememberedFolder(key: 'game' | 'save', ask: boolean): Promise<Folder | 'denied' | null> {
  if (!canPickFolders) return null;
  const h = await kvGet<DirHandle>('handle-' + key);
  if (!h) return null;
  let state = await h.queryPermission({ mode: 'read' });
  if (state !== 'granted' && ask) state = await h.requestPermission({ mode: 'read' });
  return state === 'granted' ? handleFolder(h) : 'denied';
}
