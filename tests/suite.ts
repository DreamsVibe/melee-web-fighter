// Test cases. Each either needs the user's disc (read via tests/run.ts) or runs on its own.
import type { Disc } from '../src/importer/disc';
import { Archive } from '../src/importer/hsd';
import { readActionTable } from '../src/importer/actions';
import { scriptBody } from '../src/importer/moves-convert';
import { encodeMove, formatMove, parseMove, type Cmd } from '../src/shared/move';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeZip } from '../src/shared/zip';
import { checkFolder, compareVersions, unpackRelease, writeRelease, type DirHandle } from '../src/shared/update';

export interface Test { name: string; needsDisc?: boolean; run(disc: Disc): Promise<void> | void }
export const tests: Test[] = [];
const test = (name: string, run: Test['run'], needsDisc = false) => tests.push({ name, run, needsDisc });

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const cache = new Map<string, Uint8Array>();
export async function discFile(disc: Disc, path: string): Promise<Uint8Array> {
  if (!cache.has(path)) cache.set(path, await disc.readFile(path));
  return cache.get(path)!;
}

test('move scripts round-trip exactly through .move text', async (disc) => {
  const plfx = new Archive(await discFile(disc, 'PlFx.dat'));
  let checked = 0, commands = 0;
  for (const act of readActionTable(plfx)) {
    if (!act.script) continue;
    const { body, raw } = scriptBody(plfx, act.script);
    // 1. decode fidelity: re-encoding the decoded commands gives the original words, except jump
    //    targets, which become word offsets inside the move.
    const direct = encodeMove(body);
    const flat = raw.flat();
    const isJumpWord = new Set<number>();
    let pos = 0;
    for (const words of raw) {
      const op = words[0] >>> 26;
      if (op === 5 || op === 7) isJumpWord.add(pos + 1);
      pos += words.length;
    }
    for (let i = 0; i < flat.length; i++) {
      if (isJumpWord.has(i)) continue;
      assert(direct[i] === flat[i] >>> 0, `action ${act.index} (${act.anim}): word ${i} decodes to 0x${direct[i]?.toString(16)}, disc has 0x${flat[i].toString(16)}`);
    }
    // 2. text fidelity: format → parse → encode is identical.
    const text = formatMove({ name: `a${act.index}`, animation: act.anim || null, body }, (id) => String(id));
    const back = parseMove(text, (n) => Number(n));
    const again = encodeMove(back.body);
    assert(again.length === direct.length && again.every((w, i) => w === direct[i]), `action ${act.index} (${act.anim}): text round trip differs\n${text}`);
    checked++;
    commands += body.filter((c: Cmd) => c.op !== 'label').length;
  }
  assert(checked > 250, `only ${checked} scripts checked`);
  console.log(`      ${checked} scripts, ${commands} commands`);
}, true);

test('override layer merges JSON keys and replaces other files', async () => {
  const { effectiveFiles } = await import('../src/shared/character');
  const all = new Map<string, string>([
    ['characters/fox/attributes.json', JSON.stringify({ gravity: 0.23, walk_max_vel: 1.6, special: { reflector_release_lag: 18 } })],
    ['characters/fox/moves/AttackAirN.move', 'move AttackAirN\n'],
    ['overrides/characters/fox/attributes.json', JSON.stringify({ gravity: 0.1, special: { reflector_release_lag: 1 } })],
    ['overrides/characters/fox/moves/AttackAirN.move', 'move AttackAirN\nframe 1 iasa\n'],
  ]);
  const eff = effectiveFiles(all);
  const attrs = JSON.parse(eff.get('characters/fox/attributes.json') as string);
  assert(attrs.gravity === 0.1 && attrs.walk_max_vel === 1.6 && attrs.special.reflector_release_lag === 1, 'JSON override did not merge key by key');
  assert((eff.get('characters/fox/moves/AttackAirN.move') as string).includes('iasa'), '.move override did not replace the file');
  const off = effectiveFiles(all, new Set(['characters/fox/attributes.json']));
  assert(JSON.parse(off.get('characters/fox/attributes.json') as string).gravity === 0.23, 'disabled override still applied');
});

