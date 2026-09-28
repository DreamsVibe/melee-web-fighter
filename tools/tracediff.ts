// Dev tool: replays a reference trace through the engine and prints game and web side by side, to see
// where (and how) they part. Needs the disc (MELEE_ISO or a .iso/.ciso in the current folder).
//   npx esbuild tools/tracediff.ts --bundle --platform=node --format=esm --define:DEV=false --outfile=<tmp>/tracediff.mjs
//   node <tmp>/tracediff.mjs <trace name> [from retrace] [to retrace]
// e.g. node <tmp>/tracediff.mjs sb_jab 1700 1712
import { openAsBlob, readdirSync } from 'node:fs';
import { Disc } from '../src/importer/disc';
import { foxData, sandbagData } from '../tests/sim';
import { compareTrace, compareWorldTrace, hasSandbag, readTrace } from '../tests/validate';

const iso = process.env.MELEE_ISO ?? readdirSync('.').find((f) => /\.(c?iso|gcm)$/i.test(f));
if (!iso) throw new Error('No disc: set MELEE_ISO or run from a folder with the .iso/.ciso');
const disc = await Disc.open(await openAsBlob(iso));
const [name, from = '0', to = '99999'] = process.argv.slice(2);
const rows = readTrace(`tests/expected/${name}.csv`);
const fox = await foxData(disc);
const r = hasSandbag(rows)
  ? compareWorldTrace(name, rows, fox, await sandbagData(disc), 1590, 1, [Number(from), Number(to)])
  : compareTrace(name, rows, fox);
if (!r.mismatches.length) console.log(`${name}: matches for ${r.frames} frames`);
else {
  const m = r.mismatches[0];
  console.log(`${name}: first mismatch at retrace ${m.retrace} in ${m.field} (game ${m.expected}, web ${m.actual})`);
  for (const line of m.context) console.log('  ' + line);
}
