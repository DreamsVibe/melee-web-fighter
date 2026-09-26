// Bundles the extension into dist/ with esbuild and prints a size report.
//   node build.mjs            production build (minified)
//   node build.mjs --watch    rebuild on change
//   node build.mjs --dev      unminified, with inline source maps
//   node build.mjs --tests    also bundles tests/ into dist-tests/ for Node
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = new Set(process.argv.slice(2));
const dev = args.has('--dev') || args.has('--watch');
const out = 'dist';
const BUDGET = 300 * 1024;

const entries = {
  background: 'src/background.ts',
  content: 'src/content/main.ts',
  import: 'src/importer/import.ts',
  bridge: 'src/bridge/bridge.ts',
  options: 'src/options/options.ts',
  offscreen: 'src/bridge/offscreen.ts',
};

function copyStatic() {
  cpSync('src/static', out, { recursive: true });
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function sizeReport() {
  const files = walk(out).map((p) => ({ p: relative(out, p).replaceAll('\\', '/'), n: statSync(p).size }));
  files.sort((a, b) => b.n - a.n);
  const total = files.reduce((s, f) => s + f.n, 0);
  const kb = (n) => (n / 1024).toFixed(1).padStart(7) + ' KB';
  console.log('\nsize report (unzipped):');
  for (const f of files) console.log(`  ${kb(f.n)}  ${f.p}`);
  const verdict = total <= BUDGET ? 'within' : 'OVER';
  console.log(`  ${kb(total)}  total — ${verdict} the ${BUDGET / 1024} KB budget\n`);
  if (total > BUDGET && !dev) process.exitCode = 1;
}

const options = {
  entryPoints: entries,
  outdir: out,
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'warning',
  define: { DEV: String(dev) },
};

if (!args.has('--watch')) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyStatic();

if (args.has('--watch')) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: 'report', setup(b) { b.onEnd(() => { copyStatic(); sizeReport(); }); } }],
  });
  await ctx.watch();
  console.log('watching src/ ...');
} else {
  await esbuild.build(options);
  sizeReport();
  if (args.has('--tests') && existsSync('tests/run.ts')) {
    await esbuild.build({
      entryPoints: { run: 'tests/run.ts' },
      outdir: 'dist-tests',
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      define: { DEV: 'true' },
      logLevel: 'warning',
    });
  }
}
