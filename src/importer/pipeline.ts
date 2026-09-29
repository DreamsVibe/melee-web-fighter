// The import pipeline: disc → each character's source files → converted character folders in
// IndexedDB. Only converted files are stored; the disc's own files are dropped once converted.
import { Disc } from './disc';
import { Archive } from './hsd';
import { extractModel } from './model';
import { replaceImported, FORMAT_VERSION, META_PATH, type FileData } from '../shared/db';
import { writeMesh, writeSkeleton, writeTexture, type MaterialDef } from '../shared/modelfile';
import { writeAnim } from '../shared/animfile';
import { ftDataRoot, readActionTable, readFigatree, type ActionEntry } from './actions';
import { convertSounds } from './sounds-convert';
import { convertMoves, FOX_BEHAVIORS } from './moves-convert';
import { readAttributes, readCommon, readExtras, readHurtboxes, readLaser, tidy } from './data-convert';
import { FOX_SUBMOTIONS, SANDBAG_SUBMOTIONS } from './submotions';
import { FOX_SPECIAL_FIELDS, SANDBAG_SPECIAL_FIELDS, type Field } from '../shared/attributes';

export type Progress = (fraction: number, text: string) => void;
export type Log = (line: string) => void;
export type OutFile = { path: string; data: FileData };

export const COMMON_DIR = 'common/';

/**
 * A character the importer converts. Its files are Pl<code>.dat (ftData), Pl<code>Nr.dat (model) and
 * Pl<code>AJ.dat (animations); `kind` is its Ft_Kind, which indexes PlCo.dat's per-character tables.
 */
export interface CharacterSpec {
  id: string;
  name: string;
  code: string;
  kind: number;
  /** Its own action names after the common ones (ftXx_Submotion). */
  submotions: readonly string[];
  /** Its special attributes (ext_attr), when the engine uses them. */
  specialFields: Field[];
  /** Moves run by a behavior module (see engine/behaviors). */
  behaviors: Array<[RegExp, string]>;
  /** Its own sound bank (sound ids bank*10000 + n), if it has one. */
  bank?: { file: string; index: number };
  /** Fox's and Falco's blaster shot (article 0). */
  laser?: boolean;
  /** Joint constraints the character's code attaches to its model (HSD RObj). */
  constraints?: ConstraintDef[];
}

/**
 * An HSD RObj constraint on a joint: its world position is the average of `position` joints', or its
 * X axis points at the `aim` joint (world up (0, 1, 0)), and then its local X rotation is clamped.
 */
export interface ConstraintDef { joint: number; position?: number[]; aim?: number; rotXMin?: number; rotXMax?: number }

export const FOX: CharacterSpec = {
  id: 'fox', name: 'Fox', code: 'Fx', kind: 1, submotions: FOX_SUBMOTIONS, specialFields: FOX_SPECIAL_FIELDS,
  behaviors: FOX_BEHAVIORS, bank: { file: 'audio/us/fox.ssm', index: 11 }, laser: true,
};
/**
 * Falco runs on Fox's code: ftFc_Init_MotionStateTable points at the ftFx functions, with the same
 * action names and the same special-attribute layout (ftFox_DatAttrs). His values, animations, laser
 * article and sound bank are his own.
 */
export const FALCO: CharacterSpec = {
  id: 'falco', name: 'Falco', code: 'Fc', kind: 0x16, submotions: FOX_SUBMOTIONS, specialFields: FOX_SPECIAL_FIELDS,
  behaviors: FOX_BEHAVIORS, bank: { file: 'audio/us/falco.ssm', index: 10 }, laser: true,
};
export const SANDBAG: CharacterSpec = {
  id: 'sandbag', name: 'Sandbag', code: 'Sb', kind: 0x20, submotions: SANDBAG_SUBMOTIONS,
  specialFields: SANDBAG_SPECIAL_FIELDS, behaviors: [],
  // ftSb_Init_8014FA30 sets these up in code, not data: the bag's middle (WaistN, joint 5) sits
  // between joints 12 and 17, and joints 6 and 7 point at joints 5 and 37 with their X rotation held.
  constraints: [
    { joint: 5, position: [12, 17] },
    { joint: 6, aim: 5, rotXMin: -86 * Math.PI / 180, rotXMax: -86 * Math.PI / 180 },
    { joint: 7, aim: 37, rotXMin: -Math.PI / 2, rotXMax: -Math.PI / 2 },
  ],
};
export const CHARACTERS = [FOX, FALCO, SANDBAG];
/** The characters a player can pick. */
export const PLAYABLE = [FOX, FALCO];
export const charDir = (c: CharacterSpec) => `characters/${c.id}/`;
export const CHAR_DIR = charDir(FOX);

/** Disc files the characters need. Sound banks are English (NTSC default language). */
export const SOURCE_FILES = [
  ...CHARACTERS.flatMap((c) => [`Pl${c.code}.dat`, `Pl${c.code}Nr.dat`, `Pl${c.code}AJ.dat`]), 'PlCo.dat',
  'audio/us/smash2.sem', 'audio/us/main.ssm', ...CHARACTERS.flatMap((c) => (c.bank ? [c.bank.file] : [])),
];
export type Sources = Map<string, Uint8Array>;

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
  const root = ftDataRoot(plfx);
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

