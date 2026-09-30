// Dev tool: reads a character's code in the decomp and writes what the importer and engine need to know
// about it, plus a porting report.
//   node tools/run.mjs fighter-gen <decomp folder> <id>     e.g. node tools/run.mjs fighter-gen ftCaptain captain
//   node tools/run.mjs fighter-gen ftCaptain captain --report   (report only, writes nothing)
//
// Writes src/shared/fighters/<id>.ts with
//   * SUBMOTIONS: the character's own action names (ftXx_Submotion, after the 295 common ones),
//   * SPECIAL_FIELDS: its special attributes (struct ftXx_DatAttrs in types.h), offsets computed from the
//     field types and checked against the header's /* +XX */ comments,
//   * MOTIONS: its own motion states (ftXx_Init_MotionStateTable, ids from 341): state name, the
//     submotion it plays and its move id (FtMoveId, used for stale moves).
// The report lists each motion state's callbacks, then every game function the character's code calls,
// marked "ported" when its decomp name appears anywhere in src/engine (the engine cites the functions it
// ports by name), so it's a to-do list for the port.
// The decomp is read from .private/decomp (doldecomp/melee, sparse checkout of src/melee).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DECOMP = '.private/decomp/src/melee';
const [folder, id, flag] = process.argv.slice(2);
if (!folder || !id) { console.error('usage: fighter-gen <decomp folder e.g. ftCaptain> <id> [--report]'); process.exit(2); }
const dir = join(DECOMP, 'ft/kinds', folder);
const read = (p: string) => readFileSync(p, 'utf8');
const files = readdirSync(dir);
const cFiles = files.filter((f) => f.endsWith('.c')).map((f) => ({ name: f, text: read(join(dir, f)) }));

const COMMON_MS = 341, COMMON_SM = 295;

/** Entries of `typedef enum <name> { ... }` up to the one ending in _Count. */
function enumEntries(text: string, nameRe: RegExp): string[] {
  const m = text.match(new RegExp(`typedef enum (${nameRe.source}) \\{([\\s\\S]*?)\\}`));
  if (!m) return [];
  const out: string[] = [];
  for (const line of m[2].replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').split(',')) {
    const name = line.trim().split(/\s*=/)[0];
    if (!name) continue;
    if (/_Count$/.test(name)) break;
    out.push(name);
  }
  return out;
}

const forward = existsSync(join(dir, 'forward.h')) ? read(join(dir, 'forward.h')) : '';
const smNames = enumEntries(forward, /ft\w+_Submotion/);
const prefix = smNames[0]?.match(/^(ft\w+?)_SM_/)?.[1] ?? '';
const submotions = smNames.map((n) => n.replace(/^ft\w+?_SM_/, ''));

// FtMoveId enum (ft/forward.h), sequential from 0.
const moveIds = new Map(enumEntries(read(join(DECOMP, 'ft/forward.h')), /FtMoveId/).map((n, i) => [n, i]));

