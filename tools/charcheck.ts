// Dev tool: imports the disc in Node (the same pipeline as the browser) and checks a character folder.
//   node tools/run.mjs charcheck [id ...]        e.g. node tools/run.mjs charcheck captain
// Writes every converted file to .tools-out/folder/ (grep the .move files there), then prints per
// character: its special attributes, move count, and the script commands its moves use that the
// engine doesn't run yet (commands with no `case '<op>'` in src/engine/engine.ts or script.ts),
// with the moves that use each. The disc comes from MELEE_ISO or a .iso/.ciso in the current folder.
import { openAsBlob, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Disc } from '../src/importer/disc';
import { buildFolder, CHARACTERS } from '../src/importer/pipeline';
import { parseMove } from '../src/shared/move';

const iso = process.env.MELEE_ISO ?? readdirSync('.').find((f) => /\.(c?iso|gcm)$/i.test(f));
if (!iso) throw new Error('No disc: set MELEE_ISO or run from a folder with the .iso/.ciso');
const ids = process.argv.slice(2);
const disc = await Disc.open(await openAsBlob(iso));
const files = await buildFolder(disc, () => {}, () => {});
for (const f of files) {
  const p = `.tools-out/folder/${f.path}`;
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, f.data);
}
const handled = new Set(['label', ...['src/engine/engine.ts', 'src/engine/script.ts']
  .flatMap((p) => [...readFileSync(p, 'utf8').matchAll(/case '(\w+)'/g)].map((m) => m[1]))]);
const text = (d: string | Uint8Array) => (typeof d === 'string' ? d : new TextDecoder().decode(d));

for (const spec of CHARACTERS) {
  if (ids.length && !ids.includes(spec.id)) continue;
  const dir = `characters/${spec.id}/`;
  const attrs = JSON.parse(text(files.find((f) => f.path === dir + 'attributes.json')!.data));
  console.log(`\n# ${spec.name}`);
  console.log('special:', JSON.stringify(attrs.special));
  const unknown = new Map<string, Set<string>>();
  let moves = 0;
  for (const f of files) {
    if (!f.path.startsWith(dir + 'moves/')) continue;
    moves++;
    const m = parseMove(text(f.data), (n) => Number(n) || 0);
    for (const c of m.body) if (!handled.has(c.op)) {
      if (!unknown.has(c.op)) unknown.set(c.op, new Set());
      unknown.get(c.op)!.add(m.name);
    }
  }
  console.log(`${moves} moves; commands the engine doesn't run:`);
  for (const [op, ms] of [...unknown].sort((a, b) => b[1].size - a[1].size)) console.log(`  ${op.padEnd(16)} ${ms.size} moves: ${[...ms].slice(0, 8).join(', ')}${ms.size > 8 ? ', ...' : ''}`);
}