test('zip writer and reader round-trip', async () => {
  const { writeZip, readZip } = await import('../src/shared/zip');
  const files = [{ path: 'a/b.json', data: '{"x":1}' }, { path: 'c.bin', data: new Uint8Array([0, 1, 2, 255]) }];
  const back = await readZip(writeZip(files));
  assert(back.length === 2 && new TextDecoder().decode(back[0].data) === '{"x":1}' && back[1].data[3] === 255, 'zip round trip failed');
});

test('pad processing follows HSD clamp/scale and adapter report layout', async () => {
  const { padToFloats, emptyFloats, AdapterDecoder, emptyPad, BTN } = await import('../src/engine/pad');
  const f = padToFloats({ buttons: 0, stickX: 110, stickY: 0, cX: 0, cY: 0, trigL: 200, trigR: 70 }, emptyFloats());
  assert(f.stickX === 1 && f.stickY === 0, `stick not clamped to radius 80: ${f.stickX}`);
  assert(f.analogL === 1 && Math.abs(f.analogR - 0.5) < 1e-6, `triggers ${f.analogL} ${f.analogR}`);
  const diag = padToFloats({ buttons: 0, stickX: 80, stickY: 80, cX: 0, cY: 0, trigL: 0, trigR: 0 }, emptyFloats());
  assert(Math.abs(Math.hypot(diag.stickX, diag.stickY) - 1) < 0.02, 'diagonal not clamped to the circle');
  const report = new Uint8Array(37);
  report[0] = 0x21;
  report.set([0x10, 0x01 | 0x04, 0x08 | 0x02, 128, 128, 128, 128, 30, 30], 1); // port 1 plugged: A+X, L+Z, neutral
  const dec = new AdapterDecoder();
  const p = emptyPad();
  assert(dec.decode(report, 0, p), 'port 1 not decoded');
  assert(p.buttons === (BTN.A | BTN.X | BTN.L | BTN.Z) && p.stickX === 0 && p.trigL === 0, `buttons ${p.buttons.toString(16)}`);
  report[4] = 228; report[8] = 130;
  dec.decode(report, 0, p);
  assert((p.stickX as number) === 100 && (p.trigL as number) === 100, 'origin not subtracted');
});

test('engine: Fox stands, full hops, lands', async (disc) => {
  const { foxData, newEngine, pad } = await import('./sim');
  const e = newEngine(await foxData(disc));
  for (let i = 0; i < 10; i++) e.step(pad());
  assert(e.fighter.motionName === 'Wait', `not waiting: ${e.fighter.motionName}`);
  e.step(pad({ buttons: 'X' }));
  const trace: string[] = [];
  let peak = 0;
  for (let i = 0; i < 80; i++) {
    e.step(pad({ buttons: i < 10 ? 'X' : '' }));
    peak = Math.max(peak, e.fighter.pos.y);
    trace.push(`${e.frame} ${e.fighter.motionName} f=${e.fighter.animFrame.toFixed(1)} y=${e.fighter.pos.y.toFixed(3)} vy=${e.fighter.selfVel.y.toFixed(3)}`);
  }
  console.log('      ' + trace.slice(0, 6).join('\n      '));
  console.log(`      peak ${peak.toFixed(3)}; end: ${trace[trace.length - 1]}`);
  assert(peak > 30 && peak < 40, `full hop peak ${peak}`);
  assert(e.fighter.motionName === 'Wait' || e.fighter.motionName === 'Landing', `did not land: ${e.fighter.motionName}`);
}, true);

