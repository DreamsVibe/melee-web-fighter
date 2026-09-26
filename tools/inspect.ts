// Dev tool: runs the importer's parsers on extracted disc files in Node and prints what they found.
//   npx esbuild tools/inspect.ts --bundle --platform=node --format=esm --outfile=<tmp>/inspect.mjs
//   node <tmp>/inspect.mjs <dir with PlFx.dat, PlFxNr.dat, ...> [what]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Archive } from '../src/importer/hsd';
import { extractModel } from '../src/importer/model';

const dir = process.argv[2];
const what = process.argv[3] ?? 'model';
const load = (n: string) => new Uint8Array(readFileSync(join(dir, n)));

if (what === 'model') {
  const a = new Archive(load('PlFxNr.dat'));
  const m = extractModel(a);
  console.log('joints', m.joints.length, 'vertices', m.vertices.length / 8, 'indices', m.indices.length, 'batches', m.batches.length, 'materials', m.materials.length, 'textures', m.textures.length);
  m.joints.forEach((j, i) => console.log(i, 'parent', j.parent, 'flags', j.flags.toString(16), 'pos', j.position.map((v) => v.toFixed(2)).join(','), 'ib', !!j.inverseBind));
  m.materials.forEach((mt, i) => console.log('mat', i, 'joint', mt.joint, 'dobj', mt.dobj, 'tex', mt.texture, 'diff', mt.diffuse.map((v) => v.toFixed(2)).join(','), 'rm', mt.renderMode.toString(16), 'tf', mt.texFlags.toString(16), 'uvs', mt.uvScale.join('x'), 'tris', m.batches.filter((b) => b.material === i).reduce((s, b) => s + b.count / 3, 0)));
  m.textures.forEach((t, i) => console.log('tex', i, t.width, t.height, t.kind, t.data.length));
}

if (what === 'anim') {
  const { readActionTable, readFigatree } = await import('../src/importer/actions');
  const { applyAnim } = await import('../src/render/animator');
  const plfx = new Archive(load('PlFx.dat'));
  const acts = readActionTable(plfx);
  console.log('actions', acts.length, acts.filter((a) => a.anim).length, 'with anims');
  const wait = acts.find((a) => a.anim === (process.argv[4] ?? 'Wait1'))!;
  const anim = readFigatree(load('PlFxAJ.dat'), wait.ajOffset, wait.ajSize);
  console.log('anim', wait.anim, 'frames', anim.frameCount, 'joints', anim.tracks.length, 'tracks', anim.tracks.reduce((s, t) => s + t.length, 0));
  for (const f of [0, 1, 10, 30]) {
    const local = new Float32Array(anim.tracks.length * 9);
    applyAnim(anim, f, local);
    console.log('frame', f, 'j1', Array.from(local.subarray(9, 18)).map((v) => v.toFixed(3)).join(','), 'j2', Array.from(local.subarray(18, 27)).map((v) => v.toFixed(3)).join(','));
  }
}

if (what === 'tracks') {
  const { readActionTable, readFigatree } = await import('../src/importer/actions');
  const { sampleTrack } = await import('../src/render/fobj');
  const plfx = new Archive(load('PlFx.dat'));
  const act = readActionTable(plfx).find((a) => a.anim === (process.argv[4] ?? 'Wait1'))!;
  const anim = readFigatree(load('PlFxAJ.dat'), act.ajOffset, act.ajSize);
  anim.tracks.forEach((ts, j) => ts.forEach((t) => console.log('j', j, 'ch', t.channel, 'fmt', t.valueFormat.toString(16), t.slopeFormat.toString(16), 'start', t.startFrame, 'len', t.bytes.length,
    [0, 5, 20, 60].map((f) => sampleTrack(t, f)?.toFixed(3)).join(' '))));
}

if (what === 'sounds') {
  const { readActionTable } = await import('../src/importer/actions');
  const { reachableScripts, soundIds } = await import('../src/importer/subaction');
  const { readSem, readSsm, soundSteps, writeSnd } = await import('../src/importer/sound');
  const { readSnd, decodeChannel } = await import('../src/shared/snd');
  const plfx = new Archive(load('PlFx.dat'));
  const ids = new Map<number, string[]>();
  for (const act of readActionTable(plfx)) {
    if (!act.script) continue;
    for (const cmds of reachableScripts(plfx, act.script).values()) for (const c of cmds) for (const id of soundIds(c)) {
      if (!ids.has(id)) ids.set(id, []);
      ids.get(id)!.push(act.anim || String(act.index));
    }
  }
  const sem = readSem(load('audio_us_smash2.sem'));
  const banks = [readSsm(load('audio_us_main.ssm')), readSsm(load('audio_us_fox.ssm'))];
  for (const [id, users] of [...ids].sort((a, b) => a[0] - b[0])) {
    const steps = soundSteps(sem, id);
    const s = steps[0];
    const bank = s ? banks.find((b) => s.fid >= b.firstFid && s.fid < b.firstFid + b.entries.length) : undefined;
    let stats = '';
    if (s && bank) {
      const snd = readSnd(writeSnd(bank, bank.entries[s.fid - bank.firstFid]));
      const pcm = decodeChannel(snd.channels[0]);
      let peak = 0, sum = 0; for (const v of pcm) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
      stats = `rate ${snd.sampleRate} len ${(pcm.length / snd.sampleRate).toFixed(2)}s peak ${peak.toFixed(2)} rms ${Math.sqrt(sum / pcm.length).toFixed(3)}`;
    }
    console.log(id, 'steps', steps.map((t) => `${t.fid}@${t.delayMs}v${t.volume}p${t.pitchCents}`).join(' '), bank ? (bank.firstFid ? 'fox' : 'main') : 'MISSING', stats, users.slice(0, 4).join(','));
  }
}

if (what === 'script') {
  const { readActionTable } = await import('../src/importer/actions');
  const { reachableScripts } = await import('../src/importer/subaction');
  const plfx = new Archive(load('PlFx.dat'));
  for (const name of process.argv.slice(4)) {
    const act = readActionTable(plfx).find((a) => a.anim === name || String(a.index) === name)!;
    console.log('==', name, 'index', act.index, 'flags', act.flags.toString(16));
    for (const [off, cmds] of reachableScripts(plfx, act.script)) {
      console.log(' @' + off.toString(16));
      for (const c of cmds) console.log('   op', c.op, c.words.map((w) => w.toString(16).padStart(8, '0')).join(' '));
    }
  }
}

if (what === 'move') {
  const { readActionTable } = await import('../src/importer/actions');
  const { convertMoves } = await import('../src/importer/moves-convert');
  const plfx = new Archive(load('PlFx.dat'));
  const moves = convertMoves(plfx, readActionTable(plfx), { landingairn_lag: 15 }, (id) => String(id));
  for (const n of process.argv.slice(4)) console.log(moves.find((m) => m.name === n)?.text);
}