// ---------------------------------------------------------------- motion state table
interface Motion { id: number; name: string; move: string; moveId: number; flags: string; cbs: string[] }
const motions: Motion[] = [];
const tableFile = cFiles.find((f) => /MotionState \w+_Init_MotionStateTable\[/.test(f.text));
if (tableFile) {
  const body = tableFile.text.slice(tableFile.text.search(/MotionState \w+_Init_MotionStateTable\[/));
  const open = body.indexOf('{');
  let depth = 0, start = -1, comment = '';
  for (let i = open; i < body.length; i++) {
    const ch = body[i];
    if (ch === '/' && body[i + 1] === '/') { const e = body.indexOf('\n', i); comment = body.slice(i, e); i = e; continue; }
    if (ch === '{') { depth++; if (depth === 2) start = i + 1; }
    else if (ch === '}') {
      depth--;
      if (depth === 1 && start >= 0) {
        const parts = body.slice(start, i).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').split(',').map((s) => s.trim()).filter(Boolean);
        const msName = comment.match(/(\w+_MS_(\w+))\s*=\s*(\d+)/);
        const idx = motions.length;
        const mv = parts[2]?.match(/FtMoveId_\w+/)?.[0];
        motions.push({
          id: msName ? Number(msName[3]) : COMMON_MS + idx,
          name: msName?.[2] ?? parts[0].replace(/^ft\w+?_SM_/, ''),
          move: parts[0].replace(/^ft\w+?_SM_/, ''),
          moveId: mv ? moveIds.get(mv) ?? -1 : 1,
          flags: parts[1],
          cbs: parts.slice(3, 7),
        });
        comment = '';
        start = -1;
      }
      if (depth === 0) break;
    }
  }
}

// ---------------------------------------------------------------- special attributes
const SIZES: Record<string, [number, 'f' | 'i', number?]> = {
  float: [4, 'f'], f32: [4, 'f'], s32: [4, 'i'], u32: [4, 'i'], int: [4, 'i'], bool: [4, 'i'],
  s16: [2, 'i'], u16: [2, 'i'], s8: [1, 'i'], u8: [1, 'i'], char: [1, 'i'],
  Vec2: [4, 'f', 2], Vec3: [4, 'f', 3],
};
type GenField = [string, number, 'i'?];
const fields: GenField[] = [];
const fieldWarnings: string[] = [];
const typesText = existsSync(join(dir, 'types.h')) ? read(join(dir, 'types.h')) : '';
const attrsMatch = typesText.match(/struct (ft\w+_DatAttrs) \{([\s\S]*?)\n\};/);
if (attrsMatch) {
  let off = 0;
  for (const raw of attrsMatch[2].split('\n')) {
    const line = raw.replace(/\/\/.*$/, '');
    const m = line.match(/(?:\/\*\s*\+?(?:0x)?([0-9A-Fa-f]+)\s*\*\/)?\s*(\w+)\s+(\w+)(?:\[(\w+)\])?\s*;/);
    if (!m) continue;
    const [, stated, type, name, arr] = m;
    // Other named types in these structs are enums (ItemKind, ...), which are 4-byte ints.
    const size = SIZES[type] ?? (fieldWarnings.push(`${name}: type ${type} read as a 4-byte int (an enum?)`), [4, 'i'] as [number, 'i']);
    const [unit, kind, comps = 1] = size;
    off = Math.ceil(off / unit) * unit;
    if (stated !== undefined && parseInt(stated, 16) !== off) fieldWarnings.push(`${name}: header says +${stated}, computed +${off.toString(16)}`);
    const count = (arr ? Number(arr) : 1) * comps;
    for (let k = 0; k < count; k++) {
      const suffix = comps === 2 ? ['_x', '_y'][k % 2] : comps === 3 ? ['_x', '_y', '_z'][k % 3] : '';
      const n = arr ? `${name}_${Math.floor(k / comps)}${suffix}` : `${name}${suffix}`;
      if (unit === 4) fields.push(kind === 'i' ? [n, off, 'i'] : [n, off]);
      else fieldWarnings.push(`${n} (+${off.toString(16)}) is ${unit} byte(s): not emitted, the attribute reader reads words`);
      off += unit;
    }
  }
}

// ---------------------------------------------------------------- porting report
const engineSrc = readdirSync('src/engine', { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith('.ts'))
  .map((d) => read(join(d.parentPath ?? (d as unknown as { path: string }).path, d.name))).join('\n');
const defined = new Map<string, string>();
const funcRe = /^(?:static\s+)?(?:inline\s+)?[\w*]+\s+\**(\w+)\s*\(([^)]*)\)\s*\{/gm;
for (const f of cFiles) for (const m of f.text.matchAll(funcRe)) {
  let depth = 0, i = m.index! + m[0].length - 1;
  for (; i < f.text.length; i++) { if (f.text[i] === '{') depth++; else if (f.text[i] === '}' && --depth === 0) break; }
  defined.set(m[1], f.text.slice(m.index!, i + 1));
}
const GAME_FN = /\b((?:ft|mp|it|ef|lb|pl|gm|Fighter|HSD|Stage|Ground)\w*)\s*\(/g;
const calls = new Map<string, Set<string>>();
for (const [fn, body] of defined) for (const m of body.slice(body.indexOf('{')).matchAll(GAME_FN)) {
  if (defined.has(m[1]) || /^[A-Z_]+$/.test(m[1])) continue;
  if (!calls.has(m[1])) calls.set(m[1], new Set());
  calls.get(m[1])!.add(fn);
}
const ported = (name: string) => new RegExp(`\\b${name}\\b`).test(engineSrc);

const report: string[] = [];
report.push(`# ${folder} (${prefix}): ${submotions.length} own submotions, ${motions.length} own motion states, ${fields.length} special attributes`);
report.push('', '## Motion states', '', 'id  | state | move | moveId | anim, iasa, phys, coll (ported?)');
for (const m of motions) {
  report.push(`${m.id} | ${m.name} | ${m.move} | ${m.moveId} | ${m.cbs.map((c) => `${c}${c === 'NULL' || defined.has(c) ? '' : ported(c) ? ' ✓' : ' ✗'}`).join(', ')}`);
}
report.push('', '## Game functions the character code calls', '');
const sorted = [...calls].sort((a, b) => Number(ported(a[0])) - Number(ported(b[0])) || a[0].localeCompare(b[0]));
for (const [fn, users] of sorted) report.push(`${ported(fn) ? '✓' : '✗'} ${fn}  ← ${[...users].join(', ')}`);
if (fieldWarnings.length) report.push('', '## Attribute warnings', '', ...fieldWarnings);
console.log(report.join('\n'));

if (flag !== '--report') {
  const out = [
    `// Generated by tools/fighter-gen.ts from the decomp (${folder}); do not edit by hand, run it again.`,
    `// ${prefix}_Submotion, struct ${attrsMatch?.[1] ?? '(none)'} and ${prefix}_Init_MotionStateTable.`,
    `import type { Field } from '../attributes';`,
    `import type { MotionDef } from './index';`,
    '',
    `export const SUBMOTIONS: readonly string[] = ${JSON.stringify(submotions)};`,
    '',
    `export const SPECIAL_FIELDS: Field[] = [`,
    ...fields.map(([n, o, t]) => `  ['${n}', 0x${o.toString(16)}${t ? `, '${t}'` : ''}],`),
    '];',
    '',
    '/** Own motion states: [motion id, state name, submotion (move) name, move id]. */',
    `export const MOTIONS: MotionDef[] = [`,
    ...motions.map((m) => `  [${m.id}, '${m.name}', '${m.move}', ${m.moveId}],`),
    '];',
    '',
  ].join('\n');
  mkdirSync('src/shared/fighters', { recursive: true });
  writeFileSync(`src/shared/fighters/${id}.ts`, out);
  console.log(`\nwrote src/shared/fighters/${id}.ts`);
}