/** Every move of a Fox-like character (Fox, Falco): each starts, plays and returns to standing. */
async function checkEveryMove(disc: Disc, which: 'fox' | 'falco'): Promise<void> {
  const { foxData, falcoData, newEngine, pad } = await import('./sim');
  const data = which === 'fox' ? await foxData(disc) : await falcoData(disc);
  type P = Parameters<typeof pad>[0];
  // Each case: a list of [frames, pad] steps, then idle; the states it must pass through.
  // `ends`: where the case may finish besides standing (Fox's long Firefox reaches the ledge).
  const cases: Array<{ name: string; steps: Array<[number, P]>; expect: string[]; lasers?: boolean; ends?: string }> = [
    { name: 'jab, jab, rapid jab', steps: [[1, { buttons: 'A' }], [4, {}], [1, { buttons: 'A' }], [4, {}], ...Array.from({ length: 16 }, (_, i): [number, P] => [1, { buttons: i % 2 ? '' : 'A' }])], expect: ['Attack11', 'Attack12', 'Attack100Loop', 'Attack100End'] },
    { name: 'forward tilt', steps: [[3, { sx: 45 }], [1, { sx: 45, buttons: 'A' }]], expect: ['AttackS3S'] },
    { name: 'up tilt', steps: [[3, { sy: 40 }], [1, { sy: 40, buttons: 'A' }]], expect: ['AttackHi3'] },
    { name: 'down tilt', steps: [[8, { sy: -60 }], [1, { sy: -60, buttons: 'A' }], [30, { sy: -60 }]], expect: ['AttackLw3'] },
    { name: 'forward smash, charged', steps: [[1, { sx: 127, buttons: 'A' }], [40, { buttons: 'A' }]], expect: ['AttackS4S'] },
    { name: 'up smash', steps: [[1, { cy: 127 }]], expect: ['AttackHi4'] },
    { name: 'down smash', steps: [[1, { cy: -127 }]], expect: ['AttackLw4'] },
    { name: 'dash attack', steps: [[4, { sx: 127 }], [1, { sx: 127, buttons: 'A' }]], expect: ['Dash', 'AttackDash'] },
    { name: 'grab', steps: [[1, { buttons: 'Z' }]], expect: ['Catch'] },
    { name: 'dash grab', steps: [[4, { sx: 127 }], [1, { buttons: 'Z' }]], expect: ['CatchDash'] },
    { name: 'power shield', steps: [[40, { buttons: 'R' }]], expect: ['GuardReflect', 'Guard', 'GuardOff'] },
    { name: 'light shield', steps: [[40, { r: 90 }]], expect: ['GuardOn', 'Guard', 'GuardOff'] },
    { name: 'roll', steps: [[10, { buttons: 'R' }], [1, { buttons: 'R', sx: 127 }]], expect: ['EscapeF'] },
    { name: 'spot dodge', steps: [[10, { buttons: 'R' }], [1, { buttons: 'R', sy: -127 }]], expect: ['EscapeN'] },
    { name: 'taunt', steps: [[1, { buttons: 'U' }]], expect: ['AppealSR'] },
    { name: 'Arwing taunt', steps: [[1, { buttons: 'D' }]], expect: ['SpecialAppealStartR', 'SpecialAppealR', 'SpecialAppealEndR'] },
    { name: 'blaster', steps: [[1, { buttons: 'B' }], [6, {}], [1, { buttons: 'B' }]], expect: ['SpecialNStart', 'SpecialNLoop', 'SpecialNEnd'], lasers: true },
    { name: 'illusion', steps: [[1, { sx: 127, buttons: 'B' }]], expect: ['SpecialSStart', 'SpecialS', 'SpecialSEnd'] },
    { name: 'firefox', steps: [[1, { sy: 127, buttons: 'B' }], [60, { sy: 127 }]], expect: ['SpecialHiHold', 'SpecialAirHi', 'SpecialHiFall', 'FallSpecial'] },
    { name: 'aerial blaster', steps: [[1, { buttons: 'X' }], [8, {}], [1, { buttons: 'B' }]], expect: ['SpecialAirNStart'], lasers: true },
    { name: 'aerial illusion', steps: [[1, { buttons: 'X' }], [8, {}], [1, { sx: 127, buttons: 'B' }]], expect: ['SpecialAirSStart', 'SpecialAirS', 'SpecialAirSEnd'] },
    { name: 'aerial firefox sideways', steps: [[1, { buttons: 'X' }], [8, {}], [1, { sy: 127, buttons: 'B' }], [44, { sx: 127 }]], expect: ['SpecialHiHoldAir', 'SpecialAirHi'], ends: 'CliffWait' },
  ];
  const failures: string[] = [];
  for (const c of cases) {
    const e = newEngine(data);
    for (let i = 0; i < 10; i++) e.step(pad());
    const seen: string[] = [];
    let lasers = 0;
    const record = () => {
      const n = e.fighter.motionName;
      if (seen[seen.length - 1] !== n) seen.push(n);
      lasers += e.events.filter((ev) => ev.type === 'projectile').length;
    };
    try {
      for (const [n, p] of c.steps) for (let i = 0; i < n; i++) { e.step(pad(p)); record(); }
      for (let i = 0; i < 400 && !(e.fighter.motionName === 'Wait' && e.fighter.ga === 0) && e.fighter.motionName !== c.ends; i++) { e.step(pad()); record(); }
    } catch (err) {
      failures.push(`${c.name}: threw ${(err as Error).stack}`);
      continue;
    }
    const missing = c.expect.filter((s) => !seen.includes(s));
    const done = e.fighter.motionName === 'Wait' || e.fighter.motionName === c.ends;
    console.log(`      ${c.name.padEnd(24)} ${seen.join(' > ')}${c.lasers ? `  (${lasers} shots)` : ''}`);
    if (missing.length || !done || (c.lasers && !lasers)) failures.push(`${c.name}: missing ${missing.join(', ') || '-'}, ended in ${e.fighter.motionName}${c.lasers && !lasers ? ', no laser fired' : ''}`);
  }
  assert(!failures.length, failures.join('\n      '));
}

