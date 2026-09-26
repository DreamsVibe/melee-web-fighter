// Ad-hoc: prints a frame trace for an input sequence (npm run build --tests; node dist-tests/trace.js)
import { openAsBlob } from 'node:fs';
import { Disc } from '../src/importer/disc';
import { foxData, newEngine, pad } from './sim';

const disc = await Disc.open(await openAsBlob(process.env.MELEE_ISO ?? 'Super Smash Bros. Melee (USA) (En,Ja) (Rev 2).ciso'));
const e = newEngine(await foxData(disc));
const seq: Array<[number, Parameters<typeof pad>[0]]> = JSON.parse(process.argv[2] ?? '[]');
let i = 0;
for (const [n, p] of seq) {
  for (let k = 0; k < n; k++, i++) {
    e.step(pad(p));
    const fp = e.fighter;
    console.log(`${String(e.frame).padStart(4)} ${fp.motionName.padEnd(14)} f=${fp.animFrame.toFixed(2).padStart(6)} x=${fp.pos.x.toFixed(3).padStart(9)} y=${fp.pos.y.toFixed(3).padStart(8)} vx=${fp.selfVel.x.toFixed(4)} vy=${fp.selfVel.y.toFixed(4)} gr=${fp.grVel.toFixed(4)} ${e.events.filter((v) => v.type === 'sound').map((v) => 'snd' + (v as { id: number }).id).join(',')}`);
  }
}
