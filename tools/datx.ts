// Dev tool: explore the disc and its HSD archives without extracting anything.
//   npx esbuild tools/datx.ts --bundle --platform=node --format=esm --outfile=<tmp>/datx.mjs
//   node <tmp>/datx.mjs files [substring]              list disc files
//   node <tmp>/datx.mjs roots <file>                   an archive's root symbols
//   node <tmp>/datx.mjs hex <file> <offset> [bytes]    data-relative hex dump; * marks relocated pointers
//   node <tmp>/datx.mjs words <file> <offset> [n]      32-bit words as hex / int / float / pointer
// Offsets accept hex (0x...) or a root name, optionally plus "+0x10" or "->" steps:
//   node <tmp>/datx.mjs words PlSb.dat "ftDataSandbag+0x30->" 2
// The disc comes from MELEE_ISO or a .iso/.ciso in the current folder.
import { readdirSync } from 'node:fs';
import { openDiscFile } from './disc-file';
import { Disc } from '../src/importer/disc';
import { Archive } from '../src/importer/hsd';

const iso = process.env.MELEE_ISO ?? readdirSync('.').find((f) => /\.(c?iso|gcm)$/i.test(f));
if (!iso) throw new Error('No disc: set MELEE_ISO or run from a folder with the .iso/.ciso');
const disc = await Disc.open(await openDiscFile(iso));
const [cmd, file, at, count] = process.argv.slice(2);
const hex = (n: number, w = 8) => n.toString(16).padStart(w, '0');

async function archive(name: string): Promise<Archive> {
  return new Archive(await disc.readFile(name));
}

/** "root", "root+0x10", "0x1234", "root+0x30->+4->" (-> follows the pointer at that offset). */
function resolve(a: Archive, expr: string): number {
  let o = 0;
  for (const tok of expr.match(/->|[+-]?(0x[0-9a-f]+|\d+)|[A-Za-z_][\w]*/gi) ?? []) {
    if (tok === '->') o = a.ptr(o);
    else if (/^[A-Za-z_]/.test(tok)) o = a.root(tok);
    else o += Number(tok.replace(/^\+/, ''));
  }
  return o;
}

if (cmd === 'files') {
  for (const f of disc.files.values()) if (!file || f.path.toLowerCase().includes(file.toLowerCase())) console.log(f.path.padEnd(40), f.size);
} else if (cmd === 'roots') {
  const a = await archive(file);
  console.log(`data ${a.dataSize} bytes, ${a.relocs.size} pointers`);
  for (const [name, off] of a.roots) console.log(hex(off, 6), name);
} else if (cmd === 'hex') {
  const a = await archive(file);
  const o = resolve(a, at), n = Number(count ?? 0x80);
  for (let r = o; r < o + n; r += 16) {
    const cells: string[] = [];
    for (let c = r; c < r + 16 && c < o + n; c += 4) cells.push(hex(a.u32(c)) + (a.isPtr(c) ? '*' : ' '));
    console.log(hex(r, 6), cells.join(' '));
  }
} else if (cmd === 'words') {
  const a = await archive(file);
  const o = resolve(a, at), n = Number(count ?? 16);
  for (let i = 0; i < n; i++) {
    const w = o + 4 * i, u = a.u32(w), f = a.f32(w);
    const fl = Number.isFinite(f) && Math.abs(f) > 1e-6 && Math.abs(f) < 1e7 ? f.toPrecision(6) : '';
    console.log(`+${hex(4 * i, 3)} ${hex(w, 6)}  ${hex(u)}${a.isPtr(w) ? ' ptr' : '    '}  ${String(a.s32(w)).padStart(11)}  ${fl}`);
  }
} else {
  console.log('commands: files, roots, hex, words (see the top of tools/datx.ts)');
}