test("engine: every one of Fox's moves starts, plays and returns to standing", (disc) => checkEveryMove(disc, 'fox'), true);
test("engine: every one of Falco's moves starts, plays and returns to standing", (disc) => checkEveryMove(disc, 'falco'), true);

test('engine: Falco is his own character (jumpsquat, jump height, laser sound)', async (disc) => {
  const { foxData, falcoData, newEngine, pad } = await import('./sim');
  const fox = await foxData(disc), falco = await falcoData(disc);
  assert(falco.id === 'falco' && falco.name === 'Falco', `loaded ${falco.id}`);
  const hop = (data: typeof fox) => {
    const e = newEngine(data);
    for (let i = 0; i < 10; i++) e.step(pad());
    let squat = 0, peak = 0;
    for (let i = 0; i < 120; i++) {
      e.step(pad({ buttons: i < 12 ? 'X' : '' }));
      if (e.fighter.motionName === 'KneeBend') squat++;
      peak = Math.max(peak, e.fighter.pos.y);
    }
    return { squat, peak, end: e.fighter.motionName };
  };
  const a = hop(fox), b = hop(falco);
  console.log(`      jumpsquat fox ${a.squat} falco ${b.squat}; full hop peak fox ${a.peak.toFixed(2)} falco ${b.peak.toFixed(2)}`);
  assert(a.squat === fox.attrs.jump_startup_time && b.squat === falco.attrs.jump_startup_time && b.squat > a.squat, 'jumpsquat follows each character');
  assert(b.peak > a.peak + 10, `Falco jumps higher than Fox (${b.peak} vs ${a.peak})`);
  assert(b.end === 'Wait' || b.end === 'Landing', `Falco did not land: ${b.end}`);
  // The shot sound is Falco's own (falcoSFX in ftfoxspecialn.c), from his sound bank.
  const e = newEngine(falco);
  for (let i = 0; i < 10; i++) e.step(pad());
  const sounds: number[] = [];
  e.step(pad({ buttons: 'B' }));
  for (let i = 0; i < 40; i++) { e.step(pad()); for (const ev of e.events) if (ev.type === 'sound') sounds.push(ev.id); }
  assert(sounds.includes(100099) && !sounds.includes(110103), `laser sounds ${sounds.join(', ')}`);
  assert(falco.soundIds.get('falco_falcoLaser') === 100099, 'Falco laser sound imported');
}, true);

