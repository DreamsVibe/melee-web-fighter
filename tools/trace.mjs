// node tools/trace.mjs '[[frames, {pad}], ...]'  — bundles tests/debug-trace.ts and runs it.
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
await esbuild.build({ entryPoints: ['tests/debug-trace.ts'], outfile: 'dist-tests/trace.mjs', bundle: true, platform: 'node', format: 'esm', define: { DEV: 'true' }, logLevel: 'warning' });
process.stdout.write(execFileSync(process.execPath, ['dist-tests/trace.mjs', process.argv[2] ?? '[]']));
