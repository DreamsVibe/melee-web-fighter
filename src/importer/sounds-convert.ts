// Picks every sound the characters' scripts, their sound tables and the engine can play, and writes
// them as .snd files plus a sounds.json per folder (a character's own bank → characters/<id>, shared
// → common).
import { Archive } from './hsd';
import { readSem, readSsm, soundSteps, writeSnd, type Ssm } from './sound';
import { reachableScripts, soundIds } from './subaction';
import { ftDataRoot, type ActionEntry } from './actions';
import type { OutFile, Sources, Log } from './pipeline';

/**
 * Sounds the engine plays itself: fast fall (ftcommon.c), landing thud (ftaction.c 0x46), blaster
 * shots (ftfoxspecialn.c foxSFX, falcoSFX), smash charge (ft_0DF0.c), shield on/off (ftCo_Guard.c).
 */
export const ENGINE_SOUNDS = {
  fastFall: 150, landing: 70, laser: 110103, laserBack: 110106, falcoLaser: 100099, falcoLaserBack: 100102, smashCharge: 123, shieldOn: 110, shieldOff: 127,
  // Being hit: the launch "fly" sound (ftCo_8008DCE0 x1908), the floor thud of a tumble landing
  // (ftCo_DownBound_SfxIds) and a hit on an invincible fighter (ftColl_803C0C40).
  flyStrong: 0x4f, flyMedium: 0x50, downBound1: 9, downBound2: 10, downBound3: 11, downBound4: 12,
  hitInvincible1: 141, hitInvincible2: 142, hitInvincible3: 143,
  // Catching a ledge (ftCliffCommon_80081370).
  ledgeCatch: 4,
};

/**
 * Hit sounds by a hitbox's sound kind and severity (lbColl_803B9880[kind * 3 + severity], played by
 * lbColl_80005BB0 when a hit lands). 0x83D60 is "none"; ids outside the common bank are left out.
 */
export const HIT_SOUNDS = [
  0x83d60, 0x83d60, 0x83d60, 0x5b, 0x5a, 0x59, 0x58, 0x57, 0x56, 0x6f, 0x70, 0x71, 0x54, 0x54, 0x54, 0x5a, 0x59, 0xdf,
  0xe1, 0xe1, 0xe1, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x4461b, 0x4461b, 0x4461b, 0xf1, 0xf1, 0xf1, 0x5e, 0x5d, 0x5c,
  0x35baf, 0x35bb2, 0x35bb5, 0x83d60, 0x83d60, 0x20d,
];

/** A character whose sounds are converted: its data file, actions, folder and own sound bank. */
export interface SoundSource { id: string; archive: Archive; actions: ActionEntry[]; dir: string; bank?: { file: string; index: number } }

export interface SoundDef {
  name: string;
  steps: Array<{ delayMs: number; sample: string; volume: number; pitchCents: number; pan: number }>;
}

export function convertSounds(sources: Sources, chars: SoundSource[], commonDir: string, log: Log): { files: OutFile[]; ftSfx: Map<string, Record<string, number>> } {
  const sem = readSem(sources.get('audio/us/smash2.sem')!);
  const banks: Array<{ ssm: Ssm; dir: string; prefix: string; index: number }> = [
    { ssm: readSsm(sources.get('audio/us/main.ssm')!), dir: commonDir, prefix: 'common', index: 0 },
  ];
  for (const c of chars) if (c.bank) banks.push({ ssm: readSsm(sources.get(c.bank.file)!), dir: c.dir, prefix: c.id, index: c.bank.index });
  const users = new Map<number, string>();
  const use = (id: number, who: string) => { if (id > 0 && id < 0x83d60 && !users.has(id)) users.set(id, who); };
  const ftSfx = new Map<string, Record<string, number>>();
  for (const ch of chars) {
    for (const act of ch.actions) {
      if (!act.script) continue;
      for (const cmds of reachableScripts(ch.archive, act.script).values()) for (const c of cmds) for (const id of soundIds(c)) use(id, act.anim || `action${act.index}`);
    }
    // The character's sound table (FtSFX, ftData +0x4C): named slots the engine uses (jump, double jump, ...).
    const table: Record<string, number> = {};
    const sfxTable = ch.archive.ptr(ftDataRoot(ch.archive) + 0x4c);
    const slotNames = ['smash', 'x4', 'x8', 'xC', 'jump', 'doubleJump', 'x18', 'x1C', 'x20', 'x24', 'x28', 'x2C', 'x30', 'x34'];
    slotNames.forEach((n, i) => {
      if (i === 0 || i === 7 || i === 8) return; // pointers to lists
      const v = ch.archive.s32(sfxTable + 4 * i);
      if (v > 0) { table[n] = v; use(v, n); }
    });
    ftSfx.set(ch.id, table);
  }
  // Clearer names for the ones the engine itself refers to.
  for (const [name, id] of Object.entries(ENGINE_SOUNDS)) { use(id, name); users.set(id, name); }
  HIT_SOUNDS.forEach((id, i) => { if (Math.floor(id / 10000) === 0) { use(id, `hit${Math.floor(i / 3)}_${i % 3}`); } });
  users.set(401, 'footstep');

  const files: OutFile[] = [];
  const defs = new Map<string, Record<string, SoundDef>>();
  const written = new Set<number>();
  const names = new Set<string>();
  let bytes = 0;
  for (const [id, who] of [...users].sort((a, b) => a[0] - b[0])) {
    const steps = soundSteps(sem, id);
    if (!steps.length) continue;
    const bank = banks.find((b) => b.index === Math.floor(id / 10000)) ?? banks[0];
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