test('ledges: catch facing the stage, hang, every getup, let go, time out (Fox and Falco)', async (disc) => {
  const { foxData, falcoData, finalDestination, pad } = await import('./sim');
  const { Engine } = await import('../src/engine/engine');
  type P = Parameters<typeof pad>[0];
  const failures: string[] = [];
  for (const data of [await foxData(disc), await falcoData(disc)]) {
    // Off Final Destination's right edge (ledge at x = 85.57), facing the stage, falling past the ledge.
    const run = (steps: Array<[number, P]>, opts: { facing?: number; percent?: number } = {}) => {
      const e = new Engine(data), st = finalDestination();
      e.setStage(st);
      e.spawn(92, 6, opts.facing ?? -1);
      e.fighter.percent = opts.percent ?? 0;
      const seen: string[] = [];
      let caughtAt: [number, number] | null = null, intangibleHanging = false, jumps = -1;
      for (const [n, p] of steps) for (let i = 0; i < n; i++) {
        e.step(pad(p));
        const fp = e.fighter;
        if (seen[seen.length - 1] !== fp.motionName) seen.push(fp.motionName);
        if (fp.motionName === 'CliffWait') { caughtAt ??= [fp.pos.x, fp.pos.y]; intangibleHanging ||= fp.intangible; jumps = fp.jumpsUsed; }
      }
      return { e, seen, caughtAt, intangibleHanging, jumps };
    };
    const hang: Array<[number, P]> = [[40, {}]];
    const check = (name: string, ok: boolean, r: { seen: string[] }) => { if (!ok) failures.push(`${data.name} ${name}: ${r.seen.join(' > ')}`); };
    const c = run([...hang, [20, {}]]);
    check('catch', c.seen.includes('CliffCatch') && c.seen[c.seen.length - 1] === 'CliffWait' && c.intangibleHanging && c.jumps === 1 &&
      !!c.caughtAt && c.caughtAt[0] > 85.5 && c.caughtAt[1] < 0, c);
    // Tilting toward the stage climbs (a smash up would be a tap jump, which the game checks first).
    const climb = run([...hang, [1, { sx: -80 }], [80, {}]]);
    check('climb', climb.seen.includes('CliffClimbQuick') && climb.e.fighter.motionName === 'Wait' && climb.e.fighter.pos.x < 85.5 && climb.e.fighter.ga === 0, climb);
    const attack = run([...hang, [1, { buttons: 'A' }], [90, {}]]);
    check('attack', attack.seen.includes('CliffAttackQuick') && attack.e.fighter.motionName === 'Wait' && attack.e.fighter.pos.x < 85.5, attack);
    const roll = run([...hang, [1, { buttons: 'R' }], [90, {}]]);
    check('roll', roll.seen.includes('CliffEscapeQuick') && roll.e.fighter.motionName === 'Wait' && roll.e.fighter.pos.x < attack.e.fighter.pos.x, roll);
    const jump = run([...hang, [1, { buttons: 'X' }], [140, {}]]);
    check('jump', jump.seen.includes('CliffJumpQuick1') && jump.seen.includes('CliffJumpQuick2') && jump.e.fighter.motionName === 'Wait', jump);
    const slow = run([...hang, [1, { sx: -80 }], [120, {}]], { percent: 120 });
    check('slow climb over 100%', slow.seen.includes('CliffClimbSlow') && slow.e.fighter.motionName === 'Wait', slow);
    // Pushing away lets go, and the cooldown keeps it from catching again straight away.
    const drop = run([...hang, [3, { sx: 127 }], [5, {}]]);
    check('let go', drop.e.fighter.motionName === 'Fall' && drop.e.fighter.ledgeCooldown > 0, drop);
    const timeout = run([[700, {}]]);
    check('time out', timeout.seen.includes('DamageFall'), timeout);
    const away = run([[40, {}]], { facing: 1 });
    check('facing away never catches', !away.seen.includes('CliffCatch'), away);
    const down = run([[40, { sy: -127 }]]);
    check('holding down never catches', !down.seen.includes('CliffCatch'), down);
    // Firefox catches a ledge facing either way (only on the way down, like every ledge catch): here
    // facing away from the stage, aimed down past the ledge, letting go of the stick once launched
    // (held down, it would let the ledge go by).
    const e = new Engine(data), st = finalDestination();
    e.setStage(st);
    e.spawn(93, 14, 1);
    e.step(pad({ sy: 127, buttons: 'B' }));
    const ff: string[] = [];
    for (let i = 0; i < 90 && !ff.includes('CliffCatch'); i++) {
      e.step(pad(ff.includes('SpecialAirHi') ? {} : { sy: -127 }));
      if (ff[ff.length - 1] !== e.fighter.motionName) ff.push(e.fighter.motionName);
    }
    if (!ff.includes('CliffCatch')) failures.push(`${data.name} firefox to ledge: ${ff.join(' > ')}`);
    console.log(`      ${data.name.padEnd(6)} caught at (${c.caughtAt?.map((v) => v.toFixed(2)).join(', ')}); climb > ${climb.seen.slice(-2).join(' > ')}; firefox ${ff.slice(-2).join(' > ')}`);
  }
  assert(!failures.length, failures.join('\n      '));
}, true);

