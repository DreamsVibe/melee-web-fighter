// The import pipeline: disc → Fox's source files → converted character folder in IndexedDB.
// Only converted files are stored; the disc's own files are dropped once converted.
import { Disc } from './disc';
import { Archive } from './hsd';
import { extractModel } from './model';
import { replaceImported, FORMAT_VERSION, META_PATH, type FileData } from '../shared/db';
import { writeMesh, writeSkeleton, writeTexture, type MaterialDef } from '../shared/modelfile';
import { writeAnim } from '../shared/animfile';
import { readActionTable, readFigatree, type ActionEntry } from './actions';
import { convertSounds } from './sounds-convert';
import { convertMoves } from './moves-convert';
import { readAttributes, readCommon, readExtras } from './data-convert';

export type Progress = (fraction: number, text: string) => void;
export type Log = (line: string) => void;
export type OutFile = { path: string; data: FileData };

export const CHAR_DIR = 'characters/fox/';
export const COMMON_DIR = 'common/';

/** Disc files Fox needs. Sound banks are English (NTSC default language). */
export const SOURCE_FILES = [
  'PlFx.dat', 'PlFxNr.dat', 'PlFxAJ.dat', 'PlCo.dat',
  'audio/us/smash2.sem', 'audio/us/main.ssm', 'audio/us/fox.ssm',
] as const;
export type Sources = Map<(typeof SOURCE_FILES)[number], Uint8Array>;

