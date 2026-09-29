// Content script entry: toggles the overlay. Injected on demand by the background worker, so a page
// the user never toggles on never sees this code. While off it holds only a message listener.
import { MSG } from '../shared/messages';
import { Game, SetupError } from './game';

declare global {
  interface Window { __mwfTeardown?: () => void }
}

// The worker injects this script only when nothing in the tab answers its toggle, so a copy that is
// already here was left behind by an earlier version of the extension (reloaded or updated while it
// was on the page) and can no longer reach it: it takes its fighter off the page and hands over.
window.__mwfTeardown?.();

let game: Game | null = null;
const onMessage = (msg: { type?: string }) => {
  if (msg?.type !== MSG.toggle) return;
  if (game) {
    game.destroy();
    game = null;
    return;
  }
  const g = new Game();
  game = g;
  g.onOrphaned = () => { if (game === g) game = null; };
  g.start().catch((err) => {
    // Setup problems (nothing imported yet, an older import) are for the user, not the error log.
    if (!(err instanceof SetupError)) console.error('[melee-web-fighter]', err);
    g.showError(String(err?.message ?? err));
  });
};
chrome.runtime.onMessage.addListener(onMessage);
window.__mwfTeardown = () => {
  game?.destroy();
  game = null;
  try { chrome.runtime.onMessage.removeListener(onMessage); } catch { /* the old context is gone */ }
};
