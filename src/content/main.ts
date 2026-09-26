// Content script entry: toggles the overlay. Injected on demand by the background worker, so a page
// the user never toggles on never sees this code. While off it holds only a message listener.
import { MSG } from '../shared/messages';
import { Game } from './game';

declare global {
  interface Window { __mwfLoaded?: boolean }
}

if (!window.__mwfLoaded) {
  window.__mwfLoaded = true;
  let game: Game | null = null;
  chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
    if (msg?.type !== MSG.toggle) return;
    if (game) {
      game.destroy();
      game = null;
    } else {
      const g = new Game();
      game = g;
      g.start().catch((err) => {
        console.error('[melee-web-fighter]', err);
        g.showError(String(err?.message ?? err));
      });
    }
  });
}
