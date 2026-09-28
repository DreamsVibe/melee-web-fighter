// Updates from GitHub releases: the version check, the changelog, and writing a release zip over
// the player's unpacked copy through a folder they picked (Chrome never lets an extension change
// its own files, so the player grants the folder once).
import { readZip } from './zip';

export const REPO = 'DreamsVibe/melee-web-fighter';
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
export const ASSET_NAME = 'melee-web-fighter.zip';

export interface Release { version: string; name: string; notes: string; date: string; url: string; zipUrl: string | null }

/** Compares dotted versions ("v0.2.0" and "0.10.1" both work). */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number), pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** Published releases, newest version first. */
export async function fetchReleases(): Promise<Release[]> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub is limiting requests from this network; try again in an hour.' : `GitHub answered ${res.status}.`);
  const list = await res.json() as Array<{ tag_name: string; name: string | null; body: string | null; published_at: string; html_url: string; draft: boolean; prerelease: boolean; assets: Array<{ name: string; browser_download_url: string }> }>;
  return list
    .filter((r) => !r.draft && !r.prerelease && /^v?\d+(\.\d+)*$/.test(r.tag_name))
    .map((r) => ({
      version: r.tag_name.replace(/^v/, ''),
      name: r.name || r.tag_name,
      notes: r.body ?? '',
      date: r.published_at,
      url: r.html_url,
      zipUrl: r.assets.find((a) => a.name === ASSET_NAME)?.browser_download_url ?? null,
    }))
    .sort((a, b) => compareVersions(b.version, a.version));
}

// ---------------------------------------------------------------- writing the update

/** The parts of the File System Access API the updater uses (a real FileSystemDirectoryHandle fits). */
export interface DirHandle {
  readonly name: string;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{
    getFile(): Promise<Blob>;
    createWritable(): Promise<{ write(data: Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void> }>;
  }>;
}

async function readText(dir: DirHandle, path: string): Promise<string | null> {
  const parts = path.split('/');
  try {
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    return await (await (await d.getFileHandle(parts[parts.length - 1])).getFile()).text();
  } catch { return null; }
}

async function exists(dir: DirHandle, name: string, kind: 'file' | 'dir'): Promise<boolean> {
  try { await (kind === 'dir' ? dir.getDirectoryHandle(name) : dir.getFileHandle(name)); return true; } catch { return false; }
}

export interface InstallFolder { dir: DirHandle; /** 'root' = the unzipped download (extension/ + helper/), 'extension' = extension/ itself. */ kind: 'root' | 'extension' }

/**
 * Checks that a picked folder is this extension, at the running version, and not a git checkout
 * (a developer's clone updates with git). Returns what it found, or throws a message for the player.
 */
export async function checkFolder(dir: DirHandle, name: string, version: string): Promise<InstallFolder> {
  if (await exists(dir, '.git', 'dir')) throw new Error('This folder is a git checkout; update it with "git pull" instead.');
  let kind: InstallFolder['kind'] = 'root';
  let manifest = await readText(dir, 'extension/manifest.json');
  if (manifest === null) { manifest = await readText(dir, 'manifest.json'); kind = 'extension'; }
  if (manifest === null) throw new Error(`"${dir.name}" isn't the Melee Web Fighter folder: pick the folder you unzipped, the one with extension and helper inside.`);
  let m: { name?: string; version?: string };
  try { m = JSON.parse(manifest); } catch { throw new Error(`"${dir.name}" has a damaged manifest.json.`); }
  if (m.name !== name) throw new Error(`"${dir.name}" holds a different extension (${m.name ?? 'unnamed'}).`);
  if (m.version !== version) throw new Error(`"${dir.name}" holds version ${m.version}, but Chrome is running ${version}: pick the folder Chrome loads the extension from.`);
  return { dir, kind };
}

/** The release zip's files, relative to the download root (the zip's single top folder is dropped). */
export async function unpackRelease(zip: Uint8Array, version: string): Promise<Array<{ path: string; data: Uint8Array }>> {
  let files = await readZip(zip);
  const top = files[0]?.path.split('/')[0];
  if (top && files.every((f) => f.path.startsWith(top + '/'))) files = files.map((f) => ({ path: f.path.slice(top.length + 1), data: f.data }));
  const manifest = files.find((f) => f.path === 'extension/manifest.json');
  if (!manifest) throw new Error('The download has no extension/manifest.json.');
  const v = (JSON.parse(new TextDecoder().decode(manifest.data)) as { version?: string }).version;
  if (v !== version) throw new Error(`The download is version ${v}, expected ${version}.`);
  if (files.some((f) => f.path.split('/').some((p) => p === '..' || p === '') || f.path.includes('\\'))) throw new Error('The download has unexpected file paths.');
  return files;
}

/** Writes the release over the folder. The manifest goes last, so a failed write leaves the old version's manifest. */
export async function writeRelease(folder: InstallFolder, files: Array<{ path: string; data: Uint8Array }>): Promise<number> {
  const wanted = folder.kind === 'root'
    ? files
    : files.filter((f) => f.path.startsWith('extension/')).map((f) => ({ path: f.path.slice('extension/'.length), data: f.data }));
  const isManifest = (p: string) => p === (folder.kind === 'root' ? 'extension/manifest.json' : 'manifest.json');
  const ordered = [...wanted.filter((f) => !isManifest(f.path)), ...wanted.filter((f) => isManifest(f.path))];
  for (const f of ordered) {
    const parts = f.path.split('/');
    let d = folder.dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
    await w.write(f.data as Uint8Array<ArrayBuffer>);
    await w.close();
  }
  return ordered.length;
}

// ---------------------------------------------------------------- remembering the folder

const DB = 'mwf-updater', STORE = 'kv';
function kv(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function savedFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await kv();
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get('folder');
    req.onsuccess = () => resolve(req.result as FileSystemDirectoryHandle | undefined);
    req.onerror = () => resolve(undefined);
  });
}
export async function saveFolder(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await kv();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (handle) tx.objectStore(STORE).put(handle, 'folder'); else tx.objectStore(STORE).delete('folder');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
