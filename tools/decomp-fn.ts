// Dev tool: prints decomp functions by name (their full body and file:line), without reading whole files.
//   node tools/run.mjs decomp-fn ft_80082708 ftCommon_ClampAirDrift ...
//   node tools/run.mjs decomp-fn --calls ftCa_SpecialHi_Phys   (also prints every function it calls, one level)
// Searches .private/decomp/src (doldecomp/melee, sparse). Inline helpers in headers are found too.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '.private/decomp/src';
const args = process.argv.slice(2);
const withCalls = args[0] === '--calls';
const names = withCalls ? args.slice(1) : args;
if (!names.length) { console.error('usage: decomp-fn [--calls] <function> ...'); process.exit(2); }

const files = readdirSync(ROOT, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && /\.[ch]$/.test(d.name))
  .map((d) => join(d.parentPath ?? (d as unknown as { path: string }).path, d.name));
const cache = new Map<string, string>();
const text = (f: string) => { if (!cache.has(f)) cache.set(f, readFileSync(f, 'utf8')); return cache.get(f)!; };

function find(name: string): { file: string; line: number; body: string } | null {
  const re = new RegExp(`^[\\w \\t*]*\\b${name}\\s*\\([^;{]*\\)\\s*\\{`, 'm');
  for (const f of files) {
    const t = text(f);
    if (!t.includes(name)) continue;
    const m = re.exec(t);
    if (!m) continue;
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < t.length; i++) { if (t[i] === '{') depth++; else if (t[i] === '}' && --depth === 0) break; }
    return { file: f.slice(ROOT.length + 1).replace(/\\/g, '/'), line: t.slice(0, m.index).split('\n').length, body: t.slice(m.index, i + 1) };
  }
  return null;
}

const seen = new Set<string>();
function show(name: string): string | null {
  if (seen.has(name)) return null;
  seen.add(name);
  const r = find(name);
  if (!r) { console.log(`// ${name}: not found (a macro, or outside the sparse checkout)\n`); return null; }
  console.log(`// ${r.file}:${r.line}\n${r.body}\n`);
  return r.body;
}
for (const n of names) {
  const body = show(n);
  if (withCalls && body) {
    for (const m of body.slice(body.indexOf('{')).matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      if (/^(if|for|while|switch|return|sizeof)$/.test(m[1]) || /^[A-Z_0-9]+$/.test(m[1])) continue;
      show(m[1]);
    }
  }
}
