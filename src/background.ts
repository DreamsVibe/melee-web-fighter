// Service worker: toggles the overlay in the active tab and hosts the adapter relay fallback.
import { MSG } from './shared/messages';

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

chrome.action.onClicked.addListener((tab) => void toggle(tab));
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-fighter') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await toggle(tab);
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.tabs.create({ url: chrome.runtime.getURL('import.html') });
});

// ---- adapter relay fallback (offscreen document → service worker → tab) -------------------------
const relayTabs = new Set<number>();

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL('offscreen.html');
  const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT], documentUrls: [url] });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Reads the GameCube controller adapter over WebUSB when the page frame cannot.',
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'mwf:relay-start' && sender.tab?.id !== undefined) {
    relayTabs.add(sender.tab.id);
    void ensureOffscreen();
  } else if (msg?.type === 'mwf:relay-stop' && sender.tab?.id !== undefined) {
    relayTabs.delete(sender.tab.id);
    if (!relayTabs.size) void chrome.offscreen.closeDocument().catch(() => {});
  } else if (msg?.type === 'mwf:relay-report' || msg?.type === 'mwf:relay-status') {
    for (const id of relayTabs) chrome.tabs.sendMessage(id, msg).catch(() => relayTabs.delete(id));
  }
});