export function convertModel(sources: Sources, spec: CharacterSpec, log: Log): OutFile[] {
  const CHAR_DIR = charDir(spec);
  const nr = new Archive(sources.get(`Pl${spec.code}Nr.dat`)!);
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
  log(`${spec.name} model: ${m.joints.length} joints, ${m.vertices.length / 8} vertices, ${m.indices.length / 3} triangles, ${m.textures.length} textures`);
  return files;
}

export function convertAnims(sources: Sources, spec: CharacterSpec, actions: ActionEntry[], log: Log): OutFile[] {
  const CHAR_DIR = charDir(spec);
  const aj = sources.get(`Pl${spec.code}AJ.dat`)!;
  const done = new Set<string>();
  const files: OutFile[] = [];
  for (const a of actions) {
    if (!a.anim || !a.ajSize || done.has(a.anim)) continue;
    done.add(a.anim);
    files.push({ path: CHAR_DIR + `anims/${a.anim}.anim`, data: writeAnim(readFigatree(aj, a.ajOffset, a.ajSize)) });
  }
  log(`${spec.name} animations: ${files.length}`);
  return files;
}

/** Converts the disc into the character folder files (no storage). */
export async function buildFolder(disc: Disc, progress: Progress, log: Log): Promise<OutFile[]> {
  const sources = await extractSources(disc, progress, log);
  const plco = new Archive(sources.get('PlCo.dat')!);
  const chars = CHARACTERS.map((spec) => {
    const archive = new Archive(sources.get(`Pl${spec.code}.dat`)!);
    return { spec, archive, actions: readActionTable(archive) };
  });
  const files: OutFile[] = [];
  chars.forEach(({ spec, actions }, i) => {
    progress(0.25 + 0.35 * (i / chars.length), `Converting ${spec.name}'s model and animations…`);
    files.push(...convertModel(sources, spec, log), ...convertAnims(sources, spec, actions, log));
  });
  progress(0.65, 'Converting sounds…');
  const sounds = convertSounds(sources, chars.map(({ spec, archive, actions }) => ({ id: spec.id, archive, actions, dir: charDir(spec), bank: spec.bank })), COMMON_DIR, log);
  files.push(...sounds.files);
  progress(0.8, 'Converting moves and attributes…');
  files.push({ path: COMMON_DIR + 'common.json', data: json(readCommon(plco)) });
  const soundNames = new Map<number, string>();
  for (const f of sounds.files) if (f.path.endsWith('sounds.json')) for (const [id, d] of Object.entries(JSON.parse(f.data as string))) soundNames.set(Number(id), (d as { name: string }).name);
  for (const { spec, archive, actions } of chars) {
    const dir = charDir(spec);
    const { attributes, special } = readAttributes(archive, spec.specialFields);
    files.push({ path: dir + 'attributes.json', data: json({ ...attributes, special }) });
    const extras = readExtras(archive, plco, spec.kind);
    const moves = convertMoves(archive, actions, attributes, (id) => soundNames.get(id) ?? String(id), spec.submotions, spec.behaviors);
    for (const m of moves) files.push({ path: dir + `moves/${m.name}.move`, data: m.text });
    log(`${spec.name} moves: ${moves.length} scripts`);
    const root = ftDataRoot(archive);
    const x44 = archive.ptr(root + 0x44);
    const character = {
      name: spec.name,
      id: spec.id,
      formatVersion: FORMAT_VERSION,
      modelScale: archive.f32(archive.ptr(root) + 0x8c),
      hiddenParts: hiddenParts(archive),
      costumes: ['default'],
      sounds: sounds.ftSfx.get(spec.id) ?? {},
      moves: moves.map((m) => m.name),
      // ECB bones, side offset and ledge-grab box (ftData +0x44: x, y, height), TransN joint (root motion).
      ecb: {
        bones: [0, 1, 2, 3, 4, 5].map((i) => archive.s16(x44 + 2 * i)), sideOffset: archive.f32(x44 + 12),
        ledgeSnap: [0x10, 0x14, 0x18].map((o) => tidy(archive.f32(x44 + o))),
      },
      transN: extras.parts[1],
      // Fighter_Part -> joint index (TopN, TransN, XRotN, ... TransN2).
      parts: extras.parts,
      shieldJoint: extras.shieldJoint,
      itemJoint: extras.itemJoint,
      hurtboxes: readHurtboxes(archive),
      // Push box (ftData +0x50): x offset and half width, for fighters shoving each other on the ground.
      push: [archive.f32(archive.ptr(root + 0x50)), archive.f32(archive.ptr(root + 0x50) + 4)].map(tidy),
      constraints: spec.constraints ?? [],
      articles: spec.laser ? { laser: readLaser(archive) } : {},
    };
    files.push({ path: dir + 'character.json', data: json(character) });
  }
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
