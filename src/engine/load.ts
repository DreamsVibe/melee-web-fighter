// Builds the engine's CharacterData from a character folder (after overrides are merged).
import type { FileMap } from '../shared/character';
import { bytes, text } from '../shared/character';
import { readAnim, type AnimData } from '../shared/animfile';
import { readSkeleton } from '../shared/modelfile';
import { parseMove } from '../shared/move';
import type { CharacterData, CompiledMove, Named } from './types';
import { BEHAVIORS } from './behaviors';
import { stageDir, type StageFile } from '../shared/stages';
import type { StageData } from './stagetypes';

/** A stage's collision, points and blast zones for the engine, from stages/<id>/stage.json. */
export function loadStage(files: FileMap, id: string): { data: StageData; file: StageFile } | null {
  const d = files.get(stageDir(id) + 'stage.json');
  if (d === undefined) return null;
  const file = JSON.parse(text(d)!) as StageFile;
  const f = Math.fround;
  // float32 like the game: a fighter integrated in float32 lines up exactly with a floor.
  const segments = file.segments.map((s) => ({ ...s, x0: f(s.x0), y0: f(s.y0), x1: f(s.x1), y1: f(s.y1) }));
  return { file, data: { segments, blast: file.blast, spawn: file.respawns[0] ?? file.spawns[0] ?? [0, 20] } };
}

export function loadCharacter(files: FileMap, dir: string, commonDir = 'common/'): CharacterData {
  const need = (p: string) => {
    const d = files.get(p);
    if (d === undefined) throw new Error(`The character folder is missing ${p}. Re-import your disc.`);
    return d;
  };
  const info = JSON.parse(text(need(dir + 'character.json'))!);
  const attrsAll = JSON.parse(text(need(dir + 'attributes.json'))!);
  const { special = {}, ...attrs } = attrsAll as Named & { special?: Named };
  const common = JSON.parse(text(need(commonDir + 'common.json'))!) as Named;
  const f = (o: Named) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.fround(v) : v])) as Named;

  const soundIds = new Map<string, number>();
  for (const [p, d] of files) {
    if (!p.endsWith('sounds/sounds.json')) continue;
    for (const [id, def] of Object.entries(JSON.parse(text(d)!))) soundIds.set((def as { name: string }).name, Number(id));
  }
  const soundId = (n: string) => {
    const id = soundIds.get(n) ?? Number(n);
    if (Number.isNaN(id)) throw new Error(`unknown sound "${n}"`);
    return id;
  };

  const anims = new Map<string, AnimData>();
  const anim = (name: string | null) => {
    if (!name) return null;
    if (!anims.has(name)) {
      const d = files.get(dir + `anims/${name}.anim`);
      if (!d) return null;
      anims.set(name, readAnim(bytes(d)!));
    }
    return anims.get(name)!;
  };

  const moves = new Map<string, CompiledMove>();
  for (const [p, d] of files) {
    if (!p.startsWith(dir + 'moves/') || !p.endsWith('.move')) continue;
    let m;
    try { m = parseMove(text(d)!, soundId); } catch (e) { throw new Error(`${p}: ${(e as Error).message}`); }
    const labels = new Map<string, number>();
    m.body.forEach((c, i) => { if (c.op === 'label') labels.set(c.name, i); });
    moves.set(m.name, {
      name: m.name, anim: anim(m.animation), animName: m.animation, animFlags: m.animFlags ?? 0,
      landingLag: m.landingLag, behavior: m.behavior, cmds: m.body, labels,
    });
  }
  for (const m of moves.values()) if (m.behavior) BEHAVIORS[m.behavior]?.();

  return {
    name: info.name,
    attrs: f(attrs as Named),
    special: f(special),
    common: f(common),
    moves,
    skeleton: readSkeleton(bytes(need(dir + 'model/skeleton.skel'))!),
    modelScale: Math.fround(info.modelScale),
    ecbBones: info.ecb?.bones ?? [41, 55, 25, 13, 7, 4],
    ecbSideOffset: info.ecb?.sideOffset ?? 0,
    ledgeSnap: info.ecb?.ledgeSnap ?? [0, 0, 0],
    transN: info.transN ?? 1,
    parts: info.parts ?? [],
    shieldJoint: info.shieldJoint ?? 0,
    itemJoint: info.itemJoint ?? 0,
    articles: Object.fromEntries(Object.entries(info.articles ?? {}).map(([k, v]) => [k, { lifetime: (v as Named).lifetime, scale: (v as Named).scale }])),
    sfx: info.sounds ?? {},
    soundIds,
    id: info.id ?? 'fox',
    hurtboxes: info.hurtboxes ?? [],
    push: info.push ?? [0, 3],
    constraints: info.constraints ?? [],
    laser: info.articles?.laser?.states ? info.articles.laser : null,
    // Imports from before the afterimage was read have none: the side special then doesn't hit.
    illusion: info.articles?.illusion?.states ? info.articles.illusion : null,
  };
}
