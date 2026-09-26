// Importer page: pick the disc, verify it, convert Fox, store the character folder.
import { Disc, DiscError } from './disc';
import { runImport } from './pipeline';
import { startPreview } from './preview';
import { readAnim } from '../shared/animfile';
import { applyAnim } from '../render/animator';
import { bytes } from '../shared/character';
import { AudioPlayer } from '../audio/audio';

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
    await showPreview();
  } catch (err) {
    console.error(err);
    say(err instanceof DiscError ? err.message : `Import failed: ${(err as Error).message ?? err}`, true);
  } finally {
    startBtn.disabled = false;
    fileInput.disabled = false;
  }
});

async function showPreview(): Promise<void> {
  const card = $<HTMLDivElement>('previewCard');
  card.hidden = false;
  try {
    // A fresh canvas per preview: the old WebGL context is released, not stacked.
    const old = $<HTMLCanvasElement>('preview');
    old.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    const canvas = old.cloneNode() as HTMLCanvasElement;
    old.replaceWith(canvas);
    const preview = await startPreview(canvas);
    const select = $<HTMLSelectElement>('anim');
    const names = [...preview.files.keys()].filter((p) => p.startsWith('characters/fox/anims/')).map((p) => p.slice(21, -5)).sort();
    select.replaceChildren(...names.map((n) => new Option(n, n)));
    const play = (name: string | null) => {
      if (!name) { preview.setPoser(null); return; }
      const anim = readAnim(bytes(preview.files.get(`characters/fox/anims/${name}.anim`))!);
      preview.setPoser((f, local) => applyAnim(anim, f % anim.frameCount, local));
    };
    select.onchange = () => play(select.value);
    const audio = new AudioPlayer(0.8);
    audio.load(preview.files);
    $<HTMLDivElement>('sounds').replaceChildren(...audio.list().map(([id, def]) => {
      const b = document.createElement('button');
      b.textContent = def.name;
      b.title = `sound id ${id}`;
      b.onclick = () => audio.play(id);
      return b;
    }));
    $<HTMLButtonElement>('tpose').onclick = () => play(null);
    // T-pose first, then the idle animation, so the user sees both.
    setTimeout(() => { if (names.includes('Wait1')) { select.value = 'Wait1'; play('Wait1'); } }, 1500);
  } catch (err) {
    card.hidden = true;
    say(`Imported, but the preview failed: ${(err as Error).message}`, true);
  }
}

// Show the preview straight away when a folder was imported before.
import('../shared/db').then(async ({ getFile }) => {
  if (await getFile('characters/fox/character.json')) { say('Fox is already imported. Import again to refresh him.'); await showPreview(); }
});
