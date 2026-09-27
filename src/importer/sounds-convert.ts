// Picks every sound Fox's scripts, his sound table and the engine can play, and writes them as .snd
// files plus a sounds.json per folder (Fox's own bank → characters/fox, shared → common).
import { Archive } from './hsd';
import { readSem, readSsm, soundSteps, writeSnd, type Ssm } from './sound';
import { reachableScripts, soundIds } from './subaction';
import { ftDataRoot, type ActionEntry } from './actions';
import type { OutFile, Sources, Log } from './pipeline';

/**
 * Sounds the engine plays itself: fast fall (ftcommon.c), landing thud (ftaction.c 0x46), blaster
 * shots (ftfoxspecialn.c foxSFX), smash charge (ft_0DF0.c), shield on/off (ftCo_Guard.c).
 */
export const ENGINE_SOUNDS = { fastFall: 150, landing: 70, laser: 110103, laserBack: 110106, smashCharge: 123, shieldOn: 110, shieldOff: 127 };

export interface SoundDef {
  name: string;
  steps: Array<{ delayMs: number; sample: string; volume: number; pitchCents: number; pan: number }>;
}

export function convertSounds(sources: Sources, plfx: Archive, actions: ActionEntry[], charDir: string, commonDir: string, log: Log): { files: OutFile[]; ftSfx: Record<string, number> } {
  const sem = readSem(sources.get('audio/us/smash2.sem')!);
  const banks: Array<{ ssm: Ssm; dir: string; prefix: string }> = [
    { ssm: readSsm(sources.get('audio/us/main.ssm')!), dir: commonDir, prefix: 'common' },
    { ssm: readSsm(sources.get('audio/us/fox.ssm')!), dir: charDir, prefix: 'fox' },
  ];
  const users = new Map<number, string>();
  const use = (id: number, who: string) => { if (id > 0 && id < 0x83d60 && !users.has(id)) users.set(id, who); };
  for (const act of actions) {
    if (!act.script) continue;
    for (const cmds of reachableScripts(plfx, act.script).values()) for (const c of cmds) for (const id of soundIds(c)) use(id, act.anim || `action${act.index}`);
  }
  // Fox's sound table (FtSFX, ftData +0x4C): named slots the engine uses (jump, double jump, ...).
  const ftSfx: Record<string, number> = {};
  const sfxTable = plfx.ptr(ftDataRoot(plfx) + 0x4c);
  const slotNames = ['smash', 'x4', 'x8', 'xC', 'jump', 'doubleJump', 'x18', 'x1C', 'x20', 'x24', 'x28', 'x2C', 'x30', 'x34'];
  slotNames.forEach((n, i) => {
    if (i === 0 || i === 7 || i === 8) return; // pointers to lists
    const v = plfx.s32(sfxTable + 4 * i);
    if (v > 0) { ftSfx[n] = v; use(v, n); }
  });
  // Clearer names for the ones the engine itself refers to.
  for (const [name, id] of Object.entries(ENGINE_SOUNDS)) { use(id, name); users.set(id, name); }
  users.set(401, 'footstep');

  const files: OutFile[] = [];
  const defs = new Map<string, Record<string, SoundDef>>();
  const written = new Set<number>();
  const names = new Set<string>();
  let bytes = 0;
  for (const [id, who] of [...users].sort((a, b) => a[0] - b[0])) {
    const steps = soundSteps(sem, id);
    if (!steps.length) continue;
    const bank = Math.floor(id / 10000) === 11 ? banks[1] : banks[0];
    let name = `${bank.prefix}_${who}`.replace(/[^\w]/g, '_');
    for (let k = 2; names.has(name); k++) name = `${bank.prefix}_${who}_${k}`;
    names.add(name);
    const def: SoundDef = { name, steps: [] };
    for (const s of steps) {
      const src = banks.find((b) => s.fid >= b.ssm.firstFid && s.fid < b.ssm.firstFid + b.ssm.entries.length);
      if (!src) continue;
      const path = `${src.dir}sounds/s${String(s.fid).padStart(4, '0')}.snd`;
      if (!written.has(s.fid)) {
        written.add(s.fid);
        const data = writeSnd(src.ssm, src.ssm.entries[s.fid - src.ssm.firstFid]);
        bytes += data.length;
        files.push({ path, data });
      }
      def.steps.push({ delayMs: s.delayMs, sample: path, volume: s.volume, pitchCents: s.pitchCents, pan: s.pan });
    }
    if (!def.steps.length) continue;
    const dir = bank.dir;
    if (!defs.has(dir)) defs.set(dir, {});
    defs.get(dir)![String(id)] = def;
  }
  for (const [dir, d] of defs) files.push({ path: `${dir}sounds/sounds.json`, data: JSON.stringify(d, null, 2) + '\n' });
  log(`sounds: ${users.size} ids, ${written.size} samples, ${(bytes / 1024).toFixed(0)} KB (still ADPCM)`);
  return { files, ftSfx };
}
