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