export async function extractSources(disc: Disc, progress: Progress, log: Log): Promise<Sources> {
  const out: Sources = new Map();
  let i = 0;
  for (const path of SOURCE_FILES) {
    progress(0.02 + 0.2 * (i++ / SOURCE_FILES.length), `Reading ${path}…`);
    const data = await disc.readFile(path);
    out.set(path, data);
    log(`read ${path} (${(data.length / 1024).toFixed(0)} KB)`);
  }
  return out;
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

/** DObjs shown by default: the high-detail lookup of the fighter's part-visibility table. */
function hiddenParts(plfx: Archive): number[] {
  const root = plfx.rootEndingWith('ftDataFox')[1];
  const x8 = plfx.ptr(root + 8);
  const table = plfx.ptr(x8 + 4);
  const models = plfx.u32(x8);
  const collect = (lookupIdx: number): Set<number> => {
    const s = new Set<number>();
    if (!plfx.isPtr(table + 4 * lookupIdx)) return s;
    const lk = plfx.ptr(table + 4 * lookupIdx);
    for (let i = 0; i < models; i++) {
      const cnt = plfx.u32(lk + 8 * i), arr = plfx.ptr(lk + 8 * i + 4);
      for (let j = 0; j < cnt; j++) {
        const c = plfx.u32(arr + 8 * j), p = plfx.ptr(arr + 8 * j + 4);
        for (let k = 0; k < c; k++) s.add(plfx.u8(p + k));
      }
    }
    return s;
  };
  const high = collect(0), low = collect(1);
  return [...low].filter((d) => !high.has(d)).sort((a, b) => a - b);
}

export function convertModel(sources: Sources, log: Log): OutFile[] {
  const nr = new Archive(sources.get('PlFxNr.dat')!);
  const m = extractModel(nr);
  const files: OutFile[] = [];
  files.push({ path: CHAR_DIR + 'model/skeleton.skel', data: writeSkeleton(m.joints.map((j) => ({ ...j, inverseBind: j.inverseBind ? new Float32Array(j.inverseBind) : null }))) });
  files.push({
    path: CHAR_DIR + 'model/mesh.mesh',
    data: writeMesh({
      vertices: new Float32Array(m.vertices), bones: new Uint8Array(m.bones), weights: new Uint8Array(m.weights),
      indices: m.vertices.length / 8 > 65535 ? new Uint32Array(m.indices) : new Uint16Array(m.indices), batches: m.batches,
    }),
  });
  const materials: MaterialDef[] = m.materials.map((mt) => ({
    diffuse: mt.diffuse, ambient: mt.ambient, texture: mt.texture >= 0 ? `textures/tex${String(mt.texture).padStart(2, '0')}.tex` : null,
    uvScale: mt.uvScale, wrap: mt.wrap, translucent: mt.translucent, alpha: mt.alpha, dobj: mt.dobj, joint: mt.joint,
  }));
  files.push({ path: CHAR_DIR + 'model/materials.json', data: json(materials) });
  m.textures.forEach((t, i) => files.push({ path: CHAR_DIR + `textures/tex${String(i).padStart(2, '0')}.tex`, data: writeTexture(t) }));
  log(`model: ${m.joints.length} joints, ${m.vertices.length / 8} vertices, ${m.indices.length / 3} triangles, ${m.textures.length} textures`);
  return files;
}

export function convertAnims(sources: Sources, actions: ActionEntry[], log: Log): OutFile[] {
  const aj = sources.get('PlFxAJ.dat')!;
  const done = new Set<string>();
  const files: OutFile[] = [];
  for (const a of actions) {
    if (!a.anim || !a.ajSize || done.has(a.anim)) continue;
    done.add(a.anim);
    files.push({ path: CHAR_DIR + `anims/${a.anim}.anim`, data: writeAnim(readFigatree(aj, a.ajOffset, a.ajSize)) });
  }
  log(`animations: ${files.length}`);
  return files;
}

/** Converts the disc into the character folder files (no storage). */
export async function buildFolder(disc: Disc, progress: Progress, log: Log): Promise<OutFile[]> {
  const sources = await extractSources(disc, progress, log);
  progress(0.25, 'Converting the model…');
  const plfx = new Archive(sources.get('PlFx.dat')!);
  const actions = readActionTable(plfx);
  const files: OutFile[] = [...convertModel(sources, log)];
  progress(0.45, 'Converting animations…');
  files.push(...convertAnims(sources, actions, log));
  progress(0.65, 'Converting sounds…');
  const sounds = convertSounds(sources, plfx, actions, CHAR_DIR, COMMON_DIR, log);
  files.push(...sounds.files);
  progress(0.8, 'Converting moves and attributes…');
  const { attributes, special } = readAttributes(plfx);
  files.push({ path: CHAR_DIR + 'attributes.json', data: json({ ...attributes, special }) });
  const plco = new Archive(sources.get('PlCo.dat')!);
  files.push({ path: COMMON_DIR + 'common.json', data: json(readCommon(plco)) });
  const extras = readExtras(plfx, plco);
  const soundNames = new Map<number, string>();
  for (const f of sounds.files) if (f.path.endsWith('sounds.json')) for (const [id, d] of Object.entries(JSON.parse(f.data as string))) soundNames.set(Number(id), (d as { name: string }).name);
  const moves = convertMoves(plfx, actions, attributes, (id) => soundNames.get(id) ?? String(id));
  for (const m of moves) files.push({ path: CHAR_DIR + `moves/${m.name}.move`, data: m.text });
  log(`moves: ${moves.length} scripts`);
  const attrs = plfx.ptr(plfx.rootEndingWith('ftDataFox')[1]);
  const character = {
    name: 'Fox',
    id: 'fox',
    formatVersion: FORMAT_VERSION,
    modelScale: plfx.f32(attrs + 0x8c),
    hiddenParts: hiddenParts(plfx),
    costumes: ['default'],
    sounds: sounds.ftSfx,
    moves: moves.map((m) => m.name),
    // ECB bones and side offset (ftData +0x44), TransN joint (root motion).
    ecb: (() => { const x44 = plfx.ptr(plfx.rootEndingWith('ftDataFox')[1] + 0x44); return { bones: [0, 1, 2, 3, 4, 5].map((i) => plfx.s16(x44 + 2 * i)), sideOffset: plfx.f32(x44 + 12) }; })(),
    transN: extras.parts[1],
    // Fighter_Part -> joint index (TopN, TransN, XRotN, ... TransN2).
    parts: extras.parts,
    shieldJoint: extras.shieldJoint,
    itemJoint: extras.itemJoint,
    articles: { laser: { lifetime: extras.laserLifetime, scale: extras.laserScale } },
  };
  files.push({ path: CHAR_DIR + 'character.json', data: json(character) });
  files.push({ path: META_PATH, data: JSON.stringify({ formatVersion: FORMAT_VERSION, importedAt: new Date().toISOString(), disc: `${disc.gameId} rev ${disc.revision}` }) });
  return files;
}

export async function runImport(disc: Disc, progress: Progress, log: Log): Promise<{ files: number; bytes: number }> {
  const files = await buildFolder(disc, progress, log);
  progress(0.9, 'Storing the character folder…');
  // Re-import replaces imported data; overrides/ is never touched.
  await replaceImported(files);
  const bytes = files.reduce((s, f) => s + (typeof f.data === 'string' ? f.data.length : f.data.length), 0);
  return { files: files.length, bytes };
}
