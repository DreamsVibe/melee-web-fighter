// Node test runner: `npm test`. Tests that need disc data read the user's own disc image from
// MELEE_ISO (or a .iso/.ciso at the repo root); nothing from the disc is stored in the repo.
import { openAsBlob, readdirSync, existsSync } from 'node:fs';

import { Disc } from '../src/importer/disc';
import { tests } from './suite';

async function findDisc(): Promise<Disc | null> {
  const candidates = [process.env.MELEE_ISO, ...readdirSync('.').filter((f) => /\.(c?iso|gcm)$/i.test(f)), 'C:/melee-unlocked/melee.iso'].filter(Boolean) as string[];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try { return await Disc.open(await openAsBlob(c)); } catch (e) { console.warn(`skipping ${c}: ${(e as Error).message}`); }
  }
  return null;
}

const disc = await findDisc();
if (!disc) console.warn('No Melee disc found (set MELEE_ISO): disc tests are skipped.');
let failed = 0, skipped = 0;
const only = process.argv[2];
for (const t of tests) {
  if (only && !t.name.includes(only)) continue;
  if (t.needsDisc && !disc) { skipped++; continue; }
  const t0 = performance.now();
  try {
    await t.run(disc!);
    console.log(`ok    ${t.name} (${(performance.now() - t0).toFixed(0)} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${t.name}\n      ${(e as Error).message}\n      ${(e as Error).stack?.split('\n').slice(1, 3).join('\n      ')}`);
  }
}
console.log(`\n${tests.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped`);
process.exitCode = failed ? 1 : 0;