test("sandbag: Falco's laser makes it flinch, Fox's only adds percent", async (disc) => {
  const { foxData, falcoData, sandbagData, finalDestination, pad } = await import('./sim');
  const { Engine } = await import('../src/engine/engine');
  const { World } = await import('../src/engine/world');
  const sb = await sandbagData(disc);
  const shoot = (data: Awaited<ReturnType<typeof foxData>>) => {
    const w = new World(), st = finalDestination();
    const a = w.add(new Engine(data)), b = w.add(new Engine(sb));
    w.setStage(st);
    a.spawnGrounded(0, st.segments[0], 1);
    b.spawnGrounded(30, st.segments[0], -1);
    for (let i = 0; i < 5; i++) w.step([pad()]);
    w.step([pad({ buttons: 'B' })]);
    const states = new Set<string>();
    for (let i = 0; i < 60; i++) { w.step([pad()]); states.add(b.fighter.motionName); }
    return { percent: b.fighter.percent, flinched: [...states].some((s) => s.startsWith('Damage')) };
  };
  const fox = shoot(await foxData(disc)), falco = shoot(await falcoData(disc));
  console.log(`      fox laser ${fox.percent}% flinch ${fox.flinched}; falco laser ${falco.percent}% flinch ${falco.flinched}`);
  assert(fox.percent > 0 && !fox.flinched, "Fox's laser should add percent without flinching");
  assert(falco.percent > 0 && falco.flinched, "Falco's laser should add percent and flinch");
}, true);

test('validation: web engine matches the real game frame by frame (tests/expected)', async (disc) => {
  const { expectedTraces, readTrace, compareTrace, compareWorldTrace, hasSandbag } = await import('./validate');
  const { foxData, sandbagData } = await import('./sim');
  const traces = expectedTraces();
  if (!traces.length) { console.log('      no reference traces: run tests/validation/run_reference.py'); return; }
  const data = await foxData(disc);
  const sb = await sandbagData(disc);
  const failures: string[] = [];
  for (const t of traces) {
    const rows = readTrace(t.path);
    const r = hasSandbag(rows) ? compareWorldTrace(t.name, rows, data, sb) : compareTrace(t.name, rows, data);
    if (r.mismatches.length) {
      const m = r.mismatches[0];
      failures.push(`${t.name}: first mismatch at retrace ${m.retrace} in ${m.field} (game ${m.expected}, web ${m.actual})\n        ${m.context.join('\n        ')}`);
      console.log(`      ${t.name.padEnd(12)} MISMATCH after ${r.frames} frames`);
    } else console.log(`      ${t.name.padEnd(12)} ok, ${r.frames} frames`);
  }
  assert(!failures.length, failures.join('\n      '));
}, true);

/** A DirHandle over a real folder, standing in for the File System Access API. */
function nodeDir(path: string): DirHandle {
  const name = path.split(/[\/]/).pop()!;
  return {
    name,
    async getDirectoryHandle(n, opts) {
      const p = join(path, n);
      if (opts?.create) await mkdir(p, { recursive: true });
      else if (!(await stat(p)).isDirectory()) throw new Error('not a folder');
      return nodeDir(p);
    },
    async getFileHandle(n, opts) {
      const p = join(path, n);
      if (!opts?.create) await stat(p);
      return {
        getFile: async () => new Blob([await readFile(p)]),
        createWritable: async () => {
          let data = new Uint8Array();
          return { write: async (d) => { data = d; }, close: async () => writeFile(p, data) };
        },
      };
    },
  };
}

