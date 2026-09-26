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
