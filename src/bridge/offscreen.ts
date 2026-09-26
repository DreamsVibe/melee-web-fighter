// Offscreen document fallback: when WebUSB is not usable inside the page's bridge iframe, this
// extension document reads the adapter and relays each report through the service worker.
import { AdapterReader } from './adapter';

const reader = new AdapterReader(
  (report) => void chrome.runtime.sendMessage({ type: 'mwf:relay-report', report: Array.from(report), t: performance.timeOrigin + performance.now() }),
  (status, detail) => void chrome.runtime.sendMessage({ type: 'mwf:relay-status', status, detail }),
);
void reader.start();