test('updater: version order, folder checks, and writing a release over an install', async () => {
  assert(compareVersions('v0.10.0', '0.9.9') > 0 && compareVersions('0.2', '0.2.0') === 0 && compareVersions('0.1.0', 'v0.2.0') < 0, 'version order');
  const tmp = mkdtempSync(join(tmpdir(), 'mwf-update-'));
  try {
    const NAME = 'Melee Web Fighter';
    const manifest = (version: string) => JSON.stringify({ name: NAME, version });
    // An install as unzipped: extension/ + helper/.
    const root = join(tmp, 'melee-web-fighter');
    mkdirSync(join(root, 'extension'), { recursive: true });
    mkdirSync(join(root, 'helper'));
    writeFileSync(join(root, 'extension/manifest.json'), manifest('0.2.0'));
    writeFileSync(join(root, 'extension/options.js'), 'old');
    writeFileSync(join(root, 'helper/install.ps1'), 'old');

    const folder = await checkFolder(nodeDir(root), NAME, '0.2.0');
    assert(folder.kind === 'root', 'root folder recognised');
    assert((await checkFolder(nodeDir(join(root, 'extension')), NAME, '0.2.0')).kind === 'extension', 'extension folder recognised');
    const rejects = async (dir: string, version: string, what: string) => {
      let threw = false;
      try { await checkFolder(nodeDir(dir), NAME, version); } catch { threw = true; }
      assert(threw, what);
    };
    await rejects(root, '0.1.0', 'a copy at another version is refused');
    await rejects(join(root, 'helper'), '0.2.0', 'a folder without the extension is refused');
    mkdirSync(join(tmp, 'clone/.git'), { recursive: true });
    mkdirSync(join(tmp, 'clone/extension'));
    writeFileSync(join(tmp, 'clone/extension/manifest.json'), manifest('0.2.0'));
    await rejects(join(tmp, 'clone'), '0.2.0', 'a git checkout is refused');

    const zip = writeZip([
      { path: 'melee-web-fighter/README.md', data: 'readme' },
      { path: 'melee-web-fighter/extension/manifest.json', data: manifest('0.3.0') },
      { path: 'melee-web-fighter/extension/options.js', data: 'new' },
      { path: 'melee-web-fighter/extension/icons/new.png', data: new Uint8Array([1, 2, 3]) },
      { path: 'melee-web-fighter/helper/install.ps1', data: 'new' },
    ]);
    let threw = false;
    try { await unpackRelease(zip, '0.4.0'); } catch { threw = true; }
    assert(threw, 'a zip at the wrong version is refused');
    const files = await unpackRelease(zip, '0.3.0');
    assert(files.length === 5 && files.every((f) => !f.path.startsWith('melee-web-fighter/')), 'top folder dropped');

    await writeRelease(folder, files);
    const read = (p: string) => readFileSync(join(root, p), 'utf8');
    assert(JSON.parse(read('extension/manifest.json')).version === '0.3.0', 'manifest updated');
    assert(read('extension/options.js') === 'new' && read('helper/install.ps1') === 'new' && read('README.md') === 'readme', 'files updated');
    assert(readFileSync(join(root, 'extension/icons/new.png')).length === 3, 'new folders created');

    // Picking extension/ itself updates only the extension.
    const ext = await checkFolder(nodeDir(join(root, 'extension')), NAME, '0.3.0');
    assert(await writeRelease(ext, files) === 3, 'extension folder gets only extension files');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('sandbag: hits add percent, "no damage" keeps 0% and knocks back as at 0%, a KO respawns at 0%', async (disc) => {
  const { foxData, sandbagData, finalDestination, pad } = await import('./sim');
  const { Engine } = await import('../src/engine/engine');
  const { World } = await import('../src/engine/world');
  const fox = await foxData(disc), sb = await sandbagData(disc);
  // Fox up close to a standing Sandbag, jabbing until the first hit lands.
  const setup = (noDamage: boolean) => {
    const w = new World(), st = finalDestination();
    const a = w.add(new Engine(fox)), b = w.add(new Engine(sb));
    w.setStage(st);
    a.spawnGrounded(0, st.segments[0], 1);
    b.spawnGrounded(9, st.segments[0], -1);
    b.noDamage = noDamage;
    for (let i = 0; i < 5; i++) w.step([pad()]);
    return { w, a, b };
  };
  const jab = (s: ReturnType<typeof setup>) => {
    s.w.step([pad({ buttons: 'A' })]);
    for (let i = 0; i < 12 && !s.b.fighter.hitlag; i++) s.w.step([pad()]);
    return { percent: s.b.fighter.percent, kb: Math.hypot(s.b.fighter.kbVel.x, s.b.fighter.kbVel.y) };
  };
  const dmg = setup(false), first = jab(dmg);
  assert(first.percent > 3.9 && first.percent < 4.1, `jab percent ${first.percent}`);
  const off = setup(true), noDmg = jab(off);
  assert(noDmg.percent === 0, `no-damage percent ${noDmg.percent}`);
  assert(Math.abs(noDmg.kb - first.kb) < 1e-6, `no-damage knockback ${noDmg.kb} vs ${first.kb}`);
  // Out of its KO bounds: back at the respawn point, at 0%, falling.
  dmg.w.respawn = (e) => (e === dmg.b ? [dmg.a.fighter.pos.x + 22, 20] : [0, 20]);
  dmg.b.blast = [-50, 50, -50, 50];
  dmg.b.fighter.pos.x = 80;
  dmg.w.step([pad()]);
  const f = dmg.b.fighter;
  console.log(`      after KO: ${f.motionName} at (${f.pos.x.toFixed(1)}, ${f.pos.y.toFixed(1)}), ${f.percent}%`);
  assert(f.percent === 0 && Math.abs(f.pos.x - (dmg.a.fighter.pos.x + 22)) < 1 && f.motionName === 'Fall', 'respawn');
}, true);

test("side special: the dash's afterimage item carries the hit (Fox's Illusion, Falco's Phantasm)", async (disc) => {
  const { foxData, falcoData, sandbagData, finalDestination, pad } = await import('./sim');
  const { Engine } = await import('../src/engine/engine');
  const { World } = await import('../src/engine/world');
  type P = Parameters<typeof pad>[0];
  const sb = await sandbagData(disc);
  const hop: Array<[number, P]> = [[1, { buttons: 'X' }], [4, {}]];
  // Ground, air against a standing Sandbag, and air against Sandbag in the air beside the fighter.
  const dash = (data: Awaited<ReturnType<typeof foxData>>, pre: Array<[number, P]>, sbAir: boolean) => {
    const w = new World(), st = finalDestination();
    const a = w.add(new Engine(data)), b = w.add(new Engine(sb));
    w.setStage(st);
    a.spawnGrounded(0, st.segments[0], 1);
    b.spawnGrounded(30, st.segments[0], -1);
    for (let i = 0; i < 5; i++) w.step([pad()]);
    for (const [n, p] of pre) for (let i = 0; i < n; i++) w.step([pad(p)]);
    if (sbAir) b.spawn(a.fighter.pos.x + 25, a.fighter.pos.y + 4, -1);
    let hitlag = false, maxItems = 0, itemsAfter = 0, angle = -1, kbY = 0;
    for (const [n, p] of [[1, { sx: 127, buttons: 'B' }], [80, {}]] as Array<[number, P]>) for (let i = 0; i < n; i++) {
      const before = b.fighter.percent;
      w.step([pad(p)]);
      hitlag ||= a.fighter.hitlag > 0;
      maxItems = Math.max(maxItems, a.afterimages.length);
      if (angle < 0 && b.fighter.percent !== before) { angle = b.fighter.kbAngle; kbY = b.fighter.kbVel.y; }
      if (a.fighter.motionId < 347 || a.fighter.motionId > 352) itemsAfter = Math.max(itemsAfter, a.afterimages.length);
    }
    return { percent: b.fighter.percent, angle, kbY, hitlag, maxItems, itemsAfter };
  };
  // Angles from the ground and in the air, from each one's afterimage item on the disc.
  const expect: Array<[Awaited<ReturnType<typeof foxData>>, number, number]> = [[await foxData(disc), 80, 80], [await falcoData(disc), 65, 270]];
  for (const [data, groundAngle, airAngle] of expect) {
    const art = data.illusion;
    assert(!!art && art.states.length === 3, `${data.name}: afterimage item imported`);
    const cases = { ground: dash(data, [], false), air: dash(data, hop, false), 'air vs air': dash(data, hop, true) };
    console.log(`      ${data.name.padEnd(6)} scale ${art!.scale}; ` + Object.entries(cases).map(([k, r]) => `${k} ${r.percent}% ${r.angle}° kb y ${r.kbY.toFixed(2)}`).join('; '));
    for (const [name, r] of Object.entries(cases)) {
      assert(r.percent === 7, `${data.name} ${name}: should deal 7%, dealt ${r.percent}`);
      assert(r.angle === (name === 'ground' ? groundAngle : airAngle), `${data.name} ${name}: angle ${r.angle}`);
      assert(!r.hitlag, `${data.name} ${name}: the item's hit gives the attacker no hitlag`);
      assert(r.maxItems === 1 && r.itemsAfter === 0, `${data.name} ${name}: one afterimage, gone after the move`);
    }
    // Falco's aerial Phantasm spikes an airborne opponent; a grounded one bounces off the floor.
    if (airAngle === 270) assert(cases['air vs air'].kbY < 0 && cases.air.kbY > 0, `${data.name}: spike ${cases['air vs air'].kbY}, bounce ${cases.air.kbY}`);
  }
}, true);
