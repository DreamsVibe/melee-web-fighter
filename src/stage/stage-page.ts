// The stage page (stage.html): Melee's stages, read from the user's disc at import, as places to play.
// It runs the same game as a web page does, on a StageArena, with a stage select on top: Esc, or the
// stage-select shortcut (Alt+Shift+M by default, relayed by the worker), opens and closes it.
import type { Game as GameType } from '../content/game';
import { MSG } from '../shared/messages';
import { STAGE_LIST, stageDir } from '../shared/stages';
import { getFile } from '../shared/db';
import { CHARACTERS, loadSettings, saveSettings } from '../shared/settings';

// The game itself comes from content.js, which stage.html loads first: one copy of it in the extension.
const { Game, SetupError } = window.__mwfGame!;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $<HTMLDivElement>('menu');

let game: GameType | null = null;
let current: string | null = null;

/** Which stages this import has (stages/<id>/stage.json). */
async function importedStages(): Promise<Set<string>> {
  const have = new Set<string>();
  for (const s of STAGE_LIST) if (s.ready && await getFile(stageDir(s.id) + 'stage.json')) have.add(s.id);
  return have;
}

async function renderMenu(): Promise<void> {
  const have = await importedStages();
  $('menuNote').innerHTML = have.size
    ? 'Stages come from your own Melee disc, imported with the characters.'
    : '<b>No stages are imported yet.</b> <a href="import.html" target="_blank">Import your Melee disc again</a> to add them, then come back.';
  $('stages').replaceChildren(...STAGE_LIST.map((s) => {
    const b = document.createElement('button');
    const title = document.createElement('b');
    title.textContent = s.name;
    const note = document.createElement('span');
    note.textContent = !s.ready ? 'Coming later' : have.has(s.id) ? (s.id === current ? 'Playing now' : 'Ready') : 'Import your disc again';
    b.append(title, note);
    b.disabled = !s.ready || !have.has(s.id);
    if (s.id === current) b.classList.add('current');
    b.onclick = () => play(s.id);
    return b;
  }));
  const settings = await loadSettings();
  $('chars').replaceChildren(...CHARACTERS.map((c) => {
    const b = document.createElement('button');
    b.textContent = c.name;
    if (settings.character === c.id) b.classList.add('on');
    // The game reloads the fighter live when the setting changes.
    b.onclick = async () => { await saveSettings({ character: c.id }); await renderMenu(); };
    return b;
  }));
}

async function openMenu(): Promise<void> {
  game?.setPaused(true);
  await renderMenu();
  // Last in the document: over the game's canvas, which shares its z-index.
  document.documentElement.appendChild(menu);
  menu.hidden = false;
  (menu.querySelector('.stages button:not(:disabled)') as HTMLButtonElement | null)?.focus();
}

function closeMenu(): void {
  if (!current) return; // nothing to go back to yet
  menu.hidden = true;
  game?.setPaused(false);
}

const toggleMenu = () => (menu.hidden ? void openMenu() : closeMenu());

function play(id: string): void {
  game?.destroy();
  current = id;
  const name = STAGE_LIST.find((s) => s.id === id)?.name ?? id;
  document.title = `${name} — Melee Web Fighter`;
  history.replaceState(null, '', `?stage=${encodeURIComponent(id)}`);
  menu.hidden = true;
  const g = new Game({ stage: id });
  game = g;
  // Dev builds: the running game, for the e2e tool and the console.
  if (DEV) (window as unknown as { __mwfStageGame: GameType }).__mwfStageGame = g;
  g.start().catch((err) => {
    if (!(err instanceof SetupError)) console.error('[melee-web-fighter]', err);
    g.showError(String(err?.message ?? err));
  });
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { e.preventDefault(); toggleMenu(); }
});

// The stage-select shortcut, relayed by the worker: the stage page in view answers it.
chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, respond) => {
  if (msg?.type !== MSG.stageMenu || document.visibilityState !== 'visible' || !document.hasFocus()) return;
  toggleMenu();
  respond(true);
});

const wanted = new URLSearchParams(location.search).get('stage');
void importedStages().then((have) => {
  if (wanted && have.has(wanted)) play(wanted);
  else void openMenu();
});
