// The extension's file store: one IndexedDB object store of path → contents, in the extension's own
// origin (the importer page, settings page and the bridge iframe all share it). Imported data lives
// under characters/ and common/, the user's changes under overrides/.

export type FileData = string | Uint8Array;
export interface StoredFile { path: string; data: FileData; mtime: number }

const DB_NAME = 'melee-web-fighter';
const STORE = 'files';

/** Bump when the imported folder layout or any binary format changes: forces a re-import. */
export const FORMAT_VERSION = 1;
export const META_PATH = 'meta.json';

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

export async function putFiles(files: Array<{ path: string; data: FileData }>): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const mtime = Date.now();
  for (const f of files) store.put({ path: f.path, data: f.data, mtime } satisfies StoredFile);
  await done(tx);
}

export async function getFile(path: string): Promise<StoredFile | undefined> {
  const db = await open();
  const req = db.transaction(STORE).objectStore(STORE).get(path);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as StoredFile | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** All files whose path starts with prefix (in key order). */
export async function listFiles(prefix = ''): Promise<StoredFile[]> {
  const db = await open();
  const range = prefix ? IDBKeyRange.bound(prefix, prefix + '￿') : undefined;
  const req = db.transaction(STORE).objectStore(STORE).getAll(range);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as StoredFile[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFiles(paths: string[]): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  for (const p of paths) tx.objectStore(STORE).delete(p);
  await done(tx);
}

export async function deletePrefix(prefix: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(IDBKeyRange.bound(prefix, prefix + '￿'));
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
