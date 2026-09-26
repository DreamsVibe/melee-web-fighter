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
