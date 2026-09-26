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
  for (const f of all) {
    if (paths && !paths.includes(f.path)) continue;
    if (f.path.startsWith('raw/')) continue;
    const data = typeof f.data === 'string' ? f.data : f.data.slice();
    port.postMessage({ type: MSG.file, path: f.path, data }, typeof data === 'string' ? [] : [data.buffer]);
  }
  if (paths) {
    // Deleted files: tell the content script to drop them.
    const present = new Set(all.map((f) => f.path));
    const gone = paths.filter((p) => !present.has(p));
    port.postMessage({ type: MSG.changed, paths, deleted: gone });
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
  void sendSettings().then(() => sendFolder());
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
