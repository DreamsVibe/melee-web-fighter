// Runs in an invisible extension-origin iframe that the content script adds to the page. It owns what
// only the extension origin can reach — the IndexedDB character folder and the WebUSB adapter — and
// talks to the content script over a private MessageChannel the page cannot see.
import { MSG } from '../shared/messages';
import { listFiles } from '../shared/db';
import { AdapterReader } from './adapter';

let port: MessagePort | null = null;

async function sendFolder(paths?: string[]): Promise<void> {
  if (!port) return;
  const all = await listFiles();
  const batch: Array<{ path: string; data: string | Uint8Array }> = [];
  const transfer: ArrayBuffer[] = [];
  for (const f of all) {
    if (paths && !paths.includes(f.path)) continue;
    if (f.path.startsWith('raw/')) continue;
    const data = typeof f.data === 'string' ? f.data : f.data.slice();
    if (typeof data !== 'string') transfer.push(data.buffer as ArrayBuffer);
    batch.push({ path: f.path, data });
  }
  // One message for the whole folder: hundreds of small messages cost seconds on busy pages.
  port.postMessage({ type: MSG.file, files: batch }, transfer);
  if (paths) {
    const present = new Set(all.map((f) => f.path));
    port.postMessage({ type: MSG.changed, paths, deleted: paths.filter((p) => !present.has(p)) });
  } else port.postMessage({ type: MSG.folderDone });
}

async function sendSettings(): Promise<void> {
  const settings = await chrome.storage.local.get(null);
  port?.postMessage({ type: MSG.settings, settings });
}

window.addEventListener('message', (e) => {
  if (e.data?.type !== MSG.hello || !e.ports[0] || port) return;
  port = e.ports[0];
  port.start();
  sendSettings().then(() => sendFolder()).catch((err) => console.error('[mwf bridge]', err));
  const adapter = new AdapterReader(
    (report) => port?.postMessage({ type: MSG.adapter, report }, [report.buffer]),
    (status) => port?.postMessage({ type: MSG.adapterStatus, status }),
  );
  void adapter.start();
});

// Live reload: the settings page broadcasts every override change.
const channel = new BroadcastChannel('mwf-files');
channel.onmessage = (e) => void sendFolder(e.data?.paths as string[]);
chrome.storage.onChanged.addListener(() => void sendSettings());
