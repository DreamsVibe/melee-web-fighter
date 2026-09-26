// Content script entry: toggles the overlay. Injected on demand by the background worker, so a page
// the user never toggles on never sees this code. While off it holds only a message listener.
import { MSG } from '../shared/messages';
import { Overlay } from './overlay';

declare global {
  interface Window { __mwfLoaded?: boolean }
}

if (!window.__mwfLoaded) {
  window.__mwfLoaded = true;
  let overlay: Overlay | null = null;
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type !== MSG.toggle) return;
    if (overlay) {
      overlay.destroy();
      overlay = null;
    } else {
      overlay = new Overlay();
      overlay.start().catch((err) => {
        console.error('[melee-web-fighter]', err);
        overlay?.showError(String(err?.message ?? err));
      });
    }
  });
}
