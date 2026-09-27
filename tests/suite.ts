// Test cases. Each either needs the user's disc (read via tests/run.ts) or runs on its own.
import type { Disc } from '../src/importer/disc';
import { Archive } from '../src/importer/hsd';
import { readActionTable } from '../src/importer/actions';
import { scriptBody } from '../src/importer/moves-convert';
import { encodeMove, formatMove, parseMove, type Cmd } from '../src/shared/move';

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

test("engine: every one of Fox's moves starts, plays and returns to standing", async (disc) => {
  const { foxData, newEngine, pad } = await import('./sim');
  const data = await foxData(disc);
  type P = Parameters<typeof pad>[0];
  // Each case: a list of [frames, pad] steps, then idle; the states it must pass through.
  const cases: Array<{ name: string; steps: Array<[number, P]>; expect: string[]; lasers?: boolean }> = [
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
    { name: 'aerial firefox sideways', steps: [[1, { buttons: 'X' }], [8, {}], [1, { sy: 127, buttons: 'B' }], [44, { sx: 127 }]], expect: ['SpecialHiHoldAir', 'SpecialAirHi'] },
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
      for (let i = 0; i < 400 && !(e.fighter.motionName === 'Wait' && e.fighter.ga === 0); i++) { e.step(pad()); record(); }
    } catch (err) {
      failures.push(`${c.name}: threw ${(err as Error).stack}`);
      continue;
    }
    const missing = c.expect.filter((s) => !seen.includes(s));
    const done = e.fighter.motionName === 'Wait';
    console.log(`      ${c.name.padEnd(24)} ${seen.join(' > ')}${c.lasers ? `  (${lasers} shots)` : ''}`);
    if (missing.length || !done || (c.lasers && !lasers)) failures.push(`${c.name}: missing ${missing.join(', ') || '-'}, ended in ${e.fighter.motionName}${c.lasers && !lasers ? ', no laser fired' : ''}`);
  }
  assert(!failures.length, failures.join('\n      '));
}, true);

test('validation: web engine matches the real game frame by frame (tests/expected)', async (disc) => {
  const { expectedTraces, readTrace, compareTrace } = await import('./validate');
  const { foxData } = await import('./sim');
  const traces = expectedTraces();
  if (!traces.length) { console.log('      no reference traces: run tests/validation/run_reference.py'); return; }
  const data = await foxData(disc);
  const failures: string[] = [];
  for (const t of traces) {
    const r = compareTrace(t.name, readTrace(t.path), data);
    if (r.mismatches.length) {
      const m = r.mismatches[0];
      failures.push(`${t.name}: first mismatch at retrace ${m.retrace} in ${m.field} (game ${m.expected}, web ${m.actual})\n        ${m.context.join('\n        ')}`);
      console.log(`      ${t.name.padEnd(12)} MISMATCH after ${r.frames} frames`);
    } else console.log(`      ${t.name.padEnd(12)} ok, ${r.frames} frames`);
  }
  assert(!failures.length, failures.join('\n      '));
}, true);
