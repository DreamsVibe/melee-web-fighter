// Importer page: pick the disc, verify it, convert Fox, Falco and Sandbag, store the character folders.
import { Disc, DiscError } from './disc';
import { runImport } from './pipeline';
import { startPreview } from './preview';
import { readAnim } from '../shared/animfile';
import { applyAnim } from '../render/animator';
import { bytes } from '../shared/character';
import { AudioPlayer } from '../audio/audio';

/** Characters the preview can show. */
const PREVIEW_CHARACTERS = [{ id: 'fox', name: 'Fox' }, { id: 'falco', name: 'Falco' }, { id: 'sandbag', name: 'Sandbag' }];

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
    say(`Done in ${((performance.now() - t0) / 1000).toFixed(1)} s: Fox, Falco and Sandbag take ${(result.bytes / 2 ** 20).toFixed(2)} MB in ${result.files} files.`);
    await showPreview();
  } catch (err) {
    console.error(err);
    say(err instanceof DiscError ? err.message : `Import failed: ${(err as Error).message ?? err}`, true);
  } finally {
    startBtn.disabled = false;
    fileInput.disabled = false;
  }
});

let audio: AudioPlayer | null = null;

async function showPreview(id = 'fox'): Promise<void> {
  const card = $<HTMLDivElement>('previewCard');
  card.hidden = false;
  try {
    // A fresh canvas per preview: the old WebGL context is released, not stacked.
    const old = $<HTMLCanvasElement>('preview');
    old.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    const canvas = old.cloneNode() as HTMLCanvasElement;
    old.replaceWith(canvas);
    const dir = `characters/${id}/`;
    const preview = await startPreview(canvas, dir);
    const chars = $<HTMLSelectElement>('character');
    chars.replaceChildren(...PREVIEW_CHARACTERS.filter((c) => preview.files.has(`characters/${c.id}/character.json`)).map((c) => new Option(c.name, c.id)));
    chars.value = id;
    chars.onchange = () => void showPreview(chars.value);
    const select = $<HTMLSelectElement>('anim');
    const animDir = dir + 'anims/';
    const names = [...preview.files.keys()].filter((p) => p.startsWith(animDir)).map((p) => p.slice(animDir.length, -5)).sort();
    select.replaceChildren(...names.map((n) => new Option(n, n)));
    const play = (name: string | null) => {
      if (!name) { preview.setPoser(null); return; }
      const anim = readAnim(bytes(preview.files.get(`${animDir}${name}.anim`))!);
      preview.setPoser((f, local) => applyAnim(anim, f % anim.frameCount, local));
    };
    select.onchange = () => play(select.value);
    // One player for the page: switching characters reloads it rather than opening another audio context.
    const player = (audio ??= new AudioPlayer(0.8));
    player.load(preview.files);
    $<HTMLDivElement>('sounds').replaceChildren(...player.list().map(([id, def]) => {
      const b = document.createElement('button');
      b.textContent = def.name;
      b.title = `sound id ${id}`;
      b.onclick = () => player.play(id);
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
import('../shared/db').then(async ({ getFile, asText, FORMAT_VERSION }) => {
  const info = asText(await getFile('characters/fox/character.json'));
  if (!info) return;
  if ((JSON.parse(info).formatVersion ?? 0) < FORMAT_VERSION) say('An older import was found: import your disc again (this version needs more from it, such as ledges).');
  else if (!(await getFile('characters/falco/character.json'))) say('An older import was found: import your disc again to add Falco.');
  else say('Fox, Falco and Sandbag are already imported. Import again to refresh them.');
  await showPreview();
});
