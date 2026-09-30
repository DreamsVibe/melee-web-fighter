// The extension's file store, in the extension's own origin (the importer page, settings page and
// the bridge iframe all share it). Imported data lives under characters/ and common/, the user's
// changes under overrides/.
//
// Hundreds of small IndexedDB records read slowly (seconds on Windows), so everything outside
// overrides/ is kept as ONE packed record; overrides and meta stay individual records. The API below
// hides that: callers see plain paths.

export type FileData = string | Uint8Array;
export interface StoredFile { path: string; data: FileData; mtime: number }

const DB_NAME = 'melee-web-fighter';
const STORE = 'files';
const PACK = 'pack:imported';

/** Bump when the imported folder layout or any binary format changes: forces a re-import. */
export const FORMAT_VERSION = 5;
export const META_PATH = 'meta.json';

const isPacked = (path: string) => path.startsWith('characters/') || path.startsWith('common/');

interface Pack { path: string; files: Record<string, FileData>; mtime: number }

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

async function readPack(): Promise<Pack> {
  const db = await open();
  return (await request<Pack | undefined>(db.transaction(STORE).objectStore(STORE).get(PACK))) ?? { path: PACK, files: {}, mtime: 0 };
}

export async function putFiles(files: Array<{ path: string; data: FileData }>): Promise<void> {
  const packed = files.filter((f) => isPacked(f.path));
  const loose = files.filter((f) => !isPacked(f.path));
  const mtime = Date.now();
  const pack = packed.length ? await readPack() : null;
  if (pack) { for (const f of packed) pack.files[f.path] = f.data; pack.mtime = mtime; }
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  if (pack) store.put(pack);
  for (const f of loose) store.put({ path: f.path, data: f.data, mtime } satisfies StoredFile);
  await done(tx);
}

export async function getFile(path: string): Promise<StoredFile | undefined> {
  if (isPacked(path)) {
    const pack = await readPack();
    return path in pack.files ? { path, data: pack.files[path], mtime: pack.mtime } : undefined;
  }
  const db = await open();
  return request<StoredFile | undefined>(db.transaction(STORE).objectStore(STORE).get(path));
}

/** All files whose path starts with prefix (sorted by path). */
export async function listFiles(prefix = ''): Promise<StoredFile[]> {
  const db = await open();
  const loose = (await request<Array<StoredFile | Pack>>(db.transaction(STORE).objectStore(STORE).getAll()));
  const out: StoredFile[] = [];
  for (const rec of loose) {
    if (rec.path === PACK) {
      const p = rec as Pack;
      for (const [path, data] of Object.entries(p.files)) if (path.startsWith(prefix)) out.push({ path, data, mtime: p.mtime });
    } else if (rec.path.startsWith(prefix)) out.push(rec as StoredFile);
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function deleteFiles(paths: string[]): Promise<void> {
  const packed = paths.filter(isPacked);
  const pack = packed.length ? await readPack() : null;
  if (pack) for (const p of packed) delete pack.files[p];
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  if (pack) tx.objectStore(STORE).put(pack);
  for (const p of paths.filter((x) => !isPacked(x))) tx.objectStore(STORE).delete(p);
  await done(tx);
}

export async function deletePrefix(prefix: string): Promise<void> {
  const pack = await readPack();
  let changed = false;
  for (const p of Object.keys(pack.files)) if (p.startsWith(prefix)) { delete pack.files[p]; changed = true; }
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  if (changed) tx.objectStore(STORE).put(pack);
  const keys = await request<IDBValidKey[]>(tx.objectStore(STORE).getAllKeys());
  for (const k of keys) if (typeof k === 'string' && k !== PACK && k.startsWith(prefix)) tx.objectStore(STORE).delete(k);
  await done(tx);
}

/** Replaces the whole imported folder in one write (used by the importer). */
export async function replaceImported(files: Array<{ path: string; data: FileData }>, keepPrefixes: string[] = []): Promise<void> {
  const old = await readPack();
  const pack: Pack = { path: PACK, files: {}, mtime: Date.now() };
  for (const [p, d] of Object.entries(old.files)) if (keepPrefixes.some((k) => p.startsWith(k))) pack.files[p] = d;
  for (const f of files) if (isPacked(f.path)) pack.files[f.path] = f.data;
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(pack);
  // Older versions stored one record per file: drop those.
  for (const k of await request<IDBValidKey[]>(tx.objectStore(STORE).getAllKeys())) {
    if (typeof k === 'string' && k !== PACK && (isPacked(k) || k.startsWith('raw/'))) tx.objectStore(STORE).delete(k);
  }
  for (const f of files) if (!isPacked(f.path)) tx.objectStore(STORE).put({ path: f.path, data: f.data, mtime: pack.mtime });
  await done(tx);
}

export function asText(f: StoredFile | undefined): string | undefined {
  if (!f) return undefined;
  return typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data);
}

/** Tells other extension pages (and bridge iframes) that files changed. */
export function announceChange(paths: string[]): void {
  const ch = new BroadcastChannel('mwf-files');
  ch.postMessage({ paths });
  ch.close();
}
