// Runs a TypeScript dev tool without a separate bundling step:
//   node tools/run.mjs <tool> [args...]      e.g. node tools/run.mjs datx roots PlCa.dat
// Bundles tools/<tool>.ts with esbuild into .tools-out/ (git-ignored) and runs it with the same args.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [tool, ...args] = process.argv.slice(2);
if (!tool) { console.error('usage: node tools/run.mjs <tool> [args...]'); process.exit(2); }
mkdirSync('.tools-out', { recursive: true });
const outfile = `.tools-out/${tool}.mjs`;
await build({
  entryPoints: [`tools/${tool}.ts`], bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
const r = spawnSync(process.execPath, [outfile, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
