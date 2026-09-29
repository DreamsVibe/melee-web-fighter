// Service worker: toggles the overlay in the active tab, opens the stage select, and runs the GameCube
// adapter helper.
import { MSG } from './shared/messages';
import { ADAPTER_PORT, NATIVE_HOST, type AdapterMessage, type AdapterState } from './shared/adapter-link';

async function toggle(tab?: chrome.tabs.Tab): Promise<void> {
  if (!tab?.id || !tab.url || !/^(https?|file):/.test(tab.url)) return;
  const tabId = tab.id;
  try {
    await chrome.tabs.sendMessage(tabId, { type: MSG.toggle });
  } catch {
    // Not injected yet in this tab: inject, then toggle on.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tabId, { type: MSG.toggle });
  }
}

/**
 * The stage-select shortcut: a stage page in view opens its menu; anywhere else, a new stage page opens
 * on the menu. (Asking the pages avoids needing the tabs permission to read tab URLs.)
 */
async function chooseStage(): Promise<void> {
  const shown = await chrome.runtime.sendMessage({ type: MSG.stageMenu }).catch(() => false);
  if (!shown) await chrome.tabs.create({ url: chrome.runtime.getURL('stage.html') });
}

chrome.action.onClicked.addListener((tab) => void toggle(tab));
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'choose-stage') { await chooseStage(); return; }
  if (command !== 'toggle-fighter') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await toggle(tab);
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('import.html') });
  // The settings page restarted the extension to finish an update: reopen it to show the result.
  if (details.reason === 'update') {
    void chrome.storage.local.get('pendingUpdate').then(({ pendingUpdate }) => {
      if (pendingUpdate) void chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
    });
  }
});

// ---- GameCube adapter: the native helper reads it; subscribers get its messages -------------------
const subscribers = new Set<chrome.runtime.Port>();
let native: chrome.runtime.Port | null = null;
let lastStatus: AdapterMessage = { type: 'status', s: 'starting', d: '' };
let retryTimer = 0;

function broadcast(msg: AdapterMessage): void {
  for (const p of subscribers) {
    try { p.postMessage(msg); } catch { subscribers.delete(p); }
  }
}

function setStatus(s: AdapterState, d = ''): void {
  lastStatus = { type: 'status', s, d };
  broadcast(lastStatus);
}

function startHelper(): void {
  if (native || !subscribers.size) return;
  clearTimeout(retryTimer);
  const port = chrome.runtime.connectNative(NATIVE_HOST);
  native = port;
  setStatus('starting');
  port.onMessage.addListener((m: { r?: number[]; s?: AdapterState; d?: string }) => {
    if (m.r) broadcast({ type: 'report', r: m.r, t: Date.now() });
    else if (m.s) setStatus(m.s, m.d ?? '');
  });
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message ?? '';
    if (native !== port) return;
    native = null;
    if (/not found/i.test(err)) setStatus('no-helper', err);
    else if (/forbidden/i.test(err)) setStatus('helper-forbidden', err);
    else setStatus('helper-exited', err);
    // Installed or fixed while a page is open: try again now and then.
    if (subscribers.size) retryTimer = setTimeout(startHelper, 3000) as unknown as number;
  });
}

function stopHelper(): void {
  clearTimeout(retryTimer);
  const port = native;
  native = null;
  port?.disconnect();
  lastStatus = { type: 'status', s: 'starting', d: '' };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== ADAPTER_PORT) return;
  subscribers.add(port);
  port.postMessage(lastStatus);
  port.onDisconnect.addListener(() => {
    subscribers.delete(port);
    if (!subscribers.size) stopHelper();
  });
  startHelper();
});
