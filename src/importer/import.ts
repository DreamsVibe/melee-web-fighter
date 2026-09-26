// Importer page: pick the disc, verify it, convert Fox, store the character folder.
import { Disc, DiscError } from './disc';
import { runImport } from './pipeline';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileInput = $<HTMLInputElement>('file');
const startBtn = $<HTMLButtonElement>('start');
const status = $<HTMLParagraphElement>('status');
const progress = $<HTMLProgressElement>('progress');
const log = $<HTMLPreElement>('log');

function say(text: string, error = false): void {
  status.textContent = text;
  status.className = error ? 'error' : 'muted';
}

fileInput.addEventListener('change', () => {
  startBtn.disabled = !fileInput.files?.length;
  say(fileInput.files?.[0] ? `${fileInput.files[0].name} (${(fileInput.files[0].size / 2 ** 20).toFixed(0)} MB)` : 'No disc chosen.');
});

startBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  startBtn.disabled = true;
  fileInput.disabled = true;
  progress.hidden = false;
  log.textContent = '';
  const t0 = performance.now();
  try {
    say('Reading the disc header…');
    const disc = await Disc.open(file);
    log.textContent += `Disc: ${disc.gameId} revision ${disc.revision} (${disc.kind.toUpperCase()}), ${disc.files.size} files\n`;
    const result = await runImport(disc, (fraction, text) => {
      progress.value = fraction;
      say(text);
    }, (line) => { log.textContent += line + '\n'; log.scrollTop = log.scrollHeight; });
    progress.value = 1;
    say(`Done in ${((performance.now() - t0) / 1000).toFixed(1)} s: Fox's folder is ${(result.bytes / 2 ** 20).toFixed(2)} MB in ${result.files} files.`);
    document.dispatchEvent(new CustomEvent('mwf-imported'));
  } catch (err) {
    console.error(err);
    say(err instanceof DiscError ? err.message : `Import failed: ${(err as Error).message ?? err}`, true);
  } finally {
    startBtn.disabled = false;
    fileInput.disabled = false;
  }
});
